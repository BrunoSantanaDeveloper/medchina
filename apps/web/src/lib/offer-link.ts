/**
 * Campaign link parameters that must survive the whole journey.
 *
 * A partner announces "use the code HELLEN" and links to the site. Between that
 * click and the checkout there is a sign-up, an e-mail confirmation and at least
 * two redirects — the query string is long gone by then. So the code is captured
 * from the URL on the FIRST request that carries it (middleware, any route) and
 * kept in a cookie until it is used.
 *
 * Pure and dependency-free on purpose: this runs in the edge middleware and in
 * the browser.
 */

/** Query parameter the campaign links use (Portuguese, like the public routes). */
export const COUPON_PARAM = "cupom";

/** How long a campaign code stays valid in the browser: one buying cycle. */
export const COUPON_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Coupon codes are typed by humans and pasted from posts, so they arrive with
 * stray case, spaces and quotes. Everything outside the allowed shape is
 * dropped rather than escaped — the value ends up in a cookie and in a database
 * lookup, and a code that needs escaping is not a code we issued.
 */
export function normalizeCouponCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  if (!cleaned || cleaned.length > 32) return null;
  return cleaned;
}

/** Reads the campaign code the middleware stored, from the browser. */
export function readCouponCookie(cookieName: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${cookieName}=`));
  return normalizeCouponCode(match ? decodeURIComponent(match.slice(cookieName.length + 1)) : null);
}

/**
 * Clears it once it has been redeemed (or rejected), so a stale code from a
 * finished campaign does not keep reappearing on a later purchase.
 */
export function clearCouponCookie(cookieName: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${cookieName}=; path=/; max-age=0; SameSite=Lax`;
}
