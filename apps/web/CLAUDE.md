# Gogo Web (apps/web)

Next.js 15 (App Router) + React 19 admin template.

## Stack and conventions

- **UI**: MUI v9 is the base — before building a component from scratch, check for an existing MUI or MUI X equivalent (DataGrid Premium, Charts Pro, Date Pickers Pro, Tree View are already installed). Icons: individual named imports from `@mui/icons-material`.
- **Styling**: MUI theme driven by CSS variables (`hsl(var(--token))`) defined in `@gogo/design-tokens`. MUI component overrides live in `src/style/**/*.css` (organized by category), inside CSS layers (`theme, base, mui, components, utilities`). Tailwind 4 only for layout utilities; classes merged with `tailwind-merge`.
- **Themes**: 4 color themes × light/dark, switched via classes on `<html>` (`theme-blue dark` etc.) by the `ThemeProvider` (`src/theme/theme-provider.tsx`).
- **Forms**: Formik + Yup.
- **i18n**: next-intl — every UI string goes through messages, never hardcoded.
- **Path alias**: `@/*` → `./src/*`.

## Commands (run from the monorepo root)

- `npm run dev` — dev server with turbopack
- `npm run build` — production build
- `npm run lint:fix` / `npm run prettier` — lint and formatting
- `npm run cf-typegen` — regenerate types after changing `wrangler.jsonc`

## Watch out

- `src/style/global.css` imports tokens from `@gogo/design-tokens/css/*` — do not recreate tokens locally.
- Deployment target is Cloudflare Workers via OpenNext: avoid Node APIs unavailable in that runtime in server code.
