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
| `Organization` + `WebSite` JSON-LD (site-wide) | `components/marketing/site-json-ld.tsx`, mounted by the `(marketing)` and `(autoridade)` layouts |
| `FAQPage` JSON-LD (from the FAQ items) | `components/marketing/faq.tsx` |
| `Product`/`Offer` JSON-LD (from real billing plans) | `components/marketing/pricing-section.tsx` |
| One `<h1>` per page contract | `SectionHeader` `as` / `PricingSection` `headingAs` |

## What each page must still do (the on-page layer)

See the `marketing-page` skill's "SEO & discoverability" section — enforced by review:
exactly one `<h1>` (the page title), a localized title tag (target term + value, ~60 chars) and a distinct 150–160-char description via `generateMetadata`, answer-first copy, the target term in `<h1>`/title/slug/first sentence, internal links to the money page, and structured data via `<JsonLd>` for any new schema-eligible block.

**Canonical URL (per page — Next does NOT auto-emit it).** Every page returns
`alternates: { canonical: "<its own path>" }` from `metadata`/`generateMetadata`
(resolved against `metadataBase` = `NEXT_PUBLIC_SITE_URL`). This declares the
preferred URL and prevents duplicate-content splits (query strings, trailing
slash, the `.vercel.app` alias vs. the custom domain). Dynamic routes build it
from the slug (`` `/blog/${slug}` ``). A new marketing page without a canonical
is incomplete.

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
| `/china` | "prontuário de Medicina Chinesa" + "Lei 15.345" + "Congresso de MTC Xinjiang" — authority / press; title `O prontuário brasileiro de MTC apresentado na China · MedChina` | authority → subscribe (`CtaClick`) |

Structured data note (HOME-SPEC §29.5): the home may add `SoftwareApplication` via `<JsonLd>`; never mark up ratings, reviews or availability that are not actually published.

**Landing pages and indexing (2026-09-26).** Indexing is a decision of each page's `metadata` + `sitemap.ts` + `PUBLIC_PREFIXES`, never of the route group. Two groups hold Landing DS pages: `(funil)` (offer/campaign/event pages — `/assinar`, `/fundadores`, `/lei-15345`: `noindex`, out of the sitemap, FUNIL D10) and `(autoridade)` (permanent, **indexed** landing pages with the home's own header and footer — `/china`, with `Article` JSON-LD whose `publisher` points at the site-wide `Organization` `@id`, and an image only when a real stage photo exists). `/palestra/publica` (the congress deck for the public) is `noindex` like `/palestra`: it is reached from `/china`, not from search.

## Architecture constraints (decisions, not page edits)

- **Indexable language:** i18n is cookie-based, so search and AI crawlers only ever see `DEFAULTS.locale` = **`pt-BR`** (set at init). A genuinely multilingual, indexable site needs `/[locale]/` routing + `hreflang` — an architecture change, not a page edit. See "Multilingual SEO" below for what exists today and what that change would take.

## Multilingual SEO — what is done, and the plan for the rest (written 2026-09-18)

**What shipped (2026-09-18).** The home is translated into all six locales (`components/marketing/home-copy/`), carries a language switcher, and picks a first-visit language from the request itself (`lib/locale-detection.ts` → `lib/locale-request.ts`): `Accept-Language` first, Vercel's `x-vercel-ip-country` as a fallback, with the visitor's own choice — the cookie — always winning. This serves people who arrive by link, WeChat, WhatsApp or an ad. **It does nothing for organic search**, and deliberately so: `detectLocale` returns `null` for any crawler, so Googlebot, Baiduspider and every link-preview fetcher still get pt-BR. Serving a crawler another language on the same URL would put content in the index that no URL can return.

**Why the switch is safe for the current ranking.** One URL, one canonical (`/`), one indexable language. Nothing about the pt-BR index changes; the localized renders are invisible to crawlers by construction.

**What indexable Chinese would require** — the work, in the order it has to happen:

1. **Route group** `app/(marketing)/[locale]/` wrapping the existing pages, with `generateStaticParams` over `LOCALES` and a middleware rule that keeps `/` as the un-prefixed pt-BR root (a prefix on the default locale would 301 every existing inbound link and every ad URL).
2. **`hreflang` on every page**: `alternates.languages` in each `generateMetadata`, all locales cross-referencing each other plus `x-default` → pt-BR. Wrong or partial hreflang is worse than none — it splits authority instead of consolidating it.
3. **Canonical per locale**: each localized URL is canonical to ITSELF, never to the pt-BR one (a cross-language canonical tells Google to drop the translation).
4. **`sitemap.ts` per locale**, including the DB-managed `/ajuda` and `/blog` slugs that actually have a translated row — a sitemap entry for an untranslated page is a soft-404 in another language.
5. **The informational pages' translations become load-bearing.** The `marketing` namespace is already complete in all six, but it was written for an in-app switcher, not for search: titles and descriptions per locale need a pass against real query intent in that language.
6. **The locale cookie stops deciding the language on prefixed routes** — the URL does. The cookie survives only as the redirect preference for `/`, and the detection above becomes a SUGGESTION banner ("查看中文版 →" pointing at `/zh-CN/`) instead of a content switch.
7. **Content that is not translated must not get a URL.** `/legal/*` and the consent terms are pt-BR by law and product decision (`consent_terms` has no locale column, see `apps/web/CLAUDE.md`) — those routes stay single-language and out of the alternates set.

**Cost note before doing it:** Google is blocked in mainland China, so organic acquisition there means Baidu, which needs its own webmaster registration, an ICP filing for a China-hosted domain, and treats a non-Chinese-hosted site poorly. Decide whether the target is Chinese speakers OUTSIDE China (Google works; steps 1–7 are enough) or inside it (a separate infrastructure question, not an SEO one).
- **`NEXT_PUBLIC_SITE_URL`** must be set in production (no trailing slash). Without it, `sitemap.ts`, `robots.ts`, the OG image and every JSON-LD `@id`/`url` fall back to `http://localhost:3000`.
- **Route slugs are Portuguese** (short, no accents — HOME-SPEC §28): `/planos`, `/como-funciona`, `/recursos`, `/seguranca`, `/migracao`, `/sobre`, `/contato`, `/ajuda`.

## Open items

- No quantitative claims anywhere until real data exists (HOME-SPEC §33.5); plan facts (minutes, trial) are the only numbers allowed.
- Blog/help clusters grow in the admin consoles (`/admin/blog`, `/admin/help`) — no deploy needed.
