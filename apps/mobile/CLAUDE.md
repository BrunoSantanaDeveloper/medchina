# MedChina Mobile (apps/mobile)

Expo (SDK 57) + expo-router + React Native Paper — the MedChina companion app. Its product scope is CAPTURE, not review (PRD §11, docs/PRODUCT.md): consented audio recording, voice observations, resilient upload queue and processing status. NO checkout/purchase flows ever (store policy, PRD §4.4). Shares the MedChina identity with `apps/web` through `packages/*`. Before building or editing screens, load the `mobile-screen` skill; Expo/router specifics live in the `building-native-ui` skill, UX patterns in `mobile-app-ui-design`.

Expo has changed significantly across versions — see @AGENTS.md and the versioned docs it points to.

## Stack and conventions

- **Identity**: Paper MD3 themes are GENERATED from `@flyee/design-tokens` in `src/theme/index.ts` (4 color themes × light/dark, same hues as web). Never hardcode colors; dimensions come from the `native` tokens export (`RADIUS`, `MOTION`, `GRID` = 8pt grid, `TOUCH_TARGET` = 44).
- **Components**: React Native Paper first; custom components read `useTheme()`.
- **Navigation**: expo-router — routes in `app/`, `_layout.tsx` stacks, bottom `Tabs` for primary destinations, kebab-case filenames.
- **i18n**: `use-intl` with the shared catalogs from `@flyee/content/messages/*` (same keys/ICU as web's next-intl). App-shell strings live in the `mobile` namespace; locale names in `dashboard`. Every string goes through messages.
- **Auth**: `@flyee/auth/native` (supabase-js + AsyncStorage) wired in `src/lib/supabase.ts` reading `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`. Without env the app stays browsable with a hint (same rule as web).
- **Icons**: `@/icons/nexture/ni-*` RN adapters (react-native-svg) — port more with `node scripts/port-icons.mjs ni-name` (see `src/icons/README.md`).
- **Settings**: theme color / mode / locale persisted in AsyncStorage (`src/providers/settings.tsx`), defaults mirror web (`green` — the locked MedChina Teal/Camel palette, `system`, `pt-BR`) in `src/config.ts` — keep in sync with `apps/web/src/config.ts`.
- **Path alias**: `@/*` → `./src/*`.

## Capture flow (the app's product, PRD §11)

- Routes: `(app)/index.tsx` = **today's consultations** (the home — reads `scheduled`/`in_progress` for today; the web agenda, PRD §9.3, is what fills it), `(app)/consulta/[id].tsx` = **Modo Consulta** (hidden from the tab bar with `href: null`; its header title is set per patient).
- Data access is `src/lib/clinical.ts` (today's list, `has_active_consent`, `org_audio_allowance`). The app **verifies**, it never grants or sells: consent is granted on the web with the patient present (PRD §9.5), and the app NEVER starts a trial or takes payment (PRD §4.4, store policy) — with no allowance it states the fact and points to the web.
- **Upload queue** (`src/lib/recording-queue.ts`, PRD §11/§12.4): the audio is moved out of cache into `Paths.document/recordings` the instant recording stops, and the queue survives restarts — a bad connection must never cost a consultation. States the UI says out loud: `local` (phone only) → `uploading` → `uploaded` (server confirmed). The device copy is deleted **only after** the server confirms (HOME-SPEC §22.3). A retry resumes from where it stopped (the `recordings` row id is kept) instead of inserting twice. `blocked` = the DB guards refused (no consent / no minutes): the audio is KEPT and the reason shown — never silently discarded.
- The database is the gate, not the app: the `recordings` insert is where consent (0022) and audio allowance (0024) triggers fire; the queue reads their errors rather than re-implementing the rules.
- Recording uses `expo-audio` (`useAudioRecorder` + `RecordingPresets.HIGH_QUALITY` → `.m4a`, matching the queue's MIME); the microphone permission string is in `app.json`'s `expo-audio` plugin.

## Commands

- `npm run dev:mobile` (root) or `npm start` here — Expo dev server (Expo Go first; custom builds only when native code demands).
- `npx tsc --noEmit` — type check. `npx expo-doctor` — environment check.
- The capture flow's DATA contract is verified against the real database, but **microphone capture, expo-file-system and the RN upload body need a device/emulator run** — they cannot be exercised from Node.

## Boundaries (see .claude/rules/mobile-boundaries.md)

- Never import from `apps/web` — shared code lives in `packages/*` (`design-tokens`, `content`, `auth`).
- Mobile is not shrunken web: thumb-zone actions, tabs+stacks, limited type scale (≤4 sizes/2 weights per screen), ≥44pt touch targets, safe areas always.
