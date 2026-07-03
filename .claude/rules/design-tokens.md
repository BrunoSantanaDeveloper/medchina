---
paths: ["packages/design-tokens/**", "apps/web/src/style/**"]
---

# Design tokens

- `packages/design-tokens/css/*.css` is the source of truth for visual identity. `src/tokens.generated.ts` is GENERATED — never edit it manually.
- After any change in `css/*.css`, run `npm run tokens:generate` at the root and include the generated file in the same commit.
- Color values are bare HSL triplets (`191 100% 46%`), consumed via `hsl(var(--token))` in CSS. Keep this format; do not introduce hex/rgb.
- Every color token must exist in light/dark pairs (`:root`/`.dark` in common, `.theme-x`/`.theme-x.dark` in theme files).
