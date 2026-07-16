import { ContentType, MenuType } from "./types";

import { ModeVariant, ThemeVariant } from "@/constants";

export const DEFAULTS = {
  appRoot: "/inicio",
  locale: "pt-BR",
  themeColor: "theme-green" as ThemeVariant,
  // Light-first (docs/DESIGN.md "Cuidado Sereno"): light is the default; dark
  // stays an explicit user choice via the mode switcher.
  themeMode: "light" as ModeVariant,
  contentType: ContentType.Boxed,
  leftMenuType: MenuType.Comfort,
  leftMenuWidth: {
    [MenuType.Minimal]: { primary: 60, secondary: 240 },
    [MenuType.Comfort]: { primary: 116, secondary: 240 },
    [MenuType.SingleLayer]: { primary: 280, secondary: 0 },
  },
  transitionDuration: 150,
};
