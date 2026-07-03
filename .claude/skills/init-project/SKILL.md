---
name: init-project
description: Interactive quiz to turn a fresh gogo-template clone into a configured project — branding, icon set, auth model, packages to keep, demo content to prune. Run once, right after cloning the template into a new repository.
---

# Initialize a project derived from gogo-template

You are configuring a NEW project cloned from the gogo-template monorepo. Ask the quiz below with the AskUserQuestion tool (group related questions, max 4 per call), then apply the mapped actions. Show a summary of planned actions and get confirmation BEFORE any destructive step (deleting demo content). Finish with install, build, and an initial commit.

## Quiz

**Round 1 — identity**
1. Project name and one-line description? (free text — used for package names, `NEXT_PUBLIC_TITLE`, CLAUDE.md)
2. Branding: keep the 4 demo color themes with runtime switcher, or lock a single brand palette? If brand: ask for the primary color (hex or HSL) and whether dark mode is needed.
3. Icon set: Nexture (default) or Phosphor?
4. Default locale? (template default: en; next-intl is wired)

**Round 2 — platform**
5. Auth model: multi-tenant organizations (default), single-user (no orgs), or no auth (public site/dashboard)?
6. Transactional email at launch? (requires a Resend key; invites fall back to copyable links without it)
7. Mobile app (Expo) planned for this project?
8. Background jobs/cron needed at launch? (Inngest — not yet scaffolded; if yes, plan `packages/jobs`)

**Round 3 — content**
9. Demo content to keep as reference vs. prune now. Offer multiSelect: UI showcase (`(dashboard)/ui`, ~518 files), template docs (`(dashboard)/docs`), sample apps (`(dashboard)/applications`, `(dashboard)/pages`, `(dashboard)/dashboards` extras), landing page (`landing-page`). Recommend keeping UI showcase during development and pruning before launch.

## Actions by answer

**Identity**
- Root `package.json` name, `apps/web` `NEXT_PUBLIC_TITLE` in `.env`; rewrite root `CLAUDE.md` header: it now describes THIS product (remove "this is the template base" warnings — derived repos hold real business logic; keep structure/commands sections).
- Locale: `DEFAULTS.locale` in `apps/web/src/config.ts`.

**Branding (single palette)**
- Edit `packages/design-tokens/css/green.css` (or the closest hue) with the brand HSL values; keep the light/dark block structure.
- `npm run tokens:generate` and commit the regenerated mirror.
- Set `DEFAULTS.themeColor` in `apps/web/src/config.ts`; optionally remove the other theme CSS imports from `src/style/global.css` and their entries in `THEME_OPTIONS` (`src/constants.ts`) to hide the switcher options.

**Icons: Phosphor**
- `npm run icons:stubs -w @gogo/web`
- Uncomment the `"@/icons/nexture/*": ["./src/icons/phosphor/*"]` alias in `apps/web/tsconfig.json`.
- Mention: stubs fall back to Nexture; replace incrementally (see `apps/web/src/icons/README.md`).

**Auth: multi-tenant (default)** — nothing to do; remind the user to create the Supabase project, fill `apps/web/.env` and apply `packages/db/migrations/`.
**Auth: single-user** — keep Supabase auth but hide org UI: remove `apps/web/src/app/(dashboard)/settings/organization/` and `(dashboard)/invite/`, drop the Organization section from `settings/components/settings-menu.tsx`. Keep the DB migration (orgs unused but harmless) unless the user wants a trimmed migration.
**Auth: none** — remove `apps/web/src/middleware.ts` auth redirect logic (keep `updateSession` call out), auth pages under `src/app/auth/`, and `@gogo/auth`/`@gogo/db` deps from `apps/web/package.json` + `transpilePackages`; delete `packages/auth`, `packages/db`, `packages/email` if nothing else uses them.

**Email: no** — leave `RESEND_API_KEY` empty (graceful no-op). **Email: yes** — ask for the key later via env, remind about `EMAIL_FROM` domain verification and Supabase SMTP for auth emails.

**Mobile: yes** — keep `packages/design-tokens` TS mirror contract intact; note in CLAUDE.md that `apps/mobile` (Expo + React Native Paper) is planned. Do NOT scaffold it now unless asked.

**Prune demo content** (after explicit confirmation, per selection)
- UI showcase: delete `apps/web/src/app/(dashboard)/ui/`; remove its entries from `apps/web/src/menu-items.ts`.
- Docs: delete `apps/web/src/app/(dashboard)/docs/` + menu entries.
- Sample apps: delete `(dashboard)/applications/`, `(dashboard)/pages/`, unused dashboards + menu entries; keep `dashboards/default` (it is `DEFAULTS.appRoot`).
- Landing page: delete `apps/web/src/app/landing-page/` and remove `/landing-page` from `PUBLIC_PREFIXES` in `src/middleware.ts`.
- After any prune: check `menu-items.ts` compiles and grep for imports of deleted paths.

## Finish

1. `npm install` (root), `npm run build` — must pass.
2. Update this repo's `CLAUDE.md` files to reflect the choices (remaining structure, chosen icon set, auth model).
3. Delete this skill (`.claude/skills/init-project/`) from the derived repo — it is single-use.
4. Initial commit: `chore: initialize <project> from gogo-template`.
5. Report what was configured, what was pruned, and the pending manual steps (Supabase project + migration, Vercel project, env vars, OAuth providers, Resend domain).
