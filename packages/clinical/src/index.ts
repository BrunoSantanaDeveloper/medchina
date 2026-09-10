/** Persisted consultation states from packages/db migration 0020. */
export const CONSULTATION_STATUSES = [
  "scheduled",
  "in_progress",
  "awaiting_review",
  "draft",
  "finalized",
  "cancelled",
] as const;

export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

/** Persisted capture/upload/processing states from migration 0022. */
export const RECORDING_STATUSES = [
  "recording",
  "local",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "cancelled",
] as const;

export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/**
 * What the practitioner is experiencing right now. Recording state can
 * temporarily take precedence over the coarser consultation state.
 */
export type ConsultationExperience =
  | "scheduled"
  | "manual_draft"
  | "in_session"
  | "awaiting_upload"
  | "uploading"
  | "ready_to_process"
  | "processing"
  | "awaiting_review"
  | "failed"
  | "finalized"
  | "cancelled";

/** Public name used by web and mobile when rendering the combined state. */
export type ConsultationExperienceState = ConsultationExperience;

export const CONSULTATION_TRANSITIONS: Readonly<Record<ConsultationStatus, readonly ConsultationStatus[]>> = {
  scheduled: ["scheduled", "in_progress", "cancelled"],
  draft: ["draft", "in_progress", "awaiting_review", "finalized", "cancelled"],
  in_progress: ["in_progress", "awaiting_review", "finalized", "cancelled"],
  awaiting_review: ["awaiting_review", "in_progress", "finalized", "cancelled"],
  finalized: ["finalized"],
  cancelled: ["cancelled", "scheduled"],
};

export function canTransition(
  from: ConsultationStatus,
  to: ConsultationStatus,
  context: { canRestoreCancelledAppointment?: boolean } = {},
): boolean {
  // 0028 permits restoring an appointment, but never reopening a cancelled
  // clinical draft. Callers must prove the row has scheduling context.
  if (from === "cancelled" && to === "scheduled") return context.canRestoreCancelledAppointment === true;
  return CONSULTATION_TRANSITIONS[from].includes(to);
}

export interface DeriveExperienceInput {
  consultationStatus: ConsultationStatus;
  /** The newest unresolved recording, if there is one. */
  recordingStatus?: RecordingStatus | null;
}

export function deriveConsultationExperience({
  consultationStatus,
  recordingStatus,
}: DeriveExperienceInput): ConsultationExperience {
  if (consultationStatus === "finalized") return "finalized";
  if (consultationStatus === "cancelled") return "cancelled";

  if (recordingStatus === "failed") return "failed";
  if (recordingStatus === "recording") return "in_session";
  if (recordingStatus === "local") return "awaiting_upload";
  if (recordingStatus === "uploading") return "uploading";
  if (recordingStatus === "uploaded") return "ready_to_process";
  if (recordingStatus === "processing") return "processing";

  if (consultationStatus === "scheduled") return "scheduled";
  if (consultationStatus === "draft") return "manual_draft";
  if (consultationStatus === "awaiting_review") return "awaiting_review";
  return "in_session";
}

export interface ConsultationStateInput {
  status: ConsultationStatus;
}

export interface RecordingStateInput {
  status: RecordingStatus;
  createdAt?: string | Date | null;
}

const RECORDING_PRECEDENCE: Readonly<Record<RecordingStatus, number>> = {
  failed: 8,
  processing: 7,
  uploading: 6,
  local: 5,
  recording: 4,
  uploaded: 3,
  ready: 2,
  cancelled: 1,
};

/**
 * Canonical cross-platform derivation requested by the product contract.
 * It accepts the persisted consultation plus all of its recordings and never
 * lets a benign `ready` row hide an unresolved upload, processing job or
 * failure. Finalized/cancelled consultations remain terminal.
 */
export function deriveConsultationState(
  consultation: ConsultationStateInput,
  recordings: readonly RecordingStateInput[] = [],
): ConsultationExperienceState {
  const recordingStatus = recordings.reduce<RecordingStatus | undefined>((current, recording) => {
    if (recording.status === "cancelled") return current;
    if (!current || RECORDING_PRECEDENCE[recording.status] > RECORDING_PRECEDENCE[current]) {
      return recording.status;
    }
    return current;
  }, undefined);

  return deriveConsultationExperience({ consultationStatus: consultation.status, recordingStatus });
}

export interface ConsultationCapabilities {
  canStart: boolean;
  canReschedule: boolean;
  canCancel: boolean;
  canEditClinicalRecord: boolean;
  canRecord: boolean;
  canProcessRecording: boolean;
  canReview: boolean;
  canPrepareReasoning: boolean;
  canEditPlan: boolean;
  canValidatePlan: boolean;
  canIssueValidatedDocument: boolean;
  canFinalize: boolean;
  canAddAddendum: boolean;
  hasBlockingOperation: boolean;
}

