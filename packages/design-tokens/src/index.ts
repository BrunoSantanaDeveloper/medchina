export { common, marketing, themes } from "./tokens.generated";

import { themes } from "./tokens.generated";

export type ThemeName = keyof typeof themes;
export type Mode = "light" | "dark";

/**
 * Converts a token HSL triplet ("191 100% 46%") into a CSS/React Native color.
 * Use only on COLOR tokens; shadow/radius/spacing tokens are literal values
 * and must be used as-is.
 */
export const hsl = (triplet: string, alpha?: number): string =>
  alpha === undefined ? `hsl(${triplet})` : `hsl(${triplet} / ${alpha})`;
