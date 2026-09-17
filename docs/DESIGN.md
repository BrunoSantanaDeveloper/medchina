# Design direction (committed) — the marketing look, persisted

**This file is the single source of the public site's visual direction.** The `marketing-page` skill READS it and builds within it. It is durable design memory: once committed, every new page, every edit, and every added section inherit these decisions so the whole site reads as one system.

**Scope note (2026-08-11 — REVISED, supersedes the 2026-07-26 note):** the public site runs **two design systems**, and which one applies is decided by what the page is FOR, not by when it was built:

| Page kind | Design system | Examples |
|---|---|---|
| **Landing / offer / external-facing pages** — anything a campaign, an event or an ad points at | **The MedChina Landing DS** (`clinical-source-home.tsx` + `clinical-source-home.css`) — see "The Landing DS" below | `/` (home), `/fundadores`, and every future landing, offer or campaign page |
| **Informational / institutional pages** — the site's own reference material | **The marketing component library** (`components/marketing/*`), governed by the "Cuidado Sereno" table below | `/como-funciona`, `/recursos`, `/planos`, `/seguranca`, `/migracao`, `/sobre`, `/contato`, `/ajuda`, `/blog`, `/legal/*` |

The previous version of this note had it backwards: it declared the library the default for "any future public route" and framed the home as a one-off exception that must never become a precedent. The user's decision on **2026-08-11** inverts that for the pages that carry commercial weight — a landing page that does not look like the home is a landing page that looks like a different company. The library is not deprecated; it keeps the institutional pages, where its structure and i18n discipline are the right tool.

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
- The trial starts at the first WORKING action of any kind (recording, scheduling, importing charts, using the library — migration 0084), never at sign-up, and never needs a card. Do not write "only at the first AI consultation": that was true before 0084 and is now a promise the product breaks for whoever starts by importing her charts.
- The mobile app is always "complementar" to the web platform; no purchase language for the app.
- No fabricated metrics, testimonials, logos or seals (HOME-SPEC §33.5) — plan facts (minutes, trial length, price hypotheses) are the only numbers allowed, loaded from configurable data.
- Mockup data is always fictitious (patient "Helena Martins").

## Reference ingredients

<!-- marketing-page Pass 0.R writes here when the user drops reference screenshots in attachments/. Structural ingredients only (composition, depth, breakout, imagery, motion) mapped to library primitives — never copied hex/fonts. -->
_None ingested — direction chosen from generated candidates (A · Cuidado Sereno; previews in the session artifact)._

## The Landing DS — `ClinicalSourceHome` (decided 2026-07-26 as an exception, PROMOTED to the landing standard 2026-08-11)

**Every landing, offer, campaign and event page is built in this system.** Not "may be" — is. A visitor who arrives from an ad, a QR code at a congress or a WhatsApp link must land on something that looks like the MedChina she will see next; a landing composed from the generic library next to a home built like this reads as two different products.

### What the system IS (use these, they already exist)

- **The stylesheet is the DS.** `app/(marketing)/clinical-source-home.css` (~3.900 lines) defines a global class vocabulary — `.section`, `.section-heading`, `.eyebrow`, `.button` (`--sm`/`--secondary`/`--light`), `.hero`, `.price-card`, `.plan-*`, `.faq-section`, `.final-cta`, `.check-list`, `.site-footer` — almost none of it scoped under `.clinical-source-home` (only 2 references in the whole file). A new landing page **imports this stylesheet and composes those classes**; it does not invent per-page CSS beyond what its own sections genuinely need.
- **Icons**: direct `@phosphor-icons/react` imports, `weight="duotone"` for feature/section marks, `weight="fill"` for status ticks. NOT the `@/icons/nexture/ni-*` alias.
- **Copy**: hardcoded pt-BR. Landing pages sell to one market; routing campaign copy through six locale catalogs buys nothing and slows every edit.
- **Colour**: the CSS custom properties of the DS (`--jade`, `--mint`, `--blue`, `--coral`, `--ink`…), not `hsl(var(--token))`.
- **Imagery**: real photography and real product screenshots from `public/images/medchina-*.webp`.
- **Commercial data is still DATA**: prices, limits and plan copy come from the database through `getDisplayPlans()` (fixed 2026-08-10, decision D12 in `docs/FUNIL.md`) — the DS governs the LOOK, never the numbers.

### What still applies, unexempted, to every page in this system

