# @flyee/design-tokens

Source of truth for the Flyee design system, shared across platforms.

## Contract

- **`css/*.css` is the source of truth.** Every visual identity change (colors, themes, shadows, radii) happens here — never hardcoded in an app.
- The **web** app (`apps/web`) consumes the CSS directly: `@import "@flyee/design-tokens/css/common.css"` in `src/style/global.css`.
- Other platforms (e.g. **mobile**) consume the TypeScript mirror: `import { themes, common, hsl } from "@flyee/design-tokens"`.
- The TS mirror (`src/tokens.generated.ts`) is **generated** from the CSS — never edited by hand. After changing any CSS, run:

```bash
npm run tokens:generate   # at the monorepo root
```

## Structure

- `css/common.css` — tokens shared by all themes: greys, text, feedback, shadows, radii, in `:root` (light) and `.dark` variants.
- `css/{blue,green,orange,purple}.css` — per-color-theme tokens (`.theme-<name>` and `.theme-<name>.dark`).
- `css/marketing.css` — marketing-layer tokens (fluid display type scale via `clamp()`, section rhythm, motion durations/easing). Dimensions and motion only — no colors, so no light/dark split. Exported to TS as `marketing`.
- **`native` export** (generated) — platform-neutral values for React Native: radii/spacing in px numbers, display scale as `{min,max}` px, durations as numbers, easing as cubic-bezier control points (`Easing.bezier(...ease)`). Colors are not duplicated (use `themes`/`common` + `hsl()`); shadows are intentionally omitted (RN uses elevation/Paper surfaces).
- Color values are bare HSL triplets (`"191 100% 46%"`), consumed on the web via `hsl(var(--token))` and in TS via the `hsl()` helper.

## Adding a new theme

1. Create `css/<name>.css` following the pattern of the existing files (`.theme-<name>` + `.theme-<name>.dark`).
2. Add the name to `THEME_FILES` in `scripts/generate-tokens.mjs`.
3. Import the CSS in `apps/web/src/style/global.css` and register the theme in `THEME_OPTIONS` (`apps/web/src/constants.ts`).
4. Run `npm run tokens:generate`.
