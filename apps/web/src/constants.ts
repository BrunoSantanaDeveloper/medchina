export const LOCALES = ["de", "en", "fr", "es", "pt-BR", "zh-CN"] as const;
export type LocaleOption = (typeof LOCALES)[number];

/**
 * Reading order wherever a person PICKS a language — by audience, not by the
 * alphabet: the home market first, then the market the product was translated
 * for next, then the rest. `LOCALES` is the catalog list and happens to start
 * at Deutsch, which would put Portuguese fifth for a Brazilian reader.
 *
 * Declared as a rank per locale rather than as a list, because a `Record` over
 * `LocaleOption` is what makes the compiler REQUIRE every language: a locale
 * added to the catalogs and forgotten here would otherwise just be missing from
 * every switcher, silently.
 */
const LOCALE_RANK: Record<LocaleOption, number> = {
  "pt-BR": 0,
  "zh-CN": 1,
  en: 2,
  es: 3,
  fr: 4,
  de: 5,
};

export const LOCALE_DISPLAY_ORDER: readonly LocaleOption[] = [...LOCALES].sort(
  (a, b) => LOCALE_RANK[a] - LOCALE_RANK[b],
);

/**
 * MedChina locks a single brand palette (Teal/Camel — written into
 * packages/design-tokens/css/green.css); the other template themes were
 * removed from the switcher but their CSS files remain for template merges.
 */
export const THEME_OPTIONS = {
  GREEN: "theme-green",
} as const;

export type ThemeVariant = (typeof THEME_OPTIONS)[keyof typeof THEME_OPTIONS];

export type ModeVariant = (typeof THEME_MODE_OPTIONS)[number];
export const THEME_MODE_OPTIONS = ["light", "dark", "system"] as const;

const storagePrefix = process.env.NEXT_PUBLIC_STORAGE_PREFIX || "";
export const COOKIE_KEYS = {
  locale: `${storagePrefix}-locale`,
  // Present only while the ACTIVE locale was chosen for the visitor by the
  // middleware (Accept-Language / IP country) and she has not acknowledged it.
  // It carries the detected locale so the public page can say "we switched the
  // language for you" and offer the way back — a silent switch is how someone
  // ends up reading a language she did not ask for and cannot undo.
  localeAuto: `${storagePrefix}-locale-auto`,
  // Opt-out flag for marketing analytics (read server-side to SSR the trackers,
  // and client-side by lib/analytics). Absent = tracking on (opt-out model).
  analyticsOptOut: `${storagePrefix}-analytics-optout`,
  // Coupon code carried by a campaign link (`?cupom=`). Captured by the
  // middleware on ANY page so it survives the sign-up + e-mail confirmation
  // round trip and is still there when she reaches checkout. Not a secret:
  // readable by the client so the billing page can confirm it visually.
  offerCoupon: `${storagePrefix}-cupom`,
  // FIRST-touch campaign attribution (?origem/?onda/utm_*), captured by the
  // middleware and persisted to the workspace at signup. httpOnly: nothing in
  // the browser reads it, unlike the coupon.
  attribution: `${storagePrefix}-atrib`,
  // Registered for live events: one opaque random token per event (whose sha256
  // lives in `live_event_tokens`, migrations 0112/0113). httpOnly, like the
  // attribution cookie — never the coupon's flags: it identifies registrations.
  liveEvent: `${storagePrefix}-evento`,
  // LAST-touch campaign (origem/utm_*), rewritten by the middleware on every
  // link that carries one. The checkout falls back to it when its own link has
  // none (e.g. an event's button → /planos → sign-up → billing), so a sale is
  // credited to the campaign that brought it. httpOnly; 14 days, the same
  // window the billing webhook accepts (migration 0113).
  lastCampaign: `${storagePrefix}-campanha`,
};

export const SESSION_STORAGE_KEYS = {
  /**
   * The address a sign-up just used, handed to /auth/get-verification so it can
   * resend the confirmation without asking her to retype it. sessionStorage,
   * not the URL: an e-mail in a query string ends up in history and server logs.
   */
  signupEmail: `${storagePrefix}-signup-email`,
};

export const LOCAL_STORAGE_KEYS = {
  themeColor: `${storagePrefix}-theme-color`,
  themeMode: `${storagePrefix}-theme-mode`,
  leftMenuType: `${storagePrefix}-left-menu-type`,
  contentType: `${storagePrefix}-content-type`,
  cookieConsent: `${storagePrefix}-cookie-consent`,
};
