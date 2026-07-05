/**
 * React Native mirror of the web icon contract
 * (apps/web/src/icons/nexture-icons.tsx). Same names, sizes and variants so
 * icons stay interchangeable across platforms; `color` replaces the web's
 * CSS `currentColor` (React Native has no CSS inheritance).
 */
import type { ColorValue } from "react-native";

export type IconSize = "large" | "medium" | "small" | "tiny" | number;
export type IconVariant = "outlined" | "contained";

export type NextureIconsProps = {
  variant?: IconVariant;
  size?: IconSize;
  strokeWidth?: number;
  oneTone?: boolean;
  /** Stroke/fill color — pass a theme color (e.g. `useTheme().colors.onSurface`). */
  color?: ColorValue;
};

export const sizeHelper = (size: NextureIconsProps["size"]) => {
  if (typeof size === "number") {
    return size;
  } else if (size === "large") {
    return 24;
  } else if (size === "small" || size === "tiny") {
    return 16;
  } else {
    return 20;
  }
};

export const strokeSizeHelper = (size: number) => {
  if (size === 36) {
    return 1;
  } else if (size >= 20) {
    return 1.5;
  } else {
    return 1.75;
  }
};
