import { isRetryablePipelineError, processRecording } from "@/lib/clinical-pipeline";
import { notifyRecordingStatus } from "@/lib/mobile-push";
import { createServiceClient } from "@flyee/auth/service";
import { inngest, sendEvent } from "@flyee/jobs";

/**
 * MedChina's own background job (the template's packages own theirs).
 * Transcribes a consultation recording and pre-fills its anamnesis.
 * Registered in app/api/inngest/route.ts.
 *
 * Concurrency is capped because each run holds an audio file in memory and
 * makes two Gemini calls. Retries are 3 (4 attempts) with Inngest's default
 * exponential backoff: a provider capacity wave ("model overloaded" 503)
 * typically outlasts one quick retry, and spreading attempts over minutes is
 * exactly what rides it out. This does NOT retry forever on hopeless cases:
 * definitive refusals (credits depleted, bad key — provider_rejected) are
 * non-retryable and fail on the first attempt.
 */
export const processRecordingFunction = inngest.createFunction(
  { id: "medchina-process-recording", retries: 3, concurrency: { limit: 2 } },
  { event: "medchina/recording.process" },
  async ({ event, attempt, maxAttempts }) => {
    const supabase = createServiceClient();
    const finalAttempt = attempt + 1 >= (maxAttempts ?? 4);
    const result = await processRecording(supabase, event.data.recordingId, event.data.claimId, { finalAttempt });
    if (!result.ok && result.code === "processing_already_claimed") {
      // Another fenced worker owns the recording; this event is superseded,
      // not a clinical failure and must not emit a failure notification.
      return result;
    }
    if (!result.ok && isRetryablePipelineError(result.code) && !finalAttempt) {
      // Preserve the live claim and let Inngest retry before surfacing a
      // transient provider failure to the professional.
      throw new Error(result.code);
    }
    await notifyRecordingStatus(supabase, event.data.recordingId, result.ok ? "recording_ready" : "recording_failed");
    if (!result.ok && finalAttempt) throw new Error(result.code);
    return result;
  },
);

async function deleteDueRetainedAudio() {
  const service = createServiceClient();
  const now = new Date().toISOString();
  const { data: due } = await service
    .from("transcriptions")
    .select("id, audio_path")
    .eq("retention_policy", "thirty_days")
    .not("validated_at", "is", null)
    .not("audio_path", "is", null)
    .lte("retain_until", now)
    .order("retain_until", { ascending: true })
    .limit(25);

  let deleted = 0;
  let failed = 0;
  for (const transcription of due ?? []) {
    if (!transcription.audio_path) continue;
    const { error: storageError } = await service.storage.from("transcriptions").remove([transcription.audio_path]);
    if (storageError) {
      failed += 1;
      await service
        .from("transcriptions")
        .update({ deletion_error: "retention_storage_delete_failed" })
        .eq("id", transcription.id)
        .eq("audio_path", transcription.audio_path);
      continue;
    }

    const { data: completed, error: completionError } = await service.rpc("complete_retention_audio_deletion", {
      target_transcription: transcription.id,
      expected_audio_path: transcription.audio_path,
    });
    const result = completed as { ok?: boolean } | null;
    if (completionError || !result?.ok) {
      failed += 1;
      continue;
    }
    deleted += 1;
  }
  return { deleted, failed };
}

/** Recover expired processing leases and retry the PHI-free notification
 * outbox. Both operations are idempotent database claims. */
export const recoverClinicalDeliveryFunction = inngest.createFunction(
  { id: "medchina-recover-clinical-delivery", retries: 1, concurrency: { limit: 1 } },
  { cron: "*/5 * * * *" },
  async () => {
    const service = createServiceClient();
    const now = new Date().toISOString();
    const { data: stuck } = await service
      .from("recordings")
      .select("id, processing_attempts")
      .eq("status", "processing")
      .or(`processing_lease_expires_at.is.null,processing_lease_expires_at.lte.${now}`)
      .limit(5);

    // A reclaim whose preconditions broke for good — the consultation left an
    // editable state, consent was revoked, the audio is gone. Skipping these
    // silently (the old behavior) revisited the same zombie every 5 minutes
    // forever while the UI said "Processando…"; they must settle to 'failed'.
    const UNRECOVERABLE_CLAIM_CODES = new Set([
      "invalid_consultation_transition",
      "consent_required",
      "recording_not_uploaded",
    ]);
    /** Enough reclaim cycles: a row this stubborn is failing, not in flight. */
    const MAX_PROCESSING_ATTEMPTS = 8;

    const failStuckRecording = async (recordingId: string, code: string) => {
      await service
        .from("recordings")
        .update({
          status: "failed",
          error: null,
          error_code: code,
          processing_heartbeat_at: null,
          processing_lease_expires_at: null,
        })
        .eq("id", recordingId)
        .eq("status", "processing");
      await notifyRecordingStatus(service, recordingId, "recording_failed");
    };

    for (const row of stuck ?? []) {
      if (Number(row.processing_attempts ?? 0) >= MAX_PROCESSING_ATTEMPTS) {
        await failStuckRecording(row.id, "processing_attempts_exhausted");
        continue;
      }
      const { data } = await service.rpc("claim_recording_for_processing", { target_recording: row.id });
      const claim = data as { ok?: boolean; code?: string; claimId?: string } | null;
      if (!claim?.ok || claim.code !== "claimed" || !claim.claimId) {
        if (claim?.code && UNRECOVERABLE_CLAIM_CODES.has(claim.code)) {
          await failStuckRecording(row.id, claim.code);
        }
        continue;
      }
      const queued = await sendEvent("medchina/recording.process", { recordingId: row.id, claimId: claim.claimId });
      if (!queued.sent) {
        const result = await processRecording(service, row.id, claim.claimId);
        await notifyRecordingStatus(service, row.id, result.ok ? "recording_ready" : "recording_failed");
      }
    }

    const { data: outbox } = await service
      .from("recording_notification_outbox")
      .select("recording_id, kind, status, lease_expires_at")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true })
      .limit(25);
    for (const item of outbox ?? []) {
      if (item.status === "processing" && item.lease_expires_at && item.lease_expires_at > now) continue;
      await notifyRecordingStatus(service, item.recording_id, item.kind as "recording_ready" | "recording_failed");
    }

    const retention = await deleteDueRetainedAudio();

    return {
      processingRecovered: stuck?.length ?? 0,
      notificationsRetried: outbox?.length ?? 0,
      retentionDeleted: retention.deleted,
      retentionFailed: retention.failed,
    };
  },
);

export const clinicalFunctions = [processRecordingFunction, recoverClinicalDeliveryFunction];
