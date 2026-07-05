---
name: mobile-screen
description: Design playbook for apps/mobile screens (Expo + React Native Paper). Use BEFORE creating or substantially editing any mobile screen — it keeps the app on the shared flyee identity (design tokens → Paper theme) while following NATIVE mobile patterns instead of shrinking the web UI.
---

# Mobile screen playbook

You are building a native app screen that must feel like a phone app AND look like this product. Both constraints are hard: platform patterns come first, identity comes from the tokens — never from copying web layouts.

## Identity (non-negotiable)

- **Colors only through the token theme.** The Paper MD3 themes in `apps/mobile/src/theme/` are generated from `@flyee/design-tokens` (`themes`/`common` + `hsl()`). Never hardcode hex values, never use Google's baseline Material colors, never invent a palette. All 4 color themes × light/dark must look right.
- **Dimensions from the `native` tokens export** (`import { native } from "@flyee/design-tokens"`): radii (`native.radius`), spacing base, display sizes (`{min,max}` px — use `min` on phones), motion durations and `Easing.bezier(...native.motion.ease)`.
- **Type discipline: max 4 font sizes and 2 weights per screen** (Paper variants subset defined in the theme). More sizes = visual noise, not hierarchy.
- **Components: React Native Paper first.** Before building custom, check Paper's catalog. Custom components still consume the theme via `useTheme()`.
- **Copy through the `mobile` i18n namespace** in ALL 5 locales (`packages/content/messages/*`), same anti-AI-copy rules as the `marketing-page` skill (especially pt-BR).
- **Icons via the RN adapter contract**: `apps/mobile/src/icons/nexture/ni-*` (react-native-svg, same filenames + `NextureIconsProps` as web). Missing icon? Port it from `apps/web/src/icons/nexture/` — never import an icon library directly in a screen.

## Anti-"shrunken web" list (never ship these)

- Hover-dependent affordances (tooltips, hover menus) — there is no hover.
- Dense data tables — use cards or lists with progressive disclosure.
- Primary actions at the top of the screen — the thumb lives at the bottom.
- Web-style top navbars with many links — navigation is tabs (bottom) + stacks.
- Tiny link-styled text actions — actions are buttons/list items ≥44pt.
- Layout copied from the web page "because it exists" — restructure for one-hand use.

## Mobile UX rules (from mobile-app-ui-design, enforced)

- **Thumb zone**: primary actions in the bottom third; destructive actions out of accidental reach.
- **8-point grid**: all spacing divisible by 8 (or 4 for compact pairs).
- **Touch targets ≥44pt** with ≥8pt separation.
- **60-30-10 color**: 60% neutral surfaces, 30% supporting, 10% accent (the token primary).
- **Safe areas always** (`react-native-safe-area-context`, `contentInsetAdjustmentBehavior="automatic"` on ScrollViews).
- One screen = one job; secondary content behind navigation, not stacked below the fold.

## Navigation & structure (defer to the `building-native-ui` skill for API details)

- Routes in `app/` with `_layout.tsx` stacks; kebab-case filenames; `<Link>` from expo-router.
- Screen titles via the navigation stack header, not a custom text element.
- Modals/sheets via stack presentation options, not hand-rolled overlays.
- `{ borderCurve: "continuous" }` on rounded corners; never legacy elevation-only shadows.

## Motion

- Reanimated only, durations/easing from `native.motion` (`Easing.bezier(...native.motion.ease)`).
- Respect reduced motion: gate animations on `AccessibilityInfo.isReduceMotionEnabled()` (or `useReducedMotion` from Reanimated) — content must be fully visible without animation.
- Micro-interactions over decoration: animate state changes the user caused; skip scroll-triggered reveals that delay content.

## Platform notes

- `process.env.EXPO_OS` for platform branches; haptics on iOS for confirmations.
- Test in Expo Go first; custom native code only when a feature truly requires it.
- Why other skills from the research were NOT adopted: `material-3-skill` targets Jetpack Compose/Flutter and would pull the design toward Google's baseline instead of our tokens; SwiftUI skills target native Swift, not this Expo stack.

## Before finishing

Both platforms (or at least Android emulator + iOS visual check), light/dark × 2+ color themes, pt-BR + en locales, reduced-motion on, small device (SE-size) and large; `npx tsc --noEmit -p apps/mobile` passes.
