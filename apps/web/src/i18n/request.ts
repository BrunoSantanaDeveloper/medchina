import { getRequestConfig } from "next-intl/server";

import { DEFAULTS } from "@/config";
import { LocaleOption } from "@/constants";
import { resolveRequestLocale } from "@/lib/locale-request";

// Message catalogs live in @flyee/content (shared with apps/mobile).
// Static map instead of a template-string import so the bundler can
// resolve each catalog.
const MESSAGES: Record<LocaleOption, () => Promise<{ default: Record<string, unknown> }>> = {
  de: () => import("@flyee/content/messages/de.json"),
  en: () => import("@flyee/content/messages/en.json"),
  es: () => import("@flyee/content/messages/es.json"),
  fr: () => import("@flyee/content/messages/fr.json"),
  "pt-BR": () => import("@flyee/content/messages/pt-BR.json"),
  "zh-CN": () => import("@flyee/content/messages/zh-CN.json"),
};

export default getRequestConfig(async () => {
  try {
    /**
     * The cookie is the visitor's own choice and always wins. Without one — a
     * first visit — this request's own signals decide, so someone arriving from
     * China reads Chinese on the FIRST render. Detecting here rather than only
     * in the middleware is deliberate: a cookie the middleware sets lands on
     * the RESPONSE, so trusting it alone would serve this page in Portuguese
     * and switch only on the next navigation. The middleware persists the same
     * decision so it survives and can be overridden.
     */
    const { locale } = await resolveRequestLocale();

    return {
      locale,
      messages: (await MESSAGES[locale]()).default,
      timeZone: "UTC",
    };
  } catch (error: any) {
    if (
      error.digest === "DYNAMIC_SERVER_USAGE" ||
      error.message?.includes("DynamicServerError") ||
      error.name === "DynamicServerError"
    ) {
      throw error;
    }
    // Fallback to default locale if there's an error
    return {
      locale: DEFAULTS.locale,
      messages: (await MESSAGES[DEFAULTS.locale as LocaleOption]()).default,
      timeZone: "UTC",
    };
  }
});
