---
name: marketing-page
description: Design/copy playbook for public marketing pages (landing pages, pricing, about, any page under apps/web/src/app/(marketing)). Use BEFORE creating or substantially editing any public-facing page — it prevents generic "AI slop" design and copy by forcing a committed design direction, conversion-mapped structure and jargon-free copy (EN + pt-BR rules).
---

# Marketing page playbook

You are designing a public page that must convert visitors, not decorate a template. Work like a boutique studio lead: make deliberate, opinionated choices specific to THIS product — never reach for the statistically-common default.

## Process: two passes, then code

**Pass 1 — Commit to a direction (before any code).** Write down: how the theme palette will be used on this page (where the one bold moment lives), the type treatment (display scale usage, hierarchy), the layout concept, and ONE signature element that makes the page recognizably this product's. **Spend your boldness in one place** — keep everything around it quiet and disciplined.

**Pass 2 — Critique against the brief.** Re-read the plan: which choices would appear on any generic SaaS page regardless of subject? Replace them. Only then build.

## Anti-slop list (never ship these)

- The three default clusters: warm-cream + serif display + terracotta; near-black + acid accent; broadsheet hairlines with zero radius.
- **This repo's own failure mode: admin widgets stretched into a landing page.** Marketing pages use the marketing library, never dashboard cards/stat tiles as hero content.
- Templated hero = big stat + purple gradient. Open instead with the most characteristic thing in this product's world (usually a real product screenshot in `<ProductFrame>`).
- Scattered scroll effects on everything. One orchestrated moment lands harder.
- Numbered markers (01/02/03) unless the sequence carries real information.

## Hard constraints (non-negotiable, enforced by review)

- **Structure:** every content block sits in `<Section>` / `<Container>` / `<SectionHeader>` from `apps/web/src/components/marketing/` — never hand-tuned paddings, widths or `max-w-*` per page. New sections extend the library, not the page.
- **Tokens only:** colors/radii/shadows via `hsl(var(--token))` Tailwind classes; spacing/type/motion via the marketing tokens (`packages/design-tokens/css/marketing.css`). The page must look right in all 4 color themes × light/dark.
- **Type:** headings use `font-display text-display-{2xl,xl,lg,md}` (fluid clamp scale — no `text-[3rem] md:text-[5rem]` breakpoint jumps). Optional display font: load in root layout, set `--font-display`.
- **i18n:** every string through the `marketing` namespace in ALL locale files (`de,en,es,fr,pt-BR`). No hardcoded copy.
- **Icons:** the template ships more than one icon set (Nexture native; Phosphor and others via adapters — see `apps/web/src/icons/README.md`). The set is a per-project decision made once (init-project or tsconfig alias remap), NOT per page. Pages always import through the alias `@/icons/nexture/ni-*` regardless of the chosen set, and never import an icon library (Phosphor, Lucide, MUI icons) directly. If the project hasn't decided yet, ask before the first page — don't mix sets.
- **Responsive:** mobile-first — the base layout is the phone; breakpoints only add columns/space. No horizontal scroll at 375px. Verify 375/768/1440.
- **Routes:** a new public page must be added to `PUBLIC_PREFIXES` in `apps/web/src/middleware.ts` and to `apps/web/src/app/sitemap.ts`, and export its own `metadata`/`generateMetadata`.

## Conversion structure (the home/landing formula)

Map every section to a funnel stage; a section that serves no stage gets cut:

1. **Hero — attention + value proposition.** Above the fold answers: what it is, for whom, the outcome. ONE primary CTA per page; its label is the conversion action and repeats verbatim at every action point (hero → pricing → final CTA). Secondary actions are visually subordinate (pastel/text variants).
2. **Logo cloud / testimonials — trust.** Testimonial quotes carry a concrete outcome (numbers, before/after), never vague praise.
3. **Feature grid — desire.** Titles are benefit-led (the customer's outcome), never internal feature names.
4. **Pricing — action.** Real plans via `getDisplayPlans()` (`app/(marketing)/plans.ts`); highlight one anchor plan.
5. **FAQ — objection handling.** Each question is a REAL purchase objection (price, lock-in, security, migration), answered plainly.
6. **Final CTA — recovery.** Repeats the primary CTA verbatim.

## Copy rules

- Words exist to make understanding easier. Active voice, plain verbs, conversational tone. Read it aloud: if it sounds like a press release, rewrite it.
- Benefit-led headlines: the outcome, not the feature name. Specificity beats superlatives — numbers and concrete results, never "revolutionary".
- One idea per section: headline + max 2 supporting lines, scannable.
- Consistent action names: the same button does the same thing with the same label everywhere.

**Banned AI-copy patterns — English:** "unlock", "elevate", "empower", "seamless", "robust solutions", "supercharge", "game-changing", empty triads ("fast, easy and secure"), "it's not just X, it's Y", em-dash chains, exclamation marks in body copy.

**Banned AI-copy patterns — português (pt-BR):** "desbloqueie", "eleve/potencialize/impulsione seu negócio", "soluções inovadoras/completas/robustas", "sem esforço", tríades vazias ("rápido, fácil e seguro"), a fórmula "não é apenas X, é Y", gerundismo ("estaremos enviando"), "alavancar", traduções literais do inglês ("sem costura"), excesso de travessões e exclamações. Escreva como um especialista brasileiro falaria com um cliente — não como material de imprensa.

## Imagery

- Real product screenshots inside `<ProductFrame>` beat any decorative stock photo. The template ships zero stock photos — placeholders are token-driven (CSS gradients, tinted inline SVG) so they follow every theme.
- Static assets: `apps/web/public/images/marketing/`, rendered with `next/image` (explicit `width/height`/`sizes`, translated `alt`). Dark variants via `-dark` suffix + `dark:` class. Hero media budget ~200KB; lazy-load below the fold.
- One consistent visual treatment per page (single tint/duotone from tokens) — not a collage of styles.
- AI-generated assets (Higgsfield, MCP image tools, etc.) are a per-project choice: generated files enter through `public/images/marketing/` and follow the exact same conventions.
- **No generation tool available? Deliver the prompt instead.** When the session has no image/video generation capability, produce a complete, ready-to-paste generation prompt for the user to run in their tool of choice, and leave the page working with the token-driven placeholder meanwhile. The prompt must specify: subject and composition; style aligned with the page's design direction (reference the theme's primary color values from `packages/design-tokens`); exact dimensions and aspect ratio; file format; light and dark variants when applicable; the target path under `public/images/marketing/`; and the translated `alt` text to add. The user generates the asset and drops it in — nothing else on the page should need to change.

## Motion

- Only through `<Reveal>` (`components/marketing/reveal.tsx`) or a GSAP `useGSAP` block in a client component. Transforms + `autoAlpha` only — never animate width/height/top/left.
- Wrap in `gsap.matchMedia()` honoring `prefers-reduced-motion: reduce` (static and fully visible). Degrade heavy scroll animation on touch devices.
- Durations/easing/distance come from the motion tokens. ScrollTrigger plays once, near-viewport start.
- For GSAP API details, defer to the installed `gsap-*` skills (`.claude/skills/gsap-*`).

## Before finishing

Walk the page at 375px, 768px, 1440px; toggle dark mode and at least two color themes; emulate reduced motion; confirm every string resolves in all 5 locales; run `npm run build` and `npm run lint:fix`.
