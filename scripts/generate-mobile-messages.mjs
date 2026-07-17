import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const locales = ["de", "en", "es", "fr", "pt-BR"];
const languageKeys = ["de", "en", "es", "fr", "pt-BR"];
const root = process.cwd();
const sourceDirectory = path.join(root, "packages", "content", "messages");
const outputDirectory = path.join(root, "packages", "content", "mobile-messages");
const check = process.argv.includes("--check");

await mkdir(outputDirectory, { recursive: true });
let changed = false;

for (const locale of locales) {
  const source = JSON.parse(await readFile(path.join(sourceDirectory, `${locale}.json`), "utf8"));
  const dashboard = Object.fromEntries(languageKeys.map((key) => [key, source.dashboard[key]]));
  const generated = `${JSON.stringify({ mobile: source.mobile, dashboard }, null, 2)}\n`;
  const output = path.join(outputDirectory, `${locale}.json`);
  const current = await readFile(output, "utf8").catch(() => "");
  if (current === generated) continue;
  changed = true;
  if (!check) await writeFile(output, generated, "utf8");
}

if (check && changed) {
  console.error("Mobile message catalogs are stale. Run npm run content:mobile.");
  process.exitCode = 1;
}
