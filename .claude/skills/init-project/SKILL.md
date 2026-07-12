---
name: init-project
description: Interactive quiz to turn a fresh flyee clone into a configured project — branding, icon set, auth model, packages to keep, demo content to prune. Run once, right after cloning the template into a new repository.
---

# Initialize a project derived from flyee

You are configuring a NEW project cloned from the flyee monorepo. Run **Step 0 first** (repository safety), then ask the quiz with the AskUserQuestion tool (group related questions, max 4 per call) and apply the mapped actions. Show a summary of planned actions and get confirmation BEFORE any destructive step (deleting demo content). Finish with install, build, and an initial commit.

## Step 0 — repository safety (BEFORE anything else)

The single worst failure mode of this skill is pushing the new project INTO the template repository. Neutralize it before the quiz:

1. `git remote -v`. If a remote named `template` already exists and `origin` points elsewhere, skip to the quiz.
2. If `origin` points at the flyee template repo (fresh clone): confirm with the user that this working copy is meant to become a NEW project — if they answer "no, this IS the template", STOP: this skill must never run inside the template itself.
3. `git remote rename origin template` — from this moment no push can reach the template by accident.
4. Right after Round 1 (the project name is known): create the project's own **private** repository and push the base:
   - With gh CLI: `gh repo create <project-slug> --private --source . --push`
   - Without gh: ask the user to create a private repo and give you the URL, then `git remote add origin <url>` and `git push -u origin main`.
5. From here on, all pushes go to `origin`; `template` is fetch-only (used later by `/update-from-template` and `/add-mobile`).

## Quiz

**Round 1 — identity**
1. Project name, tagline and one-line description? (free text — used for `apps/web/src/brand.ts`, package names, `NEXT_PUBLIC_TITLE`, CLAUDE.md)
2. Branding — three levels:
   a. **Keep the 4 demo color themes** with runtime switcher (nothing else to ask), or lock a **single brand palette**.
   b. If single palette: does the project have a **full brand manual** or just a primary color?
      - **Primary only**: ask for the primary (hex or HSL). The agent DERIVES secondary, accents and the light/dark variants of each color.
      - **Brand manual**: also ask for secondary and up to 4 accent colors (any may be skipped → derived), and whether the light/dark variants of each color should be calculated (default: shift lightness, keep hue/saturation) or provided exactly.
   c. Dark mode needed? (always asked for single palette)
3. Brand assets — three levels:
   - **Full set ready** (logo SVGs wordmark + compact mark, favicon PNGs): ask for the files to be dropped into `attachments/` (or for paths).
   - **One master logo only** (SVG or PNG ≥1024×1024, dropped into `attachments/`): the derived assets are GENERATED from it (see Brand assets actions).
   - **No assets yet**: keep the placeholder and note the fallback: a text wordmark (brand name in `font-display`, primary token color) — nothing ships half-branded.
4. Icon set: Nexture (default) or Phosphor?
5. Default locale? (template default: en; available: de, en, es, fr, pt-BR) — **this is the only search-indexable language**: i18n is cookie-based, so crawlers and AI engines see ONLY the default. A Brazil-first project MUST pick pt-BR (otherwise the indexed site is English); a genuinely multilingual, indexable site needs `/[locale]/` routing — flag that as a follow-up, don't silently ship the wrong default.

**Round 2 — platform**
6. Auth model: multi-tenant organizations (default), single-user (no orgs), or no auth (public site/dashboard)?
7. Transactional email at launch? (requires a Resend key; invites fall back to copyable links without it; the public contact form also needs `CONTACT_FORM_TO`)
8. Mobile app: keep the scaffolded `apps/mobile` (Expo + RN Paper shell with sign-in, tabs and settings) or prune it?
9. Which capability packages will this project use at launch? (multiSelect)
   - Billing (Stripe/Asaas subscriptions, credits, coupons — `/admin/billing`, `/settings/billing`)
   - AI assistants (+ optional knowledge base RAG — `/admin/ai`, `/admin/knowledge`)
   - External API connectors (`/settings/connections` — the project implements its own `Connector`s)
   - Audio transcription (`@flyee/transcribe`)
   - WhatsApp dispatcher (Meta Cloud API or Evolution)
   - Verifiable documents (`/verify/[code]`)
   - Audit/compliance (row versioning + consents — the project marks its tables)
   - Onboarding/activation (checklists + setup wizards — `@flyee/onboarding`; the project declares the steps)

