import { DEFAULTS } from "@/config";
import { type LocaleOption, LOCALES } from "@/constants";

/**
 * First-visit language detection for the PUBLIC site.
 *
 * Why this exists: the platform's language is a cookie, and a visitor who has
 * never been here has no cookie — so everyone landed in pt-BR, including the
 * practitioners reaching the site from China. This picks a language for that
 * first request; the visitor's own choice, once made, is the cookie and is
 * never touched again.
 *
 * Three rules hold this together:
 *
 * 1. `Accept-Language` beats the IP country. A header is what the visitor's
 *    own device says she reads; an IP says where she is standing (or where her
 *    VPN exits). A Brazilian at a congress in Shanghai keeps Portuguese.
 * 2. Crawlers are never switched. i18n here is cookie-based, so only
 *    `DEFAULTS.locale` is indexable (docs/SEO.md) — serving a crawler another
 *    language by header would put content in the index that no URL can return.
 *    Link-preview fetchers are treated the same, so a shared link keeps
 *    showing the language the sharer saw.
 * 3. Detection is a SUGGESTION: the caller must also mark it as automatic
 *    (COOKIE_KEYS.localeAuto) so the page can offer the way back.
 */

/**
 * A language choice must outlive the browser session: a session cookie means
 * the visitor picks Portuguese, closes the browser, comes back and is detected
 * into Chinese again — the switch she already refused. One year.
 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Simplified Chinese is the only Han catalog we ship — see the tw/hk note below. */
const LANGUAGE_MAP: Record<string, LocaleOption> = {
  pt: "pt-BR",
  en: "en",
  es: "es",
  fr: "fr",
  de: "de",
  zh: "zh-CN",
};

/**
 * Country is the FALLBACK signal, used only when the header says nothing we
 * ship. Kept deliberately narrow: a country is a place, not a language, and a
 * wrong guess here is a visitor reading a language she did not ask for.
 *
 * zh-CN covers the Traditional-script regions too (TW/HK/MO): we ship one Han
 * catalog, and Simplified is far closer to a Traditional reader than Portuguese
 * is. If a Traditional catalog is ever added, these three move to it.
 */
const COUNTRY_MAP: Record<string, LocaleOption> = {
  CN: "zh-CN",
  TW: "zh-CN",
  HK: "zh-CN",
  MO: "zh-CN",
  SG: "zh-CN",
  BR: "pt-BR",
  PT: "pt-BR",
  AO: "pt-BR",
  MZ: "pt-BR",
  ES: "es",
  MX: "es",
  AR: "es",
  CL: "es",
  CO: "es",
  PE: "es",
  UY: "es",
  PY: "es",
  BO: "es",
  EC: "es",
  FR: "fr",
  BE: "fr",
  DE: "de",
  AT: "de",
  CH: "de",
};

const BOT_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|baidu|yandex|sogou|bytespider|petalbot|duckduck|facebookexternalhit|whatsapp|telegram|twitter|linkedinbot|discord|embedly|quora|pinterest|applebot|headlesschrome|lighthouse|chrome-lighthouse|ahrefs|semrush|mj12|dotbot|screaming frog|curl|wget|python-requests|axios|go-http-client|node-fetch|monitoring|uptime|pingdom|gtmetrix|vercel-screenshot|prerender/i;

export function isCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // No UA at all is a script, not a browser.
  return BOT_PATTERN.test(userAgent);
}

/** The best locale we ship for an `Accept-Language` header, or null. */
export function localeFromAcceptLanguage(header: string | null | undefined): LocaleOption | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return {
        tag: tag.trim().toLowerCase(),
        // Order is the tie-breaker: "pt-BR,pt;q=0.9,en;q=0.8" must keep pt-BR
        // ahead of pt even though both would map to the same locale.
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const { tag } of ranked) {
    // An exact tag we ship wins (pt-br, zh-cn).
    const exact = (LOCALES as readonly string[]).find((locale) => locale.toLowerCase() === tag);
    if (exact) return exact as LocaleOption;

    // Otherwise the primary subtag: pt-PT -> pt-BR, en-GB -> en, zh-Hant -> zh-CN.
    const primary = tag.split("-")[0];
    const mapped = LANGUAGE_MAP[primary];
    if (mapped) return mapped;
  }

  return null;
}

/** The locale we ship for an ISO country code (Vercel's IP geolocation), or null. */
export function localeFromCountry(country: string | null | undefined): LocaleOption | null {
  if (!country) return null;
  return COUNTRY_MAP[country.trim().toUpperCase()] ?? null;
}

/**
 * The locale to apply to a first visit, or null to leave the default alone.
 *
 * Returns null — not the default — when the visitor already reads the default
 * language, so no cookie is written and no "we switched the language" notice
 * is ever shown to someone who was not switched.
 */
export function detectLocale({
  acceptLanguage,
  country,
  userAgent,
}: {
  acceptLanguage?: string | null;
  country?: string | null;
  userAgent?: string | null;
}): LocaleOption | null {
  if (isCrawler(userAgent)) return null;

  const detected = localeFromAcceptLanguage(acceptLanguage) ?? localeFromCountry(country);
  if (!detected || detected === DEFAULTS.locale) return null;
  return detected;
}
