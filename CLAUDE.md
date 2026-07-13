# MedChina — Monorepo

Prontuário inteligente e assistente clínico para Medicina Tradicional Chinesa. Derived from the flyee template (`template` git remote — pull base improvements with `/update-from-template`). This repo holds REAL business logic; the template conventions below still apply.

## Product (see docs/PRODUCT.md for the full PRD)

- **What it is**: clinical EHR + ambient AI assistant for TCM practitioners (acupuncture, auriculotherapy, moxibustion, cupping, Chinese dietary therapy). The practitioner keeps her attention on the patient; MedChina records, organizes and prepares the consultation for clinical review.
- **Core loop**: mobile app captures authorized consultation audio → transcription + speaker diarization → structured anamnesis auto-filled (with per-field provenance to the audio segment; absence never becomes negation) → gap/contradiction detection → (Pro) disharmony-pattern hypotheses, point/protocol suggestions and therapeutic-plan drafts — everything stays a draft until the professional reviews, edits, validates and signs.
- **Business model**: freemium. Gratuito (R$0, unlimited manual patients/records), Assistente (R$199/mo hypothesis, 3,000 min audio), Pro (R$299/mo hypothesis, 6,000 min + clinical reasoning). Trial Pro: 14 days or 300 min, starts only at the first REAL AI consultation, no card. Prices are launch hypotheses — keep them in configurable data, never hardcoded.
- **Platforms**: web (this repo, primary/complete) + companion mobile app (audio capture, voice notes, upload/status only — NO checkout/purchase in the app, store-policy rule).
- **MVP account model**: one workspace per professional (maps to the template's organizations; multi-professional clinics are post-MVP).
- **Safety language**: the AI never "diagnoses" — it prepares hypotheses/suggestions requiring validation. Red is reserved for risk/failure. See PRD §10 and §16.
- **Home page spec**: docs/HOME-SPEC.md (copy + composition, source of truth for the marketing home).

## Structure

- `apps/web` — Next.js 15 (App Router) + MUI v9 + MUI X Premium + Tailwind 4, deployed on Vercel. See `apps/web/CLAUDE.md`.
  - **Product layer** (authenticated app, `app/(dashboard)`): screens are goal-first, never defaulted to CRUD tables. Reusable UX blocks in `components/product/*` (`EmptyState`, `OnboardingChecklist`, `ActivationProgress`, `SetupWizard`) backed by `packages/onboarding`. The `product-screen` skill is enforced by a `PreToolUse` hook (`.claude/hooks/product-screen-guard.mjs`).
  - **Platform layer**: server-gated superadmin area at `app/(dashboard)/admin` (`profiles.is_superadmin` + RLS; layout gate + superadmin-only menu group) with consoles for real metrics (`admin_metrics()` RPC), organizations & users (suspend kill-switch; ban, 2FA visibility and 2FA reset via service role), billing, AI, knowledge, audit (audit trail + sign-in access log), **data insights** (ask the database in plain language; the model's SQL runs in a Postgres `READ ONLY` transaction and is shown with the answer), **backups** (`packages/backup`), announcements, help center, blog and **support** (`/admin/support` — quick-support widget channels stored in `platform_settings`, migration 0018). Account plumbing is real, not mock: header notification bell (`notifications` table + `lib/notifications.ts`), dismissible system announcements, profile/account settings (avatar storage bucket), floating quick-support widget reading `platform_settings` ('support' key, superadmin-managed) with `BRAND.support` as static fallback (hidden until a human channel is set).
  - **Marketing layer**: public site at `app/(marketing)` with Portuguese slugs (home, /como-funciona, /recursos, /planos, /seguranca, /migracao, /sobre, /contato, /ajuda, /blog, /legal — /ajuda and /blog serve DB-managed content written in the admin consoles, locale-aware with EN fallback via `lib/public-content.ts`) built from `components/marketing/*` primitives (Section/Container/SectionHeader/Reveal + premium archetypes: FeatureRows/BentoGrid/StatBand/ProductFrame/DataVizPlaceholder), GSAP motion, per-page SEO + sitemap/robots. The committed visual direction is persisted in `docs/DESIGN.md` and is STRICT (inherited by every new page/edit/section; redesign only on explicit request). Quality is enforced deterministically: a `PreToolUse` hook (`.claude/hooks/marketing-guard.mjs`) loads the `marketing-page` skill and injects a digest of the component catalog (`components/marketing/catalog.json`), and a `PostToolUse` lint (`.claude/hooks/marketing-lint.mjs`) checks every written file against the marketing contract (tokens, i18n, icon alias, SEO, library composition). Site identity centralized in `apps/web/src/brand.ts`.
- `packages/design-tokens` — design system source of truth (CSS tokens + generated TS mirror). MedChina locks a SINGLE brand palette written into `css/green.css` (Teal `#177c81` primary / Camel `#c09362` secondary, exact brand values; derived accents jade/slate-blue/terracotta/plum) plus warm Parchment-tinted neutrals in `css/common.css`; the other theme files stay for template merges but are not loaded. Includes `css/marketing.css` (fluid display type scale, section rhythm, motion tokens). See `packages/design-tokens/README.md`.
- `packages/db` — Drizzle schema + SQL migrations with RLS (multi-tenant: organizations/memberships/invites — one workspace per professional in the MVP). See `packages/db/README.md`.
- `packages/auth` — Supabase auth clients (browser/server/middleware). Degrades gracefully when Supabase env vars are absent. 2FA (TOTP): enroll at `/settings/security`; the middleware forces the AAL2 step-up at `/auth/two-factor` for enrolled users.
- `packages/email` — Resend + React Email templates (server-only). ACTIVE at launch (needs `RESEND_API_KEY`); no-ops without it and callers must offer a fallback.
- `packages/billing` — ACTIVE: per-org subscriptions (Gratuito/Assistente/Pro + minute credits), coupons, trials; Stripe + Asaas behind one `PaymentProvider` interface. Superadmin console at `/admin/billing`; customer page at `/settings/billing`. See `packages/billing/README.md`.
- `packages/documents` — ACTIVE: issued documents with versioning, sha256 hash and QR-verifiable codes (public page `/verify/[code]`); PDF rendering is pluggable (caller supplies bytes). Issued docs are revoked, never deleted. Powers therapeutic plans/prescriptions with professional signature. See `packages/documents/README.md`.
- `packages/jobs` — Inngest client + typed event map for background jobs/cron. Functions live in the owning package's `src/jobs.ts`; all are served by `apps/web` at `/api/inngest`. `sendEvent` never throws — callers must fall back to inline processing. See `packages/jobs/README.md`.
- `packages/audit` — ACTIVE (compliance is core for clinical data): append-only `audit_events` (call `recordAudit` from `apps/web/src/lib/audit.ts` on every mutation), `access_events` sign-in trail, immutable row versioning — MedChina must enable it on clinical tables as they are created (`select public.enable_row_versioning('public.<table>')`), versioned consent terms + acceptances (patient consent for recording/AI is a product pillar). See `packages/audit/README.md`.
- `packages/backup` — automatic logical backups of every `public` table, nightly via Inngest plus on-demand from `/admin/backups`. See `packages/backup/README.md`.
- `packages/connectors` — NOT active at launch (kept inert for template merges). See `packages/connectors/README.md`.
- `packages/knowledge` — ACTIVE: knowledge base with trust levels + pgvector RAG (clinical library: traditional sources, internal protocols, scientific evidence — classified separately per PRD §9.9); Gemini embeddings; ingestion via Inngest with inline fallback. Superadmin console at `/admin/knowledge`. See `packages/knowledge/README.md`.
- `packages/ai` — ACTIVE: instruction-driven assistants (superadmin-managed) behind a `ChatProvider` interface (Anthropic/Gemini/OpenRouter), attachments, credits per message. Console at `/admin/ai`. The clinical AI pipeline (anamnesis filling, hypotheses) builds on this + `packages/transcribe` + `packages/knowledge`. See `packages/ai/README.md`.
- `packages/transcribe` — ACTIVE (heart of the product): audio → diarized transcript (speakers + timestamps) via Gemini; Inngest job with inline fallback; optional source-audio deletion once the transcript is validated (PRD §14.3). See `packages/transcribe/README.md`.
- `packages/whatsapp` — NOT active at launch (kept inert). See `packages/whatsapp/README.md`.
- `apps/mobile` — ACTIVE: Expo (SDK 57) + expo-router + React Native Paper companion app (audio capture, voice observations, upload queue, processing status — no checkout, per store policy and PRD §4.4). Same identity as web (tokens → Paper themes, shared copy via `packages/content`, auth via `@flyee/auth/native`). Screen playbook: `.claude/skills/mobile-screen`. See `apps/mobile/CLAUDE.md`.
- `packages/onboarding` — ACTIVE: activation mechanism for the PRD §7.3 checklist (first patient → first manual consultation → AI demo → first AI consultation); step definitions live in this repo's code. See `packages/onboarding/README.md`.
- `packages/content` — cross-platform site identity (`BRAND`) + i18n message catalogs (`messages/{de,en,es,fr,pt-BR}.json`; **pt-BR is the default and the only search-indexed locale**), consumed by web (next-intl) and mobile (use-intl). Brand master art lives in `packages/content/brand/` (vector lockup `logo.svg`, extracted `mark.svg`, white variant, PNG masters).
- `attachments/` — input inbox: drop project material here (brand art, page imagery, briefs); agents route each file to its canonical home per `attachments/README.md` and the folder trends back to empty.

## Golden rules

- Visual identity (colors, themes, shadows, radii) changes ONLY in `packages/design-tokens/css/*.css`. Never hardcode theme values in an app.
- After changing token CSS, run `npm run tokens:generate` and commit the updated `tokens.generated.ts` together.
- Apps never import from other apps (`apps/web` ↛ `apps/mobile` and vice versa); shared code lives in `packages/*`.
- npm workspaces: always install dependencies from the root (`npm install`), never inside an app.
- Icons: Phosphor set via the tsconfig alias (`@/icons/nexture/*` → `src/icons/phosphor/*`; fallback stubs re-export Nexture — replace incrementally).
- Display font: TT Chocolates (commercial, `apps/web/src/fonts/tt-chocolates/`, weights 500/700/800 wired as `--font-display` in the root layout).
- Clinical safety: AI output is always a draft for professional review; never word UI/copy as autonomous diagnosis/prescription; red only for risk/error; prices/limits come from configurable data.

## Commands (root)

- `npm run dev` / `build` / `lint:fix` — delegate to `apps/web`
- `npm run dev:mobile` — Expo dev server for `apps/mobile`
- `npm run typecheck` — both apps, each with its own pinned TypeScript (web 5.8 / mobile 6.0 — never run a bare root `npx tsc` on apps/web: it picks the hoisted TS 6)
- `npm run tokens:generate` — regenerate the TS token mirror

## Platform (confirmed decisions)

- Deploy: Vercel. Database/auth/storage: Supabase (Postgres + RLS, Auth, Storage; pgvector for RAG). ORM: Drizzle (`packages/db`).
- Billing: Stripe/Asaas behind an interface (`packages/billing`). Email: Resend + React Email (`packages/email`). Jobs/cron: Inngest (`packages/jobs`). AI: Anthropic/Gemini behind a provider interface (`packages/ai`); transcription/diarization via Gemini (`packages/transcribe`).
- Locale: pt-BR default (cookie-based i18n — crawlers index ONLY pt-BR); other locales (de,en,es,fr) available via the in-app switcher.
- Do not reintroduce Cloudflare-specific services (Workers, D1, R2, Workers AI).

This repo stays **private**: the UI layer contains commercially licensed template code (MUI X Premium license) plus the commercial TT Chocolates font.
