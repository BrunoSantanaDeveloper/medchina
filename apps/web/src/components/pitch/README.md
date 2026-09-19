# Pitch deck (`/pitch`)

The deck submitted with the **NVIDIA Inception** application. The program asks
for a deck that states the mission, the solution and the competitive market
value, from a company that is incorporated, under ten years old, not public,
employs at least one developer and runs a live site — so every slide answers one
of those, and the eligibility strip sits on the cover where the company is
introduced.

## It is the congress deck's system, not a copy of it

`app/pitch/layout.tsx` loads `clinical-source-home.css` and then
`palestra.css`, so this deck IS that design: the fixed 1280×720 canvas, the
class vocabulary (`.deck-card`, `.deck-stat`, `.deck-bars`, `.deck-window`,
`.deck-steps`, `.deck-annex`), the entry motion and the export pages all come
from there. `pitch.css` adds only what this deck needs and that one does not —
the cover's fact strip, the plan cards, the founders row, the penetration
scenarios, the eligibility chips.

The fit guard is the shared `deck-fit.ts`, so a pitch page is fitted by exactly
the same rule as a projected slide.

What it deliberately does NOT carry: teleprompter, 40-minute clock, phone sync,
language switch. A pitch is read, not performed.

| File               | What it holds                                           |
| ------------------ | ------------------------------------------------------- |
| `pitch-data.ts`    | The twelve slides and their payloads                    |
| `pitch-views.tsx`  | One view per slide                                      |
| `pitch-deck.tsx`   | The viewer: canvas scale, keyboard, counter, fullscreen |
| `pitch-export.tsx` | `/pitch/exportar` — PDF (browser print) and .pptx       |

## Every number is one we can defend

The figures come from the congress deck (`components/presentation/slides-data.ts`)
or from the product's own documentation: the February 2021 survey over 3.800
respondents, the platform totals, the 459 curated library documents, the public
plan prices. The market scenarios are labelled as scenarios — 370.000 × share ×
R$ 199 × 12 — never as a revenue projection. A reviewer checks, and an invented
number is the cheapest way to lose the application.

## Before submitting

- **Confirm the incorporation year and the CNPJ** on the cover. `docs/FUNIL.md`
  notes that the 2021 entity still needs to be confirmed as the contracting one.
- **An English version is a translation of `pitch-data.ts`**, nothing
  structural — the global application form is in English.
