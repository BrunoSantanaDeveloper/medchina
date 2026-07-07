# Flyee Template — Monorepo

Reusable commercial template (admin + future mobile versions). This repo is the BASE for other projects: changes must stay generic, with no business logic from any specific derived project.

## Structure

- `apps/web` — Next.js 15 (App Router) + MUI v9 + MUI X Premium + Tailwind 4, deployed on Vercel. See `apps/web/CLAUDE.md`.
  - **Marketing layer**: public site at `app/(marketing)` (home, /pricing, /about, /contact, /legal) built from `components/marketing/*` primitives (Section/Container/SectionHeader/Reveal), GSAP motion, per-page SEO + sitemap/robots. Design/copy playbook: `.claude/skills/marketing-page`. Site identity centralized in `apps/web/src/brand.ts`.
- `packages/design-tokens` — design system source of truth (CSS tokens + generated TS mirror). Includes `css/marketing.css` (fluid display type scale, section rhythm, motion tokens). See `packages/design-tokens/README.md`.
- `packages/db` — Drizzle schema + SQL migrations with RLS (multi-tenant: organizations/memberships/invites). See `packages/db/README.md`.
- `packages/auth` — Supabase auth clients (browser/server/middleware). Degrades gracefully when Supabase env vars are absent. 2FA (TOTP): enroll at `/settings/security`; the middleware forces the AAL2 step-up at `/auth/two-factor` for enrolled users.
- `packages/email` — Resend + React Email templates (server-only). No-ops without `RESEND_API_KEY`; callers must offer a fallback.
- `packages/billing` — per-org subscriptions (recurring or credits), add-on modules, coupons, trials; Stripe + Asaas behind one `PaymentProvider` interface. Superadmin console at `/admin/billing`; customer page at `/settings/billing`. See `packages/billing/README.md`.
- `packages/documents` — issued documents with versioning, sha256 hash and QR-verifiable codes (public page `/verify/[code]`); PDF rendering is pluggable (caller supplies bytes). Issued docs are revoked, never deleted. See `packages/documents/README.md`.
- `packages/jobs` — Inngest client + typed event map for background jobs/cron. Functions live in the owning package's `src/jobs.ts`; all are served by `apps/web` at `/api/inngest`. `sendEvent` never throws — callers must fall back to inline processing. See `packages/jobs/README.md`.
- `packages/audit` — compliance layer: append-only `audit_events`, immutable row versioning (opt-in per table: `select public.enable_row_versioning('public.<table>')` — the template marks none), versioned consent terms + acceptances. See `packages/audit/README.md`.
- `packages/connectors` — framework for per-org connections to external APIs: connector registry (`Connector` interface — the template ships no concrete connectors), service-role-only secret storage, sync via Inngest. Customer UI at `/settings/connections`; derived projects register connectors in `apps/web/src/lib/connectors.ts`. See `packages/connectors/README.md`.
- `packages/knowledge` — knowledge base with trust levels (1 official → 5 opinion) + pgvector RAG; Gemini embeddings; ingestion via Inngest with inline fallback. Superadmin console at `/admin/knowledge`; assistants opt in via `config.knowledge`. See `packages/knowledge/README.md`.
- `packages/ai` — instruction-driven assistants (superadmin-managed rows, not a generic chat): Anthropic/Gemini/OpenRouter behind a `ChatProvider` interface, image+audio attachments, credits debited per message. Console at `/admin/ai`; chat wired at `/applications/ai-chat/new-chat`. See `packages/ai/README.md`.
- `packages/transcribe` — audio → diarized transcript (speakers + timestamps) via Gemini; Inngest job with inline fallback; optional source-audio deletion once the transcript is ready. See `packages/transcribe/README.md`.
- `packages/whatsapp` — WhatsApp dispatcher behind a provider interface (Meta Cloud API official / Evolution API unofficial): manual, automatic and scheduled sends (Inngest `sleepUntil`), `wa_messages` log, webhook at `/api/webhooks/whatsapp/[provider]`, inbound replies emitted as `whatsapp/message.received`. See `packages/whatsapp/README.md`.
- `apps/mobile` — Expo (SDK 57) + expo-router + React Native Paper. Same identity as web: Paper MD3 themes generated from the tokens (4 colors × light/dark), shared copy via `packages/content`, auth via `@flyee/auth/native`. Screen playbook: `.claude/skills/mobile-screen`. See `apps/mobile/CLAUDE.md`.
- `packages/content` — cross-platform site identity (`BRAND`) + i18n message catalogs (`messages/{de,en,es,fr,pt-BR}.json`), consumed by web (next-intl) and mobile (use-intl) so branding/copy never drift. Brand master art lives in `packages/content/brand/`.
- `attachments/` — input inbox: the user drops project material here (brand art, page imagery, briefs); agents route each file to its canonical home per `attachments/README.md` and the folder trends back to empty.

## Golden rules

- Visual identity (colors, themes, shadows, radii) changes ONLY in `packages/design-tokens/css/*.css`. Never hardcode theme values in an app.
- After changing token CSS, run `npm run tokens:generate` and commit the updated `tokens.generated.ts` together.
- Apps never import from other apps (`apps/web` ↛ `apps/mobile` and vice versa); shared code lives in `packages/*`.
- npm workspaces: always install dependencies from the root (`npm install`), never inside an app.

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
