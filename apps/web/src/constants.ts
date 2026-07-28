export const LOCALES = ["de", "en", "fr", "es", "pt-BR"] as const;
export type LocaleOption = (typeof LOCALES)[number];

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
  // Opt-out flag for marketing analytics (read server-side to SSR the trackers,
  // and client-side by lib/analytics). Absent = tracking on (opt-out model).
  analyticsOptOut: `${storagePrefix}-analytics-optout`,
};

export const LOCAL_STORAGE_KEYS = {
  themeColor: `${storagePrefix}-theme-color`,
  themeMode: `${storagePrefix}-theme-mode`,
  leftMenuType: `${storagePrefix}-left-menu-type`,
  contentType: `${storagePrefix}-content-type`,
  cookieConsent: `${storagePrefix}-cookie-consent`,
};
