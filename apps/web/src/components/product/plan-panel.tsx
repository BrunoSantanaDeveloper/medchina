"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiListCheck from "@/icons/nexture/ni-list-check";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/** Field kinds a modality card can render — drives both view and edit. */
type FieldKind = "text" | "textarea" | "list" | "strategy";
type FieldDescriptor = { key: string; label: string; kind: FieldKind };

// The modality shapes of lib/therapeutic-plan.ts, as render descriptors. The
// order here is the order shown.
const MODALITIES: { slug: string; fields: FieldDescriptor[] }[] = [
  {
    slug: "acupuncture",
    fields: [
      { key: "objective", label: "plan-f-objective", kind: "textarea" },
      { key: "mainPoints", label: "plan-f-main-points", kind: "list" },
      { key: "complementaryPoints", label: "plan-f-complementary-points", kind: "list" },
      { key: "meridians", label: "plan-f-meridians", kind: "list" },
      { key: "strategy", label: "plan-f-strategy", kind: "strategy" },
      { key: "frequency", label: "plan-f-frequency", kind: "text" },
    ],
  },
  {
    slug: "diet",
    fields: [
      { key: "thermalNature", label: "plan-f-thermal", kind: "text" },
      { key: "favor", label: "plan-f-favor", kind: "list" },
      { key: "reduce", label: "plan-f-reduce", kind: "list" },
      { key: "mealSuggestions", label: "plan-f-meals", kind: "list" },
      { key: "restrictions", label: "plan-f-restrictions", kind: "textarea" },
    ],
  },
  {
    slug: "moxibustion",
    fields: [
      { key: "technique", label: "plan-f-technique", kind: "text" },
      { key: "pointsOrRegion", label: "plan-f-points-region", kind: "text" },
      { key: "objective", label: "plan-f-objective", kind: "textarea" },
      { key: "contraindicationChecklist", label: "plan-f-checklist", kind: "list" },
    ],
  },
  {
    slug: "auriculotherapy",
    fields: [
      { key: "points", label: "plan-f-points", kind: "list" },
      { key: "material", label: "plan-f-material", kind: "text" },
      { key: "side", label: "plan-f-side", kind: "text" },
      { key: "stimulationGuidance", label: "plan-f-stimulation", kind: "textarea" },
      { key: "reassessment", label: "plan-f-reassessment", kind: "text" },
    ],
  },
  {
    slug: "cupping",
    fields: [
      { key: "technique", label: "plan-f-technique", kind: "text" },
      { key: "region", label: "plan-f-region", kind: "text" },
      { key: "intensity", label: "plan-f-intensity", kind: "text" },
      { key: "duration", label: "plan-f-duration", kind: "text" },
      { key: "postSessionGuidance", label: "plan-f-post-session", kind: "textarea" },
    ],
  },
];

const STRATEGIES = ["tonify", "disperse", "harmonize", "warm", "regulate"] as const;

type Modality = Record<string, unknown>;
type SafetyFlag = { category: string; matchedText: string; fieldKey?: string };
type Source = { title: string; source: string | null; kind: string };

type Plan = {
  id: string;
  objective: string;
  modalities: Record<string, Modality>;
  safetyFlags: SafetyFlag[];
  sources: Source[];
  status: "draft" | "validated";
  model: string | null;
};

/**
 * The therapeutic plan (PRD §10.9) — the Pro layer's deliverable, built on the
 * accepted hypotheses. It is a DRAFT until the professional validates it
 * (PRD §10.10): nothing here prescribes.
 *
 * The safety contract is the spine of the design:
 *  - contraindications and sensitive factors (PRD §10.10) sit at the TOP, in
 *    amber, and she must acknowledge them to validate — they are never hidden
 *    below a fold;
 *  - every field is editable, because a plan is a starting point for her
 *    judgement, not an instruction (PRD §10.9 "sempre editável").
 *
 * Issuing the signed, QR-verifiable document (PRD §9.8) is a separate act on a
 * validated plan — not built here yet.
 */
