import { hashCaptureLinkToken, isCaptureLinkToken } from "@/lib/capture-link";
import { captureCodeFrom, captureError, captureJson } from "@/lib/capture-link-route";
import { hasOnlyKeys, hasSameOrigin, isUuid, readBoundedJsonObject } from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

/** Open (or idempotently resume) the audio_only recording for this link. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return captureError("not_authorized");
  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, ["token", "clientUploadId"])) return captureError("invalid_request");
  if (!isCaptureLinkToken(body.token)) return captureError("capture_link_invalid");
  if (!isUuid(body.clientUploadId)) return captureError("invalid_request");

  let service;
  try {
    service = createServiceClient();
  } catch {
    return captureError("internal_error");
  }

  const { data, error } = await service.rpc("begin_capture_via_link", {
    target_token_hash: hashCaptureLinkToken(body.token),
    target_client_upload_id: body.clientUploadId,
  });
  if (error) return captureError("internal_error");
  const result = data as { ok?: boolean; code?: string; recordingId?: string; status?: string } | null;
  if (!result?.ok) return captureError(captureCodeFrom(result, error));
  return captureJson({ ok: true, recordingId: result.recordingId, status: result.status });
}
