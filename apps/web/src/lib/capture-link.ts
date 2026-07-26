import { createHash, randomBytes } from "node:crypto";

/**
 * Token helpers for the QR "record from your phone" flow (migration 0053).
 *
 * The raw token is a bearer secret: it is minted server-side, embedded in the
 * QR/URL FRAGMENT (never the query string, never a body the server logs), and
 * only its SHA-256 digest is stored. Same discipline as patient consent.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** Raw token for the QR; only the hash is ever persisted. */
export function createCaptureLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashCaptureLinkToken(token) };
}

export function isCaptureLinkToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function hashCaptureLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
