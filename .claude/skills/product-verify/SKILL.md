---
name: product-verify
description: Journey verification of the authenticated app — runs the app and WALKS the flows a real user takes (new + returning, desktop + mobile viewport), judging dead ends, lost context, error-vs-empty, fake surfaces and destructive actions. Use AFTER building or substantially editing screens/flows under apps/web/src/app/(dashboard), before declaring them done; also when asked to "verify the product", audit a flow, or check UX end-to-end.
---

# Product journey verification

A product screen is not "done" because it typechecks, and not even because it looks right in isolation. The failure mode this skill exists to catch — proven by a real derived-project audit — is **screens that pass individually while the journey between them is broken**: a blocked action with no way to resolve the prerequisite, a detour that loses the user's half-filled form, a network error rendered as "no data", template demo surfaces shipping to real users. Marketing has `marketing-verify` for pixels; this is its product sibling for FLOWS.

## 1. Run the app

- `npm run dev` from the repo root, in the background; reuse an already-running dev server.
- **New-user pass**: without Supabase env vars (or against a freshly seeded local Supabase) every screen renders its zero-data reality — this is the first-impression state to judge.
- **Returning-user pass**: with a seeded local Supabase, sign in as a test user that has real data, so lists, timelines and dashboards render populated.
- Never point this at production data.

## 2. Walk journeys, not routes

Screenshots go to the session scratchpad (never into the repo). Setup is the same as marketing-verify (`npm i playwright && npx playwright install chromium` in the scratchpad). Viewports: **1440×900 and 390×844**, light AND dark.

Do not just open each page. Script (or manually drive) the top 2–3 jobs the touched screens serve, end to end — e.g. "create the first X", "complete the daily task", "recover from a mistake". For each journey capture every step.

## 2b. Deterministic probes (measure before you judge)

```js
// Error ≠ empty: kill the app's data calls and confirm an ERROR renders, not the empty state.
await page.route("**/api/**", (r) => r.abort());
await page.route("**/rest/v1/**", (r) => r.abort()); // Supabase
await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
// FAIL if the screen now shows the EmptyState / "no data" copy instead of an error + retry.

// Unnamed icon controls: must be 0 on every screen you touched.
const unnamed = await page.evaluate(
  () =>
    [...document.querySelectorAll("button")].filter(
      (b) => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby"),
    ).length,
);

// Template leftovers reaching real users: open the command palette / search / shortcuts
// and grep the DOM for demo-dataset terms.
const leftovers = await page.evaluate(() =>
  ["Add Product", "Add Category", "Discounts", "ThemeForest"].filter((t) => document.body.innerText.includes(t)),
);

// Context preservation: fill a form field, take the prerequisite detour the UI offers,
// come back — assert the field still holds the value.

// Counts match lists: for every tile, badge or heading count that labels a list, open the list it
// leads to and compare its rows (or its total) with the number; the empty state must appear only
// when the list itself is empty, never because a narrower count is zero.

// Phone rows and dialogs, at 390: no row's text squeezed to a word per line beside its buttons (the
// actions go under the text), and the first field of every dialog shows its whole floating label.
const clipped = await page.evaluate(() =>
  [...document.querySelectorAll("[role=dialog] label")].filter((l) => {
    const box = l.getBoundingClientRect();
    const dialog = l.closest("[role=dialog]")?.getBoundingClientRect();
    return dialog && box.top < dialog.top;
  }).length,
);
```

**Dev mode hydrates late.** A click before hydration is lost: before judging a control that "does nothing", retry until the menu or dialog answers (or wait for a sign the page hydrated). Judge a hydration warning only if it repeats on a fresh load.

## 3. Judge the journey bar (PASS/FAIL each item, with the step screenshot as evidence)

