"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Link as MuiLink,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import ConsultationStepHeader from "@/components/product/consultation-step-header";
import DialogHeader from "@/components/product/dialog-header";
import GateNotice from "@/components/product/gate-notice";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import { ANAMNESIS_BLOCKS } from "@/lib/anamnesis";
import { deriveHypothesesPanelMode } from "@/lib/hypotheses-access";
import { trackCommercialEvent, trackProductEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import {
  type JourneyGate,
  remoteEmpty,
  remoteError,
  remoteLoading,
  type RemoteState,
  remoteSuccess,
} from "@flyee/clinical";

type Sign = { text: string; fieldKey?: string };
type Source = {
  title: string;
  source: string | null;
  kind: string;
  /**
   * The acervo page behind the citation (`/biblioteca/acervo/<id>`). The
   * pipeline only keeps a source that resolved to a chunk it actually
   * retrieved, so this id is normally present — optional because a row
   * prepared before citations carried one must still render, as TEXT rather
   * than as a link to a guessed page.
   */
  documentId?: string;
};

type FieldRef = { blockKey: string; fieldKey: string; labelKey: string };

/**
 * Anamnesis field → its readable label, keyed by the SAME composite the
 * reasoning shows the model ("tcm.tongue"). Without it a sign is an assertion;
 * with it she can go back to the line she herself recorded and weigh it.
 */
const FIELD_REFS: ReadonlyMap<string, FieldRef> = new Map(
  ANAMNESIS_BLOCKS.flatMap((block) =>
    block.fields.map(
      (field) =>
        [`${block.key}.${field.key}`, { blockKey: block.key, fieldKey: field.key, labelKey: field.label }] as const,
    ),
  ),
);

/**
 * The model is prompted with composite keys but answers with a bare one
 * ("tongue") often enough to matter. Resolved ONLY when a single block owns
 * that key — pointing at the wrong field is worse than pointing at none.
 */
const FIELD_REFS_BY_BARE_KEY: ReadonlyMap<string, FieldRef> = (() => {
  const owners = new Map<string, number>();
  for (const ref of FIELD_REFS.values()) owners.set(ref.fieldKey, (owners.get(ref.fieldKey) ?? 0) + 1);
  return new Map(
    [...FIELD_REFS.values()].filter((ref) => owners.get(ref.fieldKey) === 1).map((ref) => [ref.fieldKey, ref] as const),
  );
})();

/** An unknown or ambiguous key resolves to nothing: the sign renders as it always did. */
function resolveSignField(fieldKey: string | undefined): FieldRef | undefined {
  const key = fieldKey?.trim().toLowerCase();
  if (!key) return undefined;
  return FIELD_REFS.get(key) ?? FIELD_REFS_BY_BARE_KEY.get(key);
}

type Hypothesis = {
  id: string;
  pattern: string;
  rationale: string | null;
  correspondence: "weak" | "moderate" | "strong";
  supportingSigns: Sign[];
  contradictingSigns: Sign[];
  missingData: string[];
  sources: Source[];
  limitation: string | null;
  status: "draft" | "accepted" | "edited" | "rejected";
  /** Prepared while the clinical library could not be reached (0094). */
  retrievalFailed: boolean;
  reviewNote: string | null;
  model: string | null;
  updatedAt: string;
  staleAt: string | null;
};

type PriorPattern = { pattern: string; startedAt: string };
type HypothesesData = { hypotheses: Hypothesis[]; prior: PriorPattern[] };

/**
 * Disharmony-pattern hypotheses (PRD §10.8) — the Pro reasoning layer.
 *
 * The whole design is an argument against over-trust:
 *  - the mandatory heading and message (PRD §10.8/§10.11) are not fine print;
 *  - "correspondence with the recorded data" is the only strength language
 *    allowed — never confidence, never a percentage;
 *  - contradicting signs and missing data sit at the SAME visual level as the
 *    supporting ones. A hypothesis you can only agree with is a trap;
 *  - a limitation (essential exam data absent) is shown before the pattern is
 *    read, not after;
 *  - she can accept, reject or report every single one (PRD §10.10).
 *
 * Nothing here is red: a hypothesis is not a risk. Red stays reserved for
 * clinical risk and failure (docs/DESIGN.md).
 */
export default function HypothesesPanel({
  consultationId,
  patientId,
  reasoningEntitled,
  prepareGate,
  stepNumber,
  entitlementLoading,
  entitlementError,
  onRetryEntitlement,
  onDecisionChanged,
  onBeforePrepare,
  onFocusField,
  refreshSignal,
  isFinalized,
}: {
  consultationId: string;
  patientId: string;
  reasoningEntitled: boolean;
  /**
   * Whether preparing can run right now and, when it cannot, WHY — derived from
   * the record's data by `deriveConsultationJourney`, mirroring what
   * `POST /hypotheses` checks. The button used to be gated on status and plan
   * alone, so it stayed lit over an empty chart and the refusal arrived after
   * the wait.
   */
  prepareGate: JourneyGate;
  /** Position in the visible sequence (the page computes it; Pro-less charts renumber). */
  stepNumber?: number;
  /** Bumped by the page after a save that could have made these hypotheses stale. */
  refreshSignal?: number;
  entitlementLoading: boolean;
  entitlementError: boolean;
  onRetryEntitlement: () => void;
  /**
   * Fired when a decision lands (accept/edit/reject). The sibling plan panel
   * gates its AI button on whether a hypothesis is accepted, so it re-checks
   * the moment that changes instead of waiting for the next poll.
   */
  onDecisionChanged?: () => void;
  /**
   * Flush the anamnesis autosave and resolve once it has committed. Preparing
   * reads the recorded answers from the DB, so without this a value she typed
   * (e.g. the tongue/pulse she just entered) and then immediately clicked
   * "reprepare" over would be read stale — the hypotheses would not reflect it.
   */
  onBeforePrepare?: () => Promise<void>;
  /**
   * Take her to the anamnesis field a sign was read from. The chart lives on
   * the consultation page, so only the page can expand the block and scroll to
   * `consultation-field-<block>-<field>`; without this handler the field is
   * still NAMED on the sign, just not clickable. The panel closes its review
   * dialog before calling, so the handler must defer its own scroll (the field
   * is behind the modal until it unmounts).
   */
  onFocusField?: (blockKey: string, fieldKey: string) => void;
  isFinalized: boolean;
}) {
  const t = useTranslations("product");
  const theme = useTheme();
  // The densest reading in the product — a 50-minute transcript, a plan, a
  // prescription — happened in a shrunken window with its own scrollbar, while
  // scheduling (a far shorter task) already got the full screen.
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [hypothesesState, setHypothesesState] = useState<RemoteState<HypothesesData, "load_failed">>(() =>
    remoteLoading(),
  );
  const hypothesesRef = useRef<HypothesesData | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ hypothesis: Hypothesis; mode: "reject" | "edit" } | null>(null);
  const [note, setNote] = useState("");
  const [pattern, setPattern] = useState("");
  const [showPrior, setShowPrior] = useState(false);
  /** Set when the last preparation ran WITHOUT the library, because it failed. */
  const [retrievalFailed, setRetrievalFailed] = useState(false);
  // Reviewing patterns is deliberate work over long content — it happens in a
  // dialog so this column stays a summary instead of a scroll.
  const [reviewOpen, setReviewOpen] = useState(false);
  /** The accepted-but-stale hypothesis she is about to re-anchor to today's chart. */
  const [reaffirming, setReaffirming] = useState<Hypothesis | null>(null);
  /** The hypothesis the review dialog is showing; null = the first one waiting for her. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const upgradeViewedRef = useRef(false);

  const canPrepare = prepareGate.state === "available";
  /** Not entitled / not editable: the button is not part of this screen at all. */
  const prepareVisible = prepareGate.state !== "hidden";

  const load = useCallback(
    async (preservePrevious = true) => {
      if (!preservePrevious) hypothesesRef.current = undefined;
      const previous = preservePrevious ? hypothesesRef.current : undefined;
      setHypothesesState(remoteLoading(previous));
      if (!isSupabaseConfigured) {
        hypothesesRef.current = undefined;
        setHypothesesState(remoteEmpty());
        return;
      }
      const supabase = createClient();
      const { data, error: hypothesesError } = await supabase
        .from("consultation_hypotheses")
        .select(
          "id, pattern, rationale, correspondence, supporting_signs, contradicting_signs, missing_data, sources, limitation, status, review_note, model, updated_at, stale_at, retrieval_failed",
        )
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: true });

      if (hypothesesError) {
        setHypothesesState(remoteError("load_failed", previous));
        return;
      }

      const hypotheses = (data ?? []).map((row) => ({
        id: row.id,
        pattern: row.pattern,
        rationale: row.rationale,
        correspondence: row.correspondence,
        supportingSigns: (row.supporting_signs ?? []) as Sign[],
        contradictingSigns: (row.contradicting_signs ?? []) as Sign[],
        missingData: (row.missing_data ?? []) as string[],
        sources: (row.sources ?? []) as Source[],
        limitation: row.limitation,
        status: row.status,
        reviewNote: row.review_note,
        model: row.model,
        updatedAt: row.updated_at,
        staleAt: row.stale_at,
        retrievalFailed: Boolean(row.retrieval_failed),
      }));

      // "Comparar hipótese atual com padrões anteriores" (PRD §10.8): what this
      // patient's earlier consultations settled on — only what SHE accepted,
      // never a draft the AI once proposed.
      const { data: earlier, error: priorError } = await supabase
        .from("consultation_hypotheses")
        .select("pattern, status, consultations!inner(patient_id, started_at, id)")
        .eq("consultations.patient_id", patientId)
        .in("status", ["accepted", "edited"])
        .neq("consultation_id", consultationId)
        .order("created_at", { ascending: false })
        .limit(5);
      const prior = (earlier ?? []).map((row) => {
        const consultation = row.consultations as unknown as { started_at: string };
        return { pattern: row.pattern as string, startedAt: consultation?.started_at };
      });
      const next = { hypotheses, prior: priorError ? (previous?.prior ?? []) : prior };
      if (priorError) {
        hypothesesRef.current = next;
        setHypothesesState(remoteError("load_failed", next));
        return;
      }
      hypothesesRef.current = hypotheses.length === 0 ? undefined : next;
      setHypothesesState(hypotheses.length === 0 ? remoteEmpty() : remoteSuccess(next));
    },
    [consultationId, patientId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // A save that bumped the clinical revision stales every hypothesis
  // (mark_clinical_outputs_stale, 0031). The page tells us the moment it
  // happens; without this the card kept showing them as current until the next
  // 12-second poll — long enough for her to click "Considerar" and be refused.
  const refreshedRef = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === undefined || refreshSignal === refreshedRef.current) return;
    refreshedRef.current = refreshSignal;
    void load(true);
  }, [refreshSignal, load]);

  const prepare = async () => {
    if (!canPrepare) return;
    setBusy(true);
    setActionError(null);
    try {
      // Commit any pending anamnesis edit first, so the reasoning reads exactly
      // what is on screen (e.g. the tongue/pulse she just typed), never a stale
      // revision. A failed flush must not block preparing — worst case is the
      // same race we had before.
      await onBeforePrepare?.().catch(() => undefined);
      const response = await fetch(`/api/consultations/${consultationId}/hypotheses`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // One sentence per cause. The old single bucket told her to repeat an
        // action that could not succeed and hid which of five different things
        // had happened — including the token-budget truncation that made
        // preparing look random.
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "reasoning_not_available"
            ? t("hypotheses-not-available")
            : code === "ai_consent_refused"
              ? t("hypotheses-consent")
              : code === "nothing_recorded"
                ? t("hypotheses-nothing-recorded")
                : code === "provider_unavailable"
                  ? t("hypotheses-provider")
                  : code === "provider_rejected"
                    ? t("hypotheses-provider-rejected")
                    : code === "clinical_revision_conflict"
                      ? t("hypotheses-revision-conflict")
                      : code === "consultation_finalized"
                        ? t("hypotheses-finalized")
                        : t("hypotheses-error"),
        );
        return;
      }
      setRetrievalFailed(Boolean(body?.retrievalFailed));
      await load(true);
    } catch {
      // No response at all: the request never reached the server, so nothing
      // was written — say that instead of blaming the AI.
      setActionError(t("hypotheses-network"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Re-anchor a decision she already made to the chart as it stands now.
   *
   * A hypothesis she had accepted and that later went stale was a dead end:
   * `review_consultation_hypothesis` refuses every decision on a stale row and
   * re-preparing only replaces DRAFTS, so the AI plan (which needs an accepted,
   * non-stale hypothesis) could never run again. The confirmation is NAMED —
   * the server compares the pattern we display — so this can never become a
   * batch "mark everything current" button.
   */
  const reaffirm = async (hypothesis: Hypothesis) => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/hypotheses/${hypothesis.id}/reaffirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: hypothesis.updatedAt, confirmPattern: hypothesis.pattern }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = body?.error?.code ?? body?.code;
        setActionError(
          code === "hypothesis_revision_conflict"
            ? t("hypotheses-review-conflict")
            : code === "consultation_finalized"
              ? t("hypotheses-finalized")
              : t("hypotheses-reaffirm-error"),
        );
        await load(true);
        return;
      }
      setReaffirming(null);
      await load(true);
      onDecisionChanged?.();
    } catch {
      setActionError(t("hypotheses-network"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Her decision on a suggestion (PRD §10.10: reject, edit, report). Editing the
   * pattern makes the reading HERS — same rule as the anamnesis, where touching
   * an AI value flips it to the professional. `reviewed_by` is who decided, so a
   * human judgement is never mistaken for model output.
   */
  const review = async (
    hypothesis: Hypothesis,
    status: "accepted" | "rejected" | "edited",
    changes?: { note?: string; pattern?: string },
  ) => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/hypotheses/${hypothesis.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          pattern: changes?.pattern,
          note: changes?.note,
          expectedUpdatedAt: hypothesis.updatedAt,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = body?.error?.code ?? body?.code;
        setActionError(
          code === "hypothesis_stale"
            ? t("hypotheses-stale-draft")
            : code === "hypothesis_revision_conflict"
              ? t("hypotheses-review-conflict")
              : code === "consultation_finalized"
                ? t("hypotheses-finalized")
                : t("hypotheses-error"),
        );
        // Whatever the server saw, our copy of the row is behind. Reload so the
        // card stops offering a decision the database will refuse again.
        if (code === "hypothesis_stale" || code === "hypothesis_revision_conflict") await load(true);
        return;
      }
      setReviewing(null);
      setNote("");
      setPattern("");
      await load(true);
      onDecisionChanged?.();
    } catch {
      setActionError(t("hypotheses-network"));
    } finally {
      setBusy(false);
    }
  };

  const resource =
    hypothesesState.status === "success"
      ? hypothesesState.data
      : hypothesesState.status === "loading" || hypothesesState.status === "error"
        ? hypothesesState.previous
        : undefined;
  const hypotheses = resource?.hypotheses ?? [];
  const prior = resource?.prior ?? [];
  const initialLoading = hypothesesState.status === "loading" && !resource;
  const loadFailed = hypothesesState.status === "error";
  const refreshing = hypothesesState.status === "loading" && Boolean(resource);
  const hasAny = hypotheses.length > 0;
  const panelMode = deriveHypothesesPanelMode({
    reasoningEntitled,
    // "Can this screen offer preparing at all?" — a blocked gate still shows the
    // button, disabled, with the reason; only a hidden one takes it away.
    canPrepare: prepareVisible,
    isFinalized,
    hasHypotheses: hasAny,
  });

  const staleCount = hypotheses.filter((item) => item.staleAt).length;
  // Open on the one that needs her: the first fresh draft, else the first.
  const activeHypothesis =
    hypotheses.find((item) => item.id === activeId) ??
    hypotheses.find((item) => item.status === "draft" && !item.staleAt) ??
    hypotheses[0];
  const pendingDrafts = hypotheses.filter((item) => item.status === "draft" && !item.staleAt).length;
  const hasFreshDecision = hypotheses.some(
    (item) => (item.status === "accepted" || item.status === "edited") && !item.staleAt,
  );
  const stepStatus: "done" | "in_progress" | "stale" | undefined = !hasAny
    ? undefined
    : staleCount > 0
      ? "stale"
      : pendingDrafts > 0
        ? "in_progress"
        : hasFreshDecision
          ? "done"
          : undefined;
  const locked = !initialLoading && !entitlementLoading && !entitlementError && panelMode === "locked" && !loadFailed;

  useEffect(() => {
    if (!locked || upgradeViewedRef.current) return;
    upgradeViewedRef.current = true;
    trackCommercialEvent("upgrade.prompt_viewed", "consultation", "clinical_reasoning");
  }, [locked]);

  if (initialLoading) {
    return <CircularProgress size={24} aria-label={t("loading")} />;
  }

  const correspondenceLabel = (value: Hypothesis["correspondence"]) =>
    ({
      weak: t("hypotheses-match-weak"),
      moderate: t("hypotheses-match-moderate"),
      strong: t("hypotheses-match-strong"),
    })[value];

  const kindLabel = (kind: string) =>
    ({
      traditional: t("hypotheses-kind-traditional"),
      protocol: t("hypotheses-kind-protocol"),
      evidence: t("hypotheses-kind-evidence"),
    })[kind] ?? t("hypotheses-kind-unknown");

  /**
   * One control, rendered in two places (the empty card and the footer).
   *
   * It is shown whenever preparing is possible IN PRINCIPLE and disabled with
   * the reason underneath when a fact is missing: a button that simply vanishes
   * teaches nothing, and one that stays lit over an empty chart spends her
   * minute before refusing.
   */
  const prepareControl = (label: string, variant: "contained" | "outlined") =>
    prepareVisible ? (
      <Box className="flex flex-col gap-1.5">
        <Button
          variant={variant}
          color="primary"
          fullWidth
          startIcon={busy ? undefined : <NiClipboard size="tiny" />}
          onClick={prepare}
          disabled={busy || !canPrepare}
          aria-describedby={
            prepareGate.state === "blocked" || prepareGate.state === "unknown" ? "hypotheses-prepare-reason" : undefined
          }
        >
          {busy ? <CircularProgress size={18} /> : label}
        </Button>
        <GateNotice gate={prepareGate} id="hypotheses-prepare-reason" onRetry={onRetryEntitlement} />
        {/* A minute of silence with a spinner reads as "frozen" with the next
            patient at the door. Say how long, and what not to do meanwhile. */}
        {busy && (
          <Typography variant="body2" role="status" className="text-text-secondary text-xs leading-5">
            {t("hypotheses-preparing")}
          </Typography>
        )}
        {/* Tongue and pulse are a WARNING, never a block: the server accepts the
            request and marks the reading as partial itself (PRD §10.8). */}
        {prepareGate.state === "available" && prepareGate.soft?.includes("exam_partial") && (
          <Box className="flex flex-row flex-wrap items-center gap-1">
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("journey-reason-exam_partial")}
            </Typography>
            {onFocusField && (
              <Button size="small" className="px-1!" onClick={() => onFocusField("tcm", "tongue")}>
                {t("hypotheses-goto-exam")}
              </Button>
            )}
          </Box>
        )}
      </Box>
    ) : null;

  // Reading a sign means going back to the field that produced it — which sits
  // behind this dialog. Close first, then let the page put it in view.
  const focusField = onFocusField
    ? (blockKey: string, fieldKey: string) => {
        setReviewOpen(false);
        onFocusField(blockKey, fieldKey);
      }
    : undefined;

  // Without the Pro layer there is nothing to show and nothing to sell here —
  // the consultation screen is not a place to advertise (PRD §7.4).
  if (!entitlementLoading && !entitlementError && panelMode === "hidden" && !loadFailed) return null;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        {/* The title is prescribed by PRD §10.8, word for word. */}
        {/* Without the Pro layer this card has nothing clinical in it, so it is
            not step 2 of anything — numbering an upgrade prompt dressed it as
            part of the appointment. */}
        <ConsultationStepHeader
          step={locked ? undefined : stepNumber}
          icon={<NiClipboard size="medium" />}
          title={locked ? t("hypotheses-locked-title") : t("hypotheses-title")}
          hint={t("hypotheses-step-hint")}
          status={locked ? undefined : stepStatus}
          statusLabel={
            stepStatus
              ? t(
                  stepStatus === "done"
                    ? "journey-step-done"
                    : stepStatus === "stale"
                      ? "journey-step-stale"
                      : "journey-step-in-progress",
                )
              : undefined
          }
        />

        {loadFailed && (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={() => void load(true)}>{t("retry")}</Button>}
          >
            {t("hypotheses-load-error")}
          </Alert>
        )}

        {actionError && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {actionError}
          </Alert>
        )}

        {/* "Nenhuma fonte sustenta esta leitura" and "a biblioteca não foi
            consultada" look the same on the card and mean opposite things. */}
        {retrievalFailed && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("hypotheses-library-unavailable")}
          </Alert>
        )}

        {refreshing && <CircularProgress size={18} aria-label={t("loading")} />}

        {entitlementError && !hasAny ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={onRetryEntitlement}>{t("retry")}</Button>}
          >
            {t("hypotheses-entitlement-error")}
          </Alert>
        ) : entitlementLoading && !hasAny ? (
          <CircularProgress size={18} aria-label={t("loading")} />
        ) : locked ? (
          <Box className="border-primary/25 bg-primary/5 flex flex-col items-start gap-3 rounded-2xl border p-4">
            <Chip size="small" color="primary" label={t("hypotheses-pro-chip")} />
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("hypotheses-locked-body")}
            </Typography>
            {/* Opens beside the consultation, never in place of it: this link
                used to navigate the same tab, pulling her out of an open record
                with the patient in the room. */}
            <Button
              variant="outlined"
              color="primary"
              fullWidth
              href="/settings/billing?source=consultation&feature=clinical_reasoning"
              LinkComponent={Link}
              target="_blank"
              rel="noopener"
              onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "consultation", "clinical_reasoning")}
            >
              {t("hypotheses-locked-cta")}
            </Button>
          </Box>
        ) : loadFailed && !resource ? null : !hasAny ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("hypotheses-empty")}
            </Typography>
            {prepareControl(t("hypotheses-prepare"), "contained")}
          </>
        ) : (
          <>
            {/* The column states WHERE the review stands; the reviewing itself
                happens in the dialog below, which has room for the reasoning. */}
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {staleCount > 0
                ? // The chart moved: say it on the card, not only inside the
                  // dialog, and name both exits.
                  t("hypotheses-summary-stale")
                : hypotheses.some((item) => item.status === "draft")
                  ? t("hypotheses-summary-pending", {
                      count: hypotheses.filter((item) => item.status === "draft").length,
                    })
                  : t("hypotheses-summary-done")}
            </Typography>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              startIcon={<NiClipboard size="tiny" />}
              onClick={() => setReviewOpen(true)}
            >
              {t("hypotheses-review-open", { count: hypotheses.length })}
            </Button>

            <Dialog
              fullScreen={fullScreen}
              open={reviewOpen}
              onClose={() => setReviewOpen(false)}
              maxWidth="md"
              fullWidth
              scroll="paper"
            >
              <DialogHeader
                title={t("hypotheses-title")}
                closeLabel={t("close")}
                onClose={() => setReviewOpen(false)}
              />
              {/* One hypothesis at a time. The old dialog stacked every
                  hypothesis with every section in small text, so signs, gaps,
                  sources and buttons of different patterns ran into each other.
                  Tabs keep each reading whole, and the dot says where each one
                  stands without opening it. */}
              {hypotheses.length > 1 && (
                <Tabs
                  value={Math.max(
                    0,
                    hypotheses.findIndex((item) => item.id === activeHypothesis?.id),
                  )}
                  onChange={(_, index: number) => setActiveId(hypotheses[index]?.id ?? null)}
                  variant="scrollable"
                  scrollButtons="auto"
                  allowScrollButtonsMobile
                  aria-label={t("hypotheses-tabs-label")}
                  className="px-2 pt-1"
                >
                  {hypotheses.map((hypothesis, index) => (
                    <Tab
                      key={hypothesis.id}
                      id={`hypothesis-tab-${hypothesis.id}`}
                      aria-controls={`hypothesis-panel-${hypothesis.id}`}
                      className="normal-case"
                      label={
                        <span className="flex max-w-60 flex-row items-center gap-1.5">
                          <span
                            aria-hidden
                            className={cn("h-2 w-2 flex-none rounded-full", hypothesisDotTone(hypothesis))}
                          />
                          <span className="truncate">
                            {index + 1}. {hypothesis.pattern}
                          </span>
                        </span>
                      }
                    />
                  ))}
                </Tabs>
              )}
              <DialogContent dividers className="flex flex-col gap-4 py-5!">
                {activeHypothesis && (
                  <Box
                    role={hypotheses.length > 1 ? "tabpanel" : undefined}
                    id={`hypothesis-panel-${activeHypothesis.id}`}
                    aria-labelledby={hypotheses.length > 1 ? `hypothesis-tab-${activeHypothesis.id}` : undefined}
                    className={cn("flex flex-col gap-4", activeHypothesis.status === "rejected" && "opacity-70")}
                  >
                    {/* ---- What is being proposed, and how well it fits ---- */}
                    <Box className="flex flex-col gap-2">
                      <Box className="flex flex-row flex-wrap items-center gap-2">
                        <Typography variant="h6" component="h3" className="mb-0">
                          {activeHypothesis.pattern}
                        </Typography>
                        {activeHypothesis.status !== "draft" && (
                          <Chip
                            size="small"
                            label={t(`hypotheses-status-${activeHypothesis.status}`)}
                            className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light text-xs font-semibold"
                          />
                        )}
                      </Box>
                      {/* Correspondence with the RECORDED data — never confidence. */}
                      <CorrespondenceMeter
                        value={activeHypothesis.correspondence}
                        label={correspondenceLabel(activeHypothesis.correspondence)}
                      />
                    </Box>

                    {/* Stated BEFORE the reasoning is read, not as a footnote.
                        The exit it needs is the one button in the footer. */}
                    {activeHypothesis.staleAt && (
                      <Alert severity="warning" className="neutral bg-background-paper/60!">
                        <span id={`hypothesis-stale-${activeHypothesis.id}`}>
                          {t(
                            activeHypothesis.status === "draft" ? "hypotheses-stale-draft" : "hypotheses-stale-decided",
                          )}
                        </span>
                      </Alert>
                    )}
                    {activeHypothesis.limitation && (
                      <Alert severity="warning" className="neutral bg-background-paper/60!">
                        {activeHypothesis.limitation}
                      </Alert>
                    )}

                    {activeHypothesis.rationale && (
                      <ReviewSection title={t("hypotheses-rationale")}>
                        <Typography variant="body2" className="text-text-primary leading-6">
                          {activeHypothesis.rationale}
                        </Typography>
                      </ReviewSection>
                    )}

                    {/* For and against, side by side and with the SAME weight:
                        a hypothesis you can only agree with is a trap. */}
                    <ReviewSection title={t("hypotheses-evidence")}>
                      <Box className="grid gap-3 md:grid-cols-2">
                        <Box className="border-accent-1/30 bg-accent-1/5 rounded-2xl border p-3">
                          <SignList
                            title={t("hypotheses-supporting")}
                            signs={activeHypothesis.supportingSigns}
                            onFocusField={focusField}
                          />
                        </Box>
                        <Box className="border-accent-3/30 bg-accent-3/5 rounded-2xl border p-3">
                          <SignList
                            title={t("hypotheses-contradicting")}
                            signs={activeHypothesis.contradictingSigns}
                            onFocusField={focusField}
                          />
                        </Box>
                      </Box>
                    </ReviewSection>

                    {activeHypothesis.missingData.length > 0 && (
                      <ReviewSection title={t("hypotheses-missing")}>
                        <Box component="ul" className="flex flex-col gap-1.5">
                          {activeHypothesis.missingData.map((item, index) => (
                            <Box component="li" key={index} className="flex flex-row items-start gap-2">
                              <span
                                aria-hidden
                                className="bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-bold"
                              >
                                ?
                              </span>
                              <Typography variant="body2" className="text-text-primary leading-6">
                                {item}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      </ReviewSection>
                    )}

                    <ReviewSection title={t("hypotheses-sources")}>
                      {activeHypothesis.sources.length === 0 ? (
                        // "Nothing in the library covers this" and "the library
                        // was never reached" are opposite facts; the row knows.
                        <Typography variant="body2" className="text-text-secondary leading-6">
                          {t(
                            activeHypothesis.retrievalFailed ? "hypotheses-sources-unchecked" : "hypotheses-no-sources",
                          )}
                        </Typography>
                      ) : (
                        <Box component="ul" className="flex flex-col gap-2">
                          {activeHypothesis.sources.map((source, index) => (
                            <Box
                              component="li"
                              key={index}
                              className="border-grey-100 flex flex-col gap-1 rounded-xl border px-3 py-2 sm:flex-row sm:items-center sm:gap-2"
                            >
                              <Box className="min-w-0 flex-1">
                                {source.documentId ? (
                                  // Verified against a chunk the pipeline really
                                  // retrieved; opens beside the consultation so
                                  // the record stays where it is.
                                  <MuiLink
                                    component={Link}
                                    href={`/biblioteca/acervo/${source.documentId}`}
                                    target="_blank"
                                    rel="noopener"
                                    underline="hover"
                                    className="text-primary-dark dark:text-primary-light text-sm font-semibold"
                                    aria-label={t("hypotheses-source-open", { title: source.title })}
                                    onClick={() => trackProductEvent("citation.opened", { origin: "consultation" })}
                                  >
                                    {source.title}
                                  </MuiLink>
                                ) : (
                                  <Typography variant="body2" className="text-text-primary font-semibold">
                                    {source.title}
                                  </Typography>
                                )}
                                {source.source && (
                                  <Typography variant="caption" className="text-text-secondary block leading-4">
                                    {source.source}
                                  </Typography>
                                )}
                              </Box>
                              <Chip
                                size="small"
                                variant="outlined"
                                label={kindLabel(source.kind)}
                                className="self-start text-xs sm:self-center"
                              />
                            </Box>
                          ))}
                        </Box>
                      )}
                    </ReviewSection>

                    {activeHypothesis.reviewNote && (
                      <ReviewSection title={t("hypotheses-your-note")}>
                        <Typography variant="body2" className="text-text-secondary leading-6 italic">
                          {activeHypothesis.reviewNote}
                        </Typography>
                      </ReviewSection>
                    )}
                  </Box>
                )}
                {/* PRD §10.11 travels WITH the reasoning it qualifies. */}
                <Typography
                  variant="body2"
                  className="text-text-secondary border-grey-100 border-t pt-4 text-xs leading-5"
                >
                  {t("hypotheses-disclaimer")}
                </Typography>
              </DialogContent>
              {/* Decisions live in the footer, for the hypothesis on screen, and
                  only the ones that can work: a stale row offers its one exit
                  (the database refuses every other move on it, 0031:152-154). */}
              <DialogActions disableSpacing className="flex flex-row flex-wrap items-center gap-2">
                <Button color="grey" className="max-sm:hidden" onClick={() => setReviewOpen(false)}>
                  {t("close")}
                </Button>
                {!isFinalized && activeHypothesis && (
                  <Box className="ml-auto flex flex-row flex-wrap items-center justify-end gap-2">
                    {activeHypothesis.staleAt ? (
                      activeHypothesis.status === "accepted" || activeHypothesis.status === "edited" ? (
                        <Button
                          variant="contained"
                          color="primary"
                          disabled={busy}
                          aria-describedby={`hypothesis-stale-${activeHypothesis.id}`}
                          onClick={() => setReaffirming(activeHypothesis)}
                        >
                          {t("hypotheses-reaffirm")}
                        </Button>
                      ) : canPrepare ? (
                        <Button
                          variant="contained"
                          color="primary"
                          disabled={busy}
                          aria-describedby={`hypothesis-stale-${activeHypothesis.id}`}
                          onClick={() => void prepare()}
                        >
                          {busy ? <CircularProgress size={18} /> : t("hypotheses-reprepare")}
                        </Button>
                      ) : null
                    ) : (
                      <>
                        {activeHypothesis.status !== "rejected" && (
                          <Button
                            variant="text"
                            color="grey"
                            disabled={busy}
                            onClick={() => {
                              setReviewing({ hypothesis: activeHypothesis, mode: "reject" });
                              setNote("");
                            }}
                          >
                            {t("hypotheses-reject")}
                          </Button>
                        )}
                        {/* Editing makes the reading hers, not the model's (PRD §10.10). */}
                        <Button
                          variant="outlined"
                          color="grey"
                          disabled={busy}
                          onClick={() => {
                            setReviewing({ hypothesis: activeHypothesis, mode: "edit" });
                            setPattern(activeHypothesis.pattern);
                            setNote("");
                          }}
                        >
                          {t("hypotheses-edit")}
                        </Button>
                        {activeHypothesis.status !== "accepted" && (
                          <Button
                            variant="contained"
                            color="primary"
                            disabled={busy}
                            onClick={() => review(activeHypothesis, "accepted")}
                          >
                            {t("hypotheses-accept")}
                          </Button>
                        )}
                      </>
                    )}
                  </Box>
                )}
              </DialogActions>
            </Dialog>

            {prior.length > 0 && (
              <Box className="flex flex-col gap-1">
                <Button
                  size="small"
                  color="grey"
                  variant="text"
                  className="self-start"
                  endIcon={<NiChevronDownSmall size="small" />}
                  onClick={() => setShowPrior((value) => !value)}
                >
                  {t("hypotheses-prior", { count: prior.length })}
                </Button>
                {showPrior &&
                  prior.map((item, index) => (
                    <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
                      · {item.pattern}
                      {item.startedAt ? ` — ${new Date(item.startedAt).toLocaleDateString()}` : ""}
                    </Typography>
                  ))}
              </Box>
            )}

            {prepareControl(t("hypotheses-reprepare"), "outlined")}
          </>
        )}

        {/* PRD §10.11 — mandatory and verbatim. Kept here too (not only in the
            review dialog) so the framing is on screen before anything is read. */}
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("hypotheses-disclaimer")}
        </Typography>
      </CardContent>

      <Dialog open={Boolean(reviewing)} onClose={() => setReviewing(null)} maxWidth="xs" fullWidth>
        <DialogHeader
          title={reviewing?.mode === "edit" ? t("hypotheses-edit-title") : t("hypotheses-reject-title")}
          closeLabel={t("close")}
          onClose={() => setReviewing(null)}
        />
        <DialogContent className="flex flex-col gap-3 py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {reviewing?.mode === "edit" ? t("hypotheses-edit-body") : t("hypotheses-reject-body")}
          </Typography>
          {reviewing?.mode === "edit" && (
            <TextField
              autoFocus
              fullWidth
              label={t("hypotheses-edit-pattern")}
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
            />
          )}
          <TextField
            autoFocus={reviewing?.mode === "reject"}
            multiline
            minRows={3}
            fullWidth
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              reviewing?.mode === "edit" ? t("hypotheses-edit-placeholder") : t("hypotheses-reject-placeholder")
            }
          />
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setReviewing(null)}>
            {t("hypotheses-reject-cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              busy ||
              (reviewing?.mode === "edit" && pattern.trim().length === 0) ||
              (reviewing?.mode === "reject" && note.trim().length === 0)
            }
            onClick={() =>
              reviewing &&
              (reviewing.mode === "edit"
                ? review(reviewing.hypothesis, "edited", { pattern: pattern.trim(), note: note.trim() || undefined })
                : review(reviewing.hypothesis, "rejected", { note: note.trim() || undefined }))
            }
          >
            {reviewing?.mode === "edit" ? t("hypotheses-edit-confirm") : t("hypotheses-reject-confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reaffirming is a clinical act: the dialog NAMES the pattern, one at a
          time, and the server compares the name it was given (0098). There is
          deliberately no "reaffirm all". */}
      <Dialog
        open={Boolean(reaffirming)}
        onClose={busy ? undefined : () => setReaffirming(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogHeader
          title={t("hypotheses-reaffirm-title")}
          closeLabel={t("close")}
          onClose={() => setReaffirming(null)}
        />
        <DialogContent className="flex flex-col gap-3 py-5!">
          <Typography variant="body1" className="text-text-primary font-semibold">
            {reaffirming?.pattern}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("hypotheses-reaffirm-body")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setReaffirming(null)}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() => reaffirming && void reaffirm(reaffirming)}
          >
            {busy ? <CircularProgress size={18} /> : t("hypotheses-reaffirm-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

/**
 * The signs a hypothesis stands or falls on. Each one names the anamnesis field
 * it was read from whenever the model reported it: "língua pálida" is a claim,
 * "língua pálida — Língua" is a claim she can go and check against her own
 * record. A sign with no (or an unrecognized) field renders exactly as before —
 * a made-up provenance would be worse than none.
 */
function SignList({
  title,
  signs,
  onFocusField,
}: {
  title: string;
  signs: Sign[];
  onFocusField?: (blockKey: string, fieldKey: string) => void;
}) {
  const t = useTranslations("product");
  return (
    <Box className="flex flex-col gap-1">
      <Typography variant="body2" className="text-text-primary text-xs font-semibold">
        {title}
      </Typography>
      {signs.length === 0 ? (
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          —
        </Typography>
      ) : (
        signs.map((sign, index) => {
          const field = resolveSignField(sign.fieldKey);
          return (
            <Box key={index} className="flex flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
              <Typography variant="body2" component="span" className="text-text-secondary text-xs leading-5">
                · {sign.text}
              </Typography>
              {field && (
                <Chip
                  size="small"
                  label={t(field.labelKey)}
                  title={t("hypotheses-sign-field")}
                  className="bg-primary/10 text-primary-dark dark:text-primary-light text-xs font-semibold"
                  clickable={Boolean(onFocusField)}
                  aria-label={onFocusField ? t("hypotheses-sign-field-go", { field: t(field.labelKey) }) : undefined}
                  onClick={onFocusField ? () => onFocusField(field.blockKey, field.fieldKey) : undefined}
                />
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}

/** Where a hypothesis stands, as a dot on its tab: outdated, waiting, decided, discarded. */
function hypothesisDotTone(hypothesis: Hypothesis): string {
  if (hypothesis.staleAt) return "bg-accent-3";
  if (hypothesis.status === "draft") return "bg-primary";
  if (hypothesis.status === "rejected") return "bg-grey-500";
  return "bg-accent-1";
}

/** A titled block of the review, separated from the next by a hairline. */
function ReviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" className="border-grey-100 flex flex-col gap-2 border-t pt-4">
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

/**
 * How well a pattern matches what was RECORDED, as three steps plus the words.
 * It is a correspondence scale, never a confidence or a probability (PRD
 * §10.8): the label says so and is the accessible name.
 */
function CorrespondenceMeter({ value, label }: { value: Hypothesis["correspondence"]; label: string }) {
  const level = value === "strong" ? 3 : value === "moderate" ? 2 : 1;
  return (
    <Box role="img" aria-label={label} className="flex flex-row items-center gap-2">
      <Box aria-hidden className="flex flex-row gap-0.5">
        {[1, 2, 3].map((step) => (
          <span key={step} className={cn("h-1.5 w-5 rounded-full", step <= level ? "bg-primary" : "bg-grey-100")} />
        ))}
      </Box>
      <Typography aria-hidden variant="caption" className="text-text-secondary">
        {label}
      </Typography>
    </Box>
  );
}
