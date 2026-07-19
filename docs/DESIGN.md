# Design direction (committed) — the marketing look, persisted

**This file is the single source of the public site's visual direction.** The `marketing-page` skill READS it and builds within it. It is durable design memory: once committed, every new page, every edit, and every added section inherit these decisions so the whole site reads as one system.

## STRICT MODE — how this governs work

- **New page** → inherit everything below. Do NOT re-run the direction engine.
- **Edit an existing page** → follow this file; do not restyle.
- **Add or change a section** → the new section obeys this file AND you run a **whole-page coherence pass**: every existing section must stay aesthetically aligned with the new one and pass the premium bar. If new work raises the bar, bring the older sections up — never ship a page half at the old level and half at the new.
- **Redesign** (changing the direction itself) happens ONLY when the user explicitly asks ("redesign" / "nova direção"). That request rewrites this file first; then pages follow the new version.

---

## Committed direction — "Cuidado Sereno" (chosen by the user from 3 visual candidates, 2026-07-13)

| Field | Decision |
|---|---|
| **Direction** | Health / Care / Trust (see `.claude/skills/marketing-page/references/directions.md` #3), tuned to the MedChina brand manual and PRD §16 ("sofisticação, acolhimento, silêncio visual, precisão clínica"). |
| **Why** | The buyer is an autonomous TCM practitioner deciding whether to trust an AI with her patients' clinical records. The page must feel like her practice — calm, warm, precise — not like a tech dashboard. Trust and clinical control are the conversion levers. |
| **Display type** | **TT Chocolates** (brand manual, commercial) via `next/font/local` as `--font-display`, weights 500/700/800 (`apps/web/src/fonts/tt-chocolates/`). Warm humanist sans — headings at the fluid display scale, bold, `tracking -0.02em`. |
| **Body type** | Mulish (`--font-body`), 16–18px, line-height 1.6. |
| **Palette usage** | Light-first over the warm Parchment ground (`--background: 34 20% 97%`). **Teal primary** carries CTAs and the single bold moment per page. **Camel secondary** is the warmth layer: eyebrows, editorial accents, and the metallic-gradient moments (mirrors the logo's "China" gradient — use sparingly, one per page max). Categorical families map to accents with ONE consistent meaning site-wide: **jade `accent-1` = evidência clara / gratuito-manual**, **slate `accent-2` = organização / plataforma-web**, **terracotta `accent-3` = requer atenção / gravação ao vivo**, **plum `accent-4` = inferência da IA / Pro**. Grey-olive neutrals for "não informado". **Red is reserved for risk/error only** (PRD §16.1) — terracotta covers "attention", never red. |
| **Depth treatment** | Soft and airy: `decor="gradient-edge"` transitions between chapters, `decor="glow"` (teal, low alpha) on the hero, one `background="contrast"` elevated band per page (the library's tinted band with hairlines — the mobile/operational-trust chapter), `dots` on one quiet chapter. The bold moment is the hero glow + primary CTAs (teal). Generous radii (`--border-radius-xl+`), diffuse shadows (`shadow-lg`, never harsh). The background changes ≥2× down the page. |
| **Layout archetypes** | Hero `layout="split"` + **`<ProductComposition>`** (web anamnesis frame + phone-recording satellite chips — the product duo IS the story); `<FeatureRows>` zig-zag for the clinical-flow features; `<ProcessSteps variant="icon">` for the 4-step consultation flow; `<BentoGrid>` for the MTC specialization map; `<StatBand>` (deep teal) for plan facts; ONE breakout per page. Never centered-stack + equal-card-grid all the way down. |
| **Signature element** | The **consultation duo**: a phone "recording" card layered over/next to the web anamnesis frame, connected by the field-state language (Evidência clara / Requer atenção / Não informado as jade/terracotta/neutral chips). Field-state chips are the site's recurring motif — they appear in the hero, the anamnesis section and the traceability section, always with the same hues. |
| **Imagery** | Real product screenshots via `<ProductShot>` once `shots:marketing` can capture them; until then token-driven `<ProductFrame>`/composition mockups with FICTITIOUS data only (patient "Helena Martins", PRD §7.4 script). Linear/abstract illustrations inspired by flow/balance/continuity when a glyph can't carry the idea; **never** stock photos with white coats, caricatured Chinese symbols, robots or holograms (HOME-SPEC §7.3). |
| **Motion** | Gentle and slow (the PRD's "silêncio visual"): one orchestrated hero timeline (copy stagger → frame rise → satellites drift in) with `--motion-duration-3`-ish pacing; ambient layer = ≤3 `<Float>` satellites + `<CountUp>` on the plan numbers; quiet `<Reveal>` elsewhere. Nothing snaps. All reduced-motion safe. |

## Premium bar (must all pass before shipping any page)

1. Product evidence above the fold.
2. ≥2 layout archetypes beyond the centered stack.
3. Background changes ≥2× along the scroll.
4. 1440px density check: no viewport >50% empty.
5. One orchestrated motion moment + a runtime scroll pass (no `<Reveal>` left un-fired).
6. Display typography is TT Chocolates, not the raw admin font.
7. Harmonic palette in use: at least two hues beyond primary, purposefully mapped per the table above, via the `tone` prop — never a 100%-primary page and never hues outside the tokens.
8. Show, don't tell: text-heavy sections carry a glance-able visual (meaningful icon, figure, chart or conceptual illustration); feature/step cards lead with a meaningful icon in the family hue — no wall of title+paragraph cards.
9. The hero media is a LAYERED `<ProductComposition>` (≥2 satellite chips) or a real screenshot — never a flat single rectangle.
10. ≥1 breakout / full-bleed moment (`<Band>` or `<Breakout>`) — the page does not live entirely inside the container.
11. Ambient motion present but restrained (Float / CountUp / one Parallax), within budget and reduced-motion safe.

## MedChina-specific copy guardrails (blocking, from HOME-SPEC §2.3/§6.3 and PRD §10.10)

- Never say or imply the AI diagnoses, treats, prescribes autonomously or replaces the professional; use "hipótese", "sugestão", "preparado para sua revisão", "requer validação".
- Never promise "100% seguro/LGPD"; prefer "desenvolvido com requisitos de privacidade desde a concepção".
- The trial never reads as automatic — it starts only at the first real AI consultation, no card.
- The mobile app is always "complementar" to the web platform; no purchase language for the app.
- No fabricated metrics, testimonials, logos or seals (HOME-SPEC §33.5) — plan facts (minutes, trial length, price hypotheses) are the only numbers allowed, loaded from configurable data.
- Mockup data is always fictitious (patient "Helena Martins").

## Reference ingredients

<!-- marketing-page Pass 0.R writes here when the user drops reference screenshots in attachments/. Structural ingredients only (composition, depth, breakout, imagery, motion) mapped to library primitives — never copied hex/fonts. -->
_None ingested — direction chosen from generated candidates (A · Cuidado Sereno; previews in the session artifact)._

## Reference blueprint (committed 2026-07-19 from `attachments/medchina-clinical-source/` — HOME structure is FIXED)

The latest user-built source supersedes the 2026-07-15 composition. The production home follows this order while preserving the shared MedChina tokens, i18n, official chrome, clinical-safety language and catalog-driven prices.

| # | Reference section | Production mapping |
|---|---|---|
| 1 | Split hero with supervised-AI proposition and real web/mobile composite | `Hero layout="split"` + `ProductComposition` + supplied composite and localized floating readouts. |
| 2 | Four-column clinical-value strip | `Section background="contrast"` with four numbered trust statements. |
| 3 | Continuous three-step journey with real captures | `FeatureRows` + supplied consultation, anamnesis and plan images inside `ProductFrame`. |
| 4 | Deep clinical-presence chapter with benefit rail and consultation image | `Section background="deep"`; all benefits stay visible in a responsive grid beside the supplied image. |
| 5 | Mobile capture chapter | `Section background="paper" decor="mesh"` + supplied phone composition and four operational assurances. |
| 6 | Supervised evidence demo | Existing `AnamnesisDemo`, with canonical clear/attention/empty field states. |
| 7 | MTC specialization index | `IndexGrid` beside an editorial `SectionHeader`. |
| 8 | Deep security chapter | `Section background="deep"` + `RuledGrid variant="deep"`. |
| 9 | Pricing, FAQ and final CTA | `PricingSection` (live catalog) + `Faq layout="split"` + `Cta variant="deep"`. |

Assets are routed to `apps/web/public/images/marketing/clinical-home/`. Intentional deviations: the production page keeps the official shared header/footer, uses internal routes, and presents all clinical-presence benefits without requiring hover or client-side state.

### Previous blueprint (superseded 2026-07-19)

The user rebuilt the home externally and asked for the current home to follow it 1:1. Structure comes from the blueprint; identity (Teal/Camel tokens, TT Chocolates, Phosphor icons, `<Logo>`) stays ours. The reference has NO photos/images — every visual is a token-driven mock we rebuild as library components.

| # | Reference section | Our section (primitive + content source) |
|---|---|---|
| 1 | Sticky blurred header, 5 links, Entrar + CTA | `MarketingHeader` (existing) + hairline border. |
| 2 | Hero split (0.84/1.16): eyebrow, two-tone H1 (`t.rich` + `<em>` in primary), subtitle, 2 CTAs (secondary carries the play icon), microcopy, 4 highlight chips; visual = web record-panel + phone recording + orbit rings + dashed flow line + floating notes | `Hero layout="split"` + NEW `ConsultationDuo` — the reference canvas ported 1:1 (690×570, token colors, --duo-scale breakpoints, reduced-motion-safe pulse/wave/travel animations). Hero gained `highlights` + rich `title` + secondary `icon`. |
| 3 | Trust strip: 4 numbered columns with dividers on cream band | NEW `NumberStrip` (contrast band, camel display ordinals). |
| 4 | Interactive workflow demo: 4 tabs (Conversa/Anamnese/Análise/Plano), each a copy+evidence panel | NEW `WorkflowDemo` (client): tabbed panels — dialogue+audio strip, quote→field mapping, exception stack, plan review rows. |
| 5 | Before/After: split intro, two comparison cards joined by a bridge arrow | NEW `Comparison` + `SectionHeader align="start"`. |
| 6 | Benefits: ruled 3×2 grid, ordinal + abstract circle glyph per cell | NEW `RuledGrid`. Deviation: abstract CSS circles → meaningful Phosphor icons per family hue (premium bar #8); ordinals dropped (carry no information). |
| 7 | Mobile: dark band, copy + feature list + connection note, 3 fanned phone screens over a ring (agenda/recording/status) | `Section background="deep"` (NEW deep teal band) + NEW `MobileSequence` (reference fan canvas, --seq-scale) with `AgendaMock`/`RecordingMock`/`StatusMock` in `PhoneFrame`. |
| 8 | Anamnesis demo: fictional quote → arrow → prepared fields card with 3 states + investigation note | NEW `AnamnesisDemo` (quote block → connector → prepared-field rows + investigation footnote). |
| 9 | Clinical reasoning: intro + CTA right, 3 cards, safety line | `SectionHeader align="start"` + card row (RuledGrid `variant="cards"`) + safety footnote. |
| 10 | MTC specialization: copy left, 16-cell indexed 2-col ruled grid with accent cells | NEW `IndexGrid`. |
| 11 | Traceability: field-provenance demo card left, copy + 4-source legend right | NEW `TraceabilityDemo` (card + legend), field-state hues preserved. |
| 12 | Pricing: status line, 3 cards (middle highlighted), difference footnote | Existing `PricingSection` + NEW `tiers`/`footnote` props. Prices stay catalog-driven (`getDisplayPlans()`), per user decision. |
| 13 | Security: dark band, copy left + 4 ruled pillars | `Section background="deep"` + `RuledGrid variant="deep"`. |
| 14 | FAQ: two-column, sticky intro + accordion list | `Faq` + NEW `layout="split"` (subtitle + link). Deviation: ordinals dropped. |
| 15 | Final CTA: deep band, orbit rings, headline, CTA + demo link, 4 reassurance points | `Cta` + NEW `variant="deep"` (orbit decor, `points`, `secondaryCta`). |
| 16 | Footer: dark 4-column + clinical-responsibility legal note | `MarketingFooter` restyled to the deep band (disclaimer kept). |

Depth note: on the home, the blueprint's three deep moments (mobile band, security band, final CTA/footer) supersede the old "one contrast band" rule — expressed as the token `deep` background (`--primary-dark`), never a hardcoded ink.

Width note: the blueprint's page width is committed site-wide — `--container-max: 77.5rem` (1240px) in `packages/design-tokens/css/marketing.css`.

## Open items

- The home page (`app/(marketing)/page.tsx`) is the reference implementation of this direction, built section-by-section from `docs/HOME-SPEC.md` (order §8 is contractual).
- Supporting pages (`/como-funciona`, `/recursos`, `/planos`, `/seguranca`, `/migracao`, `/sobre`, `/contato`) are structurally compliant but quieter than the home.
- Real product screenshots ship via `shots:marketing` once the dashboards have real MedChina screens; until then the layered composition + token mockups (Helena Martins data) stand in.
