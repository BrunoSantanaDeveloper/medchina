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
`;

writeFileSync(outFile, body);
console.log(
  `tokens.generated.ts updated: ${Object.keys(themes).length} themes, ` +
    `${Object.keys(common.light).length} common tokens (light) / ${Object.keys(common.dark).length} (dark), ` +
    `${Object.keys(marketing).length} marketing tokens.`,
);