export interface DeriveCapabilitiesInput extends DeriveExperienceInput {
  hasValidatedPlan?: boolean;
}

const BLOCKING_RECORDINGS = new Set<RecordingStatus>([
  "recording",
  "local",
  "uploading",
  "uploaded",
  "processing",
  "failed",
]);

export function deriveConsultationCapabilities({
  consultationStatus,
  recordingStatus,
  hasValidatedPlan = false,
}: DeriveCapabilitiesInput): ConsultationCapabilities {
  const scheduled = consultationStatus === "scheduled";
  const editable = ["draft", "in_progress", "awaiting_review"].includes(consultationStatus);
  const finalized = consultationStatus === "finalized";
  const terminal = finalized || consultationStatus === "cancelled";
  const hasBlockingOperation = recordingStatus ? BLOCKING_RECORDINGS.has(recordingStatus) : false;

  return {
    canStart: scheduled,
    canReschedule: scheduled,
    canCancel: !terminal && (scheduled || editable),
    canEditClinicalRecord: editable,
    canRecord: editable && !hasBlockingOperation,
    canProcessRecording: editable && (recordingStatus === "uploaded" || recordingStatus === "failed"),
    canReview: editable && consultationStatus === "awaiting_review",
    canPrepareReasoning: editable && !hasBlockingOperation,
    canEditPlan: editable,
    canValidatePlan: editable && !hasBlockingOperation,
    // Issuance is intentionally available after finalization: the validated
    // clinical snapshot is frozen, while versioned documents remain usable.
    canIssueValidatedDocument: hasValidatedPlan && consultationStatus !== "cancelled",
    canFinalize: editable && !hasBlockingOperation,
    canAddAddendum: finalized,
    hasBlockingOperation,
  };
}

const EXPERIENCE_TO_STATUS: Readonly<Record<ConsultationExperienceState, ConsultationStatus>> = {
  scheduled: "scheduled",
  manual_draft: "draft",
  in_session: "in_progress",
  awaiting_upload: "in_progress",
  uploading: "in_progress",
  ready_to_process: "in_progress",
  processing: "in_progress",
  awaiting_review: "awaiting_review",
  failed: "in_progress",
  finalized: "finalized",
  cancelled: "cancelled",
};

const EXPERIENCE_TO_RECORDING: Readonly<Partial<Record<ConsultationExperienceState, RecordingStatus>>> = {
  in_session: "recording",
  awaiting_upload: "local",
  uploading: "uploading",
  ready_to_process: "uploaded",
  processing: "processing",
  failed: "failed",
};

/** Convenience API for UI code that already has the combined state. */
export function getConsultationCapabilities(
  state: ConsultationExperienceState,
  options: { hasValidatedPlan?: boolean } = {},
): ConsultationCapabilities {
  return deriveConsultationCapabilities({
    consultationStatus: EXPERIENCE_TO_STATUS[state],
    recordingStatus: EXPERIENCE_TO_RECORDING[state],
    hasValidatedPlan: options.hasValidatedPlan,
  });
}

export const CLINICAL_ERROR_CODES = [
  "not_authenticated",
  "not_authorized",
  "not_found",
  "invalid_request",
  "invalid_consultation_transition",
  "revision_conflict",
  "stale_status",
  "schedule_conflict",
  "not_an_appointment",
  "active_consultation_exists",
  "patient_unavailable",
  "audio_consent_required",
  "ai_consent_required",
  "allowance_unavailable",
  "consultation_finalized",
  "consultation_cancelled",
  "clinical_revision_conflict",
  "finalization_confirmation_required",
  "recording_pending",
  "recording_already_open",
  "capture_in_progress",
  "recording_invalid_state",
  "stale_upload_id",
  "recording_not_uploaded",
  "recording_integrity_failed",
  "recording_too_long",
  "recording_too_large",
  "transcript_not_validated",
  "audio_deletion_failed",
  "usage_record_failed",
  "processing_already_claimed",
  "processing_claim_lost",
  "consent_required",
  "consent_term_missing",
  "consent_acceptance_mismatch",
  "consent_link_invalid",
  "consent_terms_changed",
  "idempotency_conflict",
  "trial_not_started",
  "audio_allowance_exhausted",
  "reasoning_not_available",
  "nothing_recorded",
  "hypothesis_revision_conflict",
  "hypothesis_stale",
  "accepted_hypothesis_required",
  "plan_not_found",
  "plan_validated",
  "plan_not_validated",
  "plan_stale",
  "manual_plan_exists",
  "safety_acknowledgement_required",
  // Returned by validate_consultation_plan (0093) when moxibustion is enabled
  // without its contraindication checklist. It was missing here, so the route
  // rewrote it to internal_error and the panel showed "o plano mudou em outra
  // etapa" — a sentence about a completely different problem.
  "moxibustion_checklist_required",
  "derived_safety_flags_immutable",
  "images_consent_required",
  "prescription_stale",
  "prescription_not_found",
  "prescription_not_validated",
  "document_issue_conflict",
  "document_profile_incomplete",
  "document_reissue_confirmation_required",
  "provider_unavailable",
  // A definitive provider refusal (invalid key, model gone, credits depleted):
  // retrying cannot fix it, unlike the transient provider_unavailable.
  "provider_rejected",
  "internal_error",
] as const;

