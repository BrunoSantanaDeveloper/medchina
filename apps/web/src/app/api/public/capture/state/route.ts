import { after } from "next/server";

import { hashCaptureLinkToken, isCaptureLinkToken } from "@/lib/capture-link";
import { captureCodeFrom, captureError, captureJson } from "@/lib/capture-link-route";
import { processRecording } from "@/lib/clinical-pipeline";
import { notifyRecordingStatus } from "@/lib/mobile-push";
import { hasOnlyKeys, hasSameOrigin, readBoundedJsonObject, readStringField } from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";

// The inline fallback below runs AFTER the response, but still inside this
// invocation — the pipeline needs the same ceiling as its own route.
export const maxDuration = 300;

const ACTIONS = ["heartbeat", "local", "uploading", "uploaded", "cancel"] as const;
type Action = (typeof ACTIONS)[number];

const BODY_KEYS = ["token", "action", "durationSeconds", "sizeBytes", "mime", "audioPath", "errorCode"] as const;

/**
 * Start the clinical pipeline for audio the phone just delivered.
 *
 * The phone tells the professional "a anamnese está sendo preparada no
 * computador", and until now that was only true while the consultation tab
 * happened to be open AND visible: the sole trigger was a client-side effect
 * that suspends itself on `visibilityState !== "visible"`, and the recovery
 * cron only ever swept rows already in `processing`. A laptop asleep in the
 * next room left the promise unkept for hours.
 *
 * Deliberately not awaited before responding: the phone is standing in the
 * consulting room waiting for confirmation that its upload landed, and it must
 * not hold that connection open for a two-Gemini-call pipeline. Idempotent by
 * construction — a replay claims nothing (`processing_already_claimed`/`ready`)
 * and racing the desktop effect collides harmlessly in the same claim.
 */
function startProcessing(recordingId: string): void {
  after(async () => {
    try {
      const service = createServiceClient();
      const { data: claimData } = await service.rpc("claim_recording_for_processing", {
        target_recording: recordingId,
      });
      const claim = claimData as { ok?: boolean; code?: string; claimId?: string } | null;
      if (!claim?.ok || claim.code !== "claimed" || !claim.claimId) return;

      const queued = await sendEvent("medchina/recording.process", { recordingId, claimId: claim.claimId });
      if (queued.sent) return;

      const result = await processRecording(service, recordingId, claim.claimId);
      await notifyRecordingStatus(service, recordingId, result.ok ? "recording_ready" : "recording_failed");
    } catch {
      // The recovery sweep is the backstop: a row left in `uploaded` is picked
      // up there, so a failure here delays the draft instead of losing it.
    }
  });
}

/** Drive the audio_only recording forward from the phone, gated by the token. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return captureError("not_authorized");
  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, BODY_KEYS)) return captureError("invalid_request");
  if (!isCaptureLinkToken(body.token)) return captureError("capture_link_invalid");
  const action = readStringField(body, "action");
  if (!action || !ACTIONS.includes(action as Action)) return captureError("invalid_request");

  const durationSeconds =
    typeof body.durationSeconds === "number" ? Math.max(0, Math.round(body.durationSeconds)) : null;
  const sizeBytes = typeof body.sizeBytes === "number" ? Math.max(0, Math.round(body.sizeBytes)) : null;

  let service;
  try {
    service = createServiceClient();
  } catch {
    return captureError("internal_error");
  }

  const { data, error } = await service.rpc("set_capture_link_recording_state", {
    target_token_hash: hashCaptureLinkToken(body.token),
    target_action: action,
    target_duration_seconds: durationSeconds,
    target_size_bytes: sizeBytes,
    target_mime: readStringField(body, "mime"),
    target_audio_path: readStringField(body, "audioPath"),
    target_error_code: readStringField(body, "errorCode"),
  });
  if (error) return captureError("internal_error");
  const result = data as { ok?: boolean; code?: string; recordingId?: string; mode?: string } | null;
  if (!result?.ok) return captureError(captureCodeFrom(result, error));

  // An audio_only capture terminates at 'ready' in the RPC itself; only an AI
  // one lands on 'uploaded' waiting for the pipeline.
  if (result.code === "uploaded" && result.mode === "ai" && result.recordingId) {
    startProcessing(result.recordingId);
  }

  return captureJson(result);
}
