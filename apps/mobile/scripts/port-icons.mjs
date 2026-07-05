/**
 * Ports Nexture icons from the web set (apps/web/src/icons/nexture/*.tsx,
 * DOM SVG) to React Native (react-native-svg), keeping filenames and the
 * NextureIconsProps contract identical.
 *
 * Usage (from apps/mobile): node scripts/port-icons.mjs ni-home ni-settings ...
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const webIcons = join(mobileRoot, "..", "web", "src", "icons", "nexture");
const outDir = join(mobileRoot, "src", "icons", "nexture");

const SVG_TAGS = ["svg", "path", "circle", "rect", "g", "defs", "linearGradient", "radialGradient", "stop", "ellipse", "line", "polygon", "polyline", "mask", "clipPath"];
const RN_NAME = Object.fromEntries(SVG_TAGS.map((t) => [t, t === "svg" ? "Svg" : t[0].toUpperCase() + t.slice(1)]));
const TAG_RE = new RegExp(`(<\\/?)(${SVG_TAGS.join("|")})(?=[\\s/>])`, "g");

const names = process.argv.slice(2);
if (!names.length) {
  console.error("Usage: node scripts/port-icons.mjs ni-home ni-settings ...");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const name of names) {
  let src = readFileSync(join(webIcons, `${name}.tsx`), "utf8");
  const used = new Set();

  // DOM tags -> react-native-svg components (multi-line JSX safe).
  src = src.replace(TAG_RE, (_, bracket, tag) => {
    if (tag !== "svg") used.add(RN_NAME[tag]);
    return `${bracket}${RN_NAME[tag]}`;
  });

  src = src
    // currentColor has no meaning in RN — use the color prop.
    .replaceAll('"currentColor"', "{color}")
    // DOM-only attributes.
    .replace(/\s+xmlns="[^"]*"/g, "")
    .replace(/\s+className=\{className\}/g, "")
    // Contract: drop className from the destructure, add color with a default.
    .replace(/\(\{([\s\S]*?)\}: NextureIconsProps\)/, (_, params) => {
      const kept = params
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p && p !== "className");
      kept.push('color = "#000"');
      return `({ ${kept.join(", ")} }: NextureIconsProps)`;
    })
    // Import from the local contract + react-native-svg.
    .replace(
      /import \{([^}]+)\} from "\.\.\/nexture-icons";/,
      (_, imports) =>
        `import Svg${used.size ? `, { ${[...used].sort().join(", ")} }` : ""} from "react-native-svg";\n\nimport {${imports}} from "../nexture-icons";`,
    );

  writeFileSync(join(outDir, `${name}.tsx`), src);
  console.log(`ported ${name} (Svg${used.size ? ", " + [...used].sort().join(", ") : ""})`);
}
