/**
 * Generates src/tokens.generated.ts from the files in css/.
 *
 * The CSS files are the SOURCE OF TRUTH for the design system (the web app
 * consumes them directly via @import). This script extracts the custom
 * properties and produces the TypeScript mirror consumed by other platforms
 * (e.g. mobile), so values are never duplicated by hand — and can never drift.
 *
 * Usage: npm run tokens:generate (at the root) or npm run generate (in this package).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssDir = join(root, "css");
const outFile = join(root, "src", "tokens.generated.ts");

const THEME_FILES = ["blue", "green", "orange", "purple"];

/**
 * Extracts `selector { ... }` blocks (innermost only — declaration blocks
 * contain no braces) and their custom properties.
 * Keeps only the FIRST occurrence of each selector: later occurrences
 * inside @media are responsive overrides, not base values.
 */
function extractBlocks(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map();
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().split("\n").pop().trim();
    const props = {};
    for (const pm of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      props[pm[1]] = pm[2].trim().replace(/\s+/g, " ");
    }
    if (Object.keys(props).length && !blocks.has(selector)) {
      blocks.set(selector, props);
    }
  }
  return blocks;
}

function readCss(name) {
  return readFileSync(join(cssDir, `${name}.css`), "utf8");
}

const commonBlocks = extractBlocks(readCss("common"));
const common = {
  light: commonBlocks.get(":root") ?? {},
  dark: commonBlocks.get(".dark") ?? {},
};

// Marketing tokens are dimensions/motion (no colors), so no light/dark split.
const marketing = extractBlocks(readCss("marketing")).get(":root") ?? {};
if (!Object.keys(marketing).length) {
  throw new Error("Marketing tokens: empty :root block — check css/marketing.css");
}

const themes = {};
for (const name of THEME_FILES) {
  const blocks = extractBlocks(readCss(name));
  themes[name] = {
    light: blocks.get(`.theme-${name}`) ?? {},
    dark: blocks.get(`.theme-${name}.dark`) ?? {},
  };
}

for (const [name, t] of Object.entries(themes)) {
  if (!Object.keys(t.light).length || !Object.keys(t.dark).length) {
    throw new Error(`Theme "${name}": empty light or dark block — check css/${name}.css`);
  }
}

// ---------- Platform-neutral (React Native) values ----------
// RN has no CSS: rem/px strings, clamp() and cubic-bezier() must become
// numbers. Colors are NOT repeated here — HSL triplets + hsl() work in RN.

const px = (value) => {
  const m = /^(-?[\d.]+)(rem|px|em|ms)?$/.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
};

const clampMinMax = (value) => {
  const m = /^clamp\(\s*([^,]+),[^,]+,\s*([^)]+)\)$/.exec(value.trim());
  if (!m) return null;
  return { min: px(m[1]), max: px(m[2]) };
};

const bezier = (value) => {
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(value.trim());
  if (!m) return null;
  return m[1].split(",").map((n) => parseFloat(n));
};

const native = {
  radius: Object.fromEntries(
    Object.entries(common.light)
      .filter(([key]) => key.startsWith("border-radius-"))
      .map(([key, value]) => [key.replace("border-radius-", ""), px(value)]),
  ),
  spacing: { mainPadding: px(common.light["main-padding"]) },
  display: Object.fromEntries(
    ["2xl", "xl", "lg", "md"].map((size) => [size, clampMinMax(marketing[`display-${size}`])]),
  ),
  displayLeading: parseFloat(marketing["display-leading"]),
  motion: {
    duration1: px(marketing["motion-duration-1"]),
    duration2: px(marketing["motion-duration-2"]),
    duration3: px(marketing["motion-duration-3"]),
    /** cubic-bezier control points — feed to Reanimated's Easing.bezier(...). */
    ease: bezier(marketing["motion-ease"]),
    revealDistance: px(marketing["motion-reveal-distance"]),
  },
};

for (const [size, value] of Object.entries(native.display)) {
  if (!value || value.min === null || value.max === null) {
    throw new Error(`Native tokens: could not parse display-${size} clamp() — check css/marketing.css`);
  }
}
if (!native.motion.ease) {
  throw new Error("Native tokens: could not parse motion-ease cubic-bezier() — check css/marketing.css");
}

const banner = `// ============================================================
// GENERATED FILE — DO NOT EDIT MANUALLY.
// Source of truth: packages/design-tokens/css/*.css
// Regenerate: npm run tokens:generate (at the monorepo root)
// ============================================================
`;

const body = `${banner}
/** Tokens shared by all themes (greys, text, feedback, shadows, radii). Color values are HSL triplets ("H S% L%"). */
export const common = ${JSON.stringify(common, null, 2)} as const;

/** Per-color-theme tokens, in light/dark variants. Color values are HSL triplets ("H S% L%"). */
export const themes = ${JSON.stringify(themes, null, 2)} as const;

/** Marketing-layer tokens (fluid display type scale, section rhythm, motion). Dimension/motion values, no light/dark split. */
export const marketing = ${JSON.stringify(marketing, null, 2)} as const;

/**
 * Platform-neutral values for React Native: dimensions in px numbers,
 * display scale as {min,max} px, easing as cubic-bezier control points.
 * Colors are NOT duplicated here — use themes/common with the hsl() helper.
 * Shadows are intentionally omitted (RN uses elevation / Paper surfaces).
 */
export const native = ${JSON.stringify(native, null, 2)} as const;
`;

writeFileSync(outFile, body);
console.log(
  `tokens.generated.ts updated: ${Object.keys(themes).length} themes, ` +
    `${Object.keys(common.light).length} common tokens (light) / ${Object.keys(common.dark).length} (dark), ` +
    `${Object.keys(marketing).length} marketing tokens, native export OK.`,
);
