# Gogo Template — Monorepo

Reusable commercial template (admin + future mobile versions). This repo is the BASE for other projects: changes must stay generic, with no business logic from any specific derived project.

## Structure

- `apps/web` — Next.js 15 (App Router) + MUI v9 + MUI X Premium + Tailwind 4, deployed via OpenNext/Cloudflare Workers. See `apps/web/CLAUDE.md`.
- `packages/design-tokens` — design system source of truth (CSS tokens + generated TS mirror). See `packages/design-tokens/README.md`.
- `apps/mobile` — (future) Expo + React Native Paper, consuming the same tokens.

## Golden rules

- Visual identity (colors, themes, shadows, radii) changes ONLY in `packages/design-tokens/css/*.css`. Never hardcode theme values in an app.
- After changing token CSS, run `npm run tokens:generate` and commit the updated `tokens.generated.ts` together.
- Apps never import from other apps (`apps/web` ↛ `apps/mobile` and vice versa); shared code lives in `packages/*`.
- npm workspaces: always install dependencies from the root (`npm install`), never inside an app.

## Commands (root)

- `npm run dev` / `build` / `lint:fix` — delegate to `apps/web`
- `npm run preview` / `deploy` — OpenNext build + Cloudflare
- `npm run tokens:generate` — regenerate the TS token mirror
