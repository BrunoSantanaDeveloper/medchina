import { hashCaptureLinkToken, isCaptureLinkToken } from "@/lib/capture-link";
import { captureCodeFrom, captureError, captureJson } from "@/lib/capture-link-route";
import {
  hasOnlyKeys,
  hasSameOrigin,
  isUuid,
  readBoundedJsonObject,
  readStringField,
} from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

/** Confirm the phone's attachment upload landed at its reserved path. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return captureError("not_authorized");
  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, ["token", "attachmentId", "path", "size"])) return captureError("invalid_request");
  if (!isCaptureLinkToken(body.token)) return captureError("capture_link_invalid");
  if (!isUuid(body.attachmentId) || typeof body.path !== "string") return captureError("invalid_request");
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? Math.round(body.size) : null;

  let service;
  try {
    service = createServiceClient();
  } catch {
    return captureError("internal_error");
  }

  const { data, error } = await service.rpc("confirm_capture_attachment_via_link", {
    target_token_hash: hashCaptureLinkToken(body.token),
    target_attachment: body.attachmentId,
    target_path: readStringField(body, "path"),
    target_size: size,
  });
  if (error) return captureError("internal_error");
  const result = data as { ok?: boolean; code?: string } | null;
  if (!result?.ok) return captureError(captureCodeFrom(result, error));
  return captureJson(result);
}
