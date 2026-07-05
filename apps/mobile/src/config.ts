import type { Mode, ThemeName } from "@flyee/design-tokens";

// Mirrors apps/web LOCALES/DEFAULTS (web's config lives in app code and
// cannot be imported across apps; keep these in sync).
export const LOCALES = ["de", "en", "fr", "es", "pt-BR"] as const;
export type LocaleOption = (typeof LOCALES)[number];

export const DEFAULTS = {
  themeName: "green" as ThemeName,
  modeSetting: "system" as Mode | "system",
  locale: "en" as LocaleOption,
};
