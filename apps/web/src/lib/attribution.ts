/**
 * Where a signup came from — captured at the FIRST touch and carried to the
 * account.
 *
 * The commercial plan (docs/FUNIL.md T5.0) runs the base in waves: the former
 * paying users, then the ~480 old signups, then a partner's audience. Telling
 * those cohorts apart afterwards is impossible — a cohort cannot be
 * backfilled — so the dimension has to be captured before the first campaign
 * goes out, not when someone asks for the report.
 *
 * FIRST touch, unlike the coupon (which is last-touch, because typing a code is
 * a deliberate act): the campaign that BROUGHT her is the one that earned the
 * signup, even if she later arrives through a bookmark or a search result.
 *
 * Pure and dependency-free: runs in the edge middleware and on the server.
 */

/** Campaign parameters read from a link, in the order they are stored. */
export const ATTRIBUTION_PARAMS = [
  // Portuguese-first, like the public routes: the operator writes these by hand.
  "origem",
  "onda",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type AttributionParam = (typeof ATTRIBUTION_PARAMS)[number];

export type CampaignAttribution = Partial<Record<AttributionParam, string>> & {
  /** Where the click came from (Referer header on the first request). */
  referrer?: string;
  /** The page the campaign link pointed at — which landing actually converts. */
  landing_path?: string;
};

/** One buying cycle: long enough for a wave, short enough not to mis-attribute. */
export const ATTRIBUTION_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

/** Control characters — everything else (spaces, dashes, accents) is legitimate
 * in a campaign name, and stripping those would split one wave into two. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/**
 * Values arrive from URLs anyone can write and end up in a cookie and a
 * database row, so they are trimmed and bounded rather than trusted — a 4KB
 * "wave name" is not a wave name.
 */
function sanitizeValue(raw: string | null | undefined, maxLength = 64): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(CONTROL_CHARS, "");
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

/**
 * Reads campaign parameters from a request URL. Returns null when the link
 * carries none — an ordinary visitor must never create (or overwrite) an
 * attribution record with empties.
 */
export function readAttributionFromUrl(url: URL, referer?: string | null): CampaignAttribution | null {
  const attribution: CampaignAttribution = {};
  for (const param of ATTRIBUTION_PARAMS) {
    const value = sanitizeValue(url.searchParams.get(param));
    if (value) attribution[param] = value;
  }
  if (Object.keys(attribution).length === 0) return null;

  // Recorded only alongside a real campaign hit, so a plain visit never stores
  // a referrer just for having one.
  const referrerValue = sanitizeValue(referer, 255);
  if (referrerValue) attribution.referrer = referrerValue;
  const landing = sanitizeValue(url.pathname, 255);
  if (landing) attribution.landing_path = landing;

  return attribution;
}

export function encodeAttribution(attribution: CampaignAttribution): string {
  return encodeURIComponent(JSON.stringify(attribution));
}

export function decodeAttribution(raw: string | null | undefined): CampaignAttribution | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const source = parsed as Record<string, unknown>;
    const attribution: CampaignAttribution = {};
    for (const param of ATTRIBUTION_PARAMS) {
      const value = sanitizeValue(typeof source[param] === "string" ? (source[param] as string) : null);
      if (value) attribution[param] = value;
    }
    const referrer = sanitizeValue(typeof source.referrer === "string" ? source.referrer : null, 255);
    if (referrer) attribution.referrer = referrer;
    const landing = sanitizeValue(typeof source.landing_path === "string" ? source.landing_path : null, 255);
    if (landing) attribution.landing_path = landing;
    return Object.keys(attribution).length > 0 ? attribution : null;
  } catch {
    // A tampered or truncated cookie is not worth a 500 on a marketing page.
    return null;
  }
}
