export { common, marketing, native, themes } from "./tokens.generated";

import { themes } from "./tokens.generated";

export type ThemeName = keyof typeof themes;
export type Mode = "light" | "dark";

/**
 * Converts a token HSL triplet ("191 100% 46%") into a CSS/React Native color.
 * Use only on COLOR tokens; shadow/radius/spacing tokens are literal values
 * and must be used as-is.
 *
 * COMMA syntax, deliberately, even though CSS Color 4 space syntax is newer.
 * The two theme engines this monorepo feeds both fail on the space form, and
 * both fail SILENTLY (measured 2026-09-21 against @mui/material 9.1.2 and
 * @react-native/normalize-colors):
 *
 *   hsl(183 70% 30%)          MUI decomposeColor -> [183]        RN -> ok
 *   hsl(183 70% 30% / 0.12)   MUI decomposeColor -> [183]        RN -> null
 *   hsl(183, 70%, 30%)        MUI -> [183, 70, 30]               RN -> ok
 *   hsla(183, 70%, 30%, 0.12) MUI -> [183, 70, 30, 0.12]         RN -> ok
 *
 * The alpha form was losing the colour outright in the mobile Paper theme
 * (primaryContainer, secondaryContainer, errorContainer), and MUI turns the
 * partial parse into NaN without throwing, so every colour it DERIVES from
 * such a value — alpha(), getContrastText(), the *Channel variables — dies
 * with no error anywhere. Nothing in a browser, in Satori or in React Native
 * refuses the comma form.
 */
export const hsl = (triplet: string, alpha?: number): string => {
  const [h, s, l] = triplet.trim().split(/\s+/);
  return alpha === undefined ? `hsl(${h}, ${s}, ${l})` : `hsla(${h}, ${s}, ${l}, ${alpha})`;
};
