import "server-only";

import { createHash, randomBytes } from "node:crypto";

export { isShareLinkToken } from "@/lib/share-link-token";

/**
 * Server-only token helpers for patient-facing document links (migration
 * 0064). Same discipline as the QR capture and consent flows: the raw token is
 * minted server-side, travels in the URL FRAGMENT (never the query string, so
 * it stays out of server logs, referrers and analytics), and only its SHA-256
 * digest is persisted.
 */
export function createShareLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashShareLinkToken(token) };
}

export function hashShareLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
