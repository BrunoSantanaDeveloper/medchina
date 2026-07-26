import { hashCaptureLinkToken, isCaptureLinkToken } from "@/lib/capture-link";
import { captureError, captureJson } from "@/lib/capture-link-route";
import { hasOnlyKeys, hasSameOrigin, readBoundedJsonObject, readStringField } from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

const BUCKET = "transcriptions";

/**
 * A signed upload URL scoped to THIS recording's exact object path, so the
 * phone uploads straight to storage without a Supabase session (RECOMMENDED
 * path). The signed URL bypasses bucket RLS by design; the token session is
 * the authorization boundary, re-checked here before it is issued.
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return captureError("not_authorized");
  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, ["token", "mime"])) return captureError("invalid_request");
  if (!isCaptureLinkToken(body.token)) return captureError("capture_link_invalid");
  const mime = readStringField(body, "mime") ?? "audio/webm";

  let service;
  try {
    service = createServiceClient();
  } catch {
    return captureError("internal_error");
  }

  // Service role bypasses RLS; the token hash is the scope. Only a live session
  // that already opened its recording may mint an upload URL.
  const { data: session } = await service
    .from("capture_link_sessions")
    .select("org_id, recording_id, revoked_at, expires_at")
    .eq("token_hash", hashCaptureLinkToken(body.token))
    .maybeSingle();
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || !session.recording_id) {
    return captureError("capture_link_invalid");
  }

  const { data: recording } = await service
    .from("recordings")
    .select("id, org_id, status")
    .eq("id", session.recording_id)
    .maybeSingle();
  if (!recording || recording.org_id !== session.org_id) return captureError("not_found");
  if (!["local", "uploading", "failed"].includes(recording.status)) {
    return captureError("recording_invalid_state");
  }

  const extension = mime.includes("mp4") ? "m4a" : "webm";
  const path = `${recording.org_id}/${recording.id}.${extension}`;
  const { data: signed, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !signed) return captureError("upload_unavailable");

  return captureJson({ ok: true, path, token: signed.token, signedUrl: signed.signedUrl });
}