1. **First-run path to value** — a brand-new account never lands on a blank screen; every zero-data view is an `EmptyState` with why + ONE action that actually works when clicked.
2. **No dead ends** — every blocked/disabled action states its prerequisite and offers resolution **in place** (quick-create, inline step) or a navigation that provably returns. A disabled CTA with no explanation FAILS.
3. **Context survives detours** — form drafts, selected dates/entities and the origin screen are preserved across any prerequisite side-trip (patient-before-appointment class of flows). Losing the user's input FAILS.
4. **Error ≠ empty** — with data calls aborted (probe above), the screen shows an error with retry. Empty-state-on-failure FAILS.
5. **Every CTA lands in context** — checklist items, "prepare X", menu entries and notifications land on the specific in-product destination, never on generic settings, a marketing page inside the app shell, or an unrelated module.
6. **No fake or leftover surfaces** — search, shortcuts, assistants and menus contain only THIS product's entities and actions (probe above finds nothing). Demo e-commerce data reaching a user FAILS.
7. **Destructive actions confirm** — cancel/delete/revoke name the consequence before executing and offer undo where feasible; concurrent state changes (already-started, already-cancelled) are handled, not clobbered.
8. **Locale integrity** — every walked screen renders in the project's default locale; leaked English in a non-English product FAILS.
9. **Mobile 390** — the journey is completable: primary action reachable, no floating widget covering fields, no horizontal scroll, long forms usable.
10. **Keyboard/a11y quick pass** — the main journey is Tab-walkable (menu items are links, reachable by keyboard), focus lands sensibly after dialogs open/close, after errors and after an async action ends (back on the line acted on), `unnamed === 0` on every screen, and a card already decided is no longer clickable.
11. **One action at a time, and the result where it was done** — on a screen of many cards that write to the same record, click a button that writes and, while it runs, try the other writing controls: each is disabled and says why, the clicked one turns and says what it does, and opening a card or a file still works. When it ends, the controls come back only once the screen shows the result, a line with its time says it in the card acted on, another card it changed is marked, and the record's top changed at the same moment as the cards. A second click that acts on the old state, a top that still says the old state after the cards changed, or a screen that says nothing while the action runs FAILS.
12. **What asks comes first, one line each** — on every card of a record that lists things that pile up, the ones that ask the person for something are first, each a line saying what is missing with its one button, and the settled ones are lines below, the newest first, a few in sight. A card where the one item asking for action sits among open, settled ones, so the person must read them all to find it, FAILS.
13. **Counts agree with their lists, and each thing is said once** — every count beside or above a list equals what that list shows (probe above); a page that says "nothing here" while its list holds rows FAILS, and so does a screen that names the same pending thing twice (a line of a list and a tile of the same count) or shows "nothing waits" beside a list of pending items.
14. **Only what is still owed is asked** — no card offers a button for something already done (a document that arrived, a link sent, an answer given); doing it again sits in a quick-actions menu; the person's own work is never listed for something the product does by itself.
15. **Outcomes land where the person acted** — after an upload or a background check, the result (a refusal with its reason) shows on the line acted on while the person is still there; nothing says "working" after the work finished.
16. **Nothing typed is lost** — closing an editor or dialog with unsaved text asks first, and a background refresh never resets it.
17. **Words carry the state** — every state is said in words beside its colour; red appears only on failure or risk; a missing value hides its line instead of printing a placeholder.
18. **The open screen follows the background work** — trigger work the product does by itself (an action that sets it to work, an outsider's upload in another tab) and keep the screen open without reloading: what the product did shows within seconds, the screen says when it last knew it was current, and no spinner turns when nothing is under way. A screen that shows the result only after a reload FAILS.
19. **Whose turn is said, and is true** — for each wait the screen shows, the owner it names (the team and which role, the outsider, the product, the platform) is the one who can actually end it, the way to end it is offered only to who may, and the record's "who has it now" agrees with the lines below it. A record said to be with the product while it waits for the team FAILS.

## 3b. When you cannot sign in to the data a screen needs

Never look at a screen through a real person's account or production data. Instead:

- **Draw the touched components from invented fixtures.** A component that reads its own data takes an optional first read (`initial`) or splits into a data-reading wrapper and a props-only body; render those on a temporary page under a path the middleware already serves without a session, with invented people only, and capture 1440/390 light/dark from it.
- **A second dev server goes on its own port and build folder** when one is already running (for example a temporary `distDir: process.env.NEXT_DIST_DIR || ".next"` with `NEXT_DIST_DIR=.next-preview`), never on a port another session uses.
- **Undo all of it in the same turn**: stop the server's whole process tree, delete the temporary page, revert the config and the `tsconfig.json` / `next-env.d.ts` that `next dev` rewrites, and delete the build folder after checking it is not a junction or symlink (deleting through a link deletes its target). Whatever stays in the work tree between turns may be committed and deployed by whoever commits next.
- Say in the report that the screens were judged on fixtures, and which real journey is still to be walked signed in.

## 4. Close the loop

- Report the verdict table to the user (one line per item, with the failing step/screenshot named).
- FAIL items: fix under the `product-screen` skill rules, then re-walk the journey and re-judge. Do not report "done" with open FAILs.
- Clean up: screenshots and scripts stay in the scratchpad; nothing from this skill is committed; `git status` shows only the real work.

## Degraded mode (no browser available)

Say so explicitly, then do the best static pass: `npm run build` must succeed; trace each journey through the code (entry → prerequisite → return), and check items 2–7 by reading the handlers; list what could NOT be verified live and ask the user to walk the flow once. Never silently claim journey verification that didn't happen.
