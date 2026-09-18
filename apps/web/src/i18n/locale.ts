"use server";

import { cookies } from "next/headers";

import { DEFAULTS } from "@/config";
import { COOKIE_KEYS, LocaleOption, LOCALES } from "@/constants";
import { LOCALE_COOKIE_MAX_AGE } from "@/lib/locale-detection";

export async function getClientLocale() {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get(COOKIE_KEYS.locale);
  return localeCookie?.value || DEFAULTS.locale;
}

export async function setClientLocale(locale: LocaleOption) {
  if (!(LOCALES as readonly string[]).includes(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_KEYS.locale, locale, {
    path: "/",
    // A deliberate choice must outlive the browser session: as a session
    // cookie it died on close and the public site's detection switched her
    // language back on the next visit (lib/locale-detection.ts).
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  // She has now chosen — there is nothing left to announce or undo.
  cookieStore.delete(COOKIE_KEYS.localeAuto);
}

/**
 * Keep the detected language, stop announcing it. Dismissing the notice is an
 * answer ("yes, Chinese is right"), so the choice is persisted as hers.
 */
export async function acknowledgeDetectedLocale() {
  const cookieStore = await cookies();
  const current = cookieStore.get(COOKIE_KEYS.locale)?.value;
  if ((LOCALES as readonly string[]).includes(current ?? "")) {
    cookieStore.set(COOKIE_KEYS.locale, current as LocaleOption, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  }
  cookieStore.delete(COOKIE_KEYS.localeAuto);
}