export default function PlanPanel({
  consultationId,
  canReason,
  isFinalized,
}: {
  consultationId: string;
  canReason: boolean;
  isFinalized: boolean;
}) {
  const t = useTranslations("product");
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ objective: string; modalities: Record<string, Modality> } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setPlan(null);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("consultation_plans")
      .select("id, objective, modalities, safety_flags, sources, status, model")
      .eq("consultation_id", consultationId)
      .maybeSingle();
    setPlan(
      data
        ? {
            id: data.id,
            objective: data.objective ?? "",
            modalities: (data.modalities ?? {}) as Record<string, Modality>,
            safetyFlags: (data.safety_flags ?? []) as SafetyFlag[],
            sources: (data.sources ?? []) as Source[],
            status: data.status,
            model: data.model,
          }
        : null,
    );
  }, [consultationId]);

  useEffect(() => {
    load();
  }, [load]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/plan`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          body.error === "reasoning_not_available"
            ? t("plan-not-available")
            : body.error === "plan_validated"
              ? t("plan-already-validated")
              : body.error === "nothing_recorded"
                ? t("plan-nothing-recorded")
                : (body.error ?? t("plan-error")),
        );
        return;
      }
      await load();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("plan-error"));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    if (!plan) return;
    setDraft({ objective: plan.objective, modalities: structuredClone(plan.modalities) });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!plan || !draft) return;
    setBusy(true);
    const supabase = createClient();
    // Editing a validated plan returns it to draft — the previous validation
    // was of a different plan (PRD §10.10: her action validates a plan).
    await supabase
      .from("consultation_plans")
      .update({
        objective: draft.objective,
        modalities: draft.modalities,
        status: "draft",
        validated_by: null,
        validated_at: null,
      })
      .eq("id", plan.id);
    setEditing(false);
    setDraft(null);
    setBusy(false);
    await load();
  };

  const validate = async () => {
    if (!plan) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase
      .from("consultation_plans")
      .update({ status: "validated", validated_by: user?.id ?? null, validated_at: new Date().toISOString() })
      .eq("id", plan.id);
    setBusy(false);
    setAcknowledged(false);
    await load();
  };

  if (plan === undefined) return null;

  // Nothing to show and nothing to sell here without the Pro layer (PRD §7.4).
  if (!plan && !canReason) return null;

  const activeModalities = plan ? MODALITIES.filter((m) => plan.modalities[m.slug]?.enabled) : [];
  const mustAcknowledge = (plan?.safetyFlags.length ?? 0) > 0;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <NiListCheck size="medium" className="text-primary" />
          <Typography variant="h6" component="h2">
            {t("plan-title")}
          </Typography>
          {plan?.status === "validated" && (
            <Chip
              size="small"
              icon={<NiCheckSquare size="tiny" />}
              label={t("plan-validated-badge")}
              className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light ml-auto text-xs font-semibold"
            />
          )}
        </Box>

        {error && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        )}

        {!plan ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("plan-empty")}
            </Typography>
            {!isFinalized && canReason && (
              <Button variant="contained" color="primary" onClick={prepare} disabled={busy} className="self-start">
                {busy ? <CircularProgress size={18} /> : t("plan-prepare")}
              </Button>
            )}
          </>
        ) : (
          <>
            {/* Contraindications first, in amber, never hidden (PRD §10.10). */}
            {plan.safetyFlags.length > 0 && (
              <Alert severity="warning" className="neutral bg-background-paper/60! flex flex-col gap-1">
                <Typography variant="body2" className="font-semibold">
                  {t("plan-safety-title")}
                </Typography>
                {plan.safetyFlags.map((flag, index) => (
                  <Typography key={index} variant="body2" className="text-xs leading-5">
                    · {t(`plan-safety-${flag.category}`)}: {flag.matchedText}
                  </Typography>
                ))}
              </Alert>
            )}

            {/* Objective */}
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                {t("plan-objective")}
              </Typography>
              {editing ? (
                <TextField
                  multiline
                  minRows={2}
                  fullWidth
                  size="small"
                  value={draft?.objective ?? ""}
                  onChange={(event) => setDraft((d) => (d ? { ...d, objective: event.target.value } : d))}
                />
              ) : (
                <Typography variant="body2" className="text-text-secondary leading-6">
                  {plan.objective || "—"}
                </Typography>
              )}
            </Box>

            {activeModalities.map((modality) => (
              <ModalityCard
                key={modality.slug}
                slug={modality.slug}
                fields={modality.fields}
                data={(editing ? draft?.modalities[modality.slug] : plan.modalities[modality.slug]) as Modality}
                editing={editing}
                t={t}
                onChange={(next) =>
                  setDraft((d) => (d ? { ...d, modalities: { ...d.modalities, [modality.slug]: next } } : d))
                }
              />
            ))}

            {plan.sources.length > 0 && (
              <Box className="flex flex-col gap-1">
                <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                  {t("plan-sources")}
                </Typography>
                {plan.sources.map((source, index) => (
                  <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
                    · {source.title}
                    {source.source ? ` — ${source.source}` : ""}
                  </Typography>
                ))}
              </Box>
            )}

            {!isFinalized && (
              <Box className="flex flex-col gap-2">
                {editing ? (
                  <Box className="flex flex-row flex-wrap gap-2">
                    <Button variant="contained" color="primary" onClick={saveEdit} disabled={busy}>
                      {t("plan-save")}
                    </Button>
                    <Button
                      color="grey"
                      onClick={() => {
                        setEditing(false);
                        setDraft(null);
                      }}
                    >
                      {t("plan-cancel")}
                    </Button>
                  </Box>
                ) : (
                  <>
                    {plan.status === "draft" && mustAcknowledge && (
                      <FormControlLabel
                        control={
                          <Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                        }
                        label={
                          <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                            {t("plan-acknowledge")}
                          </Typography>
                        }
                      />
                    )}
                    <Box className="flex flex-row flex-wrap gap-2">
                      {plan.status === "draft" && (
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={validate}
                          disabled={busy || (mustAcknowledge && !acknowledged)}
                        >
                          {t("plan-validate")}
                        </Button>
                      )}
                      <Button variant="outlined" color="grey" onClick={startEdit} disabled={busy}>
                        {t("plan-edit")}
                      </Button>
                      {canReason && plan.status === "draft" && (
                        <Button variant="text" color="grey" onClick={prepare} disabled={busy}>
                          {busy ? <CircularProgress size={16} /> : t("plan-reprepare")}
                        </Button>
                      )}
                    </Box>
                  </>
                )}
              </Box>
            )}
          </>
        )}

        {/* The plan is a draft aid, not a prescription (PRD §10.9/§10.11). */}
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("plan-disclaimer")}
        </Typography>
      </CardContent>
    </Card>
  );
}

function ModalityCard({
  slug,
  fields,
  data,
  editing,
  t,
  onChange,
}: {
  slug: string;
  fields: FieldDescriptor[];
  data: Modality;
  editing: boolean;
  t: (key: string) => string;
  onChange: (next: Modality) => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...data, [key]: value });

  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border px-3.5 py-3">
      <Typography variant="body1" className="text-text-primary font-semibold">
        {t(`plan-modality-${slug}`)}
      </Typography>
      {fields.map((field) => {
        const raw = data?.[field.key];
        return (
          <Box key={field.key} className="flex flex-col gap-1">
            <Typography variant="body2" className="text-text-primary text-xs font-semibold">
              {t(field.label)}
            </Typography>
            {editing ? (
              <FieldEditor kind={field.kind} value={raw} t={t} onChange={(value) => set(field.key, value)} />
            ) : (
              <FieldView kind={field.kind} value={raw} t={t} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function FieldView({ kind, value, t }: { kind: FieldKind; value: unknown; t: (key: string) => string }) {
  if (kind === "list") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    if (list.length === 0) return <Dash />;
    return (
      <Box className="flex flex-col gap-0.5">
        {list.map((item, index) => (
          <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
            · {item}
          </Typography>
        ))}
      </Box>
    );
  }
  if (kind === "strategy") {
    const label = value ? t(`plan-strategy-${value}`) : "";
    return label ? (
      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
        {label}
      </Typography>
    ) : (
      <Dash />
    );
  }
  const text = typeof value === "string" ? value.trim() : "";
  return text ? (
    <Typography variant="body2" className="text-text-secondary text-xs leading-5">
      {text}
    </Typography>
  ) : (
    <Dash />
  );
}

function FieldEditor({
  kind,
  value,
  t,
  onChange,
}: {
  kind: FieldKind;
  value: unknown;
  t: (key: string) => string;
  onChange: (value: unknown) => void;
}) {
  if (kind === "strategy") {
    return (
      <TextField
        select
        size="small"
        fullWidth
        value={(value as string) ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <MenuItem value="">—</MenuItem>
        {STRATEGIES.map((strategy) => (
          <MenuItem key={strategy} value={strategy}>
            {t(`plan-strategy-${strategy}`)}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (kind === "list") {
    // One item per line — the honest, low-friction way to edit a short list.
    const text = Array.isArray(value) ? (value as string[]).join("\n") : "";
    return (
      <TextField
        multiline
        minRows={2}
        size="small"
        fullWidth
        value={text}
        placeholder={t("plan-list-hint")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }
  return (
    <TextField
      multiline={kind === "textarea"}
      minRows={kind === "textarea" ? 2 : undefined}
      size="small"
      fullWidth
      value={(value as string) ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const Dash = () => (
  <Typography variant="body2" className="text-text-secondary text-xs leading-5">
    —
  </Typography>
);