Exactly one `<h1>`; real `alt` text; **no fabricated testimonials, metrics, logos or seals** (HOME-SPEC §33.5 — still blocking); the clinical-safety copy guardrails below; honest scarcity (a counter or deadline must derive from server state — `docs/FUNIL.md`); and performance hygiene (explicit image dimensions, `loading="lazy"` below the fold, WebP).

### The lint contract

`.claude/hooks/marketing-lint.mjs` exempts this system from the token/icon-import/hardcoded-copy checks via `LANDING_DS_EXCEPTIONS` — matched by **path**, so `app/(funil)/**` and the two `clinical-source-home.*` files qualify automatically and a new landing page needs no edit to the hook. Everything outside those paths still enforces the full library contract.

### History (why this file used to say the opposite)

`app/(marketing)/page.tsx` renders `<ClinicalSourceHome />` (`components/marketing/clinical-source-home.tsx`, ~1200 lines, `"use client"`) with its own route-owned stylesheet (`app/(marketing)/clinical-source-home.css`, ~3900 lines). It is a **self-contained, hand-tuned port** of an externally built reference (`attachments/medchina-clinica/` — since removed, the port having been judged approved), not a composition of the primitives above:

- Its own header/footer (not `MarketingHeader`/`MarketingFooter`), own CSS custom properties (`--jade`, `--mint`, `--blue`, `--coral`, `--ink`…) instead of `hsl(var(--token))`, its own `@font-face` declarations instead of `next/font`.
- Icons via direct `@phosphor-icons/react` imports, not the `@/icons/nexture/ni-*` alias.
- Copy is hardcoded pt-BR, not routed through the `marketing` i18n namespace.
- Real photography (`public/images/medchina-*.webp`) instead of token-driven mocks.

**Why this exists:** the user had this file built as a literal, pixel-tuned port of an external reference and judged it materially better — "muito baixo nível" was their verdict on composing it from the generic shared primitives instead. On 2026-07-26 they made it explicit: keep this file's UI/UX intact; where a project rule would otherwise force a "drastic" rewrite, change the rule instead of the page.

**2026-08-11 — the exception became the rule for landing pages.** The 2026-07-26 text closed with "do not extend the exception to a new file without the same explicit call — it is a named exception, not a precedent." That explicit call was made: landing and external-facing pages now follow this system by default (see "The Landing DS" above). The hook's allowlist was widened from two filenames to a path rule so the standard does not need a code edit every time a campaign page is created.

**What still applies to this file, unexempted:** exactly one `<h1>`, real `alt` text, no fabricated testimonials/metrics/logos (HOME-SPEC §33.5 — still blocking, see the audit below), the clinical-safety copy guardrails (never imply autonomous diagnosis, trial never automatic, mobile app always "complementar"), and ordinary performance hygiene (explicit image dimensions, `loading="lazy"` below the fold, WebP over PNG) — all verified/fixed 2026-07-26 during the ad-landing-page quality audit.

**Known gaps, accepted as-is (not "necessary" fixes — would touch UI/UX or scope creep beyond the audit):** no dark-mode CSS (`prefers-color-scheme`/`.dark` are unhandled — the page renders identically regardless of the site's theme mode; harmless now that light is the default, see `apps/web/src/config.ts`); no `SoftwareApplication`/`Organization` JSON-LD on this route (present via the root layout only); the manual scroll-linked flow-timeline animation isn't GSAP/`<Reveal>` (it already has its own `prefers-reduced-motion` branch, so it isn't unsafe — just off-pattern).

**Orphaned in place:** the previous library-composed home (`ConsultationDuo`, `MobileSequence`, `WorkflowDemo`, `Comparison`, `RuledGrid`, `IndexGrid`, `AnamnesisDemo`, `TraceabilityDemo`, `NumberStrip`, plus the `Hero`/`PricingSection`/`Faq`/`Cta`/`Section` prop additions and the 5-locale i18n keys they consume) remains on disk, unused by any route. Kept rather than deleted since the components are individually reusable (several are already good candidates for other pages) and the i18n keys are harmless; nothing currently imports them. Revisit if they go stale.

Width note: `--container-max: 77.5rem` (1240px) in `packages/design-tokens/css/marketing.css` is committed site-wide (both this page's own CSS and the shared `Container` respect it).

## Open items

- Supporting pages (`/como-funciona`, `/recursos`, `/planos`, `/seguranca`, `/migracao`, `/sobre`, `/contato`) compose the shared library per the direction above and are unaffected by the home exception.
- **Social proof is still missing on the home** (HOME-SPEC §33.5 blocks fabricating it): needs real testimonials/case data/usage numbers from the legacy (pre-AI) product's existing user base — see the 2026-07-26 audit note for exactly what to gather.
