---
name: add-mobile
description: Restore the apps/mobile Expo app (pruned at /init-project time) from the template remote, in the standard flyee pattern — tokens → Paper theme, shared content, native auth. Single-use; delete after the app is restored.
---

# Add the mobile app to this project

This project pruned `apps/mobile` during `/init-project`. Everything needed to restore it lives in the flyee template — restore it from there instead of rebuilding, so the app arrives in the standard pattern (Paper themes generated from `@flyee/design-tokens`, shared `@flyee/content` copy, `@flyee/auth/native`) together with its harness knowledge (skills + rules).

## Steps

1. **Template remote**: `git remote -v` must show `template` (the flyee repo). If absent, ask the user for the template repo URL and `git remote add template <url>`. Then `git fetch template`.
2. **Restore the files** from the template:
   ```
   git checkout template/main -- apps/mobile .claude/skills/mobile-screen .claude/skills/building-native-ui .claude/skills/mobile-app-ui-design .claude/rules/mobile-boundaries.md
   ```
3. **Root script**: re-add `"dev:mobile": "npm run start -w @flyee/mobile"` to the root `package.json` scripts.
4. **i18n namespace**: the prune removed the `mobile` namespace from `packages/content/messages/*`. Merge it back WITHOUT clobbering the project's own copy: for each of the 5 locales, extract the `mobile` object from the template version (`git show template/main:packages/content/messages/<locale>.json`) and insert it into the project's file; adapt wording to the product where needed.
5. **Install**: `npm install` from the root (Expo/RN dependencies are heavy — expect a few minutes).
6. **Configure the app**:
   - `apps/mobile/app.json`: `name`/`slug`/`scheme` from `BRAND` (`packages/content`).
   - Copy `apps/mobile/.env.example` → `apps/mobile/.env` and fill `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY` (same Supabase project as web).
   - Sync `apps/mobile/src/config.ts` defaults (theme color, mode, locale) with `apps/web/src/config.ts`.
   - Icon/splash assets in `apps/mobile/assets/`: generate from the brand master logo if one exists (icon 1024, android foreground 1024 with ~66% art + transparent padding, splash 512 — `npx sharp-cli`), otherwise leave the placeholders and list this as pending art.
7. **Validate**: `npm run typecheck` (both apps — each uses its own pinned TypeScript) and start Expo (`npm run dev:mobile`) for a manual smoke test in Expo Go.
8. **Update the harness**: re-add to the root `CLAUDE.md` the `apps/mobile` structure entry, the `packages/content` mobile-consumer note and the `dev:mobile` command (copy the wording from `git show template/main:CLAUDE.md`).
9. **Finish**: delete this skill (`.claude/skills/add-mobile/`) — it is single-use — and commit: `feat: add mobile app from flyee template`.

## Boundaries reminder (now active again)

`apps/mobile` never imports from `apps/web`; identity comes exclusively from `@flyee/design-tokens` via `src/theme/index.ts`; copy from `@flyee/content`; load the `mobile-screen` skill before building screens.
