#!/usr/bin/env node
/**
 * Guard against a defect class this repo hit three times: a stylesheet rule
 * written against a MUI class that the DOM never receives.
 *
 * MUI 5 emitted composed classes (`MuiChip-outlinedPrimary`,
 * `MuiAlert-standardSuccess`, `MuiButton-pastelAccent-2`). MUI 9 builds the
 * class list as `Mui{Comp}-{variant}` + `Mui{Comp}-color{Color}` instead, so
 * every composed selector silently matches nothing. Nothing caught it: the
 * theme's own type augmentation DECLARED those classes, so TypeScript accepted
 * `chipClasses.outlinedError`, and no lint covers `src/style/**`.
 *
 * The source of truth is each component's class manifest, which ships a
 * literal array of every slot the component can emit:
 *   generateUtilityClasses('MuiAlert', ['root', 'icon', 'colorError', ...])
 *
 * Usage:
 *   node scripts/check-mui-classes.mjs           # report, exit 1 on findings
 *   node scripts/check-mui-classes.mjs --list    # also list what was skipped
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const STYLE_DIR = join(ROOT, "apps", "web", "src", "style");
const PACKAGES = [
  "@mui/material",
  "@mui/lab",
  "@mui/x-data-grid",
  "@mui/x-data-grid-pro",
  "@mui/x-data-grid-premium",
  "@mui/x-charts",
  "@mui/x-date-pickers",
  "@mui/x-date-pickers-pro",
  "@mui/x-tree-view",
];

const listFiles = (dir, ext, acc = []) => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listFiles(p, ext, acc);
    else if (p.endsWith(ext)) acc.push(p);
  }
  return acc;
};

/**
 * Build `MuiAlert -> Set(slots)` from every manifest in the installed packages.
 * A component can appear in more than one package (the Pro DataGrid re-exports
 * the community one), so slots are merged rather than replaced.
 */
function loadManifests() {
  const byComponent = new Map();
  for (const pkg of PACKAGES) {
    const dir = join(ROOT, "node_modules", ...pkg.split("/"));
    for (const file of listFiles(dir, "Classes.js")) {
      // Skip the duplicate module builds; any one of them carries the array.
      if (/[\\/](esm|modern|legacy|node)[\\/]/.test(file)) continue;
      let src;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const re = /generateUtilityClasses\w*\.default\)?\(\s*'([^']+)'\s*,\s*\[([^\]]*)\]/g;
      let m;
      while ((m = re.exec(src))) {
        const comp = m[1];
        const slots = [...m[2].matchAll(/'([^']+)'/g)].map((s) => s[1]);
        if (!byComponent.has(comp)) byComponent.set(comp, new Set());
        const set = byComponent.get(comp);
        for (const s of slots) set.add(s);
      }
      // The DataGrid does not use generateUtilityClasses: it keeps its slots in
      // a `{ root: [...], children: [...] }` literal. Take every quoted string
      // in that file. Over-permissive on purpose — a guard that cries wolf is
      // a guard that gets switched off.
      if (file.endsWith(`${sep}gridClasses.js`)) {
        if (!byComponent.has("MuiDataGrid")) byComponent.set("MuiDataGrid", new Set());
        const set = byComponent.get("MuiDataGrid");
        for (const s of src.matchAll(/'([A-Za-z][A-Za-z0-9_-]*)'/g)) set.add(s[1]);
      }
    }
  }
  return byComponent;
}

/**
 * Classes the app defines itself, on purpose. They are not MUI slots and the
 * guard must not flag them. Keep this list short and justified.
 */
const APP_OWNED = new Set([
  "neutral", // alert.css / the app's own quiet Alert treatment
]);

/**
 * WHAT THIS GUARD DOES NOT DO — read this before trusting a green run.
 *
 * It checks that a NAME can be emitted. It does NOT check that two names can
 * land on the SAME ELEMENT. `useUtilityClasses` splits slots into groups, and
 * a compound selector across two groups matches nothing while every name in it
 * is real. `.MuiDrawer-paper.MuiDrawer-anchorLeft` passed this guard and was
 * dead: `anchorLeft` belongs to the root group, `paper` to another element.
 * When you write a compound, open the component's `useUtilityClasses` and
 * confirm both names sit in the same array.
 *
 * Manifests are also incomplete. `formControlLabelClasses` omits
 * `labelPlacementEnd`, yet FormControlLabel emits
 * `labelPlacement${capitalize(labelPlacement)}` unconditionally with `end` as
 * the default — so the class is real and the manifest simply does not list it.
 * Entries below are names verified against the component source, not guesses.
 */
