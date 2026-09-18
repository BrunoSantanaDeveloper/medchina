import { type HomeCopy, homeCopyPtBR } from "./pt-BR";

import { type LocaleOption, LOCALES } from "@/constants";

export type { HomeCopy } from "./pt-BR";

/**
 * Static map instead of a template-string import, so the bundler can resolve
 * each language on its own — mirroring src/i18n/request.ts. The home is a
 * client component, so the SERVER picks one language here and hands it down as
 * data: importing all six into the component would ship six copies of the page
 * to every visitor.
 */
const LOADERS: Record<LocaleOption, () => Promise<HomeCopy>> = {
  "pt-BR": async () => homeCopyPtBR,
  en: () => import("./en").then((m) => m.homeCopy),
  es: () => import("./es").then((m) => m.homeCopy),
  fr: () => import("./fr").then((m) => m.homeCopy),
  de: () => import("./de").then((m) => m.homeCopy),
  "zh-CN": () => import("./zh-CN").then((m) => m.homeCopy),
};

export function isHomeLocale(value: string | undefined | null): value is LocaleOption {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** The home's copy for `locale`, falling back to pt-BR for anything unknown. */
export async function getHomeCopy(locale: string): Promise<HomeCopy> {
  if (!isHomeLocale(locale)) return homeCopyPtBR;
  return LOADERS[locale]();
}
