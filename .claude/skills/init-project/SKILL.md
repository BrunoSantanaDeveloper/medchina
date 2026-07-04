---
name: init-project
description: Interactive quiz to turn a fresh flyee clone into a configured project — branding, icon set, auth model, packages to keep, demo content to prune. Run once, right after cloning the template into a new repository.
---

# Initialize a project derived from flyee

You are configuring a NEW project cloned from the flyee monorepo. Ask the quiz below with the AskUserQuestion tool (group related questions, max 4 per call), then apply the mapped actions. Show a summary of planned actions and get confirmation BEFORE any destructive step (deleting demo content). Finish with install, build, and an initial commit.

## Quiz

**Round 1 — identity**
1. Project name, tagline and one-line description? (free text — used for `apps/web/src/brand.ts`, package names, `NEXT_PUBLIC_TITLE`, CLAUDE.md)
2. Branding: keep the 4 demo color themes with runtime switcher, or lock a single brand palette? If brand: ask for the primary color (hex or HSL) and whether dark mode is needed.
3. Brand assets: does the user have logo SVG(s) (wordmark + compact mark) and favicon PNGs ready? Ask for file paths or for the files to be dropped into the repo. Without assets, keep the placeholder and note the fallback: a text wordmark (brand name in `font-display`, primary token color) — nothing ships half-branded.
4. Icon set: Nexture (default) or Phosphor?
5. Default locale? (template default: en; available: de, en, es, fr, pt-BR)

**Round 2 — platform**
6. Auth model: multi-tenant organizations (default), single-user (no orgs), or no auth (public site/dashboard)?
7. Transactional email at launch? (requires a Resend key; invites fall back to copyable links without it; the public contact form also needs `CONTACT_FORM_TO`)
8. Mobile app (Expo) planned for this project?
9. Background jobs/cron needed at launch? (Inngest — not yet scaffolded; if yes, plan `packages/jobs`)

**Round 3 — content**
10. **Marketing site**: keep the public site (`app/(marketing)`: home, /pricing, /about, /contact, /legal) or prune it? If keeping, ask which pages stay.
11. Other demo content to keep as reference vs. prune now. Offer multiSelect: UI showcase (`(dashboard)/ui`, ~518 files), template docs (`(dashboard)/docs`), sample apps (`(dashboard)/applications`, `(dashboard)/pages`, `(dashboard)/dashboards` extras). Recommend keeping UI showcase during development and pruning before launch.

## Actions by answer

**Identity**
- Rewrite `apps/web/src/brand.ts` (name, tagline, description; `NEXT_PUBLIC_SITE_URL` note for production). Root `package.json` name, `apps/web` `NEXT_PUBLIC_TITLE` in `.env`; rewrite root `CLAUDE.md` header: it now describes THIS product (remove "this is the template base" warnings — derived repos hold real business logic; keep structure/commands sections).
- Locale: `DEFAULTS.locale` in `apps/web/src/config.ts`.

**Brand assets**
- Logo: replace the SVGs in `apps/web/src/components/logo/logo.tsx` keeping the contract documented there (full + mobile variants, token tinting). Also replace `apps/web/public/images/email/logo.svg`.
- Favicons: replace `apps/web/public/favicon/{light,dark}.png` (paths come from `brand.ts` — keep the theme-agnostic names).
- No assets yet: render the brand name as a text wordmark in `logo.tsx` (`font-display`, primary token color) so nothing ships half-branded; revisit when the final SVGs exist.
- The shared OG image (`app/(marketing)/opengraph-image.tsx`) reads `brand.ts` + tokens — no per-asset work needed.

**Branding (single palette)**
- Edit `packages/design-tokens/css/green.css` (or the closest hue) with the brand HSL values; keep the light/dark block structure.
- `npm run tokens:generate` and commit the regenerated mirror.
- Set `DEFAULTS.themeColor` in `apps/web/src/config.ts`; optionally remove the other theme CSS imports from `src/style/global.css` and their entries in `THEME_OPTIONS` (`src/constants.ts`) to hide the switcher options.

