---
paths: ["apps/mobile/**"]
---

# apps/mobile boundaries

- Load the `mobile-screen` skill BEFORE creating or substantially editing screens; Expo/router specifics live in `building-native-ui`, UX patterns in `mobile-app-ui-design`.
- Never import from `apps/web`; only from `packages/*` (`@flyee/design-tokens`, `@flyee/content`, `@flyee/auth/native`).
- Visual components: React Native Paper, themed EXCLUSIVELY through `src/theme/index.ts` (generated from `@flyee/design-tokens`: `themes`, `common`, `native`, `hsl()`). Never hardcode colors or dimensions in screens.
- i18n messages come from `@flyee/content/messages/*` (shared with web); app-shell strings in the `mobile` namespace, all 5 locales.
- Icons only via `@/icons/nexture/ni-*` RN adapters — port missing ones with `node scripts/port-icons.mjs`, never import an icon library directly.
- Mobile is not shrunken web: primary actions in the thumb zone, navigation via Expo Router (tabs + stacks), type scale ≤4 sizes/2 weights, touch targets ≥44pt, safe areas always.
- Features must be functionally equivalent to their web counterpart (same validation rules and i18n messages from `packages/*`), expressed in the platform's visual language.
