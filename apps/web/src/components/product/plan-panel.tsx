"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import ConsultationStepHeader from "@/components/product/consultation-step-header";
import DialogHeader from "@/components/product/dialog-header";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiListCheck from "@/icons/nexture/ni-list-check";
import { hasHomeGuidance } from "@/lib/home-guidance";
import { type FieldDescriptor, type FieldKind, PLAN_MODALITIES, PLAN_STRATEGIES } from "@/lib/plan-modalities";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type Modality = Record<string, unknown>;
type SafetyFlag = { category: string; matchedText: string; fieldKey?: string };
type Source = { title: string; source: string | null; kind: string };
type IssuedDocument = {
  id: string;
  /** "therapeutic-plan" (clinical) or "home-guidance" (the patient's sheet). */
  kind: string;
  version: number;
  verifyCode: string;
  status: string;
  issuedAt: string | null;
  storagePath: string | null;
};

type Plan = {
  id: string;
  objective: string;
  modalities: Record<string, Modality>;
  safetyFlags: SafetyFlag[];
  sources: Source[];
  status: "draft" | "validated";
  origin: "manual" | "ai";
  updatedAt: string;
  model: string | null;
  staleAt: string | null;
};
type PlanData = { plan: Plan; documents: IssuedDocument[] };

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
  hasAcceptedHypotheses,
  isFinalized,
}: {
  consultationId: string;
  canReason: boolean;
  /**
   * Whether at least one hypothesis is accepted/edited. The AI plan is BUILT on
   * those (PRD §10.9), so preparing without one is refused server-side
   * (`accepted_hypothesis_required`). We gate the button on it instead of
   * letting the click surface a warning after the fact.
   */
  hasAcceptedHypotheses: boolean;
  isFinalized: boolean;
}) {
  const t = useTranslations("product");
  const [planState, setPlanState] = useState<RemoteState<PlanData, "load_failed">>(() => remoteLoading());
  const planRef = useRef<PlanData | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Reading and editing the plan is deliberate work over long content — it
  // happens in a dialog so this column stays a summary.
  const [planOpen, setPlanOpen] = useState(false);
  const [draft, setDraft] = useState<{ objective: string; modalities: Record<string, Modality> } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  // What she declared she treats with (activation step). `null` while unknown;
  // an empty array means she never declared one.
  const [practiceScope, setPracticeScope] = useState<string[] | null>(null);
  /** Set when the last preparation ran WITHOUT the library, because it failed. */
  const [retrievalFailed, setRetrievalFailed] = useState(false);
  /** Reissuing revokes the signed PDF that is already in the patient's hands. */
  const [confirmReissue, setConfirmReissue] = useState(false);
  /** The issued document she is handing to the patient (PRD §9.8). */
  const [sharingDoc, setSharingDoc] = useState<IssuedDocument | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareResult, setShareResult] = useState<{
    url: string;
    /** Set for the WhatsApp handoff: the wa.me link she presses send in. */
    whatsappUrl?: string | null;
    delivered: boolean;
    reason?: string;
  } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const issueKey = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("practice_modalities").eq("id", user.id).maybeSingle();
      if (active) setPracticeScope((data?.practice_modalities as string[] | null) ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(
    async (preservePrevious = true) => {
      if (!preservePrevious) planRef.current = undefined;
      const previous = preservePrevious ? planRef.current : undefined;
      setPlanState(remoteLoading(previous));
      if (!isSupabaseConfigured) {
        planRef.current = undefined;
        setPlanState(remoteEmpty());
        return;
      }
      const supabase = createClient();
      const { data, error: planError } = await supabase
        .from("consultation_plans")
        .select("id, objective, modalities, safety_flags, sources, status, origin, updated_at, model, stale_at")
        .eq("consultation_id", consultationId)
        .maybeSingle();
      if (planError) {
        setPlanState(remoteError("load_failed", previous));
        return;
      }
      if (!data) {
        planRef.current = undefined;
        setPlanState(remoteEmpty());
        return;
      }
      const plan: Plan = {
        id: data.id,
        objective: data.objective ?? "",
        modalities: (data.modalities ?? {}) as Record<string, Modality>,
        safetyFlags: (data.safety_flags ?? []) as SafetyFlag[],
        sources: (data.sources ?? []) as Source[],
        status: data.status,
        origin: data.origin,
        updatedAt: data.updated_at,
        model: data.model,
        staleAt: data.stale_at,
      };

      // Documents already issued from this plan (PRD §9.8) — newest first.
      // Both kinds: the clinical plan and the patient's home-guidance sheet,
      // which share this source and this panel.
      const { data: docs, error: documentsError } = await supabase
        .from("documents")
        .select("id, kind, version, verify_code, status, issued_at, storage_path")
        .in("kind", ["therapeutic-plan", "home-guidance"])
        .eq("source_type", "consultation_plan")
        .eq("source_id", data.id)
        .order("version", { ascending: false });
      const documents = documentsError
        ? previous?.plan.id === plan.id
          ? previous.documents
          : []
        : (docs ?? []).map((doc) => ({
            id: doc.id,
            kind: doc.kind as string,
            version: doc.version,
            verifyCode: doc.verify_code,
            status: doc.status,
            issuedAt: doc.issued_at,
            storagePath: doc.storage_path,
          }));
      const next = { plan, documents };
      planRef.current = next;
      setPlanState(documentsError ? remoteError("load_failed", next) : remoteSuccess(next));
    },
    [consultationId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const prepare = async (replaceManual = false) => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replaceManual }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "reasoning_not_available"
            ? t("plan-not-available")
            : code === "plan_validated"
              ? t("plan-already-validated")
              : code === "nothing_recorded"
                ? t("plan-nothing-recorded")
                : code === "accepted_hypothesis_required"
                  ? t("plan-accepted-hypothesis-required")
                  : code === "manual_plan_exists"
                    ? t("plan-manual-kept")
                    : t("plan-error"),
        );
        return;
      }
      setRetrievalFailed(Boolean(body?.retrievalFailed));
      await load(true);
    } catch {
      setActionError(t("plan-error"));
    } finally {
      setBusy(false);
    }
  };

  const createManual = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/plan/manual`, { method: "POST" });
      if (!response.ok) {
        setActionError(t("plan-error"));
        return;
      }
      await load(true);
    } catch {
      setActionError(t("plan-error"));
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
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/plan`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          objective: draft.objective,
          modalities: draft.modalities,
          expectedUpdatedAt: plan.updatedAt,
        }),
      });
      if (!response.ok) {
        setActionError(t("plan-conflict"));
        return;
      }
      setEditing(false);
      setDraft(null);
      await load(true);
    } catch {
      setActionError(t("plan-error"));
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    if (!plan) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/plan`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          expectedUpdatedAt: plan.updatedAt,
          acknowledgeSafety: acknowledged,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = body?.error?.code ?? body?.error;
        setActionError(code === "plan_stale" ? t("plan-stale") : t("plan-conflict"));
        return;
      }
      setAcknowledged(false);
      await load(true);
    } catch {
      setActionError(t("plan-error"));
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    const nextVersion = (planDocuments[0]?.version ?? 0) + 1;
    // Reissuing REVOKES the version already handed to the patient — its QR
    // starts reporting "substituído". An act with that consequence gets a real
    // dialog that names it, like every other irreversible act on this screen.
    if (planDocuments.length > 0 && !confirmReissue) {
      setConfirmReissue(true);
      return;
    }
    setConfirmReissue(false);
    setBusy(true);
    setActionError(null);
    try {
      issueKey.current ??= crypto.randomUUID();
      const response = await fetch(`/api/consultations/${consultationId}/plan/issue`, {
        method: "POST",
        headers: {
          "idempotency-key": issueKey.current,
          ...(planDocuments.length > 0 ? { "confirm-version": String(nextVersion) } : {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "plan_not_validated"
            ? t("plan-issue-need-validate")
            : code === "document_profile_incomplete"
              ? t("plan-issue-profile-incomplete")
              : code === "document_reissue_confirmation_required"
                ? t("plan-issue-version-conflict")
                : t("plan-issue-error"),
        );
        return;
      }
      issueKey.current = null;
      await load(true);
    } catch {
      setActionError(t("plan-issue-error"));
    } finally {
      setBusy(false);
    }
  };

  const download = async (doc: IssuedDocument) => {
    if (!doc.storagePath) return;
    setActionError(null);
    try {
      const supabase = createClient();
      // The documents bucket is private; a short-lived signed URL is RLS-gated to
      // members (migration 0006), so this never exposes another org's file.
      const { data, error: downloadError } = await supabase.storage
        .from("documents")
        .createSignedUrl(doc.storagePath, 120);
      if (downloadError || !data?.signedUrl) {
        setActionError(t("plan-download-error"));
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener");
    } catch {
      setActionError(t("plan-download-error"));
    }
  };

  /**
   * Issue the patient's home-guidance sheet — the plan's other half, in her
   * language (PRD §9.8). Same pipeline as the clinical document (versioned,
   * hashed, QR-verifiable); different audience.
   */
  const issueGuidance = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/guidance/issue`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "nothing_recorded"
            ? t("guidance-issue-empty")
            : code === "plan_not_validated"
              ? t("plan-issue-need-validate")
              : code === "document_profile_incomplete"
                ? t("plan-issue-profile-incomplete")
                : t("guidance-issue-error"),
        );
        return;
      }
      await load(true);
    } catch {
      setActionError(t("guidance-issue-error"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hand the document to the patient. The link is minted server-side and comes
   * back even when the chosen channel fails, so a WhatsApp outage degrades to
   * "copy the link" instead of leaving her with nothing to give.
   */
  const share = async (channel: "whatsapp" | "email" | "link") => {
    if (!sharingDoc) return;
    setShareBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/documents/${sharingDoc.id}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        whatsappUrl?: string | null;
        delivered?: boolean;
        deliveryReason?: string;
      };
      if (!response.ok || !body.ok || !body.url) {
        setActionError(t("plan-share-error"));
        return;
      }
      setShareResult({
        url: body.url,
        whatsappUrl: body.whatsappUrl ?? null,
        delivered: body.delivered === true,
        reason: body.deliveryReason,
      });
    } catch {
      setActionError(t("plan-share-error"));
    } finally {
      setShareBusy(false);
    }
  };

  const closeShare = () => {
    setSharingDoc(null);
    setShareResult(null);
    setShareCopied(false);
  };

  const resource =
    planState.status === "success"
      ? planState.data
      : planState.status === "loading" || planState.status === "error"
        ? planState.previous
        : undefined;
  const plan = resource?.plan ?? null;
  const documents = resource?.documents ?? [];
  // Versioning is per KIND: reissuing the clinical plan must not be confused
  // by the guidance sheet's own version line, and vice versa.
  const planDocuments = documents.filter((doc) => doc.kind === "therapeutic-plan");
  const guidanceDocuments = documents.filter((doc) => doc.kind === "home-guidance");
  const initialLoading = planState.status === "loading" && !resource;
  const loadFailed = planState.status === "error";
  const refreshing = planState.status === "loading" && Boolean(resource);

  if (initialLoading) return <CircularProgress size={24} aria-label={t("loading")} />;

  // Her declared practice bounds what she is offered to fill in (PRD §10.9):
  // filling a modality she does not practise is review work she cannot use. An
  // empty declaration means every modality, never none. A modality already
  // enabled on the plan stays visible even if it later fell out of scope —
  // otherwise she could not edit or switch it off.
  const scopedSlugs = practiceScope && practiceScope.length > 0 ? practiceScope : null;
  const isOffered = (slug: string) =>
    !scopedSlugs || scopedSlugs.includes(slug) || Boolean(plan?.modalities[slug]?.enabled);
  const activeModalities = plan
    ? editing
      ? PLAN_MODALITIES.filter((modality) => isOffered(modality.slug))
      : PLAN_MODALITIES.filter((modality) => plan.modalities[modality.slug]?.enabled)
    : [];
  // Nothing is hidden silently: say which modalities her scope left out, and
  // where to change it.
  const hiddenByScope = plan ? PLAN_MODALITIES.filter((modality) => !isOffered(modality.slug)) : [];
  const mustAcknowledge = (plan?.safetyFlags.length ?? 0) > 0;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <ConsultationStepHeader
          step={3}
          icon={<NiListCheck size="medium" />}
          title={t("plan-title")}
          hint={t("plan-step-hint")}
          trailing={
            plan?.status === "validated" ? (
              <Chip
                size="small"
                icon={<NiCheckSquare size="tiny" />}
                label={t("plan-validated-badge")}
                className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light ml-auto text-xs font-semibold"
              />
            ) : undefined
          }
        />

        {loadFailed && (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={() => void load(true)}>{t("retry")}</Button>}
          >
            {t("plan-load-error")}
          </Alert>
        )}

        {actionError && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {actionError}
          </Alert>
        )}

        {/* A plan built without the library is not a plan built on sources
            that happened to find nothing — say which one this is. */}
        {retrievalFailed && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("hypotheses-library-unavailable")}
          </Alert>
        )}

        {refreshing && <CircularProgress size={18} aria-label={t("loading")} />}

        {loadFailed && !resource ? null : !plan ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("plan-empty")}
            </Typography>
            {!isFinalized && (
              <Box className="flex flex-col gap-2">
                <Button
                  variant="contained"
                  color="primary"
                  fullWidth
                  startIcon={busy ? undefined : <NiListCheck size="tiny" />}
                  onClick={createManual}
                  disabled={busy}
                >
                  {busy ? <CircularProgress size={18} /> : t("plan-create-manual")}
                </Button>
                {canReason && (
                  <>
                    <Button
                      variant="outlined"
                      color="primary"
                      fullWidth
                      startIcon={<NiListCheck size="tiny" />}
                      onClick={() => prepare()}
                      // The AI plan is built ON the accepted hypotheses — until
                      // there is one it cannot run, so it stays disabled with the
                      // reason stated below rather than erroring after a click.
                      disabled={busy || !hasAcceptedHypotheses}
                    >
                      {t("plan-prepare")}
                    </Button>
                    {!hasAcceptedHypotheses && (
                      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                        {t("plan-accepted-hypothesis-required")}
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            )}
          </>
        ) : (
          <>
            {plan.staleAt && (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("plan-stale")}
              </Alert>
            )}
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

            {/* The column summarises; the plan itself is read and edited in the
                dialog, which has room for every modality's fields. Safety flags
                above stay on the page — they are never behind a click. */}
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {activeModalities.length > 0
                ? t("plan-summary-modalities", { count: activeModalities.length })
                : t("plan-summary-empty")}
            </Typography>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              startIcon={<NiListCheck size="tiny" />}
              onClick={() => setPlanOpen(true)}
            >
              {t("plan-open")}
            </Button>

            <Dialog open={planOpen} onClose={() => setPlanOpen(false)} maxWidth="md" fullWidth scroll="paper">
              <DialogHeader
                title={t("plan-title")}
                closeLabel={t("close")}
                onClose={() => setPlanOpen(false)}
                trailing={
                  plan.status === "validated" ? (
                    <Chip
                      size="small"
                      icon={<NiCheckSquare size="tiny" />}
                      label={t("plan-validated-badge")}
                      className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light text-xs font-semibold"
                    />
                  ) : undefined
                }
              />
              <DialogContent dividers className="flex flex-col gap-3 py-5!">
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

                {editing && hiddenByScope.length > 0 && (
                  <Alert
                    severity="info"
                    className="neutral bg-background-paper/60!"
                    action={
                      <Button size="small" color="inherit" href="/primeiros-passos">
                        {t("plan-scope-adjust")}
                      </Button>
                    }
                  >
                    {t("plan-scope-note", {
                      modalities: hiddenByScope.map((modality) => t(`plan-modality-${modality.slug}`)).join(", "),
                    })}
                  </Alert>
                )}

                {activeModalities.map((modality) => (
                  <ModalityCard
                    key={modality.slug}
                    slug={modality.slug}
                    fields={modality.fields}
                    data={
                      ((editing ? draft?.modalities[modality.slug] : plan.modalities[modality.slug]) ?? {
                        enabled: false,
                      }) as Modality
                    }
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

                {/* The acknowledgement is a READING task about the content
                    above, so it stays in the content. The act it unlocks lives
                    in the footer with the other decisions. */}
                {!isFinalized && !editing && plan.status === "draft" && mustAcknowledge && (
                  <FormControlLabel
                    control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />}
                    label={
                      <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                        {t("plan-acknowledge")}
                      </Typography>
                    }
                  />
                )}
                {/* The draft-not-a-prescription framing travels with the plan. */}
                <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                  {t("plan-disclaimer")}
                </Typography>
              </DialogContent>
              {/* Decisions live in the footer, pinned while the content scrolls:
                  a plan runs several modalities long, and "Validar" parked at the
                  bottom of the content meant scrolling to act. */}
              <DialogActions className="flex flex-row flex-wrap justify-end gap-2">
                {!isFinalized && editing ? (
                  <>
                    <Button
                      color="grey"
                      onClick={() => {
                        setEditing(false);
                        setDraft(null);
                      }}
                    >
                      {t("plan-cancel")}
                    </Button>
                    <Button variant="contained" color="primary" onClick={saveEdit} disabled={busy}>
                      {t("plan-save")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button color="grey" onClick={() => setPlanOpen(false)}>
                      {t("close")}
                    </Button>
                    {!isFinalized && canReason && plan.status === "draft" && plan.origin === "ai" && (
                      <Button
                        variant="text"
                        color="grey"
                        onClick={() => prepare()}
                        // Rebuilding still needs a settled hypothesis to build on.
                        disabled={busy || !hasAcceptedHypotheses}
                      >
                        {busy ? <CircularProgress size={16} /> : t("plan-reprepare")}
                      </Button>
                    )}
                    {!isFinalized && (
                      <Button variant="outlined" color="grey" onClick={startEdit} disabled={busy}>
                        {t("plan-edit")}
                      </Button>
                    )}
                    {!isFinalized && plan.status === "draft" && (
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={validate}
                        disabled={busy || (mustAcknowledge && !acknowledged)}
                      >
                        {t("plan-validate")}
                      </Button>
                    )}
                    {/* A validated plan can become a signed document (PRD §9.8).
                        Issuing again supersedes the previous version. */}
                    {!isFinalized && plan.status === "validated" && (
                      <Button variant="contained" color="primary" onClick={issue} disabled={busy}>
                        {busy ? (
                          <CircularProgress size={16} />
                        ) : planDocuments.some((doc) => doc.status === "issued") ? (
                          t("plan-reissue")
                        ) : (
                          t("plan-issue")
                        )}
                      </Button>
                    )}
                    {/* The patient's half of the same validated plan (PRD §9.8).
                        Offered only when the plan actually contains homework -
                        an empty handout wastes her attention. */}
                    {!isFinalized && plan.status === "validated" && hasHomeGuidance(plan.modalities) && (
                      <Button variant="outlined" color="primary" onClick={issueGuidance} disabled={busy}>
                        {guidanceDocuments.some((doc) => doc.status === "issued")
                          ? t("guidance-reissue")
                          : t("guidance-issue")}
                      </Button>
                    )}
                  </>
                )}
              </DialogActions>
            </Dialog>

            {/* Issued documents — viewable and verifiable even after the record
                is finalized (the plan freezes, the documents remain). */}
            {documents.length > 0 && (
              <Box className="flex flex-col gap-1.5">
                <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                  {t("plan-documents-title")}
                </Typography>
                {documents.map((doc) => (
                  <Box
                    key={doc.id}
                    className="border-grey-100 flex flex-row flex-wrap items-center gap-2 rounded-2xl border px-3 py-2"
                  >
                    <Box className="min-w-0 flex-1">
                      <Typography variant="body2" className="text-text-primary text-xs font-medium">
                        {/* Two kinds share this list now, so each names itself —
                            "versão 2" alone would be ambiguous. */}
                        {doc.kind === "home-guidance" ? t("guidance-title") : t("plan-title")} · {t("plan-doc-version")}{" "}
                        {doc.version}
                        {doc.status === "revoked" ? ` · ${t("plan-doc-superseded")}` : ""}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary font-mono text-xs">
                        {doc.verifyCode}
                      </Typography>
                    </Box>
                    <Button size="small" variant="text" color="grey" onClick={() => download(doc)}>
                      {t("plan-doc-download")}
                    </Button>
                    {/* The point of issuing it is that the PATIENT gets it. A
                        download alone ends the cycle inside the practitioner's
                        computer (PRD §9.8). Only for the CURRENT version — a
                        superseded document must not be handed out again. */}
                    {doc.status === "issued" && (
                      <Button size="small" variant="text" color="primary" onClick={() => setSharingDoc(doc)}>
                        {t("plan-doc-send")}
                      </Button>
                    )}
                    <Button size="small" variant="text" color="grey" href={`/verify/${doc.verifyCode}`} target="_blank">
                      {t("plan-doc-verify-link")}
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}

        {/* The plan is a draft aid, not a prescription (PRD §10.9/§10.11). */}
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("plan-disclaimer")}
        </Typography>
      </CardContent>

      {/* Reissuing revokes the version already in the patient's hands — its own
          dialog, naming the consequence, never a browser popup. */}
      <Dialog open={confirmReissue} onClose={() => setConfirmReissue(false)} maxWidth="xs" fullWidth>
        <DialogHeader title={t("plan-reissue")} closeLabel={t("close")} onClose={() => setConfirmReissue(false)} />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("plan-reissue-confirm", { version: (planDocuments[0]?.version ?? 0) + 1 })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmReissue(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={() => void issue()} disabled={busy}>
            {t("plan-reissue")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Handing the document to the patient (PRD §9.8). The message that
          leaves carries no clinical content — only an expiring link. */}
      <Dialog open={Boolean(sharingDoc)} onClose={closeShare} maxWidth="xs" fullWidth>
        <DialogHeader title={t("plan-share-title")} closeLabel={t("close")} onClose={closeShare} />
        <DialogContent className="flex flex-col gap-3 py-5!">
          {!shareResult ? (
            <>
              <Typography variant="body2" className="text-text-secondary leading-6">
                {t("plan-share-body")}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                disabled={shareBusy}
                onClick={() => void share("whatsapp")}
              >
                {t("plan-share-whatsapp")}
              </Button>
              <Button
                variant="outlined"
                color="grey"
                fullWidth
                disabled={shareBusy}
                onClick={() => void share("email")}
              >
                {t("plan-share-email")}
              </Button>
              <Button variant="text" color="grey" fullWidth disabled={shareBusy} onClick={() => void share("link")}>
                {t("plan-share-link")}
              </Button>
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("plan-share-privacy")}
              </Typography>
            </>
          ) : (
            <>
              <Alert severity={shareResult.delivered ? "success" : "info"}>
                {shareResult.delivered
                  ? t("plan-share-sent")
                  : shareResult.whatsappUrl
                    ? t("plan-share-whatsapp-ready")
                    : shareResult.reason === "contact_missing"
                      ? t("plan-share-contact-missing")
                      : shareResult.reason === "channel_unavailable"
                        ? t("plan-share-channel-unavailable")
                        : t("plan-share-link-ready")}
              </Alert>
              {/* A real anchor, not a scripted window.open: the click that
                  leaves for WhatsApp is HERS, so no popup blocker eats it and
                  the browser can hand off to the installed app when there is
                  one. Nothing is sent until she presses send there. */}
              {shareResult.whatsappUrl && (
                <Button
                  variant="contained"
                  color="primary"
                  fullWidth
                  href={shareResult.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("plan-share-whatsapp-open")}
                </Button>
              )}
              {/* Always offered, delivered or not: the link is the deliverable,
                  the channel is only a convenience. */}
              <TextField
                size="small"
                fullWidth
                value={shareResult.url}
                slotProps={{ htmlInput: { readOnly: true, "aria-label": t("plan-share-copy") } }}
              />
              <Button
                variant="outlined"
                color="grey"
                fullWidth
                onClick={() => {
                  void navigator.clipboard
                    .writeText(shareResult.url)
                    .then(() => {
                      setShareCopied(true);
                      window.setTimeout(() => setShareCopied(false), 4000);
                    })
                    .catch(() => undefined);
                }}
              >
                {shareCopied ? t("plan-share-copied") : t("plan-share-copy")}
              </Button>
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("plan-share-expires")}
              </Typography>
            </>
          )}
        </DialogContent>
      </Dialog>
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
  const enabled = data?.enabled === true;

  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border px-3.5 py-3">
      {editing ? (
        <FormControlLabel
          control={<Checkbox checked={enabled} onChange={(event) => set("enabled", event.target.checked)} />}
          label={
            <Typography variant="body1" className="text-text-primary font-semibold">
              {t(`plan-modality-${slug}`)}
            </Typography>
          }
        />
      ) : (
        <Typography variant="body1" className="text-text-primary font-semibold">
          {t(`plan-modality-${slug}`)}
        </Typography>
      )}
      {(!editing || enabled) &&
        fields.map((field) => {
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
        {PLAN_STRATEGIES.map((strategy) => (
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
