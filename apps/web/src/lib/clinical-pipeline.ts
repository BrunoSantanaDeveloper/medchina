import { extractAnamnesis } from "@/lib/clinical-extraction";
import { parseTranscriptResult } from "@/lib/transcript";
import { alertAfterAudioUsage, billableSeconds } from "@/lib/usage";
import type { ClinicalErrorCode } from "@flyee/clinical";
import { processTranscription, type TranscriptResult } from "@flyee/transcribe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A claimed, idempotent recording pipeline. External provider calls happen
 * outside a DB transaction; `apply_recording_result` performs the final merge
 * atomically and refuses stale claims or closed consultations.
 */
export type PipelineResult =
  | { ok: true; transcriptionId: string; answers: number; gaps: number }
  | { ok: false; code: ClinicalErrorCode };

const RETRYABLE_PIPELINE_ERRORS = new Set<ClinicalErrorCode>([
  "provider_unavailable",
  "internal_error",
  "usage_record_failed",
]);

export const isRetryablePipelineError = (code: ClinicalErrorCode) => RETRYABLE_PIPELINE_ERRORS.has(code);

type RecordingClaimOutcome = { claimId: string } | { result: PipelineResult };

async function acquireRecordingClaim(supabase: SupabaseClient, recordingId: string): Promise<RecordingClaimOutcome> {
  const { data: claimData, error: claimError } = await supabase.rpc("claim_recording_for_processing", {
    target_recording: recordingId,
  });
  if (claimError) return { result: { ok: false, code: "internal_error" } };

  const claim = claimData as { ok?: boolean; code?: string; claimId?: string; transcriptionId?: string } | null;
  if (!claim?.ok) {
    return {
      result: {
        ok: false,
        code: claim?.code === "consent_required" ? "consent_required" : "recording_invalid_state",
      },
    };
  }
  if (claim.code === "ready") {
    return claim.transcriptionId
      ? { result: { ok: true, transcriptionId: claim.transcriptionId, answers: 0, gaps: 0 } }
      : { result: { ok: false, code: "internal_error" } };
  }
  if (claim.code === "processing_already_claimed") {
    return { result: { ok: false, code: "processing_already_claimed" } };
  }
  return claim.claimId ? { claimId: claim.claimId } : { result: { ok: false, code: "internal_error" } };
}

type FailureStage = "transcription" | "extraction" | "apply";

async function fail(
  supabase: SupabaseClient,
  recordingId: string,
  claimId: string,
  code: ClinicalErrorCode,
  stage: FailureStage,
  terminal = true,
): Promise<PipelineResult> {
  if (!terminal) {
    await supabase
      .from("recordings")
      .update({ error: null, error_code: code, failure_stage: stage })
      .eq("id", recordingId)
      .eq("status", "processing")
      .eq("processing_claim_id", claimId);
    await heartbeat(supabase, recordingId, claimId);
    return { ok: false, code };
  }
  await supabase
    .from("recordings")
    .update({
      status: "failed",
      error: null,
      error_code: code,
      failure_stage: stage,
      processing_heartbeat_at: null,
      processing_lease_expires_at: null,
    })
    .eq("id", recordingId)
    .eq("status", "processing")
    .eq("processing_claim_id", claimId);
  return { ok: false, code };
}

async function heartbeat(supabase: SupabaseClient, recordingId: string, claimId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("heartbeat_recording_processing", {
    target_recording: recordingId,
    target_claim_id: claimId,
  });
  return !error && Boolean((data as { ok?: boolean } | null)?.ok);
}

