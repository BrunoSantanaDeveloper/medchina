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
| `deck-sync.ts`                    | Cross-device sync: transport choice, room code, connect/publish                   |
| `deck-connect.tsx`                | The QR panel that pairs the phone                                                 |
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

## The phone teleprompter (QR sync)

She reads the script from her phone while the laptop drives the projector. The
**Celular** button (or `C`) on the projector opens a QR; scanning it lands the
phone on `?apresentador=1&sala=<code>`, already following the deck. Both sides
can navigate — the phone's thumb bar and the laptop's keys drive the same state.

**A device that joins ASKS where the talk is.** The projector is the source of
truth: it publishes on connect and answers newcomers. The phone only asks. This
is the whole reason the QR can be scanned at minute twenty without the projected
deck jumping back to slide 1.

Two transports, picked from the hostname so the on-screen status is never a
guess (`deck-sync.ts`):

| Deck opened on                                      | Transport                                 | Notes                                                     |
| --------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| a private address (`192.168.x.x`, `10.x`, `.local`) | **`lan`** — this app's own SSE endpoint   | no internet, no third party; the setup to prefer on stage |
| a public address (the Vercel deploy)                | **`cloud`** — Supabase Realtime broadcast | needs internet on both devices                            |

`/api/public/palestra/sync` keeps its rooms in module memory, which is right for
one Node process and wrong on serverless — so it **refuses with 501 on Vercel**
rather than accepting a connection it cannot fan out. A sync indicator that might
be lying is worse than none.

Practical notes for the day:

- **`localhost` cannot be scanned.** Only that laptop resolves it, so the panel
  says so and names the fix: reopen the deck on the network address the dev
  server prints.
- **Prefer the phone's hotspot.** Congress guest Wi-Fi often isolates clients
  from each other, which breaks LAN sync; putting the laptop on the phone's
  hotspot puts both on one network and needs no internet at all.
- The phone holds a **Wake Lock** so the screen does not sleep mid-block, and
  re-acquires it after every tab switch (browsers drop it silently).

## Charts

Three, each picked by what the data has to do — and stopping there. The other
number slides are KPI rows, which is the correct form for a handful of headline
figures; a chart there would be decoration.

| Slide           | Form                                                        | Why                                                                                                                                                     |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10 · the survey | horizontal bars on a shared 0–100% axis                     | four percentages off ONE base (3.800 respondents); as separate cards the reader had to compare them in their head, and the comparison _is_ the argument |
| 6 · the law     | milestone rail, markers at their real share of elapsed time | makes "22 anos" visceral — the 16-year silence before the Chamber vote takes most of the rail                                                           |
| 12 · paid plans | meter                                                       | 222 means nothing without its denominator (of 1.046)                                                                                                    |

**Drawn by hand, not with `@mui/x-charts`** — which IS installed and licensed
(MUI X Premium) and is the right tool for the product's dashboards and patient
evolution charts. On a projected slide it would be the wrong trade: no tooltip,
legend or axis machinery is wanted, the deck needs its own display face and
colours, and the fixed canvas scales a CSS bar perfectly. Three CSS forms cost
less than theming a chart library into a design system it does not share.

Colour was **validated, not eyeballed**, with the dataviz skill's checker
against the deck surface:

- the brand `--jade` FAILS the chroma floor as a fill (0.079 — "reads gray"),
  which is why bars run `--jade → --mint` instead of flat jade;
- `--mint` ↔ `--coral` passes CVD separation (ΔE 9.3) and normal vision (28.3);
- both sit under 3:1 against the surface, so **every bar carries a visible value
  label** — that is the required relief, not decoration.

Coral marks the 6,8% as _emphasis within one series_, never as a second
category, and values wear text tokens rather than the bar colour.

## Assets to drop before the talk

Everything below degrades to a composed placeholder, so the deck is presentable
without any of it. Availability is decided by probing the URL with a deadline,
because `next dev` answers a missing file with 200 and an HTML body and the
media `error` event never fires.

| Path                                                                   | Slide          |
| ---------------------------------------------------------------------- | -------------- |
| `public/videos/palestra/depoimento-1-alexander-assuncao.mp4`           | Bloco 6 · CNAA |
| `public/videos/palestra/depoimento-2-hellen.mp4`                       | Bloco 7 · user |
| `public/images/palestra/fundadora-debora.webp`                         | Slide 2        |
| `public/images/palestra/fundador-bruno.webp`                           | Slide 2        |
| `public/images/palestra/v1-{cadastro,agenda,anamnese,financeiro}.webp` | Slide 11       |

`public/images/palestra/qr-medchina.svg` is a real, scannable QR for
`medchinaprontuarios.com.br` — regenerate it if the domain changes.

## Confirm before the talk

- **Slide 12's numbers.** They come from the previous platform's database
  (1.046 registered professionals, 222 who paid). Pull the current totals from
  production and update `PLATFORM_STATS`.
- **The domain and e-mail** on the closing slide (`CONTACT` in `slides-data.ts`)
  — the repo has no committed `NEXT_PUBLIC_SITE_URL`.
