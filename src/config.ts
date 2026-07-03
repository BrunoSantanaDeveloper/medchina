import { ContentType, MenuType } from "./types";

import { ModeVariant, ThemeVariant } from "@/constants";

export const DEFAULTS = {
  appRoot: "/dashboards/default",
  locale: "en",
  themeColor: "theme-green" as ThemeVariant,
  themeMode: "system" as ModeVariant,
  contentType: ContentType.Boxed,
  leftMenuType: MenuType.Comfort,
  leftMenuWidth: {
    [MenuType.Minimal]: { primary: 60, secondary: 240 },
    [MenuType.Comfort]: { primary: 116, secondary: 240 },
    [MenuType.SingleLayer]: { primary: 280, secondary: 0 },
  },
  transitionDuration: 150,
};