**Round 3 — content**
10. **Marketing site**: keep the public site (`app/(marketing)`: home, /pricing, /about, /contact, /help, /blog, /legal) or prune it? If keeping, ask which pages stay — /help and /blog are DB-managed (superadmin writes content in `/admin/help` and `/admin/blog`, no deploy needed); pruning either also removes its admin console, migration usage note and footer link.
10b. **Quick-support widget**: which channels for the floating support button (`BRAND.support` in `packages/content/src/index.ts`)? WhatsApp number (digits with country code), support email, both, or none (widget hidden until a human channel is set).
11. Other demo content to keep as reference vs. prune now. Offer multiSelect: UI showcase (`(dashboard)/ui`, ~518 files), template docs (`(dashboard)/docs`), sample apps (`(dashboard)/applications`, `(dashboard)/pages`, `(dashboard)/dashboards` extras). Recommend keeping UI showcase during development and pruning before launch.
12. **Product brief** (optional but recommended): does the user have a detailed product description/PRD? Paste it, point to a file, or drop it into `attachments/`. Explain why it matters: it becomes the versioned product memory every future agent session starts from.

## Actions by answer

**Attachments inbox (always)**
- Before acting on any answer, list `attachments/` — the user may have dropped material there (brand art, imagery, briefs). Route every file to its canonical home per `attachments/README.md` (`git mv`, never copy); brand masters go to `packages/content/brand/` before derivatives are generated. Anything that fits no routing row: ask, don't guess.

**Identity**
- Rewrite `BRAND` in `packages/content/src/index.ts` (name, tagline, description; `NEXT_PUBLIC_SITE_URL` note for production) — shared by web and mobile. Root `package.json` name, `apps/web` `NEXT_PUBLIC_TITLE` in `.env`; rewrite root `CLAUDE.md` header: it now describes THIS product (remove "this is the template base" warnings — derived repos hold real business logic; keep structure/commands sections).
- Locale: `DEFAULTS.locale` in `apps/web/src/config.ts`. This is the search-indexable language (cookie-based i18n) — set it to the primary market's language, not a leftover `en`.

**Brand assets**
- Logo: replace the SVGs in `apps/web/src/components/logo/logo.tsx` keeping the contract documented there (full + mobile variants, token tinting). Also replace `apps/web/public/images/email/logo.svg`.
- Favicons: replace `apps/web/public/favicon/{light,dark}.png` (paths come from `brand.ts` — keep the theme-agnostic names).
- **Master logo provided → generate the set** (use `npx` tools, do NOT add repo dependencies):
  - `apps/web/public/favicon/light.png` and `dark.png` at 512×512 (`npx sharp-cli resize`; dark variant = same art unless a dark master was given).
  - `apps/web/public/favicon.ico` (32+16) via `npx png-to-ico` — legacy fallback for clients that blindly fetch `/favicon.ico` (the template ships none).
  - Mobile, if kept: `apps/mobile/assets/icon.png` 1024×1024, `android-icon-foreground.png` 1024 (art at ~66% with transparent padding — Android crops a circle), `splash-icon.png` 512.
  - Visually inspect each generated file (Read the image) before committing — automated resizes can clip or look muddy at 16px.
- No assets yet: render the brand name as a text wordmark in `logo.tsx` (`font-display`, primary token color) so nothing ships half-branded; revisit when the final SVGs exist.
- The shared OG image (`app/(marketing)/opengraph-image.tsx`) reads `brand.ts` + tokens — no per-asset work needed.

