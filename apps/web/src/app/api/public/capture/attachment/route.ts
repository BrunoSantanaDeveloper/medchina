import { attachmentExtension, attachmentKindForMime } from "@/lib/attachment-mime";
import { hashCaptureLinkToken, isCaptureLinkToken } from "@/lib/capture-link";
import { captureCodeFrom, captureError, captureJson } from "@/lib/capture-link-route";
import { hasOnlyKeys, hasSameOrigin, readBoundedJsonObject, readStringField } from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

const BUCKET = "clinical-attachments";

/**
 * Reserve an attachment for the phone (photo or document) via the QR capture
 * session, and hand back a signed upload URL. Same token, same consultation as
 * the audio capture — the phone becomes camera + microphone in one flow.
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return captureError("not_authorized");
  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, ["token", "mime"])) return captureError("invalid_request");
  if (!isCaptureLinkToken(body.token)) return captureError("capture_link_invalid");
  const mime = readStringField(body, "mime") ?? "";
  const kind = attachmentKindForMime(mime);
  if (!kind) return captureError("invalid_request");

  let service;
  try {
    service = createServiceClient();
  } catch {
    return captureError("internal_error");
  }

  const { data, error } = await service.rpc("reserve_capture_attachment_via_link", {
    target_token_hash: hashCaptureLinkToken(body.token),
    target_kind: kind,
    target_mime: mime,
  });
  if (error) return captureError("internal_error");
  const result = data as {
    ok?: boolean;
    code?: string;
    attachmentId?: string;
    orgId?: string;
    consultationId?: string;
  } | null;
  if (!result?.ok || !result.attachmentId || !result.orgId || !result.consultationId) {
    return captureError(captureCodeFrom(result, error));
  }

  const path = `${result.orgId}/${result.consultationId}/${result.attachmentId}.${attachmentExtension(mime)}`;
  const { data: signed, error: signError } = await service.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signError || !signed) return captureError("upload_unavailable");

  return captureJson({ ok: true, attachmentId: result.attachmentId, kind, path, token: signed.token });
}