**Icons: Phosphor**
- `npm run icons:stubs -w @flyee/web`
- Uncomment the `"@/icons/nexture/*": ["./src/icons/phosphor/*"]` alias in `apps/web/tsconfig.json`.
- Mention: stubs fall back to Nexture; replace incrementally (see `apps/web/src/icons/README.md`).

**Auth: multi-tenant (default)** — nothing to do; remind the user to create the Supabase project, fill `apps/web/.env` and apply `packages/db/migrations/`.
**Auth: single-user** — keep Supabase auth but hide org UI: remove `apps/web/src/app/(dashboard)/settings/organization/` and `(dashboard)/invite/`, drop the Organization section from `settings/components/settings-menu.tsx`. Keep the DB migration (orgs unused but harmless) unless the user wants a trimmed migration.
**Auth: none** — remove `apps/web/src/middleware.ts` auth redirect logic (keep `updateSession` call out), auth pages under `src/app/auth/`, and `@flyee/auth`/`@flyee/db` deps from `apps/web/package.json` + `transpilePackages`; delete `packages/auth`, `packages/db`, `packages/email` if nothing else uses them.

**Email: no** — leave `RESEND_API_KEY` empty (graceful no-op). **Email: yes** — ask for the key later via env, remind about `EMAIL_FROM` domain verification and Supabase SMTP for auth emails.

**Mobile: yes** — keep `packages/design-tokens` TS mirror contract intact; note in CLAUDE.md that `apps/mobile` (Expo + React Native Paper) is planned. Do NOT scaffold it now unless asked.

**Marketing site: keep**
- Load the `marketing-page` skill and rewrite the `marketing` namespace copy in ALL locale files (`de,en,es,fr,pt-BR`) from the branding answers (product, audience, main outcome), following the skill's conversion + anti-AI-copy rules.
- Remove unwanted pages: delete the page folder under `app/(marketing)/`, its `PUBLIC_PREFIXES` entry in `src/middleware.ts`, its `sitemap.ts` entry, and its header/footer links.
- Hero imagery: real product screenshots in `<ProductFrame>`; AI generation tools are optional — without one, the `marketing-page` skill produces ready-to-run generation prompts and the token placeholder keeps working meanwhile.

**Marketing site: prune**
- Delete `apps/web/src/app/(marketing)/` and `apps/web/src/components/marketing/`; make `/` redirect to `/auth/sign-in` (new minimal `app/page.tsx`).
- Trim `PUBLIC_PREFIXES` in `src/middleware.ts` to `["/auth", "/verify"]`; delete `app/sitemap.ts` + `app/robots.ts` (or keep them pointing only at `/`).
- Remove the `marketing` namespace from all message files; remove `gsap`/`@gsap/react` from `apps/web/package.json` if nothing else uses them.
- Delete the `marketing-page` and `gsap-*` skills plus `.claude/rules/marketing.md`.

**Prune demo content** (after explicit confirmation, per selection)
- UI showcase: delete `apps/web/src/app/(dashboard)/ui/`; remove its entries from `apps/web/src/menu-items.ts`.
- Docs: delete `apps/web/src/app/(dashboard)/docs/` + menu entries.
- Sample apps: delete `(dashboard)/applications/`, `(dashboard)/pages/`, unused dashboards + menu entries; keep `dashboards/default` (it is `DEFAULTS.appRoot`).
- After any prune: check `menu-items.ts` compiles and grep for imports of deleted paths.

## Finish

1. `npm install` (root), `npm run build` — must pass.
2. Update this repo's `CLAUDE.md` files to reflect the choices (remaining structure, chosen icon set, auth model).
3. Delete this skill (`.claude/skills/init-project/`) from the derived repo — it is single-use.
4. Initial commit: `chore: initialize <project> from flyee`.
5. Report what was configured, what was pruned, and the pending manual steps (Supabase project + migration, Vercel project, env vars, OAuth providers, Resend domain).