const EMITTED_DESPITE_MANIFEST = new Map([
  // FormControlLabel.js: slots.root includes `labelPlacement${capitalize(x)}`
  // unconditionally; `end` is the default value, so the class always ships.
  ["MuiFormControlLabel", new Set(["labelPlacementEnd"])],
]);

/**
 * Dead selectors this repo has looked at and decided to leave alone. Each one
 * needs a reason, and the reason has to survive re-reading: a baseline that
 * grows without argument is how the debt got here in the first place.
 *
 * New instances still fail. Nothing is hidden — they are printed as accepted
 * at the end of every run.
 */
const ACCEPTED = [
  {
    file: "apps/web/src/style/inputs/button.css",
    match: /^\.MuiButton-(contained|text|outlined)[A-Z]/,
    why:
      "MUI ships native styling for these three variants, so unlike pastel and surface the buttons are " +
      "not unstyled. Migrating them changes the look of every button in the app, which the owner " +
      "declined (2026-09-11). NOT a clean bill of health: what these dead rules were carrying is gone " +
      "with them, and MUI's own substitute is broken by the same hsl(var()) palette. theme.alpha() " +
      "returns the malformed 'rgba(hsl(var(--primaryChannel) / 0.08)', so no text or outlined button " +
      "in the app has a hover background. Measured 2026-09-21; revisit with the owner.",
  },
];

const acceptedBy = (file, selector) =>
  ACCEPTED.find((rule) => file === rule.file && rule.match.test(selector));

/**
 * `color{X}` and `size{X}` legitimately grow past the manifest: a theme that
 * augments the palette (this one adds accent-1..4, text-primary, grey) or adds
 * a size (`tiny`) makes MUI emit `MuiChip-colorAccent-1` and
 * `MuiButton-sizeTiny`, which no shipped manifest can list. Verified in the
 * DOM on 2026-09-21. Trusting these costs the guard nothing, because the
 * defect it exists to catch has a different shape.
 */
const EXTENSIBLE = /^(color|size)[A-Z]/;

/**
 * The defect shape, and the only thing worth failing a build over: a slot
 * spelled `{variant}{Suffix}` where `{variant}` is itself a real slot. That is
 * the MUI 5 composed class — `standardSuccess`, `outlinedPrimary`,
 * `avatarMedium`, `groupedHorizontal` — which MUI 9 stopped emitting. Anything
 * else unknown is reported quietly instead, because it is far more likely to
 * be a slot from a package whose manifest is not installed.
 */
function composedParts(slot, known, appVariants) {
  const m = slot.match(/^([a-z][A-Za-z0-9]*?)([A-Z][A-Za-z0-9-]*)$/);
  if (!m) return null;
  const [, prefix, rest] = m;
  if (!known.has(prefix) && !appVariants.has(prefix)) return null;
  return { prefix, rest };
}

/**
 * Variants the THEME adds, which no manifest can know about: `pastel` and
 * `surface` on Button. MUI does emit `MuiButton-pastel` for them (the variant
 * name is always a class), so a bare rule works — but `pastel{Color}` is as
 * dead as `outlined{Color}`, and worse, because MUI ships no native styling to
 * fall back on. Detect them the only honest way available: a bare
 * `.Mui{Comp}-{word}` rule in the app's own stylesheets.
 */
function collectAppVariants(files, manifests) {
  const byComponent = new Map();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*\.(Mui[A-Za-z0-9]+)-([a-z][a-z0-9]*)\s*[,{]/);
      if (!m) continue;
      const [, comp, slot] = m;
      if (manifests.get(comp)?.has(slot)) continue;
      if (!byComponent.has(comp)) byComponent.set(comp, new Set());
      byComponent.get(comp).add(slot);
    }
  }
  return byComponent;
}

