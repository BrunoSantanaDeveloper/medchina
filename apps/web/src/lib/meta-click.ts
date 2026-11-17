/**
 * The Meta ad-click id (`fbclid`) and the `_fbc` value built from it.
 *
 * Why this exists at all: `_fbc` is normally the Pixel's cookie, and a
 * server-side conversion just reads it. But the Pixel does not always run —
 * a tracking-prevention browser or an ad blocker refuses
 * `connect.facebook.net` before any request leaves (measured in production:
 * ERR_BLOCKED_BY_CLIENT) — and the checkout here is a server action with no
 * browser in the request at all. When the Pixel never ran, a real ad click
 * reaches Meta with nothing to match it to.
 *
 * Meta documents the remedy: when the cookie is absent, build the value
 * yourself as `fb.<subdomainIndex>.<clickTimeMs>.<fbclid>`. Their own
 * server-side examples use index 1, and the index only has to be consistent,
 * so 1 it is.
 *
 * What this module deliberately does NOT do is write a cookie called `_fbc`.
 * That name belongs to the Pixel, which scopes it to the registrable domain;
 * ours would be host-only, and two cookies of the same name make
 * `cookies().get("_fbc")` return whichever the runtime prefers. So the raw id
 * is kept under our own prefixed cookie and `_fbc` is built only when the
 * Pixel's own value is missing — the Pixel always wins.
 *
 * Pure and dependency-free: this runs in the edge middleware and on the server.
 */

/** Meta's click ids are opaque base64-ish strings; anything else is not one. */
const FBCLID = /^[A-Za-z0-9_-]{1,255}$/;

/**
 * The id as it may be stored, or null.
 *
 * Bounded and character-checked because it arrives in a URL anyone can write
 * and ends up in a cookie and in an outbound API payload.
 */
export function sanitizeFbclid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return FBCLID.test(value) ? value : null;
}

/**
 * `<clickTimeMs>.<fbclid>` — the click TIME travels with the id because Meta
 * wants the moment of the click, not the moment of the conversion, and the
 * two are days apart for a boleto.
 */
export function encodeFbclidCookie(fbclid: string, clickTimeMs: number): string {
  return `${Math.floor(clickTimeMs)}.${fbclid}`;
}

/** The `_fbc` value Meta expects, or null when the cookie is absent or junk. */
export function buildFbc(cookieValue: string | null | undefined): string | null {
  if (!cookieValue) return null;
  const separator = cookieValue.indexOf(".");
  if (separator <= 0) return null;
  const clickTimeMs = Number(cookieValue.slice(0, separator));
  const fbclid = sanitizeFbclid(cookieValue.slice(separator + 1));
  if (!fbclid || !Number.isFinite(clickTimeMs) || clickTimeMs <= 0) return null;
  return `fb.1.${Math.floor(clickTimeMs)}.${fbclid}`;
}