export async function processRecording(
  supabase: SupabaseClient,
  recordingId: string,
  existingClaimId?: string,
  options: { finalAttempt?: boolean } = {},
): Promise<PipelineResult> {
  const finalAttempt = options.finalAttempt ?? true;
  let claimId = existingClaimId;
  if (!claimId) {
    const claimed = await acquireRecordingClaim(supabase, recordingId);
    if ("result" in claimed) return claimed.result;
    claimId = claimed.claimId;
  }
  if (!claimId) return { ok: false, code: "internal_error" };

  if (!(await heartbeat(supabase, recordingId, claimId))) {
    // Inngest retries carry the original event payload. A prior attempt may
    // have transitioned the row to failed and fenced that claim, so reclaim
    // atomically instead of retrying forever with a dead token.
    const reclaimed = await acquireRecordingClaim(supabase, recordingId);
    if ("result" in reclaimed) return reclaimed.result;
    claimId = reclaimed.claimId;
    if (!(await heartbeat(supabase, recordingId, claimId))) {
      return { ok: false, code: "processing_already_claimed" };
    }
  }

  const activeClaimId = claimId;
  const reject = (code: ClinicalErrorCode, stage: FailureStage) =>
    fail(supabase, recordingId, activeClaimId, code, stage, finalAttempt || !isRetryablePipelineError(code));

  const { data: recording, error: loadError } = await supabase
    .from("recordings")
    .select(
      "id, org_id, patient_id, consultation_id, status, audio_path, mime, duration_seconds, created_by, transcription_id, processing_claim_id, processing_clinical_revision",
    )
    .eq("id", recordingId)
    .maybeSingle();

  if (loadError || !recording) return { ok: false, code: "not_found" };
  if (
    recording.status !== "processing" ||
    recording.processing_claim_id !== claimId ||
    !recording.audio_path ||
    !recording.consultation_id ||
    !recording.transcription_id ||
    recording.processing_clinical_revision == null
  ) {
    return { ok: false, code: "recording_invalid_state" };
  }

  const { data: consented } = await supabase.rpc("has_active_consent", {
    target_org: recording.org_id,
    target_patient: recording.patient_id,
    term_slug: "ai-processing",
  });
  if (!consented) return reject("consent_required", "transcription");

  const { data: consultation } = await supabase
    .from("consultations")
    .select("id, status, clinical_revision")
    .eq("id", recording.consultation_id)
    .maybeSingle();
  if (!consultation || !["draft", "in_progress", "awaiting_review"].includes(consultation.status)) {
    return reject("invalid_consultation_transition", "apply");
  }
  if (String(consultation.clinical_revision) !== String(recording.processing_clinical_revision)) {
    return reject("clinical_revision_conflict", "apply");
  }

  // ---- 1. Transcribe once -------------------------------------------------
  const transcriptionId = recording.transcription_id;
  const { data: beforeTranscription } = await supabase
    .from("transcriptions")
    .select("status, result")
    .eq("id", transcriptionId)
    .maybeSingle();

  if (beforeTranscription?.status !== "ready") {
    const transcribed = await processTranscription(supabase, transcriptionId);
    if (!transcribed.ok) return reject("provider_unavailable", "transcription");
  }

  if (!(await heartbeat(supabase, recordingId, claimId))) {
    return { ok: false, code: "processing_already_claimed" };
  }

  const { data: transcriptionRow } = await supabase
    .from("transcriptions")
    .select("result")
    .eq("id", transcriptionId)
    .maybeSingle();
  // Sanitize before the prompt sees it: a segment missing `text` used to be
  // rendered into the transcript as the literal string "undefined", and the
  // validator that exists for exactly this was only ever used by the viewer.
  const transcript: TranscriptResult | null = transcriptionRow?.result
    ? parseTranscriptResult(transcriptionRow.result)
    : null;
  if (!transcript?.segments?.length) {
    return reject("provider_unavailable", "transcription");
  }

  const consumedSeconds = billableSeconds(transcript, recording.duration_seconds);

  // ---- 2. Extract ---------------------------------------------------------
  let extraction;
  try {
    extraction = await extractAnamnesis(transcript);
  } catch {
    return reject("provider_unavailable", "extraction");
  }

  // Who is who, resolved once and kept: the extraction computed it, used it to
  // arbitrate observations, and then threw it away — leaving the transcript
  // viewer to show opaque "Speaker 1 / Speaker 2" gutters forever.
  if (extraction.practitionerSpeaker) {
    await supabase
      .from("transcriptions")
      .update({
        metadata: {
          practitionerSpeaker: extraction.practitionerSpeaker,
          extractionModel: extraction.model,
          extractionPromptVersion: extraction.promptVersion,
          unverifiedProvenance: extraction.unverified,
          droppedAnswers: extraction.dropped,
        },
      })
      .eq("id", transcriptionId);
  }

  if (!(await heartbeat(supabase, recordingId, claimId))) {
    return { ok: false, code: "processing_already_claimed" };
  }

  // ---- 3. Merge atomically ------------------------------------------------
  const answers = extraction.answers.map((answer) => ({
    blockKey: answer.blockKey,
    fieldKey: answer.fieldKey,
    value: answer.value,
    source: answer.source,
    state: answer.state,
    // Hypotheses and plans have recorded model + prompt_version since 0025
    // (PRD §10.10); the drafts that feed them did not, so a quality regression
    // could never be traced back to the prompt that caused it.
    provenance: {
      ...answer.provenance,
      model: extraction.model,
      promptVersion: extraction.promptVersion,
    },
  }));
  const { data: appliedData, error: applyError } = await supabase.rpc("apply_recording_result", {
    target_recording: recording.id,
    target_transcription: transcriptionId,
    target_claim_id: claimId,
    target_answers: answers,
    target_gaps: extraction.gaps,
    target_billable_seconds: consumedSeconds,
  });
  if (applyError) {
    // The atomic RPC may have committed while its HTTP response was lost.
    // Never turn that already-ready row back into a failure.
    const { data: recovered } = await supabase
      .from("recordings")
      .select("status, transcription_id")
      .eq("id", recordingId)
      .maybeSingle();
    if (recovered?.status === "ready" && recovered.transcription_id) {
      return {
        ok: true,
        transcriptionId: recovered.transcription_id,
        answers: answers.length,
        gaps: extraction.gaps.length,
      };
    }
    const code = applyError.message.includes("usage_record_failed") ? "usage_record_failed" : "internal_error";
    return reject(code, "apply");
  }

  const applied = appliedData as { ok?: boolean; code?: string; answers?: number; gaps?: number } | null;
  if (!applied?.ok) {
    const code: ClinicalErrorCode =
      applied?.code === "consent_required"
        ? "consent_required"
        : applied?.code === "clinical_revision_conflict"
          ? "clinical_revision_conflict"
          : applied?.code === "invalid_consultation_transition"
            ? "invalid_consultation_transition"
            : "recording_invalid_state";
    return reject(code, "apply");
  }

  await alertAfterAudioUsage(supabase, recording.org_id);

  // The AI summary is NOT regenerated per recording — it is generated ONCE at
  // finalization, over ALL recordings joined into the anamnesis (see the
  // finalize route). Per-recording churn would spend an AI call on every audio.

  return {
    ok: true,
    transcriptionId,
    answers: applied.answers ?? answers.length,
    gaps: applied.gaps ?? extraction.gaps.length,
  };
}