function main() {
  const manifests = loadManifests();
  const files = listFiles(STYLE_DIR, ".css");
  const appVariants = collectAppVariants(files, manifests);
  const findings = [];
  const accepted = new Map();
  const skipped = new Map();
  const unknown = new Map();

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      // `.MuiAlert-standardSuccess` — component + slot. The global state
      // classes (`Mui-disabled`) carry no component and are out of scope.
      const re = /\.(Mui[A-Za-z0-9]+)-([A-Za-z][A-Za-z0-9-]*)/g;
      let m;
      while ((m = re.exec(line))) {
        const [, comp, slot] = m;
        if (APP_OWNED.has(slot)) continue;
        const known = manifests.get(comp);
        if (!known) {
          const at = skipped.get(comp) ?? [];
          at.push(`${relative(ROOT, file).split(sep).join("/")}:${i + 1}`);
          skipped.set(comp, at);
          continue;
        }
        if (known.has(slot)) continue;
        if (EMITTED_DESPITE_MANIFEST.get(comp)?.has(slot)) continue;
        if (EXTENSIBLE.test(slot)) continue;
        const where = `${relative(ROOT, file).split(sep).join("/")}:${i + 1}`;
        const composed = composedParts(slot, known, appVariants.get(comp) ?? new Set());
        if (!composed) {
          const at = unknown.get(`${comp}-${slot}`) ?? [];
          at.push(where);
          unknown.set(`${comp}-${slot}`, at);
          continue;
        }
        // The emitted form: the variant stays a class, the rest becomes its own
        // slot. `color{Rest}` when the suffix names a colour, the bare
        // lower-cased suffix when it names another state (horizontal, Medium).
        const asColor = `color${composed.rest}`;
        const asSize = `size${composed.rest}`;
        const asOwn = composed.rest.charAt(0).toLowerCase() + composed.rest.slice(1);
        const pair = (second) => `.${comp}-${composed.prefix}.${comp}-${second}`;
        let suggestion = null;
        if (known.has(asColor)) suggestion = pair(asColor);
        else if (known.has(asSize)) suggestion = pair(asSize);
        else if (known.has(asOwn)) suggestion = pair(asOwn);
        else suggestion = `${pair(asColor)} (a theme colour) or ${pair(asSize)} (a size)`;
        const rel = relative(ROOT, file).split(sep).join("/");
        const rule = acceptedBy(rel, `.${comp}-${slot}`);
        if (rule) {
          accepted.set(rule.why, (accepted.get(rule.why) ?? 0) + 1);
          continue;
        }
        findings.push({ file: rel, line: i + 1, selector: `.${comp}-${slot}`, suggestion });
      }
    });
  }

  if (findings.length) {
    console.error(`\nMUI class guard: ${findings.length} selector(s) that the DOM never receives.\n`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  ${f.selector}`);
      if (f.suggestion) console.error(`      -> the emitted form is ${f.suggestion}`);
    }
    console.error(
      "\nMUI 9 builds a class list as Mui{Comp}-{variant} + Mui{Comp}-color{Color}." +
        "\nThe composed Mui{Comp}-{variant}{Color} of MUI 5 is gone. A type augmentation" +
        "\nthat declares one does NOT make the DOM emit it.\n",
    );
  } else {
    console.log(`MUI class guard: every selector in ${files.length} stylesheet(s) matches a real class.`);
  }

  if (accepted.size) {
    console.log(`
Known-dead and deliberately left alone:`);
    for (const [why, count] of accepted) console.log(`  ${count} selector(s) — ${why}`);
  }

  if (unknown.size) {
    console.log(`
Unrecognised, but not the composed-class shape (likely a slot from a package whose manifest is not installed, or a genuinely new name):`);
    for (const [name, at] of [...unknown].sort()) {
      console.log(`  .${name} — ${at.length}x, e.g. ${at[0]}`);
    }
  }

  if (process.argv.includes("--list") && skipped.size) {
    console.log(`\nNot checked (no class manifest installed for these):`);
    for (const [comp, at] of [...skipped].sort()) {
      console.log(`  ${comp} — ${at.length} occurrence(s), e.g. ${at[0]}`);
    }
  }

  process.exit(findings.length ? 1 : 0);
}

main();
