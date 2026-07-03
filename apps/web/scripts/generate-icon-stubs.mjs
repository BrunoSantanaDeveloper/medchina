/**
 * Fills an alternative icon set (e.g. src/icons/phosphor) with fallback
 * stubs so the icon alias swap is safe: every icon that has no real
 * adapter yet re-exports the original Nexture implementation.
 *
 * Usage: npm run icons:stubs [-- <set>]   (default set: phosphor)
 *
 * Replace stubs with real adapters over time; the script never
 * overwrites existing files.
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const set = process.argv[2] ?? "phosphor";
const nextureDir = join(root, "src", "icons", "nexture");
const targetDir = join(root, "src", "icons", set);

if (!existsSync(targetDir)) {
  console.error(`Target set folder does not exist: src/icons/${set}`);
  process.exit(1);
}

const icons = readdirSync(nextureDir).filter((file) => file.endsWith(".tsx"));
let created = 0;

for (const file of icons) {
  const target = join(targetDir, file);
  if (existsSync(target)) continue;
  const name = file.replace(/\.tsx$/, "");
  writeFileSync(
    target,
    `// Fallback stub — replace with a real ${set} adapter when needed.\nexport { default } from "../nexture/${name}";\n`,
  );
  created++;
}

const adapters = icons.length - created;
console.log(`src/icons/${set}: ${adapters} real adapters/stubs already present, ${created} fallback stubs created.`);
