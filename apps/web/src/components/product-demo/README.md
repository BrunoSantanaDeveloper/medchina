# Product demo deck (`/demonstracao`)

Three slides that show MedChina to anyone — a professional, a clinic, a
partner — with no event, audience or date attached. Shown from a laptop or sent
as a link; `/demonstracao/exportar` hands it over as a PDF or a PowerPoint.

| Slide | Says                                          | Shows                                                                        |
| ----- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| 1     | What it is, and the brand line as the promise | What typing takes from the consultation, beside the real consultation clip   |
| 2     | How it works: record, review, decide          | Three real captures, consent and offline capture                             |
| 3     | The AI prepares; the professional decides     | The worked review example, three rules the software checks, the address + QR |

## It is the congress deck's system, not a copy of it

`app/demonstracao/layout.tsx` loads `clinical-source-home.css` and then
`palestra.css`, exactly like `/pitch`, so the fixed 1280×720 canvas, the class
vocabulary (`.deck-motto`, `.deck-flow`, `.deck-evidence`, `.deck-principle`,
`.deck-qr`), the entry motion, the fit guard (`deck-fit.ts`) and the export
pages all come from there. `demonstracao.css` adds only the brand row of the
cover, the taller captures and the closing call to action.

The clip on slide 1 is the congress deck's own (`/videos/palestra/consulta-acelerada.mp4`),
played by the shared `AmbientShot` in `presentation/deck-media.tsx`: same speed
caption, same blocked-autoplay and reduced-motion handling, and its still on
paper. Never import `slide-views.tsx` or `slides-deck.ts` from here — the first
drags the whole congress deck into this bundle, the second is the teleprompter.

| File              | What it holds                                                                       |
| ----------------- | ----------------------------------------------------------------------------------- |
| `demo-data.ts`    | The three slides and every string on them                                           |
| `demo-views.tsx`  | One view per slide                                                                  |
| `demo-deck.tsx`   | The viewer: canvas scale, keys, swipe, fullscreen with the toolbar that leaves      |
| `demo-export.tsx` | `/demonstracao/exportar` — PDF (browser print) and .pptx, rendered in `export` mode |

## What it deliberately does not say

- **No price, trial length or count.** Those are configurable data and change;
  a deck that gets forwarded must not carry a number that may already be wrong.
  The free tier is named only as the home names it.
- **No diagnosis.** The AI prepares hypotheses and drafts; the professional
  reviews, edits, validates and signs.
- **No patient name on screen.** The congress deck's agenda capture shows one,
  so this deck does not use it. Swap a capture only for one that is anonymous.

Route facts: public (`PUBLIC_PREFIXES` in `middleware.ts`), `noindex`, and out
of `sitemap.ts` (named in its exclusion comment), like `/palestra` and `/pitch`.
Portuguese only.
