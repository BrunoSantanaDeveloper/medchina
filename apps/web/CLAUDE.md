# MedChina Web (apps/web)

Next.js 15 (App Router) + React 19 — the MedChina platform (web is the primary, complete surface; see root CLAUDE.md and docs/PRODUCT.md).

## Stack and conventions

- **UI**: MUI v9 is the base — before building a component from scratch, check for an existing MUI or MUI X equivalent (DataGrid Premium, Charts Pro, Date Pickers Pro, Tree View are already installed). Icons: **Phosphor** via the `@/icons/nexture/*` tsconfig alias (16 real adapters; the rest are Nexture fallback stubs — replace incrementally, see `src/icons/README.md`).
- **Styling**: MUI theme driven by CSS variables (`hsl(var(--token))`) defined in `@flyee/design-tokens`. MUI component overrides live in `src/style/**/*.css` (organized by category), inside CSS layers (`theme, base, mui, components, utilities`). Tailwind 4 only for layout utilities; classes merged with `tailwind-merge`.
- **Themes**: SINGLE locked brand palette (Teal/Camel, written into `@flyee/design-tokens` `css/green.css`) × light/dark, applied via classes on `<html>` (`theme-green dark`) by the `ThemeProvider` (`src/theme/theme-provider.tsx`). `THEME_OPTIONS` holds only GREEN; the color switcher is removed. Display font: TT Chocolates (`src/fonts/tt-chocolates/`, `--font-display` in the root layout).
- **Forms**: Formik + Yup.
- **i18n**: next-intl — every UI string goes through messages, never hardcoded. Locales: `de,en,es,fr,pt-BR`; catalogs live in `packages/content/messages/` (shared with apps/mobile). Namespaces: `marketing` (public site), `auth` (sign-in/sign-up/recovery/2FA), `product` (clinical app + onboarding), `dashboard` (chrome/menu). Admin consoles stay EN-only on purpose.
- **Path alias**: `@/*` → `./src/*`.
- **Brand**: site identity (name, tagline, siteUrl, favicon paths) comes from `@flyee/content` (`src/brand.ts` is a re-export shim); the logo is the single component `src/components/logo/logo.tsx` (used by admin AND marketing chrome).

## Marketing layer (public site)

- Routes live in `src/app/(marketing)/` with Portuguese slugs (home `/`, `/como-funciona`, `/recursos`, `/planos`, `/seguranca`, `/migracao`, `/sobre`, `/contato`, `/ajuda`, `/blog`, `/legal/{termos,privacidade,cookies}`) with their own chrome — no admin layout. Each new public route must be added to `PUBLIC_PREFIXES` (`src/middleware.ts`) and `src/app/sitemap.ts`. The home is built section-by-section from `docs/HOME-SPEC.md` (contractual order); MedChina copy guardrails live in `docs/DESIGN.md` (never imply autonomous diagnosis; no unproven metrics/testimonials; prices are hypotheses from configurable data).
- `/ajuda` and `/blog` render DB-managed content (superadmin writes it in `/admin/help` and `/admin/blog`) through `src/lib/public-content.ts` (anon client, published rows only, locale with EN fallback); the sitemap includes their published slugs and degrades to the static list without Supabase env. Markdown renders via `components/marketing/markdown-prose.tsx` (react-markdown, raw HTML ignored).
- Pages compose the primitives in `src/components/marketing/` (`Section`/`Container`/`SectionHeader`; sections like Hero, FeatureGrid, PricingSection) — never hand-tuned spacing/widths. See that folder's README and the `marketing-page` skill (load it before building/editing public pages).
- Display typography: `font-display text-display-{2xl,xl,lg,md}` (fluid clamp scale from `@flyee/design-tokens/css/marketing.css`).
- Motion: GSAP only inside marketing client components via `<Reveal>`/`useGSAP` (transforms + `autoAlpha`, honors `prefers-reduced-motion`); never in admin code.
- Public pricing reads plans through `@flyee/billing/public` (`listPublicPlans`, service-role, read-only) with i18n placeholder fallback; the contact form sends via `@flyee/email` (`CONTACT_FORM_TO`) with a graceful not-configured hint.

## Clinical core (the MVP product)

