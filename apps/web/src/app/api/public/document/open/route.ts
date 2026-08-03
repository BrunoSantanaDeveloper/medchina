import { NextResponse } from "next/server";

import { hasOnlyKeys, hasSameOrigin, readBoundedJsonObject } from "@/lib/patient-consent-session";
import { hashShareLinkToken, isShareLinkToken } from "@/lib/share-link";
import { createServiceClient } from "@flyee/auth/service";

const BUCKET = "documents";
/** Long enough to download on a weak connection, short enough not to leak. */
const SIGNED_URL_SECONDS = 300;

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin",
} as const;

function json(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
  return response;
}

/**
 * Serve one issued document to the patient holding its share link.
 *
 * The token is the credential (migration 0064 re-validates it, counts the open
 * and writes the audit event). The stored path never reaches the browser — it
 * is exchanged here for a short signed URL, so the response cannot be replayed
 * days later from someone's history.
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return json({ ok: false, code: "not_authorized" }, 403);
  const body = await readBoundedJsonObject(request);
  if (!body || !hasOnlyKeys(body, ["token"])) return json({ ok: false, code: "invalid_request" }, 422);
  if (!isShareLinkToken(body.token)) return json({ ok: false, code: "share_link_invalid" }, 410);

  let service;
  try {
    service = createServiceClient();
  } catch {
    return json({ ok: false, code: "internal_error" }, 500);
  }

  const { data, error } = await service.rpc("open_document_share_link", {
    target_token_hash: hashShareLinkToken(body.token),
  });
  if (error) return json({ ok: false, code: "internal_error" }, 500);
  const result = data as {
    ok?: boolean;
    code?: string;
    organizationName?: string;
    kind?: string;
    verifyCode?: string;
    issuedAt?: string;
    storagePath?: string;
  } | null;
  if (!result?.ok || !result.storagePath) {
    const code = result?.code ?? "share_link_invalid";
    return json({ ok: false, code }, code === "document_revoked" ? 409 : 410);
  }

  const { data: signed, error: signError } = await service.storage
    .from(BUCKET)
    .createSignedUrl(result.storagePath, SIGNED_URL_SECONDS);
  if (signError || !signed?.signedUrl) return json({ ok: false, code: "internal_error" }, 500);

  return json({
    ok: true,
    organizationName: result.organizationName,
    kind: result.kind,
    verifyCode: result.verifyCode,
    issuedAt: result.issuedAt,
    downloadUrl: signed.signedUrl,
  });
}
