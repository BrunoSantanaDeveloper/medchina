import { hashCaptureLinkToken, isCaptureLinkToken } from "@/lib/capture-link";
import { captureCodeFrom, captureError, captureJson } from "@/lib/capture-link-route";
import { hasOnlyKeys, hasSameOrigin, readBoundedJsonObject } from "@/lib/patient-consent-session";
import { createServiceClient } from "@flyee/auth/service";

/** Minimal, PHI-thin context for the phone page (first name + booleans). */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return captureError("not_authorized");
  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, ["token"])) return captureError("invalid_request");
  if (!isCaptureLinkToken(body.token)) return captureError("capture_link_invalid");

  let service;
  try {
    service = createServiceClient();
  } catch {
    return captureError("internal_error");
  }

  const { data, error } = await service.rpc("resolve_capture_link", {
    target_token_hash: hashCaptureLinkToken(body.token),
  });
  if (error) return captureError("internal_error");
  const result = data as { ok?: boolean; code?: string } | null;
  if (!result?.ok) return captureError(captureCodeFrom(result, error));
  return captureJson(result);
}
