"use client";

import { useTranslations } from "next-intl";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

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
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import ConsultationStepHeader from "@/components/product/consultation-step-header";
import DialogHeader from "@/components/product/dialog-header";
import GateNotice from "@/components/product/gate-notice";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiPrinter from "@/icons/nexture/ni-printer";
import NiSendUpRight from "@/icons/nexture/ni-send-up-right";
import { hasHomeGuidance } from "@/lib/home-guidance";
import { type FieldDescriptor, type FieldKind, PLAN_MODALITIES, PLAN_STRATEGIES } from "@/lib/plan-modalities";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import {
  type ConsultationStatus,
  derivePlanValidationGate,
  type JourneyGate,
  planFactsFromRow,
  remoteEmpty,
  remoteError,
  remoteLoading,
  type RemoteState,
  remoteSuccess,
} from "@flyee/clinical";

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
  /** When she signed this content — what decides if an issued PDF is current. */
  validatedAt: string | null;
  /**
   * This plan was generated with the clinical library UNREACHABLE (0098). Held
   * only in local state before, it vanished on reload — so a plan built with no
   * sources looked like a plan whose sources found nothing.
   */
  retrievalFailed: boolean;
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
  prepareGate,
  createManualGate,
  stepNumber,
  consultationStatus,
  onChanged,
  refreshSignal,
  isFinalized,
}: {
  consultationId: string;
  /**
   * Whether the AI plan can be prepared right now and, when it cannot, WHY —
   * derived from the record's data (`deriveConsultationJourney`), mirroring
   * `POST /plan` and `save_generated_consultation_plan`. It replaces the old
   * `hasAcceptedHypotheses` boolean, which counted accepted hypotheses without
   * looking at whether they had gone stale — so the button stayed lit over a
   * hypothesis the database would refuse to build on.
   */
  prepareGate: JourneyGate;
  /** Creating a manual plan needs no AI and no hypothesis: only an editable record. */
  createManualGate: JourneyGate;
  /** Position in the visible sequence, computed by the page. */
  stepNumber?: number;
  /** Validation is allowed after finalization, refused on a cancelled record (0093). */
  consultationStatus: ConsultationStatus;
  /** Tells the page a decision changed, so the journey re-reads the facts at once. */
  onChanged?: () => void;
  /** Bumped by the page after a save that could have made this plan stale. */
  refreshSignal?: number;
  isFinalized: boolean;
}) {
  const t = useTranslations("product");
  const theme = useTheme();
  // The densest reading in the product — a 50-minute transcript, a plan, a
  // prescription — happened in a shrunken window with its own scrollbar, while
  // scheduling (a far shorter task) already got the full screen.
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
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
  /** Which document action is in flight, as `${kind}` — one spinner per row. */
  const [docBusy, setDocBusy] = useState<string | null>(null);
  /** Generating with AI over a MANUAL draft replaces what she typed — confirmed. */
  const [confirmReplaceManual, setConfirmReplaceManual] = useState(false);
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
        .select(
          "id, objective, modalities, safety_flags, sources, status, origin, updated_at, model, stale_at, validated_at, retrieval_failed",
        )
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
        validatedAt: data.validated_at,
        retrievalFailed: Boolean(data.retrieval_failed),
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

  // A save that bumped the clinical revision returns this plan to draft and
  // clears its validation (mark_clinical_outputs_stale, 0031). The page signals
  // it immediately, so the card stops showing a validation that no longer holds.
  const refreshedRef = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === undefined || refreshSignal === refreshedRef.current) return;
    refreshedRef.current = refreshSignal;
    void load(true);
  }, [refreshSignal, load]);

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
            : code === "ai_consent_refused"
              ? t("plan-consent")
              : code === "plan_validated"
                ? t("plan-already-validated")
                : code === "nothing_recorded"
                  ? t("plan-nothing-recorded")
                  : code === "accepted_hypothesis_required"
                    ? t("plan-accepted-hypothesis-required")
                    : code === "manual_plan_exists"
                      ? t("plan-manual-kept")
                      : code === "provider_unavailable"
                        ? t("plan-provider")
                        : code === "provider_rejected"
                          ? t("plan-provider-rejected")
                          : code === "clinical_revision_conflict"
                            ? t("plan-revision-conflict")
                            : t("plan-error"),
        );
        return;
      }
      setRetrievalFailed(Boolean(body?.retrievalFailed));
      await load(true);
      onChanged?.();
    } catch {
      // The request never reached the server: nothing was written.
      setActionError(t("plan-network"));
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
        const body = await response.json().catch(() => ({}));
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "manual_plan_exists" || code === "plan_validated"
            ? t("plan-already-exists")
            : code === "consultation_finalized"
              ? t("plan-finalized")
              : code === "nothing_recorded"
                ? t("journey-reason-nothing_recorded")
                : t("plan-error"),
        );
        return;
      }
      await load(true);
      onChanged?.();
    } catch {
      setActionError(t("plan-network"));
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
        // Saving had ONE sentence for every possible refusal ("o plano mudou em
        // outra etapa"), which was wrong for most of them.
        const body = await response.json().catch(() => ({}));
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "clinical_revision_conflict" || code === "plan_revision_conflict"
            ? t("plan-reloaded-conflict")
            : code === "derived_safety_flags_immutable"
              ? t("plan-safety-immutable")
              : code === "consultation_finalized"
                ? t("plan-finalized")
                : code === "invalid_request"
                  ? t("plan-save-invalid")
                  : t("plan-error"),
        );
        if (code === "clinical_revision_conflict" || code === "plan_revision_conflict") await load(true);
        return;
      }
      setEditing(false);
      setDraft(null);
      await load(true);
      onChanged?.();
    } catch {
      setActionError(t("plan-network"));
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
        // Everything that was not `plan_stale` used to read "o plano mudou em
        // outra etapa. Recarregue" — including a plan with no objective and a
        // moxibustion checklist that was never filled, which reloading cannot fix.
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "plan_stale"
            ? t(plan.origin === "manual" ? "plan-stale-manual" : "plan-stale-ai")
            : code === "moxibustion_checklist_required"
              ? t("journey-reason-moxibustion_checklist_required")
              : code === "safety_acknowledgement_required"
                ? t("journey-reason-safety_acknowledgement_required")
                : code === "invalid_request"
                  ? t(
                      planFacts && !planFacts.hasObjective
                        ? "journey-reason-plan_objective_required"
                        : planFacts?.enabledModalities === 0
                          ? "journey-reason-plan_modality_required"
                          : "plan-validate-incomplete",
                    )
                  : code === "clinical_revision_conflict"
                    ? t("plan-reloaded-conflict")
                    : code === "invalid_consultation_transition"
                      ? t("plan-cancelled")
                      : t("plan-error"),
        );
        // Realign with what the server sees, so the button state stops lying.
        await load(true);
        return;
      }
      setAcknowledged(false);
      await load(true);
      onChanged?.();
    } catch {
      setActionError(t("plan-network"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The signed, current PDF for one of the plan's two documents (PRD §9.8) —
   * the receituário concept: the icons just WORK, issuing (or re-issuing after
   * she re-validated an edited plan) only when nothing current is on file.
   * A re-issue supersedes the previous version — her re-validation was the
   * deliberate act that authorized it, exactly as in the receituário.
   */
  const ensureCurrentDocument = async (kind: "therapeutic-plan" | "home-guidance"): Promise<IssuedDocument | null> => {
    const kindDocuments = documents.filter((doc) => doc.kind === kind);
    const latest = kindDocuments[0];
    const current =
      latest &&
      latest.status === "issued" &&
      latest.storagePath &&
      latest.issuedAt &&
      (!plan?.validatedAt || new Date(latest.issuedAt) >= new Date(plan.validatedAt));
    if (current) return latest;

    const endpoint = kind === "home-guidance" ? "guidance/issue" : "plan/issue";
    const issueOnce = (confirmVersion?: number) =>
      fetch(`/api/consultations/${consultationId}/${endpoint}`, {
        method: "POST",
        headers: {
          "idempotency-key": crypto.randomUUID(),
          ...(confirmVersion ? { "confirm-version": String(confirmVersion) } : {}),
        },
      });

    let response = await issueOnce(latest ? latest.version + 1 : undefined);
    let body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      documentId?: string;
      error?: { code?: string; details?: { expectedVersion?: number } };
    };
    if (!response.ok && body.error?.code === "document_reissue_confirmation_required") {
      response = await issueOnce(body.error.details?.expectedVersion);
      body = (await response.json().catch(() => ({}))) as typeof body;
    }
    if (!response.ok || !body.documentId) {
      const code = body.error?.code;
      setActionError(
        code === "plan_not_validated"
          ? t("plan-issue-need-validate")
          : code === "document_profile_incomplete"
            ? t("plan-issue-profile-incomplete")
            : code === "nothing_recorded"
              ? t("guidance-issue-empty")
              : t("plan-issue-error"),
      );
      return null;
    }
    const supabase = createClient();
    const { data: issued } = await supabase
      .from("documents")
      .select("id, kind, version, verify_code, status, issued_at, storage_path")
      .eq("id", body.documentId)
      .maybeSingle();
    void load(true);
    if (!issued?.storage_path) {
      setActionError(t("plan-issue-error"));
      return null;
    }
    return {
      id: issued.id,
      kind: issued.kind,
      version: issued.version,
      verifyCode: issued.verify_code,
      status: issued.status,
      issuedAt: issued.issued_at,
      storagePath: issued.storage_path,
    };
  };

  const fetchPdfBlobUrl = async (kind: "therapeutic-plan" | "home-guidance"): Promise<string | null> => {
    const doc = await ensureCurrentDocument(kind);
    if (!doc?.storagePath) return null;
    const supabase = createClient();
    // The documents bucket is private; a short-lived signed URL is RLS-gated to
    // members (migration 0006), so this never exposes another org's file.
    const { data: signed } = await supabase.storage.from("documents").createSignedUrl(doc.storagePath, 120);
    if (!signed?.signedUrl) {
      setActionError(t("plan-download-error"));
      return null;
    }
    const pdf = await fetch(signed.signedUrl);
    if (!pdf.ok) {
      setActionError(t("plan-download-error"));
      return null;
    }
    return URL.createObjectURL(await pdf.blob());
  };

  const downloadDoc = async (kind: "therapeutic-plan" | "home-guidance") => {
    setDocBusy(kind);
    setActionError(null);
    try {
      const url = await fetchPdfBlobUrl(kind);
      if (!url) return;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = kind === "home-guidance" ? "orientacoes.pdf" : "plano-terapeutico.pdf";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setActionError(t("plan-download-error"));
    } finally {
      setDocBusy(null);
    }
  };

  const printDoc = async (kind: "therapeutic-plan" | "home-guidance") => {
    setDocBusy(kind);
    setActionError(null);
    try {
      const url = await fetchPdfBlobUrl(kind);
      if (!url) return;
      const viewer = window.open(url, "_blank", "noopener");
      // Best effort: the browser's PDF viewer keeps its own print control when
      // the programmatic call is refused for a blob document.
      window.setTimeout(() => {
        try {
          viewer?.print();
        } catch {
          /* viewer stays open for a manual print */
        }
      }, 800);
    } catch {
      setActionError(t("plan-download-error"));
    } finally {
      setDocBusy(null);
    }
  };

  /** Hand it to the patient: make sure a current version exists, then share. */
  const shareDoc = async (kind: "therapeutic-plan" | "home-guidance") => {
    setDocBusy(kind);
    setActionError(null);
    try {
      const doc = await ensureCurrentDocument(kind);
      if (doc) setSharingDoc(doc);
    } catch {
      setActionError(t("plan-issue-error"));
    } finally {
      setDocBusy(null);
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

  // The same reading of the row the DATABASE does when it validates
  // (validate_consultation_plan, 0093:308-336), so the button can say what is
  // missing instead of erroring after the click with a sentence about staleness.
  const planFacts = plan
    ? planFactsFromRow({
        status: plan.status,
        origin: plan.origin,
        stale_at: plan.staleAt,
        objective: plan.objective,
        modalities: plan.modalities,
        safety_flags: plan.safetyFlags,
      })
    : null;
  const validationGate: JourneyGate = planFacts
    ? derivePlanValidationGate(planFacts, { acknowledged, consultationStatus })
    : { state: "hidden" };
  const canPrepareAi = prepareGate.state === "available";
  const prepareVisible = prepareGate.state !== "hidden";
  const libraryUnavailable = retrievalFailed || Boolean(plan?.retrievalFailed);

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <ConsultationStepHeader
          step={stepNumber}
          icon={<NiListCheck size="medium" />}
          title={t("plan-title")}
          hint={t("plan-step-hint")}
          status={plan?.staleAt ? "stale" : plan?.status === "validated" ? "done" : plan ? "in_progress" : undefined}
          statusLabel={
            plan?.staleAt
              ? t("journey-step-stale")
              : plan?.status === "validated"
                ? undefined // the "Validado por você" chip below already says it
                : plan
                  ? t("journey-step-in-progress")
                  : undefined
          }
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
            that happened to find nothing — say which one this is. The fact now
            lives on the row (0098), so it survives a reload. */}
        {libraryUnavailable && (
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
                {createManualGate.state !== "hidden" && (
                  <>
                    <Button
                      variant="contained"
                      color="primary"
                      fullWidth
                      startIcon={busy ? undefined : <NiListCheck size="tiny" />}
                      onClick={createManual}
                      disabled={busy || createManualGate.state !== "available"}
                      aria-describedby={createManualGate.state === "blocked" ? "plan-manual-reason" : undefined}
                    >
                      {busy ? <CircularProgress size={18} /> : t("plan-create-manual")}
                    </Button>
                    <GateNotice gate={createManualGate} id="plan-manual-reason" />
                  </>
                )}
                {/* The AI plan is built ON the hypotheses she settled — the
                    button stays visible with the reason under it rather than
                    erroring after a click (or, worse, lighting up over a
                    hypothesis that went stale). */}
                {prepareVisible && (
                  <>
                    <Button
                      variant="outlined"
                      color="primary"
                      fullWidth
                      startIcon={<NiListCheck size="tiny" />}
                      onClick={() => prepare()}
                      disabled={busy || !canPrepareAi}
                      aria-describedby={
                        prepareGate.state === "blocked" || prepareGate.state === "unknown"
                          ? "plan-prepare-reason"
                          : undefined
                      }
                    >
                      {t("plan-prepare")}
                    </Button>
                    <GateNotice gate={prepareGate} id="plan-prepare-reason" />
                  </>
                )}
                {busy && (
                  <Typography variant="body2" role="status" className="text-text-secondary text-xs leading-5">
                    {t("plan-preparing")}
                  </Typography>
                )}
              </Box>
            )}
          </>
        ) : (
          <>
            {/* The exit depends on where the plan came from: a manual one is
                brought up to date by Editar → Salvar (save_consultation_plan
                clears stale_at, 0031), an AI one can also be prepared again. The
                old single sentence told everyone to "prepare novamente", an
                action a manual plan does not have. */}
            {plan.staleAt && (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t(plan.origin === "manual" ? "plan-stale-manual" : "plan-stale-ai")}
                {documents.length > 0 && ` ${t("plan-stale-documents")}`}
              </Alert>
            )}
            {/* Contraindications first, in amber, never hidden (PRD §10.10). */}
            {plan.safetyFlags.length > 0 && (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                <Box className="flex flex-col gap-1">
                  <Typography variant="body2" className="font-semibold">
                    {t("plan-safety-title")}
                  </Typography>
                  {plan.safetyFlags.map((flag, index) => (
                    <Typography key={index} variant="body2" className="text-xs leading-5">
                      · {t(`plan-safety-${flag.category}`)}: {flag.matchedText}
                    </Typography>
                  ))}
                </Box>
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

            <Dialog
              fullScreen={fullScreen}
              open={planOpen}
              onClose={() => setPlanOpen(false)}
              maxWidth="md"
              fullWidth
              scroll="paper"
            >
              <DialogHeader
                title={t("plan-title")}
                closeLabel={t("close")}
                onClose={() => setPlanOpen(false)}
                trailing={
                  <>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t(plan.origin === "ai" ? "plan-origin-ai" : "plan-origin-manual")}
                      className="text-xs"
                    />
                    {plan.status === "validated" ? (
                      <Chip
                        size="small"
                        icon={<NiCheckSquare size="tiny" />}
                        label={t("plan-validated-badge")}
                        className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light text-xs font-semibold"
                      />
                    ) : plan.staleAt ? (
                      <Chip
                        size="small"
                        label={t("journey-step-stale")}
                        className="bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light text-xs font-semibold"
                      />
                    ) : null}
                  </>
                }
              />
              <DialogContent dividers className="flex flex-col gap-4 py-5!">
                {/* Whether this plan still holds comes before what it says. */}
                {plan.staleAt && (
                  <Alert severity="warning" className="neutral bg-background-paper/60!">
                    {t(plan.origin === "manual" ? "plan-stale-manual" : "plan-stale-ai")}
                    {documents.length > 0 && ` ${t("plan-stale-documents")}`}
                  </Alert>
                )}

                <PlanSection title={t("plan-objective")}>
                  {editing ? (
                    <TextField
                      multiline
                      minRows={2}
                      fullWidth
                      size="small"
                      value={draft?.objective ?? ""}
                      onChange={(event) => setDraft((d) => (d ? { ...d, objective: event.target.value } : d))}
                    />
                  ) : plan.objective ? (
                    <Typography variant="body2" className="text-text-primary leading-6">
                      {plan.objective}
                    </Typography>
                  ) : (
                    <Typography variant="body2" className="text-text-secondary leading-6">
                      {t("plan-objective-empty")}
                    </Typography>
                  )}
                </PlanSection>

                {/* The contraindications INSIDE the dialog, with the
                    acknowledgement right under them. They used to live only on
                    the card behind this modal, while the checkbox here asked
                    her to confirm "as contraindicações acima". */}
                {plan.safetyFlags.length > 0 && (
                  <PlanSection title={t("plan-safety-title")}>
                    <Alert severity="warning" className="neutral bg-background-paper/60!">
                      <Box className="flex flex-col gap-2">
                        <Box component="ul" className="flex flex-col gap-1">
                          {plan.safetyFlags.map((flag, index) => (
                            <Typography key={index} component="li" variant="body2" className="leading-6">
                              <span className="font-semibold">{t(`plan-safety-${flag.category}`)}</span>
                              {flag.matchedText ? `: ${flag.matchedText}` : ""}
                            </Typography>
                          ))}
                        </Box>
                        {!editing && plan.status === "draft" && mustAcknowledge && (
                          <FormControlLabel
                            className="mt-1"
                            control={
                              <Checkbox
                                checked={acknowledged}
                                onChange={(event) => setAcknowledged(event.target.checked)}
                              />
                            }
                            label={
                              <Typography variant="body2" className="text-text-primary leading-5">
                                {t("plan-acknowledge")}
                              </Typography>
                            }
                          />
                        )}
                      </Box>
                    </Alert>
                  </PlanSection>
                )}

                {editing && hiddenByScope.length > 0 && (
                  <Alert
                    severity="info"
                    className="neutral bg-background-paper/60!"
                    action={
                      <Button size="small" color="inherit" href="/settings">
                        {t("plan-scope-adjust")}
                      </Button>
                    }
                  >
                    {t("plan-scope-note", {
                      modalities: hiddenByScope.map((modality) => t(`plan-modality-${modality.slug}`)).join(", "),
                    })}
                  </Alert>
                )}

                <PlanSection title={t("plan-modalities-title")}>
                  {activeModalities.length === 0 ? (
                    <Typography variant="body2" className="text-text-secondary leading-6">
                      {t("plan-summary-empty")}
                    </Typography>
                  ) : (
                    <Box className="flex flex-col gap-3">
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
                    </Box>
                  )}
                </PlanSection>

                {plan.sources.length > 0 && (
                  <PlanSection title={t("plan-sources")}>
                    <Box component="ul" className="flex flex-col gap-2">
                      {plan.sources.map((source, index) => (
                        <Box component="li" key={index} className="border-grey-100 rounded-xl border px-3 py-2">
                          <Typography variant="body2" className="text-text-primary font-semibold">
                            {source.title}
                          </Typography>
                          {source.source && (
                            <Typography variant="caption" className="text-text-secondary block leading-4">
                              {source.source}
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </PlanSection>
                )}

                {/* The draft-not-a-prescription framing travels with the plan. */}
                <Typography
                  variant="body2"
                  className="text-text-secondary border-grey-100 border-t pt-4 text-xs leading-5"
                >
                  {t("plan-disclaimer")}
                </Typography>
              </DialogContent>
              {/* Decisions pinned in the footer while the content scrolls. What
                  is missing is said ONCE, above the buttons, instead of wedged
                  between them. */}
              <DialogActions disableSpacing className="flex flex-col items-stretch gap-2">
                {!editing &&
                  ((plan.status === "draft" && validationGate.state === "blocked") ||
                    (!isFinalized &&
                      prepareVisible &&
                      plan.status === "draft" &&
                      (prepareGate.state === "blocked" || prepareGate.state === "unknown"))) && (
                    <Box className="flex flex-col gap-0.5 px-2">
                      {plan.status === "draft" && <GateNotice gate={validationGate} id="plan-validate-reason" />}
                      {!isFinalized && prepareVisible && plan.status === "draft" && (
                        <GateNotice gate={prepareGate} id="plan-dialog-prepare-reason" />
                      )}
                    </Box>
                  )}
                <Box className="flex flex-row flex-wrap items-center gap-2">
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
                      <Box className="ml-auto">
                        <Button variant="contained" color="primary" onClick={saveEdit} disabled={busy}>
                          {t("plan-save")}
                        </Button>
                      </Box>
                    </>
                  ) : (
                    <>
                      <Button color="grey" className="max-sm:hidden" onClick={() => setPlanOpen(false)}>
                        {t("close")}
                      </Button>
                      <Box className="ml-auto flex flex-row flex-wrap items-center justify-end gap-2">
                        {!isFinalized && prepareVisible && plan.status === "draft" && plan.origin === "ai" && (
                          <Button
                            variant="text"
                            color="grey"
                            onClick={() => prepare()}
                            // Rebuilding still needs a settled, current hypothesis.
                            disabled={busy || !canPrepareAi}
                            aria-describedby={canPrepareAi ? undefined : "plan-dialog-prepare-reason"}
                          >
                            {busy ? <CircularProgress size={16} /> : t("plan-reprepare")}
                          </Button>
                        )}
                        {/* A manual draft can still receive the AI proposals —
                            explicitly, and confirmed, because it overwrites what
                            she typed (a validated plan is refused server-side). */}
                        {!isFinalized && prepareVisible && plan.status === "draft" && plan.origin === "manual" && (
                          <Button
                            variant="text"
                            color="grey"
                            onClick={() => setConfirmReplaceManual(true)}
                            disabled={busy || !canPrepareAi}
                            aria-describedby={canPrepareAi ? undefined : "plan-dialog-prepare-reason"}
                          >
                            {busy ? <CircularProgress size={16} /> : t("plan-generate-ai")}
                          </Button>
                        )}
                        {!isFinalized && (
                          <Button variant="outlined" color="grey" onClick={startEdit} disabled={busy}>
                            {t("plan-edit")}
                          </Button>
                        )}
                        {/* Validating stays available after the record is closed
                            (0093): a signature attests what the plan already said.
                            It checks what the DATABASE checks and says which one is
                            missing, above. */}
                        {plan.status === "draft" && (
                          <Button
                            variant="contained"
                            color="primary"
                            onClick={validate}
                            disabled={busy || validationGate.state !== "available"}
                            aria-describedby={validationGate.state === "blocked" ? "plan-validate-reason" : undefined}
                          >
                            {t("plan-validate")}
                          </Button>
                        )}
                      </Box>
                    </>
                  )}
                </Box>
              </DialogActions>
            </Dialog>

            {/* The plan's two documents, receituário-style: one row per kind,
                actions as icons that just work (auto-issuing the current
                version under the hood). Versions and verify codes stay
                INTERNAL — the QR printed on the paper is the public proof.
                Viewable even after the record is finalized (the plan freezes,
                the documents remain). */}
            {(plan.status === "validated" || documents.length > 0) && (
              <Box className="flex flex-col gap-1.5">
                <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                  {t("plan-documents-title")}
                </Typography>
                <DocumentRow
                  label={t("plan-title")}
                  ready={plan.status === "validated"}
                  busy={docBusy === "therapeutic-plan"}
                  t={t}
                  onDownload={() => void downloadDoc("therapeutic-plan")}
                  onPrint={() => void printDoc("therapeutic-plan")}
                  onShare={() => void shareDoc("therapeutic-plan")}
                />
                {/* The patient's half of the same validated plan (PRD §9.8).
                    Offered only when the plan actually contains homework — an
                    empty handout wastes her attention. */}
                {(hasHomeGuidance(plan.modalities) || guidanceDocuments.length > 0) && (
                  <DocumentRow
                    label={t("guidance-title")}
                    ready={plan.status === "validated"}
                    busy={docBusy === "home-guidance"}
                    t={t}
                    onDownload={() => void downloadDoc("home-guidance")}
                    onPrint={() => void printDoc("home-guidance")}
                    onShare={() => void shareDoc("home-guidance")}
                  />
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

      {/* Generating with AI over a manual DRAFT replaces what she typed — an
          act with that consequence gets a dialog that names it. */}
      <Dialog open={confirmReplaceManual} onClose={() => setConfirmReplaceManual(false)} maxWidth="xs" fullWidth>
        <DialogHeader
          title={t("plan-generate-ai")}
          closeLabel={t("close")}
          onClose={() => setConfirmReplaceManual(false)}
        />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("plan-replace-manual-body")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmReplaceManual(false)}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() => {
              setConfirmReplaceManual(false);
              void prepare(true);
            }}
          >
            {t("plan-generate-ai")}
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
                      : shareResult.reason === "channel_not_configured"
                        ? t("plan-share-channel-not-configured")
                        : shareResult.reason === "channel_rejected" || shareResult.reason === "channel_unavailable"
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

/**
 * One of the plan's documents as a single row: name on the left, actions as
 * icons on the right (the receituário concept — no "issue" ceremony, the
 * icons produce the current signed version on demand). Until the plan is
 * validated the icons stay visible but disabled, with the reason as tooltip:
 * the affordance teaches what validating unlocks.
 */
function DocumentRow({
  label,
  ready,
  busy,
  t,
  onDownload,
  onPrint,
  onShare,
}: {
  label: string;
  ready: boolean;
  busy: boolean;
  t: (key: string) => string;
  onDownload: () => void;
  onPrint: () => void;
  onShare: () => void;
}) {
  const gate = (title: string) => (ready ? title : t("plan-issue-need-validate"));
  return (
    <Box className="border-grey-100 flex flex-row items-center gap-2 rounded-2xl border px-3 py-1.5">
      <NiDocumentFull size="tiny" className="text-text-secondary flex-none" aria-hidden />
      <Typography variant="body2" className="text-text-primary min-w-0 flex-1 text-xs font-medium">
        {label}
      </Typography>
      {busy ? (
        <CircularProgress size={18} aria-label={t("loading")} className="flex-none" />
      ) : (
        <Box className="-mr-1 flex flex-none flex-row items-center">
          <Tooltip title={gate(t("plan-doc-download"))}>
            <span>
              <IconButton size="small" aria-label={t("plan-doc-download")} disabled={!ready} onClick={onDownload}>
                <NiDownloadCloud size="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={gate(t("plan-doc-print"))}>
            <span>
              <IconButton size="small" aria-label={t("plan-doc-print")} disabled={!ready} onClick={onPrint}>
                <NiPrinter size="small" />
              </IconButton>
            </span>
          </Tooltip>
          {/* The point of issuing it is that the PATIENT gets it — a download
              alone ends the cycle inside the practitioner's computer (PRD §9.8). */}
          <Tooltip title={gate(t("plan-doc-send"))}>
            <span>
              <IconButton size="small" aria-label={t("plan-doc-send")} disabled={!ready} onClick={onShare}>
                <NiSendUpRight size="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Box>
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

  // Each modality is its own card with a header, and its fields a LABEL | VALUE
  // grid. They used to be label-over-value lines of the same small text, so
  // one modality ran into the next and points blended with instructions.
  return (
    <Box component="section" className="border-grey-100 flex flex-col overflow-hidden rounded-2xl border">
      <Box className="border-grey-100 bg-grey-100/40 flex flex-row items-center gap-2 border-b px-3.5 py-2">
        {editing ? (
          <FormControlLabel
            className="m-0"
            control={<Checkbox checked={enabled} onChange={(event) => set("enabled", event.target.checked)} />}
            label={
              <Typography variant="subtitle2" className="text-text-primary font-semibold">
                {t(`plan-modality-${slug}`)}
              </Typography>
            }
          />
        ) : (
          <Typography variant="subtitle2" component="h4" className="text-text-primary mb-0 font-semibold">
            {t(`plan-modality-${slug}`)}
          </Typography>
        )}
        {editing && !enabled && (
          <Typography variant="caption" className="text-text-secondary ml-auto">
            {t("plan-modality-inactive")}
          </Typography>
        )}
      </Box>
      {(!editing || enabled) && (
        <Box component="dl" className="m-0 grid gap-x-4 gap-y-3 px-3.5 py-3 sm:grid-cols-[minmax(9rem,13rem)_1fr]">
          {fields.map((field) => (
            <Fragment key={field.key}>
              <Typography component="dt" variant="caption" className="text-text-secondary pt-0.5 font-semibold">
                {t(field.label)}
              </Typography>
              <Box component="dd" className="m-0 min-w-0">
                {editing ? (
                  <FieldEditor
                    kind={field.kind}
                    value={data?.[field.key]}
                    t={t}
                    onChange={(value) => set(field.key, value)}
                  />
                ) : slug === "moxibustion" &&
                  field.key === "contraindicationChecklist" &&
                  enabled &&
                  !(
                    Array.isArray(data?.[field.key]) &&
                    (data?.[field.key] as unknown[]).some((entry) => String(entry ?? "").trim())
                  ) ? (
                  // Mirrors validate_consultation_plan (0093): moxibustion is not
                  // validated without its pre-application checklist.
                  <Typography
                    variant="body2"
                    className="text-accent-3-dark dark:text-accent-3-light leading-6 font-semibold"
                  >
                    {t("plan-field-required-to-validate")}
                  </Typography>
                ) : (
                  <FieldView kind={field.kind} value={data?.[field.key]} t={t} />
                )}
              </Box>
            </Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
}

function FieldView({ kind, value, t }: { kind: FieldKind; value: unknown; t: (key: string) => string }) {
  if (kind === "list") {
    const list = (Array.isArray(value) ? (value as unknown[]) : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    if (list.length === 0) return <Dash />;
    // Points and meridians ("E36", "BP6", "Fígado") read best as tokens; a
    // list of instructions or meals reads best as lines.
    if (list.every((item) => item.length <= 24)) {
      return (
        <Box className="flex flex-row flex-wrap gap-1.5">
          {list.map((item, index) => (
            <Chip key={index} size="small" variant="outlined" label={item} className="text-xs" />
          ))}
        </Box>
      );
    }
    return (
      <Box component="ul" className="flex flex-col gap-1">
        {list.map((item, index) => (
          <Typography
            key={index}
            component="li"
            variant="body2"
            className="text-text-primary flex flex-row gap-2 leading-6"
          >
            <span aria-hidden className="text-text-secondary">
              •
            </span>
            <span className="min-w-0">{item}</span>
          </Typography>
        ))}
      </Box>
    );
  }
  if (kind === "strategy") {
    const label = value ? t(`plan-strategy-${value}`) : "";
    return label ? (
      <Typography variant="body2" className="text-text-primary leading-6">
        {label}
      </Typography>
    ) : (
      <Dash />
    );
  }
  const text = typeof value === "string" ? value.trim() : "";
  return text ? (
    <Typography variant="body2" className="text-text-primary leading-6 whitespace-pre-line">
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
    return <ListEditor value={value} placeholder={t("plan-list-hint")} onChange={onChange} />;
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

/**
 * A short list edited one item per line. The array is normalised (trim + drop
 * blank lines) only on BLUR — never on every keystroke. Doing it per keystroke
 * was the bug: it stripped a trailing space the instant you typed it and
 * deleted a blank line the instant you pressed Enter, so spaces and line breaks
 * were impossible. Local text holds exactly what she types; the parent gets the
 * clean array when she leaves the field.
 */
function ListEditor({
  value,
  placeholder,
  onChange,
}: {
  value: unknown;
  placeholder: string;
  onChange: (value: string[]) => void;
}) {
  const arrayToText = (input: unknown) => (Array.isArray(input) ? (input as string[]).join("\n") : "");
  const [text, setText] = useState(() => arrayToText(value));
  const focusedRef = useRef(false);

  // Re-seed from upstream only while she is NOT editing (a reload / external
  // change), so a poll or parent re-render never yanks the caret mid-word.
  useEffect(() => {
    if (!focusedRef.current) setText(arrayToText(value));
  }, [value]);

  const commit = (raw: string) => {
    const cleaned = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    onChange(cleaned);
    // Reflect the normalised form once editing ends.
    setText(cleaned.join("\n"));
  };

  return (
    <TextField
      multiline
      minRows={2}
      size="small"
      fullWidth
      value={text}
      placeholder={placeholder}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => {
        focusedRef.current = false;
        commit(event.target.value);
      }}
    />
  );
}

const Dash = () => (
  <Typography variant="body2" className="text-text-secondary text-xs leading-5">
    —
  </Typography>
);

/** A titled block of the plan dialog, separated from the next by a hairline. */
function PlanSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" className="border-grey-100 flex flex-col gap-2 border-t pt-4 first:border-t-0 first:pt-0">
      <Typography
        variant="subtitle2"
        component="h4"
        className="text-text-secondary mb-0 text-xs font-semibold tracking-wide uppercase"
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}