- Routes: `/inicio` (app home — `DEFAULTS.appRoot`), `/pacientes` (+ `/novo`, `/[id]`), `/consultas/[id]`, `/onboarding` (start choice, PRD §6.4). Schema + RLS + guards: `packages/db/migrations/0020_clinical.sql` (`patients`, `consultations`, `anamnesis_answers`, `consultation_addenda`; row versioning enabled on all three clinical tables).
- **Absence is never a negative answer** (PRD §10.5): an anamnesis field with no value has NO row — clearing a field DELETES its answer. Never store an empty string or a "no".
- **A finalized consultation is frozen** (PRD §8.5): DB triggers reject any edit to the record or its answers; corrections go to `consultation_addenda` (append-only — no update/delete policy). The UI disables the fields and offers "Adicionar adendo".
- Anamnesis blocks/fields are declared in `src/lib/anamnesis.ts` — the keys are STABLE (they are what the AI pipeline will map extracted values onto); tongue/pulse/palpation are professional observations (`source = professional_voice`), never inferred from patient speech (PRD §10.3).
- Activation (`src/lib/onboarding.ts`): steps use live predicates over real state; the aha moment is the first FINALIZED manual consultation. `OnboardingChecklistCard` on the home reads those facts.
- **Consent gates capture** (migration `0022_consent_recordings.sql`, PRD §9.5): three patient consents (`audio-recording`, `ai-processing`, `clinical-images`) are seeded as versioned `consent_terms`; the patient screen `/pacientes/[id]/consentimentos` grants/revokes per purpose (revoking stamps `revoked_at`, never deletes — auditable). `has_active_consent(org, patient, slug)` is the shared answer; a DB trigger REJECTS inserting a `recordings` row without an active `audio-recording` consent. Refusing to record never blocks manual care.
- **Web recording** (`components/product/consultation-recorder.tsx`, PRD §4.1/§12.4): MediaRecorder capture in the consultation sidebar (while not finalized). Audio goes to the private `transcriptions` bucket under `<org_id>/<recording_id>.webm`; the `recordings` row flips to `uploaded` ONLY after storage confirms — nothing claims to be "sent" before the server accepts it. The bucket + path convention are shared with `@flyee/transcribe` (0007), which is where the AI pipeline picks up next.
- **Immutability guards protect content, not housekeeping** (migration `0021`): the finalized-consultation triggers skip nested/cascade operations (`pg_trigger_depth() > 1`) and only reject changes to the CLINICAL payload — so account/patient deletion (LGPD erasure, PRD §14.5) cascades through a finalized record, while a professional still cannot rewrite it from the app.
- **AI pipeline** (PRD §10.2; `lib/clinical-pipeline.ts` + `lib/clinical-extraction.ts`, job `lib/clinical-jobs.ts` on event `medchina/recording.process`, kicked off by `POST /api/recordings/[id]/process` with the template's queue-or-inline fallback): an `uploaded` recording → diarized transcript (`@flyee/transcribe` + Gemini) → DRAFT anamnesis. The extraction rules are enforced in code AND prompt, not the prompt alone: absence is never written as a negative (no row); tongue/pulse/palpation only fill from a practitioner-dictated line (`source = professional_voice`), never inferred from patient speech (a violation is DROPPED, not trusted); every value carries provenance (transcript quote + timestamp) for review; gaps land in `consultations.ai_gaps` as questions, never answers. The consultation moves to `awaiting_review`; a value the professional already typed by hand is never overwritten. Gated on a SEPARATE `ai-processing` consent (recording consent alone is not enough). GEMINI_API_KEY is server-only — processing is a server route/job, never a client call. Editing an AI-filled field flips it to `source = professional, state = edited` so a human decision is never mistaken for AI output.

## Platform admin & account

- Superadmin area at `src/app/(dashboard)/admin`: `layout.tsx` is a server gate on `profiles.is_superadmin` (RLS remains the real defense); the Admin menu group renders only for superadmins (`hooks/use-is-superadmin.ts`). Consoles: `/admin` (metrics via `admin_metrics()`), `/admin/organizations` (tenants + users; ban/unban, 2FA state and 2FA reset need `SUPABASE_SERVICE_ROLE_KEY`), `/admin/billing`, `/admin/ai`, `/admin/knowledge`, `/admin/audit` (audit_events + access_events + wa_messages), `/admin/insights`, `/admin/backups`, `/admin/announcements`, `/admin/help`, `/admin/blog`. Admin console UI is intentionally EN-only (platform operator surface); everything user-facing stays i18n.
- Every mutation records an audit event through `lib/audit.ts` (`recordAudit`) — keep that up when adding admin/tenant writes. Sign-ins are logged automatically by a DB trigger (migration 0016); users see their own in `/settings/security`.
- `/admin/insights` (`api/admin/insights/route.ts`): the model writes SQL from an `information_schema` catalog and each statement executes inside a postgres-js `sql.begin("read only", …)` transaction with a 5s `statement_timeout` — **the read-only transaction is the safety boundary, not the prompt**. Every executed query is audited and shown in the UI. Needs `DATABASE_URL` + one AI provider key; degrades to a 503 hint otherwise.
- `/admin/backups` (`@flyee/backup`): nightly Inngest cron + "Run backup now" (falls back to an inline run without Inngest keys, bounded by the function timeout). Archives land in the private `backups` bucket; downloads are service-role signed URLs.
- Real account plumbing: header bell reads the `notifications` table (create rows server-side with `lib/notifications.ts` or DB triggers — see migration 0012); announcements banner in the dashboard layout (per-user dismissal); `/settings` edits the real profile (display name + avatar → `avatars` bucket, migration 0013) and credentials (email/password); the user menu shows the real session and signs out for real.
- Floating quick-support widget (`components/support/support-widget.tsx`, mounted in both layouts) reads the superadmin-managed channels from `platform_settings` ('support' key — console at `/admin/support`, migration 0018, helper `lib/platform-settings.ts`), falling back to `BRAND.support` from `@flyee/content`; it renders nothing until a human channel (WhatsApp/email) is set.

## Commands (run from the monorepo root)

- `npm run dev` — dev server with turbopack
- `npm run build` — production build
- `npm run lint:fix` / `npm run prettier` — lint and formatting

## Auth

- Supabase via `@flyee/auth` (`client`/`server`/`middleware` entry points). `src/middleware.ts` refreshes the session and protects everything except `/` and the public prefixes (`/auth`, `/verify`, `/pricing`, `/about`, `/contact`, `/legal`).
- Without `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` the middleware no-ops and auth screens show a configuration hint — a fresh clone stays browsable.
- Signup metadata (`display_name`, `company`) drives profile + first organization creation in the database trigger (`packages/db/migrations/0000_init.sql`).

## Watch out

- `src/style/global.css` imports tokens from `@flyee/design-tokens/css/*` — do not recreate tokens locally.
- Deployment target is Vercel (native Next.js runtime).
- Server-only secrets (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) must never reach client components.
