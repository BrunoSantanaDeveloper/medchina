# Design direction (committed) — the marketing look, persisted

**This file is the single source of the public site's visual direction.** The `marketing-page` skill READS it and builds within it. It is durable design memory: once committed, every new page, every edit, and every added section inherit these decisions so the whole site reads as one system.

## STRICT MODE — how this governs work

- **New page** → inherit everything below. Do NOT re-run the direction engine.
- **Edit an existing page** → follow this file; do not restyle.
- **Add or change a section** → the new section obeys this file AND you run a **whole-page coherence pass**: every existing section must stay aesthetically aligned with the new one and pass the premium bar. If new work raises the bar, bring the older sections up — never ship a page half at the old level and half at the new.
- **Redesign** (changing the direction itself) happens ONLY when the user explicitly asks ("redesign" / "nova direção"). That request rewrites this file first; then pages follow the new version.

Derived projects: `/init-project` rewrites this file when the brand direction is committed. The values below are the flyee template's own reference direction — replace them, keep the shape.

---

## Committed direction

| Field | Decision |
|---|---|
| **Direction** | Premium SaaS / Data-driven (see `.claude/skills/marketing-page/references/directions.md` #1) |
| **Why** | Multi-tenant admin platform sold to teams; the product IS data and control surfaces, so the site must read as a serious, expensive tool — not a brochure. |
| **Display type** | Urbanist (geometric sans), loaded via `next/font` as `--font-heading`; marketing `font-display` resolves to it. Tight tracking, extrabold at the top of the fluid scale. |
| **Body type** | Mulish (`--font-body`), 16–18px, line-height 1.5+. |
| **Numbers** | Tabular/extrabold in the display face for `StatBand` and KPIs — data credibility. |
| **Palette usage** | Dark-first, **harmonic — never monochrome**. Primary is reserved for CTAs and the bold moment (hero glow + data viz main series). Categorical elements use the theme's harmonic hues via `tone` (`secondary`, `accent-1..4`): plan tiers, feature families, chart comparison series, icon chips — each family keeps ONE consistent hue across the whole site. Quiet base (neutral surfaces, hairline borders); never more than one saturated focus per viewport. |
| **Depth treatment** | `Section decor="glow"` on the hero; `decor="grid"` on one technical/feature section; `dots`/`mesh` on quieter chapters; one `background="contrast"` band (StatBand); one `orbit` on the closing CTA. The background MUST change ≥2× down the page. |
| **Layout archetypes** | Hero `layout="split"` + **`<ProductComposition>`** (layered frame + floating satellite chips); `<FeatureRows>` zig-zag for depth features; ONE breakout moment (`<Band angle>` or `<Breakout side>`); `<BentoGrid>` for secondary; `<StatBand>` for proof. Never centered-stack + equal-card-grid all the way down, never a flat single-rectangle hero. |
| **Signature element** | The **layered `<ProductComposition>`**: a central data-viz/screenshot frame with floating KPI/trend/readout satellite chips overlapping its edges — product evidence above the fold, always, and never a flat rectangle. A naked text hero is a direction violation. |
| **Imagery** | Real screenshots via `<ProductShot>` when they exist (pipeline: `npm run shots:marketing`); until then the token `<ProductFrame>`/`<DataVizPlaceholder>` frame inside `<ProductComposition>`. Same `-dark` pair convention. |
| **Motion** | One orchestrated hero timeline (staggered copy → frame rise → satellites pop via GSAP `useGSAP`); **ambient layer**: floating satellites, `<CountUp>` stat numbers, one desktop `<Parallax>` on a breakout, one `orbit` decor. Quiet `<Reveal>` elsewhere; chart draws on viewport entry. Budget ≤4 Float + ≤2 Parallax; all reduced-motion safe. |

## Premium bar (must all pass before shipping any page)

1. Product evidence above the fold.
2. ≥2 layout archetypes beyond the centered stack.
3. Background changes ≥2× along the scroll.
4. 1440px density check: no viewport >50% empty.
5. One orchestrated motion moment + a runtime scroll pass (no `<Reveal>` left un-fired).
6. Display typography is the committed display font, not the raw admin font.
7. Harmonic palette in use: at least two hues beyond primary, purposefully mapped (tiers/families/series), via the `tone` prop — never a 100%-primary page and never hues outside the tokens.
8. Show, don't tell: text-heavy sections carry a glance-able visual (meaningful icon, figure, chart or conceptual illustration); feature/step cards lead with a meaningful icon in the family hue — no wall of title+paragraph cards.
9. The hero media is a LAYERED `<ProductComposition>` (≥2 satellite chips) or a real screenshot — never a flat single rectangle.
10. ≥1 breakout / full-bleed moment (`<Band>` or `<Breakout>`) — the page does not live entirely inside the container.
11. Ambient motion present but restrained (Float / CountUp / one Parallax / one orbit), within budget and reduced-motion safe.

## Reference ingredients

<!-- marketing-page Pass 0.R writes here when the user drops reference screenshots in attachments/. Structural ingredients only (composition, depth, breakout, imagery, motion) mapped to library primitives — never copied hex/fonts. -->
_None ingested yet._

## Open items (template baseline)

- The home page implements this direction end to end (layered ProductComposition hero + satellites, FeatureRows zig-zag with decor="grid", one Breakout with parallax, BentoGrid, oversized counting StatBand, orbit-decor CTA, ambient floats — family→hue mapping documented in `app/(marketing)/page.tsx`). It is the reference implementation new pages read.
- `/pricing`, `/about` and `/contact` are supporting pages: structurally compliant (single h1, metadata, primitives, lead-section glow) but intentionally quieter than the home. Deepening them further is a normal edit governed by this file.
- Real product screenshots ship via the `shots:marketing` pipeline once a project can reach its product; the template's reference home stays on the layered composition + token placeholder frame by design (fresh-clone dashboards are auth-gated).
