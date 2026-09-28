/**
 * The campaign dimensions a link carries from a landing page to the checkout —
 * the LAST touch before a purchase (docs/PAGINA-EVENTO.md §11).
 *
 * First touch (lib/attribution.ts, migration 0086) is written once per
 * workspace and never updated, so the base that already has an account is never
 * credited to an event or a campaign that sold to it later. This carries the
 * campaign of THIS purchase: /assinar forwards it into the checkout link,
 * /assinatura hands it to `startCheckout`, and the checkout stores it in
 * `meta_attribution` (rewritten on every checkout — last touch by construction),
 * which the billing webhook reads to enrich the Purchase.
 *
 * Pure and dependency-free. Query parameters are attacker-controlled: only
 * these keys, control characters dropped, 64 characters at most — the same
 * fence the database CHECK repeats.
 */
export const CAMPAIGN_PARAM_KEYS = ["origem", "utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

export type CampaignParamKey = (typeof CAMPAIGN_PARAM_KEYS)[number];
export type CampaignParams = Partial<Record<CampaignParamKey, string>>;

function clean(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  let out = "";
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += char;
  }
  return out.trim().slice(0, 64);
}

/** The allowlisted campaign parameters of a query-string-like object. */
export function pickCampaignParams(source: unknown): CampaignParams {
  if (!source || typeof source !== "object") return {};
  const record = source as Record<string, unknown>;
  const picked: CampaignParams = {};
  for (const key of CAMPAIGN_PARAM_KEYS) {
    const value = clean(record[key]);
    if (value) picked[key] = value;
  }
  return picked;
}

/** `&origem=…&utm_source=…` — ready to append to a URL that already has a query. */
export function campaignQuery(params: CampaignParams): string {
  return CAMPAIGN_PARAM_KEYS.filter((key) => params[key])
    .map((key) => `&${key}=${encodeURIComponent(params[key] as string)}`)
    .join("");
}

export function hasCampaign(params: CampaignParams): boolean {
  return CAMPAIGN_PARAM_KEYS.some((key) => Boolean(params[key]));
}

/** How long the last-touch campaign cookie lives: the webhook's attribution window. */
export const LAST_CAMPAIGN_MAX_AGE = 60 * 60 * 24 * 14;

/** The campaign as the last-touch cookie stores it (URL-encoded JSON of the allowlisted keys). */
export function encodeCampaignCookie(params: CampaignParams): string {
  return encodeURIComponent(JSON.stringify(pickCampaignParams(params)));
}

/** The cookie back into campaign parameters — re-validated: a cookie is client input too. */
export function decodeCampaignCookie(value: string | null | undefined): CampaignParams {
  if (!value) return {};
  try {
    return pickCampaignParams(JSON.parse(decodeURIComponent(value)));
  } catch {
    return {};
  }
}
