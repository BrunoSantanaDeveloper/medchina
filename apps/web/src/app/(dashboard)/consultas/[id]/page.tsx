"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Popover,
  Skeleton,
  Typography,
} from "@mui/material";

import ConsultationRecorder from "@/components/product/consultation-recorder";
import RecordingsPanel from "@/components/product/recordings-panel";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiPlay from "@/icons/nexture/ni-play";
import { ANAMNESIS_BLOCKS, PROFESSIONAL_OBSERVATION_FIELDS } from "@/lib/anamnesis";
import { recordAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Provenance = { quote?: string; start?: string; speaker?: string };
type FieldMeta = { value: string; state: string; source: string; provenance: Provenance };

type Consultation = {
  id: string;
  orgId: string;
  patientId: string;
  patientName: string;
  status: string;
  chiefComplaint: string | null;
  summary: string | null;
  startedAt: string;
  aiGaps: string[];
};

type Addendum = { id: string; body: string; reason: string | null; createdAt: string };

/**
 * The consultation record (PRD §8.3/§10.6/§8.5). The job: review what the AI
 * drafted (or type it manually), decide, and close the record.
 *
 * The AI never produces a fact — it produces a DRAFT with, per field, a review
 * STATE and an ORIGIN, plus PROVENANCE (the transcript excerpt it came from):
 *  - state: clear (evidence) / attention (ambiguous/sensitive) / edited (the
 *    professional changed it) — surfaced as a chip so review focuses on what
 *    needs it (PRD §10.6);
 *  - origin: patient report vs practitioner observation vs AI inference stay
 *    visually distinct (PRD §10.3);
 *  - editing a field flips it to the professional's own words (source
 *    professional, state edited), so a human decision is never mistaken for AI.
 *
 * Two DB-enforced rules the UI keeps honest: a blank field is "não informado"
 * (clearing DELETES the answer, PRD §10.5), and a finalized record is frozen
 * (corrections are addenda, PRD §8.5).
 */
export default function ConsultaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations("product");

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [fields, setFields] = useState<Record<string, FieldMeta>>({});
  const [addenda, setAddenda] = useState<Addendum[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [addendumOpen, setAddendumOpen] = useState(false);
  const [addendumBody, setAddendumBody] = useState("");
  const [addendumReason, setAddendumReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [provenanceAnchor, setProvenanceAnchor] = useState<{ el: HTMLElement; data: Provenance } | null>(null);

  // Last persisted value per field so blur only writes real changes.
  const persisted = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    const [{ data: row }, { data: answerRows }, { data: addendaRows }] = await Promise.all([
      supabase
        .from("consultations")
        .select("id, org_id, patient_id, status, chief_complaint, summary, started_at, ai_gaps, patients(full_name)")
        .eq("id", params.id)
        .maybeSingle(),
      supabase
        .from("anamnesis_answers")
        .select("block_key, field_key, value, state, source, provenance")
        .eq("consultation_id", params.id),
      supabase
        .from("consultation_addenda")
        .select("id, body, reason, created_at")
        .eq("consultation_id", params.id)
        .order("created_at"),
    ]);

    if (row) {
      const patient = row.patients as unknown as { full_name: string } | null;
      setConsultation({
        id: row.id,
        orgId: row.org_id,
        patientId: row.patient_id,
        patientName: patient?.full_name ?? "—",
        status: row.status,
        chiefComplaint: row.chief_complaint,
        summary: row.summary,
        startedAt: row.started_at,
        aiGaps: (row.ai_gaps as string[] | null) ?? [],
      });
    }

    const map: Record<string, FieldMeta> = {};
    const persistedMap: Record<string, string> = {};
    for (const answer of answerRows ?? []) {
      const composite = `${answer.block_key}.${answer.field_key}`;
      map[composite] = {
        value: answer.value as string,
        state: (answer.state as string) ?? "clear",
        source: (answer.source as string) ?? "professional",
        provenance: (answer.provenance as Provenance) ?? {},
      };
      persistedMap[composite] = answer.value as string;
    }
    setFields(map);
    persisted.current = persistedMap;

    setAddenda(
      (addendaRows ?? []).map((addendum) => ({
        id: addendum.id,
        body: addendum.body,
        reason: addendum.reason,
        createdAt: addendum.created_at,
      })),
    );
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const isFinalized = consultation?.status === "finalized";

  const setFieldValue = (composite: string, value: string) =>
    setFields((current) => ({
      ...current,
      [composite]: current[composite]
        ? { ...current[composite], value }
        : { value, state: "clear", source: "professional", provenance: {} },
    }));

  const saveAnswer = async (blockKey: string, fieldKey: string) => {
    if (!consultation || isFinalized) return;
    const composite = `${blockKey}.${fieldKey}`;
    const value = (fields[composite]?.value ?? "").trim();
    if (value === (persisted.current[composite] ?? "")) return;

    setSavingKey(composite);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!value) {
      // Clearing a field REMOVES the answer — an empty field is "not informed",
      // never a stored negative (PRD §10.5).
      const { error: deleteError } = await supabase
        .from("anamnesis_answers")
        .delete()
        .eq("consultation_id", consultation.id)
        .eq("block_key", blockKey)
        .eq("field_key", fieldKey);
      if (deleteError) setError(deleteError.message);
      else {
        delete persisted.current[composite];
        setFields((current) => {
          const next = { ...current };
          delete next[composite];
          return next;
        });
      }
      setSavingKey(null);
      return;
    }

    // A professional edit becomes HER value: source professional, state edited
    // — an AI draft the human changed is no longer an AI inference.
    const wasAi = fields[composite]?.source === "ai_inference" || fields[composite]?.source === "patient_report";
    const source = PROFESSIONAL_OBSERVATION_FIELDS.has(composite) ? "professional_voice" : "professional";
    const state = wasAi ? "edited" : "clear";

    const { error: upsertError } = await supabase.from("anamnesis_answers").upsert(
      {
        org_id: consultation.orgId,
        consultation_id: consultation.id,
        block_key: blockKey,
        field_key: fieldKey,
        value,
        source,
        state,
        created_by: user?.id ?? null,
      },
      { onConflict: "consultation_id,block_key,field_key" },
    );

    if (upsertError) setError(upsertError.message);
    else {
      persisted.current[composite] = value;
      setFields((current) => ({
        ...current,
        [composite]: { ...current[composite], value, source, state },
      }));
    }
    setSavingKey(null);
  };

  const saveHeaderField = async (field: "chief_complaint" | "summary", value: string) => {
    if (!consultation || isFinalized) return;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("consultations")
      .update({ [field]: value.trim() || null })
      .eq("id", consultation.id);
    if (updateError) setError(updateError.message);
  };

  const finalize = async () => {
    if (!consultation || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from("consultations")
      .update({ status: "finalized", finalized_at: new Date().toISOString(), finalized_by: user?.id ?? null })
      .eq("id", consultation.id);

    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    recordAudit(supabase, "consultation.finalized", {
      orgId: consultation.orgId,
      entityType: "consultation",
      entityId: consultation.id,
    });
    setFinalizeOpen(false);
    setBusy(false);
    await load();
    router.refresh();
  };

  const addAddendum = async () => {
    if (!consultation || !addendumBody.trim() || busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from("consultation_addenda").insert({
      org_id: consultation.orgId,
      consultation_id: consultation.id,
      body: addendumBody.trim(),
      reason: addendumReason.trim() || null,
      created_by: user?.id ?? null,
    });
    if (insertError) setError(insertError.message);
    else {
      recordAudit(supabase, "consultation.addendum.created", {
        orgId: consultation.orgId,
        entityType: "consultation",
        entityId: consultation.id,
      });
      setAddendumBody("");
      setAddendumReason("");
      setAddendumOpen(false);
      await load();
    }
    setBusy(false);
  };

  const filledCount = useMemo(() => Object.values(fields).filter((meta) => meta.value.trim()).length, [fields]);
  const attentionCount = useMemo(
    () => Object.values(fields).filter((meta) => meta.state === "attention").length,
    [fields],
  );

  if (!consultation) {
    return <Skeleton variant="rounded" height={420} className="rounded-3xl" />;
  }

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
          <Box>
            <Typography variant="h1" component="h1" className="mb-0">
              {consultation.patientName}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("home-breadcrumb")}
              </Link>
              <Link color="inherit" href={`/pacientes/${consultation.patientId}`}>
                {consultation.patientName}
              </Link>
              <Typography variant="body2">{new Date(consultation.startedAt).toLocaleDateString()}</Typography>
            </Breadcrumbs>
          </Box>

          {isFinalized ? (
            <Button variant="outlined" color="grey" onClick={() => setAddendumOpen(true)}>
              {t("consultation-add-addendum")}
            </Button>
          ) : (
            <Button variant="contained" color="primary" onClick={() => setFinalizeOpen(true)} disabled={busy}>
              {t("consultation-finalize")}
            </Button>
          )}
        </Box>
      </Grid>

      {/* An AI-drafted consultation says so, and points review at the exceptions. */}
      {consultation.status === "awaiting_review" && (
        <Grid size={12}>
          <Alert severity="info" icon={<NiListCheck />} className="neutral bg-background-paper/60!">
            {attentionCount > 0
              ? t("consultation-review-attention", { count: attentionCount })
              : t("consultation-review-ready")}
          </Alert>
        </Grid>
      )}

      {isFinalized && (
        <Grid size={12}>
          <Alert severity="success" icon={<NiLock />} className="neutral bg-background-paper/60!">
            {t("consultation-finalized-notice")}
          </Alert>
        </Grid>
      )}

      {error && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        </Grid>
      )}

      <Grid size={{ xs: 12, lg: 8 }}>
        <Card component="section">
          <CardContent className="flex flex-col gap-4">
            <Box>
              <Typography variant="h5" component="h2" className="card-title">
                {t("consultation-anamnesis-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("consultation-anamnesis-subtitle")}
              </Typography>
            </Box>

            <FormControl className="outlined" variant="standard" size="small">
              <FormLabel component="label">{t("field-main-complaint")}</FormLabel>
              <Input
                multiline
                minRows={2}
                disabled={isFinalized}
                defaultValue={consultation.chiefComplaint ?? ""}
                onBlur={(event) => saveHeaderField("chief_complaint", event.target.value)}
              />
            </FormControl>

            {ANAMNESIS_BLOCKS.map((block) => (
              <Accordion
                key={block.key}
                elevation={0}
                disableGutters
                defaultExpanded={block.key === "complaint"}
                className="border-grey-100 bg-background-paper rounded-2xl! border"
              >
                <AccordionSummary expandIcon={<NiChevronDownSmall />} className="px-5! py-2!">
                  <Typography component="h3" variant="subtitle1">
                    {t(block.title)}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails className="flex flex-col gap-1 px-5! pt-0! pb-5!">
                  {block.fields.map((field) => {
                    const composite = `${block.key}.${field.key}`;
                    const meta = fields[composite];
                    const isObservation = PROFESSIONAL_OBSERVATION_FIELDS.has(composite);
                    return (
                      <FormControl key={field.key} className="outlined" variant="standard" size="small">
                        <FormLabel component="label" className="flex flex-row flex-wrap items-center gap-2">
                          {t(field.label)}
                          {isObservation && (
                            <span className="bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light rounded-full px-2 py-0.5 text-xs font-semibold">
                              {t("field-observation-badge")}
                            </span>
                          )}
                          {meta?.value && (
                            <StateChip state={meta.state} sourceLabel={t(`source-${meta.source}`)} t={t} />
                          )}
                          {meta?.provenance?.quote && (
                            <button
                              type="button"
                              className="text-secondary-dark dark:text-secondary-light inline-flex items-center gap-1 text-xs font-semibold"
                              onClick={(event) =>
                                setProvenanceAnchor({ el: event.currentTarget, data: meta.provenance })
                              }
                            >
                              <NiPlay size="tiny" />
                              {t("field-provenance")}
                            </button>
                          )}
                          {savingKey === composite && (
                            <span className="text-text-secondary text-xs">{t("saving")}</span>
                          )}
                        </FormLabel>
                        <Input
                          multiline={field.multiline}
                          minRows={field.multiline ? 2 : undefined}
                          disabled={isFinalized}
                          value={meta?.value ?? ""}
                          onChange={(event) => setFieldValue(composite, event.target.value)}
                          onBlur={() => saveAnswer(block.key, field.key)}
                        />
                      </FormControl>
                    );
                  })}
                </AccordionDetails>
              </Accordion>
            ))}

            <FormControl className="outlined" variant="standard" size="small">
              <FormLabel component="label">{t("consultation-summary")}</FormLabel>
              <Input
                multiline
                minRows={3}
                disabled={isFinalized}
                defaultValue={consultation.summary ?? ""}
                onBlur={(event) => saveHeaderField("summary", event.target.value)}
              />
            </FormControl>
          </CardContent>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, lg: 4 }}>
        <Box className="flex flex-col gap-5">
          {!isFinalized && (
            <ConsultationRecorder
              orgId={consultation.orgId}
              patientId={consultation.patientId}
              consultationId={consultation.id}
            />
          )}

          {!isFinalized && <RecordingsPanel consultationId={consultation.id} onProcessed={load} />}

          {/* Gaps are suggestions to investigate — never answers (PRD §10.7). */}
          {consultation.aiGaps.length > 0 && !isFinalized && (
            <Card component="section">
              <CardContent className="flex flex-col gap-2">
                <Typography variant="h6" component="h2">
                  {t("consultation-gaps-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary text-xs">
                  {t("consultation-gaps-subtitle")}
                </Typography>
                <Box component="ul" className="flex flex-col gap-1.5">
                  {consultation.aiGaps.map((gap) => (
                    <li key={gap} className="text-text-primary flex items-start gap-2 text-sm leading-5">
                      <span aria-hidden className="bg-accent-3 mt-1.5 h-1.5 w-1.5 flex-none rounded-full" />
                      {gap}
                    </li>
                  ))}
                </Box>
              </CardContent>
            </Card>
          )}

          <Card component="section">
            <CardContent className="flex flex-col gap-2">
              <Typography variant="h6" component="h2">
                {t("consultation-state-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary leading-6">
                {t("consultation-state-body", { count: filledCount })}
              </Typography>
              <Typography variant="body2" className="text-text-secondary leading-6">
                {t("consultation-absence-note")}
              </Typography>
            </CardContent>
          </Card>

          {addenda.length > 0 && (
            <Card component="section">
              <CardContent className="flex flex-col gap-3">
                <Typography variant="h6" component="h2">
                  {t("consultation-addenda-title")}
                </Typography>
                {addenda.map((addendum) => (
                  <Box key={addendum.id} className="border-grey-100 rounded-2xl border p-3">
                    <Typography variant="body2" className="text-text-primary leading-6">
                      {addendum.body}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary mt-1 text-xs">
                      {new Date(addendum.createdAt).toLocaleString()}
                      {addendum.reason ? ` · ${addendum.reason}` : ""}
                    </Typography>
                  </Box>
                ))}
              </CardContent>
            </Card>
          )}
        </Box>
      </Grid>

      {/* Provenance: the transcript excerpt an AI value came from (PRD §13.1). */}
      <Popover
        open={Boolean(provenanceAnchor)}
        anchorEl={provenanceAnchor?.el ?? null}
        onClose={() => setProvenanceAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box className="flex max-w-xs flex-col gap-1 p-4">
          <Typography variant="body2" className="text-text-secondary font-mono text-xs">
            {provenanceAnchor?.data.speaker}
            {provenanceAnchor?.data.start ? ` · ${provenanceAnchor.data.start}` : ""}
          </Typography>
          <Typography variant="body2" className="text-text-primary leading-6 italic">
            “{provenanceAnchor?.data.quote}”
          </Typography>
        </Box>
      </Popover>

      {/* Finalizing is irreversible — say so before it happens. */}
      <Dialog open={finalizeOpen} onClose={() => setFinalizeOpen(false)}>
        <DialogTitle className="flex flex-row items-center gap-2">
          <NiCheckSquare size="medium" className="text-primary" />
          {t("consultation-finalize-title")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" className="text-text-secondary leading-6">
            {t("consultation-finalize-body")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setFinalizeOpen(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={finalize} disabled={busy}>
            {t("consultation-finalize-confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addendumOpen} onClose={() => setAddendumOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("consultation-addendum-title")}</DialogTitle>
        <DialogContent className={cn("flex flex-col gap-2")}>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("consultation-addendum-body")}
          </Typography>
          <FormControl className="outlined" variant="standard" size="small">
            <FormLabel component="label">{t("consultation-addendum-text")}</FormLabel>
            <Input
              multiline
              minRows={3}
              value={addendumBody}
              onChange={(event) => setAddendumBody(event.target.value)}
            />
          </FormControl>
          <FormControl className="outlined" variant="standard" size="small">
            <FormLabel component="label">{t("consultation-addendum-reason")}</FormLabel>
            <Input value={addendumReason} onChange={(event) => setAddendumReason(event.target.value)} />
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setAddendumOpen(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={addAddendum} disabled={busy || !addendumBody.trim()}>
            {t("consultation-addendum-save")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}

/**
 * The per-field review chip: state (clear/attention/edited) + origin. Colors
 * map to the site motif — jade = clear evidence, terracotta = needs attention,
 * neutral = the professional's own edit. Never red (reserved for risk).
 */
function StateChip({ state, sourceLabel, t }: { state: string; sourceLabel: string; t: (key: string) => string }) {
  const style =
    state === "attention"
      ? "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light"
      : state === "edited"
        ? "bg-grey-100 text-text-secondary"
        : "bg-accent-1/12 text-accent-1-dark dark:text-accent-1-light";
  const label =
    state === "attention" ? t("state-attention") : state === "edited" ? t("state-edited") : t("state-clear");
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", style)} title={sourceLabel}>
      {label}
    </span>
  );
}
