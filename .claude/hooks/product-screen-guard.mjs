#!/usr/bin/env node
/**
 * PreToolUse guard for the authenticated app (product screens).
 *
 * Fires on every Write/Edit/MultiEdit under app/(dashboard)/** or
 * components/product/**, injecting a non-blocking reminder so the
 * `product-screen` skill applies to NEW screens, EDITS and added sections
 * alike — the default drift into CRUD tables never gets a free pass.
 *
 * It also injects a digest of the product component catalog
 * (apps/web/src/components/product/catalog.json), so every generation knows
 * which shared component or template pattern already covers the shape being
 * written. Without it, reviews keep discovering the same class of defect:
 * a series, a ratio or a counter set rendered as a sentence, while the
 * component for it sits unused in the repo.
 *
 * Marketing paths are excluded: they have their own guard.
 * Cross-platform: pure Node, no shell.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractToolPaths, isCodexHook, normalizeToolPath } from "./lib/tool-paths.mjs";

function catalogDigest(cwd) {
  try {
    const json = readFileSync(join(cwd, "apps", "web", "src", "components", "product", "catalog.json"), "utf8");
    const catalog = JSON.parse(json);
    const shared = (catalog.components ?? []).map((c) => `- ${c.name}(${c.props}) — ${c.use}`);
    const template = (catalog.template ?? []).map((c) => `- ${c.name} [porte de ${c.source}] — ${c.use}`);
    if (!shared.length && !template.length) return "";
    return [
      "5. COMPONENT CATALOG — check the shape against this BEFORE writing markup. A series, a ratio, a share or a counter set rendered as a sentence is a defect:",
      ...shared,
      ...(template.length ? ["   Template patterns not yet packaged (port, never reinvent):", ...template] : []),
      ...(catalog.tones?.rule ? [`   Tones: ${catalog.tones.rule}`] : []),
      ...(catalog.traps ?? []).map((t) => `   Trap: ${t}`),
    ].join("\n");
  } catch {
    return ""; // Catalog pruned or unreadable — the reminder still stands on its own.
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // Malformed payload — never block a tool call.
  }

  const isProduct = extractToolPaths(input)
    .map(normalizeToolPath)
    .some(
      (path) =>
        !/\/app\/\(marketing\)\//.test(path) &&
        !/\/components\/marketing\//.test(path) &&
        (/\/app\/\(dashboard\)\//.test(path) || /\/components\/product\//.test(path)),
    );
  if (!isProduct) process.exit(0);

  const reminder = [
    "PRODUCT SCREEN — mandatory before this write/edit:",
    "1. Load the `product-screen` skill and obey it.",
    "2. GOAL, NOT TABLE: state who is on this screen, what job they came to do, and what success looks like. Do NOT default to a CRUD table of rows — a table is right only when the job really is scan/compare/manage many rows.",
    "3. Activation: a brand-new user must find a path to value (aha moment), never a blank screen. Every zero-data view uses `EmptyState` (icon + why + the ONE next action). Long setups use `SetupWizard` (progressive disclosure); first-result steps use `OnboardingChecklist` + `@flyee/onboarding`.",
    "4. Engagement: use completion drive (`ActivationProgress`) and competence feedback. Do NOT add points, badges, leaderboards or streaks — they are documented failures and streaks carry regulatory risk.",
    catalogDigest(input?.cwd ?? process.cwd()),
  ]
    .filter(Boolean)
    .join("\n");

  const output = isCodexHook(input)
    ? { systemMessage: reminder }
    : {
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reminder },
      };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
