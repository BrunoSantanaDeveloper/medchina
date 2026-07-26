import "server-only";

import { createHash, randomBytes } from "node:crypto";

export { isCaptureLinkToken } from "@/lib/capture-link-token";

/**
 * Server-only token helpers for the QR "record from your phone" flow
 * (migration 0053). The pure shape check lives in `capture-link-token.ts` so
 * the phone client can import it without this module's `node:crypto`.
 *
 * The raw token is a bearer secret: it is minted server-side, embedded in the
 * QR/URL FRAGMENT (never the query string, never a body the server logs), and
 * only its SHA-256 digest is stored. Same discipline as patient consent.
 */

/** Raw token for the QR; only the hash is ever persisted. */
export function createCaptureLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashCaptureLinkToken(token) };
}

export function hashCaptureLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
