# Flyee Mobile (apps/mobile)

Expo (SDK 57) + expo-router + React Native Paper app sharing the flyee identity with `apps/web` through `packages/*`. Before building or editing screens, load the `mobile-screen` skill; Expo/router specifics live in the `building-native-ui` skill, UX patterns in `mobile-app-ui-design`.

Expo has changed significantly across versions — see @AGENTS.md and the versioned docs it points to.

## Stack and conventions

- **Identity**: Paper MD3 themes are GENERATED from `@flyee/design-tokens` in `src/theme/index.ts` (4 color themes × light/dark, same hues as web). Never hardcode colors; dimensions come from the `native` tokens export (`RADIUS`, `MOTION`, `GRID` = 8pt grid, `TOUCH_TARGET` = 44).
- **Components**: React Native Paper first; custom components read `useTheme()`.
- **Navigation**: expo-router — routes in `app/`, `_layout.tsx` stacks, bottom `Tabs` for primary destinations, kebab-case filenames.
- **i18n**: `use-intl` with the shared catalogs from `@flyee/content/messages/*` (same keys/ICU as web's next-intl). App-shell strings live in the `mobile` namespace; locale names in `dashboard`. Every string goes through messages.
- **Auth**: `@flyee/auth/native` (supabase-js + AsyncStorage) wired in `src/lib/supabase.ts` reading `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`. Without env the app stays browsable with a hint (same rule as web).
- **Icons**: `@/icons/nexture/ni-*` RN adapters (react-native-svg) — port more with `node scripts/port-icons.mjs ni-name` (see `src/icons/README.md`).
- **Settings**: theme color / mode / locale persisted in AsyncStorage (`src/providers/settings.tsx`), defaults mirror web (`green`, `system`, `en`) in `src/config.ts` — keep in sync with `apps/web/src/config.ts`.
- **Path alias**: `@/*` → `./src/*`.

## Commands

- `npm run dev:mobile` (root) or `npm start` here — Expo dev server (Expo Go first; custom builds only when native code demands).
- `npx tsc --noEmit` — type check. `npx expo-doctor` — environment check.

## Boundaries (see .claude/rules/mobile-boundaries.md)

- Never import from `apps/web` — shared code lives in `packages/*` (`design-tokens`, `content`, `auth`).
- Mobile is not shrunken web: thumb-zone actions, tabs+stacks, limited type scale (≤4 sizes/2 weights per screen), ≥44pt touch targets, safe areas always.