export type ClinicalErrorCode = (typeof CLINICAL_ERROR_CODES)[number];

export interface ClinicalDomainError {
  code: ClinicalErrorCode;
  retryable: boolean;
  /** Safe structured context only; never put clinical free text here. */
  details?: Readonly<Record<string, unknown>>;
}

const CLINICAL_ERROR_CODE_SET = new Set<string>(CLINICAL_ERROR_CODES);

export function isClinicalErrorCode(value: unknown): value is ClinicalErrorCode {
  return typeof value === "string" && CLINICAL_ERROR_CODE_SET.has(value);
}

export type RemoteState<T, E = ClinicalDomainError> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "success"; data: T }
  | { status: "empty" }
  | { status: "error"; error: E; previous?: T };

export const remoteIdle = <T, E = ClinicalDomainError>(): RemoteState<T, E> => ({ status: "idle" });
export const remoteLoading = <T, E = ClinicalDomainError>(previous?: T): RemoteState<T, E> => ({
  status: "loading",
  ...(previous === undefined ? {} : { previous }),
});
export const remoteSuccess = <T, E = ClinicalDomainError>(data: T): RemoteState<T, E> => ({ status: "success", data });
export const remoteEmpty = <T, E = ClinicalDomainError>(): RemoteState<T, E> => ({ status: "empty" });
export const remoteError = <T, E = ClinicalDomainError>(error: E, previous?: T): RemoteState<T, E> => ({
  status: "error",
  error,
  ...(previous === undefined ? {} : { previous }),
});

export type ProductIntent = "activation" | "schedule" | "manual" | "ai" | "review";

export interface JourneyContext {
  intent: ProductIntent;
  origin?: string;
  returnTo?: string;
  patientId?: string;
  consultationId?: string;
}

const SAFE_DEFAULT_NEXT = "/inicio";

