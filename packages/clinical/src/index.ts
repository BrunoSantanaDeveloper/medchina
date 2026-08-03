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
  "derived_safety_flags_immutable",
  "document_issue_conflict",
  "document_profile_incomplete",
  "document_reissue_confirmation_required",
  "provider_unavailable",
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
