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
| `slides-data.ts`                  | All content: the 22 steps plus the per-slide payloads (timeline, stats, columns…) |
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

## Video: two kinds, and they behave differently

`SlideMediaSpec` is a union, because on stage a video is one of two things.

A **testimony** (`kind: "testimony"`) is watched: a speaker, a running time,
controls, and Debora stops talking until it ends. That is Hellen's depoimento in
Bloco 7 — the only one left in the deck.

An **ambient** clip (`kind: "ambient"`) is not watched, it runs. The slide where
she starts presenting the platform (roteiro 13, "Atenda olhando para o
paciente") carries a screencast of a real consultation, muted, looping, without
controls, while she delivers the motto over it. Only the current slide is mounted, so entering the slide starts the
clip and leaving it stops it; there is no video playing three slides away, and
coming back starts it over.

Three things it will not fake:

- **the speed is on the slide.** The clip is sped up, and a consultation
  replayed at speed with no word about it claims a pace the product does not
  have. `caption` says so in the projected language, and the teleprompter line
  says it out loud.
- **a blocked autoplay says so.** Muted autoplay is allowed everywhere this
  deck runs, but a policy or an extension can still refuse it; `play()` is the
  only honest test, and a refusal renders a play affordance instead of standing
  frozen on frame one.
- **`prefers-reduced-motion` is honoured** by handing her the controls — not by
  hiding the clip. On a machine that asked for less movement a loop she did not
  start is the wrong default, and an empty frame is worse. If the projector
  laptop has that setting on, that slide shows the first frame with controls and
  she presses play.

`aspect` on the spec is the geometry of the PICTURE, not of the file: a screen
recording usually arrives padded into a standard frame (this one is 1920×1080
around a 1920×879 window, with a 100px black band baked in above and below).
The window body is framed on the picture and `object-fit: cover` crops the
padding away, because a projected slide showing someone else's letterbox reads
as a mistake — and it would be the only pure black on screen.

**`/videos` is skipped by the middleware** (`src/middleware.ts`), the same way
`/images` is. Without that line every `<video>` on this deck answered a 307 to
`/auth/sign-in`: a file under `public/` has no session to refresh, and the deck
is meant to be openable with nobody signed in.

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

## Assets

`public/videos/palestra/consulta-acelerada.mp4` (1920×1080, 55s, 17 MB) is the
only media that SHIPS with the deck — the accelerated consultation on slide 15.
It is committed on purpose: the slide is built around it, and an asset that has
to be remembered on the day is an asset that will be missing.

Everything below is dropped in before the talk and degrades to a composed
placeholder until then, so the deck is presentable without any of it.
Availability is decided by probing the URL with a deadline, because `next dev`
answers a missing file with 200 and an HTML body and the media `error` event
never fires.

| Path                                                                   | Slide    |
| ---------------------------------------------------------------------- | -------- |
| `public/images/palestra/v1-{cadastro,agenda,anamnese,financeiro}.webp` | Slide 11 |

**Hellen's testimony is served off the site**, not from `public/`:
`https://medchinaprontuarios.com.br/depo-hellen.mp4`. The file is 149 MiB and
GitHub refuses any blob over 100 MiB, so it cannot live in the repo — the local
copy is gitignored. Two consequences:

- **it needs internet in the room.** Everything else on this deck runs from the
  laptop; this one slide does not. Open the URL on the venue's wi-fi before
  going on stage, and remember the recommended setup (the phone's hotspot) is
  what makes it work when the guest network does not.
- **a remote source is not probed.** `useAssetAvailable` only HEAD-probes local
  files: a cross-origin probe needs CORS headers the host may not send, and a
  blocked probe cannot be told apart from a missing file, which would hide a
  video that is perfectly there. Off-origin sources render straight away and
  fall back to the composed standby card on the element's `error` event.

`public/images/palestra/qr-medchina.svg` is a real, scannable QR for
`medchinaprontuarios.com.br` — regenerate it if the domain changes.

## Confirm before the talk

- **Slide 12's numbers.** They come from the previous platform's database
  (1.046 registered professionals, 222 who paid). Pull the current totals from
  production and update `PLATFORM_STATS`.
- **The domain and e-mail** on the closing slide (`CONTACT` in `slides-data.ts`)
  — the repo has no committed `NEXT_PUBLIC_SITE_URL`.
- **Watch the consultation clip through once on the venue's projector.** It is a real
  recording of a real consultation: the interface in it is in Portuguese (the
  product has no Chinese locale), and the patient data in it is whatever was on
  screen when it was recorded. Both are hers to accept or to re-record.