function sanitizeCandidate(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return null;

  try {
    const decoded = decodeURIComponent(candidate);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) return null;

    const base = "https://medchina.internal";
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/**
 * Prevent open redirects while preserving a user's in-product journey.
 * The fallback is sanitized by the same rules and ultimately becomes /inicio.
 */
export function sanitizeInternalNext(value: string | null | undefined, fallback = SAFE_DEFAULT_NEXT): string {
  return sanitizeCandidate(value) ?? sanitizeCandidate(fallback) ?? SAFE_DEFAULT_NEXT;
}

/* -------------------------------------------------------------------------- *
 * The consultation journey — what is ready, what is blocked, and WHY.
 *
 * `deriveConsultationCapabilities` above answers "would the server accept this
 * transition?" from the STATUS. This answers the other half, the one the screen
 * kept getting wrong: "is there anything to act on yet?" — from the DATA.
 *
 * Two rules make it honest, and every branch below is written to them:
 *  1. A step is only blocked for a fact the SERVER also checks (each branch
 *     names the migration or route it mirrors). The two deliberate exceptions
 *     are marked UI-only: a capture in flight (whose draft would immediately
 *     stale the result through mark_clinical_outputs_stale) and a failed save
 *     (the server would read a chart missing what she just typed).
 *  2. A fact that is still loading is never "available" and never "blocked",
 *     and a fact that FAILED to load is "unknown" — never rendered as a
 *     negative answer (PRD §10.5).
 * -------------------------------------------------------------------------- */

/** A fact the screen fetches asynchronously. "unavailable" means the fetch FAILED. */
export type Fact<T> = { status: "loading" } | { status: "unavailable" } | { status: "ready"; value: T };

export const factLoading = <T,>(): Fact<T> => ({ status: "loading" });
export const factUnavailable = <T,>(): Fact<T> => ({ status: "unavailable" });
export const factReady = <T,>(value: T): Fact<T> => ({ status: "ready", value });

export interface HypothesisFacts {
  draftFresh: number;
  draftStale: number;
  acceptedFresh: number;
  acceptedStale: number;
  rejected: number;
}

/**
 * Counts by decision AND freshness. Counting accepted hypotheses without
 * looking at `stale_at` is what left the plan's AI button lit over a hypothesis
 * the database would refuse to build on (`accepted_hypothesis_required`,
 * 0031:656-662).
 */
export function hypothesisFactsFromRows(
  rows: readonly { status: string; stale_at?: string | null }[],
): HypothesisFacts {
  const facts: HypothesisFacts = { draftFresh: 0, draftStale: 0, acceptedFresh: 0, acceptedStale: 0, rejected: 0 };
  for (const row of rows) {
    const stale = Boolean(row.stale_at);
    if (row.status === "draft") {
      if (stale) facts.draftStale += 1;
      else facts.draftFresh += 1;
    } else if (row.status === "accepted" || row.status === "edited") {
      if (stale) facts.acceptedStale += 1;
      else facts.acceptedFresh += 1;
    } else if (row.status === "rejected") {
      facts.rejected += 1;
    }
  }
  return facts;
}

export interface PlanFacts {
  status: "draft" | "validated";
  origin: "ai" | "manual";
  stale: boolean;
  hasObjective: boolean;
  enabledModalities: number;
  moxibustionEnabled: boolean;
  moxibustionChecklistFilled: boolean;
  safetyFlagCount: number;
}

const modalityEnabled = (value: unknown): boolean => {
  // Mirrors `(modality.value ->> 'enabled')::boolean` — Postgres accepts the
  // JSON boolean and the string "true" alike.
  const enabled = (value as { enabled?: unknown } | null)?.enabled;
  return enabled === true || enabled === "true";
};

/** Mirrors `jsonb_array_elements_text` + `nullif(btrim(entry), '')`. */
const checklistEntryText = (entry: unknown): string =>
  entry === null || entry === undefined ? "" : typeof entry === "string" ? entry : JSON.stringify(entry);

/** The plan row as the panel and the page both read it, in the shape the validation rule needs. */
export function planFactsFromRow(row: {
  status: string;
  origin: string;
  stale_at?: string | null;
  objective?: string | null;
  modalities?: unknown;
  safety_flags?: unknown;
}): PlanFacts {
  const modalities =
    row.modalities && typeof row.modalities === "object" ? (row.modalities as Record<string, unknown>) : {};
  const moxibustion = modalities.moxibustion;
  const checklist = (moxibustion as { contraindicationChecklist?: unknown } | null)?.contraindicationChecklist;
  return {
    status: row.status === "validated" ? "validated" : "draft",
    origin: row.origin === "manual" ? "manual" : "ai",
    stale: Boolean(row.stale_at),
    hasObjective: Boolean((row.objective ?? "").trim()),
    enabledModalities: Object.values(modalities).filter(modalityEnabled).length,
    moxibustionEnabled: modalityEnabled(moxibustion),
    moxibustionChecklistFilled:
      Array.isArray(checklist) && checklist.some((entry) => checklistEntryText(entry).trim().length > 0),
    safetyFlagCount: Array.isArray(row.safety_flags) ? row.safety_flags.length : 0,
  };
}

export interface PrescriptionFacts {
  status: "draft" | "validated";
}

export interface JourneyFacts {
  consultationStatus: ConsultationStatus;
  recordingStatus: RecordingStatus | null;
  isPrimaryTab: boolean;
  saveFailed: boolean;
  consents: Fact<{ audio: boolean; ai: boolean; images: boolean }>;
  reasoningEntitled: Fact<boolean>;
  record: {
    /** Non-blank answers that are not rejected, in ANY block — what the routes call "something recorded". */
    recordedAnswerCount: number;
    hasChiefComplaint: boolean;
    hasSummary: boolean;
    attentionCount: number;
    aiDraftPresent: boolean;
    tongueRecorded: boolean;
    pulseRecorded: boolean;
    /** An imported record (legacy_body): real content, with no anamnesis fields. */
    legacyRecord: boolean;
    gapCount: number;
  };
  hypotheses: Fact<HypothesisFacts>;
  plan: Fact<PlanFacts | null>;
  prescription: Fact<PrescriptionFacts | null>;
}

/**
 * Why a step cannot run. Every reason that the SERVER also has keeps the
 * server's name, so the sentence shown before the click and the one shown after
 * a refusal come from the same table.
 */
export const JOURNEY_REASONS = [
  "ai_consent_required",
  "audio_consent_required",
  "nothing_recorded",
  "save_failed",
  "capture_in_flight",
  "other_tab",
  "accepted_hypothesis_required",
  "hypothesis_stale",
  "plan_stale",
  "plan_objective_required",
  "plan_modality_required",
  "moxibustion_checklist_required",
  "safety_acknowledgement_required",
  "recording_pending",
  "reasoning_not_available",
  "exam_partial",
] as const;
export type JourneyReason = (typeof JOURNEY_REASONS)[number];

export type JourneyGate =
  | { state: "hidden" }
  | { state: "loading" }
  | { state: "unknown" }
  | { state: "blocked"; reason: JourneyReason; soft?: JourneyReason[] }
  | { state: "available"; soft?: JourneyReason[] };

export type JourneyStepKey = "consent" | "record" | "review" | "hypotheses" | "plan" | "prescription" | "finalize";
export type JourneyStepState =
  | "hidden"
  | "loading"
  | "unknown"
  | "blocked"
  | "available"
  | "in_progress"
  | "done"
  | "stale";

export interface JourneyStep {
  key: JourneyStepKey;
  state: JourneyStepState;
  reason?: JourneyReason;
  /** Only record, hypotheses and plan are numbered, over the VISIBLE ones. */
  number?: number;
  optional: boolean;
  count?: number;
}

export type JourneyNextKey =
  | "start"
  | "retry-save"
  | "other-tab"
  | "recording"
  | "uploading"
  | "process-recording"
  | "processing"
  | "recover-recording"
  | "record"
  | "review-attention"
  | "consent-for-ai"
  | "prepare-hypotheses"
  | "decide-hypotheses"
  | "hypotheses-stale"
  | "plan-stale"
  | "validate-plan"
  | "finalize"
  | "finalized"
  | "cancelled"
  | "loading";

export interface JourneyNext {
  key: JourneyNextKey;
  count?: number;
  step?: JourneyStepKey;
}

export type FinalizeWarning =
  | "attention_fields"
  | "draft_hypotheses"
  | "draft_plan"
  | "draft_prescription"
  | "empty_consultation";

export interface ConsultationJourney {
  steps: Record<JourneyStepKey, JourneyStep>;
  gates: {
    prepareHypotheses: JourneyGate;
    preparePlanAi: JourneyGate;
    createManualPlan: JourneyGate;
    generateSummary: JourneyGate;
    analyzeAttachment: JourneyGate;
    finalize: JourneyGate;
  };
  next: JourneyNext;
  /** What finalize_consultation (0093:82-110) is expected to warn about. The server stays authoritative. */
  finalizeLooseEnds: FinalizeWarning[];
  /** Hypotheses or a plan are current: editing the chart now makes them stale. */
  editingInvalidatesOutputs: boolean;
}

const EDITABLE_STATUSES: readonly ConsultationStatus[] = ["draft", "in_progress", "awaiting_review"];
/** A capture whose draft is still coming (a failed one is not: it goes nowhere on its own). */
const CAPTURE_IN_FLIGHT = new Set<RecordingStatus>(["recording", "local", "uploading", "uploaded", "processing"]);

const blockedGate = (reason: JourneyReason, soft?: readonly JourneyReason[]): JourneyGate => ({
  state: "blocked",
  reason,
  ...(soft && soft.length > 0 ? { soft: [...soft] } : {}),
});
const availableGate = (soft?: readonly JourneyReason[]): JourneyGate => ({
  state: "available",
  ...(soft && soft.length > 0 ? { soft: [...soft] } : {}),
});

/** The gate a step inherits when it has no data of its own to report. */
function stepFromGate(key: JourneyStepKey, gate: JourneyGate, optional: boolean): JourneyStep {
  if (gate.state === "blocked") return { key, state: "blocked", reason: gate.reason, optional };
  if (gate.state === "available") return { key, state: "available", optional };
  return { key, state: gate.state, optional };
}

export function deriveConsultationJourney(facts: JourneyFacts): ConsultationJourney {
  const editable = EDITABLE_STATUSES.includes(facts.consultationStatus);
  const finalized = facts.consultationStatus === "finalized";
  const cancelled = facts.consultationStatus === "cancelled";
  const scheduled = facts.consultationStatus === "scheduled";
  const captureInFlight = facts.recordingStatus ? CAPTURE_IN_FLIGHT.has(facts.recordingStatus) : false;

  // What the AI routes call "something recorded": an answer that is not
  // rejected, or the chief complaint (hypotheses/route.ts, summary/route.ts).
  const recorded = facts.record.recordedAnswerCount > 0 || facts.record.hasChiefComplaint;
  // What the SCREEN calls a started record — a summary or an imported body is
  // content too, even though the AI routes do not reason over them alone.
  const anythingRecorded = recorded || facts.record.hasSummary || facts.record.legacyRecord;

  /** Editable + Pro + this tab + the patient's AI consent: the head of every AI gate. */
  const aiPrefix = (): JourneyGate | null => {
    if (!editable) return { state: "hidden" };
    if (facts.reasoningEntitled.status === "loading") return { state: "loading" };
    if (facts.reasoningEntitled.status === "unavailable") return { state: "unknown" };
    // Not Pro: the panels show their own upgrade card, the journey shows nothing.
    if (!facts.reasoningEntitled.value) return { state: "hidden" };
    if (!facts.isPrimaryTab) return blockedGate("other_tab");
    if (facts.consents.status === "loading") return { state: "loading" };
    if (facts.consents.status === "unavailable") return { state: "unknown" };
    // Mirrors has_active_consent(..., 'ai-processing') in every AI route.
    if (!facts.consents.value.ai) return blockedGate("ai_consent_required");
    return null;
  };

  const prepareHypotheses: JourneyGate = (() => {
    const prefix = aiPrefix();
    if (prefix) return prefix;
    // UI-only: the draft about to land bumps clinical_revision, and
    // mark_clinical_outputs_stale (0031:835-866) would stale what we prepare now.
    if (captureInFlight) return blockedGate("capture_in_flight");
    // Mirrors hypotheses/route.ts: `answers.length === 0 && !chiefComplaint`.
    if (!recorded) return blockedGate("nothing_recorded");
    // UI-only: the server reads the DATABASE, which is missing her unsaved text.
    if (facts.saveFailed) return blockedGate("save_failed");
    // Never a block: the server accepts it and writes the "leitura parcial"
    // limitation itself (PRD §10.8, clinical-reasoning.ts).
    const soft: JourneyReason[] =
      facts.record.tongueRecorded && facts.record.pulseRecorded ? [] : ["exam_partial"];
    return availableGate(soft);
  })();

  const preparePlanAi: JourneyGate = (() => {
    const prefix = aiPrefix();
    if (prefix) return prefix;
    if (facts.plan.status === "loading") return { state: "loading" };
    if (facts.plan.status === "unavailable") return { state: "unknown" };
    // Mirrors plan/route.ts: a validated plan is refused (plan_validated).
    if (facts.plan.value?.status === "validated") return { state: "hidden" };
    if (facts.hypotheses.status === "loading") return { state: "loading" };
    if (facts.hypotheses.status === "unavailable") return { state: "unknown" };
    if (captureInFlight) return blockedGate("capture_in_flight");
    // Mirrors save_generated_consultation_plan (0031:656-662): accepted OR
    // edited AND stale_at is null.
    if (facts.hypotheses.value.acceptedFresh === 0) return blockedGate("accepted_hypothesis_required");
    if (!recorded) return blockedGate("nothing_recorded");
    if (facts.saveFailed) return blockedGate("save_failed");
    return availableGate();
  })();

  const createManualPlan: JourneyGate = (() => {
    if (!editable) return { state: "hidden" };
    if (!facts.isPrimaryTab) return blockedGate("other_tab");
    if (facts.plan.status === "loading") return { state: "loading" };
    if (facts.plan.status === "unavailable") return { state: "unknown" };
    // One plan per consultation (0026): with one on file there is nothing to create.
    if (facts.plan.value) return { state: "hidden" };
    return availableGate();
  })();

  const generateSummary: JourneyGate = (() => {
    const prefix = aiPrefix();
    if (prefix) return prefix;
    // Mirrors summary/route.ts: answers (not rejected) or chief complaint.
    if (!recorded) return blockedGate("nothing_recorded");
    if (facts.saveFailed) return blockedGate("save_failed");
    return availableGate();
  })();

  // The attachment IS the data, so there is no "nothing recorded" here.
  const analyzeAttachment: JourneyGate = aiPrefix() ?? availableGate();

  const finalize: JourneyGate = (() => {
    if (finalized || cancelled || scheduled) return { state: "hidden" };
    if (!facts.isPrimaryTab) return blockedGate("other_tab");
    // Mirrors finalize_consultation (0093:70-76).
    if (facts.recordingStatus && BLOCKING_RECORDINGS.has(facts.recordingStatus)) {
      return blockedGate("recording_pending");
    }
    if (facts.saveFailed) return blockedGate("save_failed");
    return availableGate();
  })();

  const consentStep: JourneyStep = (() => {
    if (!editable) return { key: "consent", state: "hidden", optional: true };
    if (facts.consents.status === "loading") return { key: "consent", state: "loading", optional: true };
    if (facts.consents.status === "unavailable") return { key: "consent", state: "unknown", optional: true };
    const { audio, ai } = facts.consents.value;
    if (audio && ai) return { key: "consent", state: "done", optional: true };
    if (audio || ai) return { key: "consent", state: "in_progress", optional: true };
    return { key: "consent", state: "available", optional: true };
  })();

  const recordStep: JourneyStep = (() => {
    if (scheduled || cancelled) return { key: "record", state: "hidden", optional: false };
    if (finalized) return { key: "record", state: "done", optional: false, count: facts.record.recordedAnswerCount };
    if (captureInFlight) return { key: "record", state: "in_progress", optional: false };
    if (anythingRecorded) {
      return { key: "record", state: "done", optional: false, count: facts.record.recordedAnswerCount };
    }
    if (!facts.isPrimaryTab) return { key: "record", state: "blocked", reason: "other_tab", optional: false };
    return { key: "record", state: "available", optional: false };
  })();

  const reviewStep: JourneyStep = (() => {
    const exists = facts.record.aiDraftPresent || facts.record.attentionCount > 0 || facts.record.gapCount > 0;
    if (!exists || !editable) return { key: "review", state: "hidden", optional: true };
    if (facts.record.attentionCount > 0) {
      return { key: "review", state: "in_progress", optional: true, count: facts.record.attentionCount };
    }
    return { key: "review", state: "done", optional: true };
  })();

  const hypothesesStep: JourneyStep = (() => {
    if (facts.reasoningEntitled.status === "loading" || facts.hypotheses.status === "loading") {
      return { key: "hypotheses", state: "loading", optional: true };
    }
    if (facts.reasoningEntitled.status === "unavailable" || facts.hypotheses.status === "unavailable") {
      return { key: "hypotheses", state: "unknown", optional: true };
    }
    const counts = facts.hypotheses.value;
    const total = counts.draftFresh + counts.draftStale + counts.acceptedFresh + counts.acceptedStale + counts.rejected;
    if (!facts.reasoningEntitled.value && total === 0) return { key: "hypotheses", state: "hidden", optional: true };
    if (finalized || cancelled) {
      return total > 0
        ? { key: "hypotheses", state: "done", optional: true }
        : { key: "hypotheses", state: "hidden", optional: true };
    }
    if (counts.draftStale + counts.acceptedStale > 0) {
      return { key: "hypotheses", state: "stale", reason: "hypothesis_stale", optional: true };
    }
    if (counts.draftFresh > 0) {
      return { key: "hypotheses", state: "in_progress", optional: true, count: counts.draftFresh };
    }
    if (counts.acceptedFresh > 0) return { key: "hypotheses", state: "done", optional: true };
    return stepFromGate("hypotheses", prepareHypotheses, true);
  })();

  const planStep: JourneyStep = (() => {
    if (facts.plan.status === "loading") return { key: "plan", state: "loading", optional: true };
    if (facts.plan.status === "unavailable") return { key: "plan", state: "unknown", optional: true };
    const plan = facts.plan.value;
    if (!plan) {
      if (finalized || cancelled) return { key: "plan", state: "hidden", optional: true };
      return stepFromGate("plan", createManualPlan, true);
    }
    if (plan.stale) return { key: "plan", state: "stale", reason: "plan_stale", optional: true };
    if (plan.status === "validated") return { key: "plan", state: "done", optional: true };
    return { key: "plan", state: "in_progress", optional: true };
  })();

  const prescriptionStep: JourneyStep = (() => {
    if (facts.prescription.status === "loading") return { key: "prescription", state: "loading", optional: true };
    if (facts.prescription.status === "unavailable") return { key: "prescription", state: "unknown", optional: true };
    const prescription = facts.prescription.value;
    if (!prescription) {
      return editable
        ? { key: "prescription", state: "available", optional: true }
        : { key: "prescription", state: "hidden", optional: true };
    }
    return prescription.status === "validated"
      ? { key: "prescription", state: "done", optional: true }
      : { key: "prescription", state: "in_progress", optional: true };
  })();

  const finalizeStep: JourneyStep = finalized
    ? { key: "finalize", state: "done", optional: false }
    : stepFromGate("finalize", finalize, false);

  // Numbers come from the VISIBLE steps, so a workspace without Pro reads
  // 1, 2 instead of 1, (missing 2), 3.
  let sequence = 0;
  const numbered = (step: JourneyStep): JourneyStep =>
    step.state === "hidden" ? step : { ...step, number: (sequence += 1) };
  const numberedRecord = numbered(recordStep);
  const numberedHypotheses = numbered(hypothesesStep);
  const numberedPlan = numbered(planStep);

  const finalizeLooseEnds: FinalizeWarning[] = [];
  if (facts.record.attentionCount > 0) finalizeLooseEnds.push("attention_fields");
  if (facts.hypotheses.status === "ready" && facts.hypotheses.value.draftFresh + facts.hypotheses.value.draftStale > 0) {
    finalizeLooseEnds.push("draft_hypotheses");
  }
  if (facts.plan.status === "ready" && facts.plan.value?.status === "draft") finalizeLooseEnds.push("draft_plan");
  if (facts.prescription.status === "ready" && facts.prescription.value?.status === "draft") {
    finalizeLooseEnds.push("draft_prescription");
  }

  const editingInvalidatesOutputs =
    (facts.hypotheses.status === "ready" &&
      facts.hypotheses.value.draftFresh + facts.hypotheses.value.acceptedFresh > 0) ||
    (facts.plan.status === "ready" && facts.plan.value !== null && facts.plan.value?.stale === false);

  const next: JourneyNext = (() => {
    if (cancelled) return { key: "cancelled" };
    if (finalized) return { key: "finalized" };
    if (scheduled) return { key: "start", step: "record" };
    if (facts.saveFailed) return { key: "retry-save", step: "record" };
    if (!facts.isPrimaryTab) return { key: "other-tab" };
    switch (facts.recordingStatus) {
      case "recording":
        return { key: "recording", step: "record" };
      case "local":
      case "uploading":
        return { key: "uploading", step: "record" };
      case "uploaded":
        return { key: "process-recording", step: "record" };
      case "processing":
        return { key: "processing", step: "record" };
      case "failed":
        return { key: "recover-recording", step: "record" };
      default:
        break;
    }
    if (!anythingRecorded) return { key: "record", step: "record" };
    if (facts.record.attentionCount > 0) {
      return { key: "review-attention", count: facts.record.attentionCount, step: "review" };
    }
    if (facts.reasoningEntitled.status === "ready" && facts.reasoningEntitled.value) {
      if (facts.hypotheses.status === "ready") {
        const counts = facts.hypotheses.value;
        if (counts.draftStale + counts.acceptedStale > 0) return { key: "hypotheses-stale", step: "hypotheses" };
        if (counts.draftFresh > 0) return { key: "decide-hypotheses", count: counts.draftFresh, step: "hypotheses" };
        const total =
          counts.draftFresh + counts.draftStale + counts.acceptedFresh + counts.acceptedStale + counts.rejected;
        if (total === 0) {
          if (facts.consents.status === "ready" && !facts.consents.value.ai) {
            return { key: "consent-for-ai", step: "hypotheses" };
          }
          if (prepareHypotheses.state === "available") return { key: "prepare-hypotheses", step: "hypotheses" };
        }
      }
    }
    if (facts.plan.status === "ready" && facts.plan.value) {
      if (facts.plan.value.stale) return { key: "plan-stale", step: "plan" };
      if (facts.plan.value.status === "draft") return { key: "validate-plan", step: "plan" };
    }
    // Never recommend finalizing before the decisions are known: the bar used to
    // say "finalize quando estiver de acordo" over a chart with drafts open.
    if (
      facts.reasoningEntitled.status === "loading" ||
      facts.hypotheses.status === "loading" ||
      facts.plan.status === "loading" ||
      facts.prescription.status === "loading"
    ) {
      return { key: "loading" };
    }
    return { key: "finalize", step: "finalize" };
  })();

  return {
    steps: {
      consent: consentStep,
      record: numberedRecord,
      review: reviewStep,
      hypotheses: numberedHypotheses,
      plan: numberedPlan,
      prescription: prescriptionStep,
      finalize: finalizeStep,
    },
    gates: { prepareHypotheses, preparePlanAi, createManualPlan, generateSummary, analyzeAttachment, finalize },
    next,
    finalizeLooseEnds,
    editingInvalidatesOutputs,
  };
}

/**
 * Can this plan be validated right now? Mirrors validate_consultation_plan
 * (0093:255-340) in ITS order, so the sentence under the disabled button is the
 * one the database would have produced. Validation stays available after the
 * record is finalized on purpose — a signature attests what the plan already
 * said (0093).
 */
export function derivePlanValidationGate(
  plan: PlanFacts,
  input: { acknowledged: boolean; consultationStatus: ConsultationStatus },
): JourneyGate {
  if (input.consultationStatus === "cancelled") return { state: "hidden" };
  if (plan.status === "validated") return { state: "hidden" };
  if (plan.stale) return blockedGate("plan_stale");
  if (!plan.hasObjective) return blockedGate("plan_objective_required");
  if (plan.enabledModalities === 0) return blockedGate("plan_modality_required");
  if (plan.moxibustionEnabled && !plan.moxibustionChecklistFilled) return blockedGate("moxibustion_checklist_required");
  if (plan.safetyFlagCount > 0 && !input.acknowledged) return blockedGate("safety_acknowledgement_required");
  return availableGate();
}
