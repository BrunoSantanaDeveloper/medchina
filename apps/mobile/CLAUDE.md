# MedChina Mobile (apps/mobile)

Expo (SDK 57) + expo-router + React Native Paper — the MedChina companion app. Its product scope is CAPTURE, not review (PRD §11, docs/PRODUCT.md): consented audio recording, voice observations, resilient upload queue and processing status. NO checkout/purchase flows ever (store policy, PRD §4.4). Shares the MedChina identity with `apps/web` through `packages/*`. Before building or editing screens, load the `mobile-screen` skill; Expo/router specifics live in the `building-native-ui` skill, UX patterns in `mobile-app-ui-design`.

Expo has changed significantly across versions — see @AGENTS.md and the versioned docs it points to.

## Stack and conventions

- **Identity**: Paper MD3 themes are GENERATED from `@flyee/design-tokens` in `src/theme/index.ts` (the single MedChina Teal/Camel identity × light/dark). Never hardcode colors; dimensions come from the `native` tokens export (`RADIUS`, `MOTION`, `GRID` = 8pt grid, `TOUCH_TARGET` = 44).
- **Components**: React Native Paper first; custom components read `useTheme()`.
- **Navigation**: expo-router — routes in `app/`, `_layout.tsx` stacks, bottom `Tabs` for primary destinations, kebab-case filenames.
- **i18n**: `use-intl` with the shared catalogs from `@flyee/content/messages/*` (same keys/ICU as web's next-intl). App-shell strings live in the `mobile` namespace; locale names in `dashboard`. Every string goes through messages.
- **Auth**: `@flyee/auth/native` wired in `src/lib/supabase.ts` reading `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`. Without env the app stays browsable with a hint (same rule as web). The session is persisted through `src/lib/session-storage.ts` — AES-GCM over AsyncStorage, key in SecureStore — because a clinical refresh token must not sit in plain text (SecureStore alone cannot hold it: >2 KB). Auto-refresh is bound to AppState (`startAutoRefresh`/`stopAutoRefresh`), the documented React Native pattern.
- **Icons**: `@/icons/nexture/ni-*` RN adapters (react-native-svg) — port more with `node scripts/port-icons.mjs ni-name` (see `src/icons/README.md`).
- **Settings**: theme mode / locale persisted in AsyncStorage (`src/providers/settings.tsx`), defaults mirror web (`system`, `pt-BR`) in `src/config.ts` — keep in sync with `apps/web/src/config.ts`.
- **Path alias**: `@/*` → `./src/*`.

## Capture flow (the app's product, PRD §11)

- Routes: `(app)/index.tsx` = **today's consultations** (the home — reads `scheduled`/`in_progress` for today; the web agenda, PRD §9.3, is what fills it), `(app)/consulta/[id].tsx` = **Modo Consulta** (hidden from the tab bar with `href: null`; its header title is set per patient).
- Data access is `src/lib/clinical.ts` (today's list, `has_active_consent`, `org_audio_allowance`). Consent is granted on the web with the patient present (PRD §9.5). On the first eligible online AI capture, the server may atomically grant the free promotional allowance; this is an operational entitlement, with no plan, price, card, renewal, checkout, purchase link or commercial trial UI in the app. When no allowance is available, the app states only that capture is unavailable; contracting remains web-only (PRD §4.4, store policy).
- **Upload queue** (`src/lib/recording-queue.ts`, PRD §11/§12.4): the audio is moved out of cache into `Paths.document/recordings` the instant recording stops, and the queue survives restarts — a bad connection must never cost a consultation. States the UI says out loud: `local` (phone only) → `uploading` → `uploaded` (server confirmed). The device copy is deleted **only after** the server confirms (HOME-SPEC §22.3). A retry resumes from where it stopped (the `recordings` row id is kept) instead of inserting twice. `blocked` = the DB guards refused (no consent / no minutes): the audio is KEPT and the reason shown — never silently discarded.
- The database is the gate, not the app: the `recordings` insert is where consent (0022) and audio allowance (0024) triggers fire; the queue reads their errors rather than re-implementing the rules.
- Recording uses `expo-audio` (`useAudioRecorder` + `RecordingPresets.HIGH_QUALITY` → `.m4a`, matching the queue's MIME); the microphone permission string is in `app.json`'s `expo-audio` plugin.
- **The capture survives the phone being put down**: `enableBackgroundRecording` (app.json) + `allowsBackgroundRecording` (`setAudioModeAsync`) keep the microphone running under the iOS `audio` background mode and an Android microphone foreground service. A consultation lasts 40–60 min with the screen auto-locking; ending the capture on `AppState !== "active"` used to truncate it silently. Only "Encerrar" (or the 2 h cap) ends a recording. If the OS kills the process anyway, `active-capture` is recovered at next launch — audio is never discarded. Both stores must be told (see `docs/STORE-REVIEW.md`).
- **A failed read is never an empty day**: `src/lib/clinical.ts` returns `offline`/`not_found`/`unavailable` explicitly and falls back to `src/lib/clinical-cache.ts` (AES-GCM over AsyncStorage, scoped to the signed-in user and to TODAY, cleared on sign-out) so a phone with no signal still opens on the day's list. Consent reads return `null` (unknown) rather than `false` — offline, the cached authorization decides and the DB stays the gate.
- **Queue states the home is honest about**: `isAwaitingDelivery` (audio on the phone, moving on its own) drives the "aguardando envio" banner; `needsAttention` (`failed`/`blocked`/`quarantined`) drives the stopped-recordings section, which lists items from ANY day — a failure from yesterday must not be buried inside yesterday's consultation. Delivered rows are purged after `DELIVERED_RETENTION_DAYS`; anything still holding audio is never purged on a timer.

## Commands

- `npm run dev:mobile` (root) or `npm start` here — Expo dev server (Expo Go first; custom builds only when native code demands).
- `npx tsc --noEmit` — type check. `npx expo-doctor` — environment check.
- The capture flow's DATA contract is verified against the real database, but **microphone capture, expo-file-system and the RN upload body need a device/emulator run** — they cannot be exercised from Node.

## Boundaries (see .claude/rules/mobile-boundaries.md)

- Never import from `apps/web` — shared code lives in `packages/*` (`design-tokens`, `content`, `auth`).
- Mobile is not shrunken web: thumb-zone actions, tabs+stacks, limited type scale (≤4 sizes/2 weights per screen), ≥44pt touch targets, safe areas always.
