import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from "react-native-paper";

import { common, hsl, native, themes, type Mode, type ThemeName } from "@flyee/design-tokens";

export const THEME_NAMES = Object.keys(themes) as ThemeName[];

/** 8-point grid unit (mobile-app-ui-design rule: all spacing divisible by 8/4). */
export const GRID = 8;
export const RADIUS = native.radius;
export const MOTION = native.motion;
/** Minimum touch target (pt). */
export const TOUCH_TARGET = 44;

/**
 * Maps the shared design tokens onto a React Native Paper MD3 theme, so the
 * app carries the exact same identity as apps/web (which consumes the same
 * tokens as CSS variables). Never hardcode colors in screens — extend this
 * mapping instead.
 */
function buildTheme(name: ThemeName, mode: Mode): MD3Theme {
  const base = mode === "dark" ? MD3DarkTheme : MD3LightTheme;
  // The dark CSS block only overrides part of the tokens; the rest inherit
  // from :root — mirror that cascade here.
  const c = mode === "dark" ? { ...common.light, ...common.dark } : common.light;
  const t = mode === "dark" ? { ...themes[name].light, ...themes[name].dark } : themes[name].light;

  const surface = hsl(c["background-paper"]);

  return {
    ...base,
    // Paper uses `roundness` as the base border radius for components.
    roundness: RADIUS.xs,
    colors: {
      ...base.colors,
      primary: hsl(t["primary"]),
      onPrimary: hsl(c["text-contrast"]),
      primaryContainer: hsl(t["primary"], 0.12),
      onPrimaryContainer: hsl(t[mode === "dark" ? "primary-light" : "primary-dark"]),
      secondary: hsl(t["secondary"]),
      onSecondary: hsl(c["text-contrast"]),
      secondaryContainer: hsl(t["secondary"], 0.12),
      onSecondaryContainer: hsl(t[mode === "dark" ? "secondary-light" : "secondary-dark"]),
      tertiary: hsl(t["accent-1"]),
      onTertiary: hsl(c["text-contrast"]),
      background: hsl(c["background"]),
      onBackground: hsl(c["text-primary"]),
      surface,
      onSurface: hsl(c["text-primary"]),
      surfaceVariant: hsl(c["grey-25"]),
      onSurfaceVariant: hsl(c["text-secondary"]),
      surfaceDisabled: hsl(c["grey-50"]),
      onSurfaceDisabled: hsl(c["text-disabled"]),
      outline: hsl(c["grey-200"]),
      outlineVariant: hsl(c["grey-100"]),
      error: hsl(c["error"]),
      onError: hsl(c["text-contrast"]),
      errorContainer: hsl(c["error"], 0.12),
      onErrorContainer: hsl(c["error-dark"]),
      // Flat surfaces matching the web's paper look (no MD3 tint overlays).
      elevation: {
        level0: "transparent",
        level1: surface,
        level2: surface,
        level3: surface,
        level4: surface,
        level5: surface,
      },
    },
  };
}

const cache = new Map<string, MD3Theme>();

export function getTheme(name: ThemeName, mode: Mode): MD3Theme {
  const key = `${name}-${mode}`;
  let theme = cache.get(key);
  if (!theme) {
    theme = buildTheme(name, mode);
    cache.set(key, theme);
  }
  return theme;
}
