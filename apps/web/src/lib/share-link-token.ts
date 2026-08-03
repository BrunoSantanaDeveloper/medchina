/**
 * Isomorphic token-shape check for patient document links. Kept SEPARATE from
 * `share-link.ts` (which pulls in `node:crypto`) so the public page can
 * validate a token without dragging a Node-only module into the browser.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function isShareLinkToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
