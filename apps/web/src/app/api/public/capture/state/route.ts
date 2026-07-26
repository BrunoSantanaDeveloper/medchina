import { hashCaptureLinkToken, isCaptureLinkToken } from "@/lib/capture-link";
import { captureCodeFrom, captureError, captureJson } from "@/lib/capture-link-route";
import { hasOnlyKeys, hasSameOrigin, readBoundedJsonObject, readStringField } from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

const ACTIONS = ["heartbeat", "local", "uploading", "uploaded", "cancel"] as const;
type Action = (typeof ACTIONS)[number];

const BODY_KEYS = ["token", "action", "durationSeconds", "sizeBytes", "mime", "audioPath", "errorCode"] as const;

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
  const result = data as { ok?: boolean; code?: string } | null;
  if (!result?.ok) return captureError(captureCodeFrom(result, error));
  return captureJson(result);
}
