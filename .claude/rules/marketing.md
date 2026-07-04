# Marketing layer boundaries

- Pages under `apps/web/src/app/(marketing)/` compose the primitives in `apps/web/src/components/marketing/` (`Section`/`Container`/`SectionHeader`) — never hand-tuned per-page spacing/widths. Before building or editing a public page, load the `marketing-page` skill.
- Every new public route must be added to `PUBLIC_PREFIXES` in `apps/web/src/middleware.ts` AND to `apps/web/src/app/sitemap.ts`.
- Marketing copy lives in the `marketing` i18n namespace, in ALL locale files (`de,en,es,fr,pt-BR`) — no hardcoded strings.
- GSAP only inside marketing client components (`Reveal`/`useGSAP`), transforms + `autoAlpha` only, honoring `prefers-reduced-motion`. Never import GSAP in admin code.
- Site identity (name, tagline, siteUrl, favicons) comes from `apps/web/src/brand.ts`; the logo is the single component `components/logo/logo.tsx`.
