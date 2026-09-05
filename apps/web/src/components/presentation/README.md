# Congress deck (`/palestra`)

Debora's 40-minute talk at the TCM congress in Xinjiang, built as a real
presentation tool rather than a page that happens to show slides.

The source of truth for the content is
`attachments/Palestra-MedChina-Congresso-MTC-Xinjiang.docx.md`. The `script`
field of every step follows it near-verbatim — it is the teleprompter, so a
sentence that is not there will not be said on stage.

## Files

| File                              | What it holds                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `types.ts`                        | `Bi` (a pt/zh pair), `DeckLang`, `SlideData`                                      |
| `slides-data.ts`                  | All content: the 24 steps plus the per-slide payloads (timeline, stats, columns…) |
| `slide-views.tsx`                 | One view per step, composed from the deck's class vocabulary                      |
| `slide-deck.tsx`                  | The shell: canvas scaling, keyboard, timer, presenter window, overlays            |
| `../../app/palestra/palestra.css` | The deck's design system                                                          |

## Which design system this is

The **Landing DS** (`docs/DESIGN.md`). `app/palestra/layout.tsx` imports
`clinical-source-home.css` first, so the deck inherits the home's palette
(`--jade`, `--coral`, `--ink`, `--paper`…), the self-hosted TT Chocolates and
Mulish faces and its class vocabulary; `palestra.css` adds only what a projected
deck needs. Like the rest of that system it uses direct Phosphor imports and
hardcoded copy, and it is deliberately outside the token/i18n contract.

It is **not** covered by `marketing-lint` (that hook only walks
`app/(marketing)/` and `components/marketing/`), so the contract here is this
README and the comments in the CSS.

Two rules that are easy to break by accident:

- **Never write ``className={`base ${cond ? " mod" : ""}`}``.**
  `prettier-plugin-tailwindcss` normalises whitespace inside class strings and
  eats the leading space, silently producing `basemod`. Use the local `cx()`.
- **One language on screen at a time.** `Bi` values are read as `value[lang]`;
  stacking both languages on a slide is what the switch exists to avoid.

## Stage behaviour worth knowing

- **Fixed 1280×720 canvas, scaled by transform.** The slide is composed once and
  every projector gets the same picture. Type is sized in canvas pixels on
  purpose — the scale factor does the responsiveness.
- **Nothing is clipped.** After each render the frame measures the composed
  block and shrinks only what does not fit (floor 0.72). Portuguese runs about a
  third longer than Chinese, so the same slide needs different room.
- **Presenter window** (`?apresentador=1`, or the button, or `N`): the script,
  the stage directions, the optional cuts and a clock that says whether she is
  ahead of or behind the block's time range. The two windows sync over a
  `BroadcastChannel`; a window that joins asks for the current state rather than
  broadcasting its own.
- **The timer reads the wall clock**, never accumulated `setInterval` ticks — a
  background tab throttles those, which is the same trap the clinical recorder
  documents in `apps/web/CLAUDE.md`.
- Position lives in the URL hash and the timer in `sessionStorage`, so a refresh
  mid-talk does not restart the presentation.

## Assets to drop before the talk

Everything below degrades to a composed placeholder, so the deck is presentable
without any of it. Availability is decided by probing the URL with a deadline,
because `next dev` answers a missing file with 200 and an HTML body and the
media `error` event never fires.

| Path                                                                   | Slide                         |
| ---------------------------------------------------------------------- | ----------------------------- |
| `public/videos/palestra/depoimento-1-alexander-assuncao.mp4`           | Bloco 6 · CNAA                |
| `public/videos/palestra/depoimento-2-hellen.mp4`                       | Bloco 7 · user                |
| `public/videos/palestra/depoimento-3-prof-francisco.mp4`               | Bloco 9 · Confucius Institute |
| `public/images/palestra/fundadora-debora.webp`                         | Slide 2                       |
| `public/images/palestra/fundador-bruno.webp`                           | Slide 2                       |
| `public/images/palestra/v1-{cadastro,agenda,anamnese,financeiro}.webp` | Slide 11                      |

`public/images/palestra/qr-medchina.svg` is a real, scannable QR for
`medchina.com.br` — regenerate it if the domain changes.

## Confirm before the talk

- **Slide 12's numbers.** They come from the previous platform's database
  (1.046 registered professionals, 222 who paid). Pull the current totals from
  production and update `PLATFORM_STATS`.
- **The domain and e-mail** on the closing slide (`CONTACT` in `slides-data.ts`)
  — the repo has no committed `NEXT_PUBLIC_SITE_URL`.
