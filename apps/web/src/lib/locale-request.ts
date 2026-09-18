import { cookies, headers } from "next/headers";

import { DEFAULTS } from "@/config";
import { COOKIE_KEYS, type LocaleOption, LOCALES } from "@/constants";
import { detectLocale } from "@/lib/locale-detection";

export type LocaleSource =
  /** The visitor chose it (or a previous visit's detection was persisted). */
  | "cookie"
  /** No cookie: decided from this request's own signals. */
  | "detected"
  /** No cookie and nothing to detect. */
  | "default";

export type ResolvedLocale = {
  locale: LocaleOption;
  source: LocaleSource;
  /**
   * True when the visitor is NOT reading the default language and did not ask
   * for that — she must be told, and given the way back (docs/SEO.md).
   */
  autoSwitched: boolean;
};

const isSupported = (value: string | undefined | null): value is LocaleOption =>
  !!value && (LOCALES as readonly string[]).includes(value);

/**
 * The single answer to "which language is this request in, and who decided?"
 *
 * Both the i18n request config (src/i18n/request.ts) and the public pages that
 * announce an automatic switch go through this, so the page can never disagree
 * with the catalog it was rendered from.
 */
export async function resolveRequestLocale(): Promise<ResolvedLocale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const chosen = cookieStore.get(COOKIE_KEYS.locale)?.value;
  if (isSupported(chosen)) {
    // A locale the middleware detected on an earlier request is still flagged
    // as automatic until she acknowledges it.
    const auto = cookieStore.get(COOKIE_KEYS.localeAuto)?.value;
    return { locale: chosen, source: "cookie", autoSwitched: auto === chosen && chosen !== DEFAULTS.locale };
  }

  const detected = detectLocale({
    acceptLanguage: headerList.get("accept-language"),
    // Vercel's IP geolocation. Absent locally and on other hosts — the header
    // is a bonus signal, never the one the decision depends on.
    country: headerList.get("x-vercel-ip-country"),
    userAgent: headerList.get("user-agent"),
  });

  if (detected) return { locale: detected, source: "detected", autoSwitched: true };

  return { locale: DEFAULTS.locale as LocaleOption, source: "default", autoSwitched: false };
}
