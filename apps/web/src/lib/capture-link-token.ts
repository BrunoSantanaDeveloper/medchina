/**
 * Isomorphic token-shape check for the QR capture flow. Kept SEPARATE from
 * `capture-link.ts` (which pulls in `node:crypto`) so the phone client bundle
 * can validate a token without dragging a Node-only module into the browser.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function isCaptureLinkToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
