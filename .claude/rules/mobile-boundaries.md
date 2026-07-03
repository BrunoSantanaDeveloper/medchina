---
paths: ["apps/mobile/**"]
---

# apps/mobile boundaries

- Never import from `apps/web`; only from `packages/*`.
- Visual components: React Native Paper, themed from `@gogo/design-tokens` (`themes`, `common`, `hsl()` helper).
- Mobile is not shrunken web: primary actions in the thumb zone, navigation via Expo Router, limited type scale.
- Features must be functionally equivalent to their web counterpart (same Yup schemas and i18n messages from `packages/*`), expressed in the platform's visual language.
