import { getRequestConfig } from "next-intl/server";

import { DEFAULTS } from "@/config";
import { LOCALES } from "@/constants";
import { getClientLocale } from "@/i18n/locale";

export default getRequestConfig(async () => {
  try {
    const localeCookie = await getClientLocale();
    // @ts-expect-error Checking if the locale is valid
    const locale = LOCALES.includes(localeCookie) ? localeCookie : DEFAULTS.locale;

    return {
      locale,
      messages: (await import(`./messages/${locale}.json`)).default,
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
      messages: (await import(`./messages/${DEFAULTS.locale}.json`)).default,
      timeZone: "UTC",
    };
  }
});