**Branding (single palette)**
- Build the full token palette from the answers. Every theme file carries `primary`, `secondary`, `accent-1..4`, EACH with `-light`/`-dark` variants, in light AND dark blocks (`.theme-x` / `.theme-x.dark`) — the structure is mandatory (see `.claude/rules/design-tokens.md`); values are bare HSL triplets.
- Derivation rules for anything not provided: secondary = primary hue shifted ~30–40° (keep saturation family); accents = harmonic hues (analogous/complementary) at similar saturation; `-light`/`-dark` variants = same hue/saturation, lightness ±12–18%; dark-block values = reduce saturation slightly and adjust lightness for contrast on dark surfaces. Check text contrast (`text-contrast` token) against the resulting primary/secondary.
- **Show the derived palette for approval BEFORE writing tokens**: render every color as an HSL value list (name → triplet, light and dark) and get an explicit OK — derived colors are a proposal, not a decision.
- Then edit `packages/design-tokens/css/green.css` (or the closest hue to the primary) with the approved values; keep the light/dark block structure untouched.
- `npm run tokens:generate` and commit the regenerated mirror (web CSS vars and the mobile Paper theme both come from it — no app-side work).
- Set `DEFAULTS.themeColor` in `apps/web/src/config.ts` (and `apps/mobile/src/config.ts` if mobile was kept); optionally remove the other theme CSS imports from `src/style/global.css` and their entries in `THEME_OPTIONS` (`src/constants.ts`) to hide the switcher options.

**Icons: Phosphor**
- `npm run icons:stubs -w @flyee/web`
- Uncomment the `"@/icons/nexture/*": ["./src/icons/phosphor/*"]` alias in `apps/web/tsconfig.json`.
- Mention: stubs fall back to Nexture; replace incrementally (see `apps/web/src/icons/README.md`).

**Auth: multi-tenant (default)** — nothing to do; remind the user to create the Supabase project, fill `apps/web/.env` and apply `packages/db/migrations/`.
**Auth: single-user** — keep Supabase auth but hide org UI: remove `apps/web/src/app/(dashboard)/settings/organization/` and `(dashboard)/invite/`, drop the Organization section from `settings/components/settings-menu.tsx`. KEEP all DB migrations: every capability package scopes data through the user's auto-created org, so orgs keep powering RLS even single-user.
**Auth: none** — remove `apps/web/src/middleware.ts` auth redirect logic (keep `updateSession` call out) and auth pages under `src/app/auth/`. Warn clearly: every capability package (billing, AI, knowledge, connectors, transcribe, whatsapp, documents, audit) depends on Supabase + orgs — this option only fits pure marketing/showcase sites with no selected capabilities.

