# Search direction (committed) — the SEO baseline, persisted

**This file is the single source of the public site's search direction.** The `marketing-page` skill READS it (the way it reads `docs/DESIGN.md`) when writing titles, descriptions and copy. It records two things: what the base template already guarantees for free, and the per-page target terms MedChina commits to.

---

## What the template guarantees automatically (do NOT re-implement)

These ship in the base and rebrand from `@flyee/content` — a new page inherits them without effort:

| Concern | Where |
|---|---|
| XML sitemap (public routes only) | `apps/web/src/app/sitemap.ts` |
| robots + sitemap pointer (crawlers blocked from app/api) | `apps/web/src/app/robots.ts` |
| `metadataBase` + `%s \| Brand` title template + favicons | `apps/web/src/app/layout.tsx` |
| Shared Open Graph image (token-driven, 1200×630) | `apps/web/src/app/(marketing)/opengraph-image.tsx` |
| `Organization` + `WebSite` JSON-LD (site-wide) | `apps/web/src/app/(marketing)/layout.tsx` |
| `FAQPage` JSON-LD (from the FAQ items) | `components/marketing/faq.tsx` |
| `Product`/`Offer` JSON-LD (from real billing plans) | `components/marketing/pricing-section.tsx` |
| One `<h1>` per page contract | `SectionHeader` `as` / `PricingSection` `headingAs` |

## What each page must still do (the on-page layer)

See the `marketing-page` skill's "SEO & discoverability" section — enforced by review:
exactly one `<h1>` (the page title), a localized title tag (target term + value, ~60 chars) and a distinct 150–160-char description via `generateMetadata`, answer-first copy, the target term in `<h1>`/title/slug/first sentence, internal links to the money page, and structured data via `<JsonLd>` for any new schema-eligible block.

## Per-page target terms (MedChina — pt-BR is the indexed language)

Source: `docs/PRODUCT.md` §26/§29 of `docs/HOME-SPEC.md`. Money pages first. Terms are used naturally — never stuffed (HOME-SPEC §29.4).

| Page | Primary term / intent | Funnel role |
|---|---|---|
| `/planos` | "prontuário eletrônico MTC preço" / "sistema para acupunturista planos" — commercial | **money page** — checkout entry |
| `/` (home) | "prontuário para Medicina Tradicional Chinesa" + brand; title: `MedChina \| Prontuário inteligente para Medicina Tradicional Chinesa` (HOME-SPEC §29.1) | brand + top-of-funnel |
| `/como-funciona` | "como funciona prontuário com IA" / "gravar consulta anamnese automática" — informational→commercial | education → demo → sign-up |
| `/recursos` | "sistema para acupunturista" / "anamnese MTC" / "plano terapêutico MTC" — commercial investigation | feature depth → plans |
| `/seguranca` | "prontuário eletrônico LGPD" / "segurança de dados clínicos" — trust investigation | objection handling |
| `/migracao` | brand + "migração versão anterior" — navigational (existing users) | support / retention |
| `/ajuda` | long-tail support queries (DB-managed articles) | support + topic cluster |
| `/blog` | topic cluster around "acupuntura prontuário", "gestão clínica MTC" (DB-managed) | authority growth |
| `/sobre` | brand + "sobre" | brand / navigational |
| `/contato` | brand + "contato" | navigational |
| `/legal/*` | none — not a ranking target | trust / compliance |

Structured data note (HOME-SPEC §29.5): the home may add `SoftwareApplication` via `<JsonLd>`; never mark up ratings, reviews or availability that are not actually published.

## Architecture constraints (decisions, not page edits)

- **Indexable language:** i18n is cookie-based, so search and AI crawlers only ever see `DEFAULTS.locale` = **`pt-BR`** (set at init). A genuinely multilingual, indexable site needs `/[locale]/` routing + `hreflang` — an architecture change, not a page edit.
- **`NEXT_PUBLIC_SITE_URL`** must be set in production (no trailing slash). Without it, `sitemap.ts`, `robots.ts`, the OG image and every JSON-LD `@id`/`url` fall back to `http://localhost:3000`.
- **Route slugs are Portuguese** (short, no accents — HOME-SPEC §28): `/planos`, `/como-funciona`, `/recursos`, `/seguranca`, `/migracao`, `/sobre`, `/contato`, `/ajuda`.

## Open items

- No quantitative claims anywhere until real data exists (HOME-SPEC §33.5); plan facts (minutes, trial) are the only numbers allowed.
- Blog/help clusters grow in the admin consoles (`/admin/blog`, `/admin/help`) — no deploy needed.
