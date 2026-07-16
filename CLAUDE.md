# Flyee Template — Monorepo

Reusable commercial template (admin + future mobile versions). This repo is the BASE for other projects: changes must stay generic, with no business logic from any specific derived project.

## Structure

- `apps/web` — Next.js 15 (App Router) + MUI v9 + MUI X Premium + Tailwind 4, deployed on Vercel. See `apps/web/CLAUDE.md`.
  - **Product layer** (authenticated app, `app/(dashboard)`): screens are goal-first, never defaulted to CRUD tables. Reusable UX blocks in `components/product/*` (`EmptyState`, `OnboardingChecklist`, `ActivationProgress`, `SetupWizard`) backed by `packages/onboarding`. Quality is enforced deterministically, mirroring the marketing layer: the `product-screen` skill is loaded by a `PreToolUse` hook (`.claude/hooks/product-screen-guard.mjs`), a `PostToolUse` lint (`.claude/hooks/product-lint.mjs`) checks every written file against the product contract (no raw theme values, a11y names on icon controls/labels/switches, error-never-rendered-as-empty, no GSAP), and flows are verified end-to-end with the `product-verify` skill (walks the real journeys — dead ends, lost context, error≠empty, leftover demo surfaces — before a screen is declared done).
  - **Platform layer**: server-gated superadmin area at `app/(dashboard)/admin` (`profiles.is_superadmin` + RLS; layout gate + superadmin-only menu group) with consoles for real metrics (`admin_metrics()` RPC), organizations & users (suspend kill-switch; ban, 2FA visibility and 2FA reset via service role), billing, AI, knowledge, audit (audit trail + sign-in access log + WhatsApp), **data insights** (ask the database in plain language; the model's SQL runs in a Postgres `READ ONLY` transaction and is shown with the answer), **backups** (`packages/backup`), announcements, help center and blog. Account plumbing is real, not mock: header notification bell (`notifications` table + `lib/notifications.ts`), dismissible system announcements, profile/account settings (avatar storage bucket), floating quick-support widget configured in `BRAND.support` (WhatsApp/email; hidden until a channel is set).
  - **Marketing layer**: public site at `app/(marketing)` (home, /pricing, /about, /contact, /help, /blog, /legal — /help and /blog serve DB-managed content written in the admin consoles, locale-aware with EN fallback via `lib/public-content.ts`) built from `components/marketing/*` primitives (Section/Container/SectionHeader/Reveal + premium archetypes: FeatureRows/BentoGrid/StatBand/ProductFrame/DataVizPlaceholder), GSAP motion, per-page SEO + sitemap/robots. The committed visual direction is persisted in `docs/DESIGN.md` and is STRICT (inherited by every new page/edit/section; redesign only on explicit request). Quality is enforced deterministically: a `PreToolUse` hook (`.claude/hooks/marketing-guard.mjs`) loads the `marketing-page` skill and injects a digest of the component catalog (`components/marketing/catalog.json`), and a `PostToolUse` lint (`.claude/hooks/marketing-lint.mjs`) checks every written file against the marketing contract (tokens, i18n, icon alias, SEO, library composition). Site identity centralized in `apps/web/src/brand.ts`.
- `packages/design-tokens` — design system source of truth (CSS tokens + generated TS mirror). Includes `css/marketing.css` (fluid display type scale, section rhythm, motion tokens). See `packages/design-tokens/README.md`.
- `packages/db` — Drizzle schema + SQL migrations with RLS (multi-tenant: organizations/memberships/invites). See `packages/db/README.md`.
- `packages/auth` — Supabase auth clients (browser/server/middleware). Degrades gracefully when Supabase env vars are absent. 2FA (TOTP): enroll at `/settings/security`; the middleware forces the AAL2 step-up at `/auth/two-factor` for enrolled users.
- `packages/email` — Resend + React Email templates (server-only). No-ops without `RESEND_API_KEY`; callers must offer a fallback.
- `packages/billing` — per-org subscriptions (recurring or credits), add-on modules, coupons, trials; Stripe + Asaas behind one `PaymentProvider` interface. Superadmin console at `/admin/billing`; customer page at `/settings/billing`. See `packages/billing/README.md`.
- `packages/documents` — issued documents with versioning, sha256 hash and QR-verifiable codes (public page `/verify/[code]`); PDF rendering is pluggable (caller supplies bytes). Issued docs are revoked, never deleted. See `packages/documents/README.md`.
- `packages/jobs` — Inngest client + typed event map for background jobs/cron. Functions live in the owning package's `src/jobs.ts`; all are served by `apps/web` at `/api/inngest`. `sendEvent` never throws — callers must fall back to inline processing. See `packages/jobs/README.md`.
- `packages/audit` — compliance layer: append-only `audit_events` (wired by default across every mutation the template ships — call `recordAudit` from `apps/web/src/lib/audit.ts`), `access_events` sign-in trail (trigger on `auth.sessions`, migration 0016), immutable row versioning (opt-in per table: `select public.enable_row_versioning('public.<table>')` — the template marks none), versioned consent terms + acceptances. See `packages/audit/README.md`.
- `packages/backup` — automatic logical backups: every `public` table exported to gzipped JSONL in the private `backups` bucket, nightly via Inngest cron plus on-demand from `/admin/backups`, with retention pruning. Data only (no DDL) — Supabase's native backups/PITR remain the disaster-recovery layer. See `packages/backup/README.md`.
- `packages/connectors` — framework for per-org connections to external APIs: connector registry (`Connector` interface — the template ships no concrete connectors), service-role-only secret storage, sync via Inngest. Customer UI at `/settings/connections`; derived projects register connectors in `apps/web/src/lib/connectors.ts`. See `packages/connectors/README.md`.
- `packages/knowledge` — knowledge base with trust levels (1 official → 5 opinion) + pgvector RAG; Gemini embeddings; ingestion via Inngest with inline fallback. Superadmin console at `/admin/knowledge`; assistants opt in via `config.knowledge`. See `packages/knowledge/README.md`.
- `packages/ai` — instruction-driven assistants (superadmin-managed rows, not a generic chat): Anthropic/Gemini/OpenRouter behind a `ChatProvider` interface, image+audio attachments, credits debited per message. Console at `/admin/ai`; chat wired at `/applications/ai-chat/new-chat`. See `packages/ai/README.md`.
- `packages/transcribe` — audio → diarized transcript (speakers + timestamps) via Gemini; Inngest job with inline fallback; optional source-audio deletion once the transcript is ready. See `packages/transcribe/README.md`.
- `packages/whatsapp` — WhatsApp dispatcher behind a provider interface (Meta Cloud API official / Evolution API unofficial): manual, automatic and scheduled sends (Inngest `sleepUntil`), `wa_messages` log, webhook at `/api/webhooks/whatsapp/[provider]`, inbound replies emitted as `whatsapp/message.received`. See `packages/whatsapp/README.md`.
- `apps/mobile` — Expo (SDK 57) + expo-router + React Native Paper. Same identity as web: Paper MD3 themes generated from the tokens (4 colors × light/dark), shared copy via `packages/content`, auth via `@flyee/auth/native`. Screen playbook: `.claude/skills/mobile-screen`. See `apps/mobile/CLAUDE.md`.
- `packages/onboarding` — activation mechanism for onboarding checklists / setup wizards: persists completed steps, dismissal and the activation moment (`onboarding_state`, migration 0009); step definitions stay in the derived project's code. Powers completion-drive UX. See `packages/onboarding/README.md`.
- `packages/content` — cross-platform site identity (`BRAND`) + i18n message catalogs (`messages/{de,en,es,fr,pt-BR}.json`), consumed by web (next-intl) and mobile (use-intl) so branding/copy never drift. Brand master art lives in `packages/content/brand/`.
- `attachments/` — input inbox: the user drops project material here (brand art, page imagery, briefs); agents route each file to its canonical home per `attachments/README.md` and the folder trends back to empty.

## Golden rules

- Visual identity (colors, themes, shadows, radii) changes ONLY in `packages/design-tokens/css/*.css`. Never hardcode theme values in an app.
- After changing token CSS, run `npm run tokens:generate` and commit the updated `tokens.generated.ts` together.
- Apps never import from other apps (`apps/web` ↛ `apps/mobile` and vice versa); shared code lives in `packages/*`.
- npm workspaces: always install dependencies from the root (`npm install`), never inside an app.

## Shared Claude/Codex harness

- `CLAUDE.md`, `apps/*/CLAUDE.md`, `.claude/rules/*`, `.claude/skills/*` and `.claude/hooks/*` are the canonical shared sources. Do not maintain a second hand-written Codex copy.
- Codex reads the generated `AGENTS.md` mirror and generated `.agents/skills/*` discovery bridges. `.codex/config.toml` points its lifecycle hooks at the same implementations under `.claude/hooks/`.
- `PostToolUse` automatically runs `scripts/sync-agent-harness.mjs` after canonical harness edits. `npm run harness:check` and `npm run harness:test` are also enforced by the pre-commit hook.

## Starting a derived project

1. `git clone <flyee repo> <project>` and run `/init-project` — its Step 0 secures the remotes FIRST (renames `origin` → `template`, creates the project's own private repo and pushes) so nothing can be pushed to the template by accident; keeping `template` as a remote lets the project pull base improvements later via the `/update-from-template` skill (kept in every derivative; `/add-mobile` restores a pruned mobile app the same way).
2. The quiz then configures branding (palette + assets generated from a master logo dropped in `attachments/`), icon set (Nexture/Phosphor via tsconfig alias), auth model, active capability packages, the marketing site (keep + customize copy, or prune), product brief (`docs/PRODUCT.md`) and prunes demo content. It copies `apps/web/.env.example` → `.env` (gitignored; real keys never enter git). The skill is single-use and removes itself.

This repo and its derivatives stay **private**: the UI layer still contains commercially licensed template code (plus the MUI X Premium license).

## Commands (root)

- `npm run dev` / `build` / `lint:fix` — delegate to `apps/web`
- `npm run dev:mobile` — Expo dev server for `apps/mobile`
- `npm run typecheck` — both apps, each with its own pinned TypeScript (web 5.8 / mobile 6.0 — never run a bare root `npx tsc` on apps/web: it picks the hoisted TS 6)
- `npm run tokens:generate` — regenerate the TS token mirror

## Platform (confirmed decisions)

- Deploy: Vercel. Database/auth/storage: Supabase (Postgres + RLS, Auth, Storage; pgvector for future RAG). ORM: Drizzle (`packages/db`).
- Billing: Stripe behind an interface (`packages/billing`). Email: Resend + React Email (`packages/email`). Jobs/cron: Inngest (`packages/jobs`). AI: Anthropic behind a provider interface (`packages/ai`).
- Do not reintroduce Cloudflare-specific services (Workers, D1, R2, Workers AI).