**Capability packages** — packages NOT selected stay in place: they are inert without env keys, and keeping them makes future `git merge template/main` clean. Never delete `packages/*`. For each SELECTED capability, record it as active in the project CLAUDE.md and add its setup to the pending list reported at the end:
- Billing: `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` and/or `ASAAS_API_KEY`/`ASAAS_WEBHOOK_TOKEN`; webhooks at `/api/webhooks/[provider]`.
- AI/knowledge: `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`OPENROUTER_API_KEY`; knowledge (and transcribe) require `GEMINI_API_KEY`.
- Connectors: implement `Connector`s and register them in `apps/web/src/lib/connectors.ts`.
- WhatsApp: `WHATSAPP_PROVIDER` + provider keys; webhook at `/api/webhooks/whatsapp/[provider]`; Meta templates must be approved in the Meta panel.
- Audit: mark sensitive tables via `select public.enable_row_versioning('public.<table>');` in project migrations.
- Onboarding: declare the activation steps (`OnboardingStep[]`) in the project's code and render `OnboardingChecklist` on the app home; no env vars. The `product-screen` skill governs every app screen regardless of this selection.
- Any async capability (knowledge/connectors/transcribe/whatsapp) needs Inngest: local `npx inngest-cli dev`; production `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`.

**Email: no** — leave `RESEND_API_KEY` empty (graceful no-op). **Email: yes** — ask for the key later via env, remind about `EMAIL_FROM` domain verification and Supabase SMTP for auth emails.

**Mobile: keep** — `apps/mobile` (Expo + expo-router + RN Paper) is already scaffolded. Update `apps/mobile/app.json` (name/slug from the brand answers) and its icon/splash assets in `apps/mobile/assets/`; remind about `apps/mobile/.env.example` → `.env` with `EXPO_PUBLIC_SUPABASE_*` (same Supabase project as web); defaults in `apps/mobile/src/config.ts` follow the chosen theme/locale. Delete `.claude/skills/add-mobile/` — it only serves projects that pruned mobile.
**Mobile: prune** — delete `apps/mobile/`; remove the `dev:mobile` root script; delete the `mobile-screen`, `building-native-ui` and `mobile-app-ui-design` skills plus `.claude/rules/mobile-boundaries.md`; remove the `mobile` namespace from `packages/content/messages/*` and the `native` consumers note in CLAUDE.md (keep the tokens `native` export — it is generated and harmless). KEEP `.claude/skills/add-mobile/` and note in the final report: run `/add-mobile` whenever the project needs the app later — it restores everything from the template remote in the standard pattern.

**Product brief provided**
- Save it verbatim (light formatting only) to `docs/PRODUCT.md` — the versioned product memory of the derived repo.
- Add a ~10-line product summary to the rewritten root `CLAUDE.md` with a "See docs/PRODUCT.md" pointer (shallow context always loaded, deep context on demand — same pattern as package READMEs).
- Use it as the primary input for the marketing copy rewrite, and cross-check the capability selections against it (e.g. the brief mentions patient confirmations via WhatsApp but WhatsApp was not selected → flag the mismatch before finishing).

**No product brief** — recommend creating `docs/PRODUCT.md` in the first working session, before feature work starts; note it in the final report.

**Marketing site: keep**
- Load the `marketing-page` skill and run its Pass 0 direction engine for THIS product (category + brand answers + `docs/PRODUCT.md`). **The choice is visual (Pass 0.B.3)**: generate 2–3 self-contained HTML previews of distinct candidate directions (real token values + candidate font pairing), show them side by side (Artifact when available, else files the user opens) and let the user pick with AskUserQuestion — this quiz is exactly the interactive session that flow was designed for. Then **commit the chosen direction to `docs/DESIGN.md`** (rewrite the template's reference values). This is the persisted visual memory every later page inherits — from here on the direction is STRICT (no re-styling without an explicit "redesign").
- **Commit the search direction to `docs/SEO.md`**: rewrite the per-page target-term table from `docs/PRODUCT.md` (each kept page → its primary keyword + intent; money pages first), keeping the "what the template guarantees automatically" section intact. This is the SEO counterpart of `docs/DESIGN.md` — the `marketing-page` skill reads it when writing titles and copy. If the marketing site is pruned, delete this file (see below).
- Load the committed display font via `next/font` in the root layout and set `--font-display` (typography is a blocking decision — never leave marketing on the admin font).
- Rewrite the `marketing` namespace copy in ALL locale files (`de,en,es,fr,pt-BR`) from the branding answers AND `docs/PRODUCT.md`, following the skill's conversion + anti-AI-copy rules. Build the home page to the premium bar (product evidence above the fold, ≥2 archetypes, background varies, density + motion checks).
- Remove unwanted pages: delete the page folder under `app/(marketing)/`, its `PUBLIC_PREFIXES` entry in `src/middleware.ts`, its `sitemap.ts` entry, and its header/footer links.
- Hero imagery: real product screenshots in `<ProductFrame glow>` (or `<DataVizPlaceholder>` for data products); AI generation tools are optional — without one, the `marketing-page` skill produces ready-to-run generation prompts and the token placeholder keeps working meanwhile.

**Marketing site: prune** (note below) — also delete `docs/DESIGN.md` and `docs/SEO.md` (no public pages to govern).

**Marketing site: prune**
- Delete `apps/web/src/app/(marketing)/` and `apps/web/src/components/marketing/`; make `/` redirect to `/auth/sign-in` (new minimal `app/page.tsx`).
- Trim `PUBLIC_PREFIXES` in `src/middleware.ts` to `["/auth", "/verify"]`; delete `app/sitemap.ts` + `app/robots.ts` (or keep them pointing only at `/`).
- Remove the `marketing` namespace from all message files; remove `gsap`/`@gsap/react` from `apps/web/package.json` if nothing else uses them.
- Delete the `marketing-page` and `gsap-*` skills plus `.claude/rules/marketing.md`.

**Prune demo content** (after explicit confirmation, per selection)
- UI showcase: delete `apps/web/src/app/(dashboard)/ui/`; remove its entries from `apps/web/src/menu-items.ts`.
- Docs: delete `apps/web/src/app/(dashboard)/docs/` + menu entries.
- Sample apps: delete `(dashboard)/applications/`, `(dashboard)/pages/`, unused dashboards + menu entries; keep `dashboards/default` (it is `DEFAULTS.appRoot`). If AI was selected, KEEP `applications/ai-chat/new-chat` + `applications/ai-chat/components` (the wired assistant chat).
- After any prune: check `menu-items.ts` compiles and grep for imports of deleted paths.

## Finish

1. Copy `apps/web/.env.example` → `apps/web/.env` (gitignored) and fill what is already known (title, locale). Real keys are added by the user later — never commit them.
2. Check `attachments/` is empty again (only its README) — everything routed to canonical homes.
3. `npm install` (root), `npm run build` — must pass.
4. Update this repo's `CLAUDE.md` files to reflect the choices (remaining structure, chosen icon set, auth model, active capability packages, product summary + `docs/PRODUCT.md` pointer).
5. Delete this skill (`.claude/skills/init-project/`) from the derived repo — it is single-use. KEEP `update-from-template` (reusable forever) and, when mobile was pruned, `add-mobile`.
6. Initial commit: `chore: initialize <project> from flyee`. Before pushing, assert `git remote get-url origin` is NOT the template URL (Step 0 guarantee) — then push to `origin`.
7. Report what was configured, what was pruned, and the pending manual steps:
   - Supabase project + apply ALL migrations in `packages/db/migrations/` in order (0003 enables pgvector) + enable TOTP MFA in Auth settings if 2FA will be used.
   - Bootstrap the platform superadmin (`update public.profiles set is_superadmin = true where id = '<uuid>'`) — the `/admin` consoles (metrics, organizations/users, billing, AI, knowledge, audit, insights, backups, announcements, help center, blog) are invisible without it. `SUPABASE_SERVICE_ROLE_KEY` enables user ban/unban, 2FA state + 2FA reset and auth-side info in `/admin/organizations`.
   - `/admin/insights` (ask the database in plain language) needs `DATABASE_URL` + one AI provider key; `/admin/backups` needs `DATABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, and its nightly cron only fires with `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` (without them, backups run inline when triggered by hand).
   - Vercel project rooted at `apps/web`; env vars mirrored from `.env`, including `NEXT_PUBLIC_SITE_URL` (the canonical origin, no trailing slash) — `sitemap.ts`, `robots.ts`, the OG image and every JSON-LD URL fall back to `localhost` without it.
   - Per selected capability: provider dashboards (Stripe/Asaas webhooks, Meta WhatsApp templates + webhook + verify token, Inngest app URL, Resend domain, OAuth providers).
   - Brand art still pending, if any (logo SVGs, favicons, email logo).
