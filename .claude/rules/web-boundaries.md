---
paths: ["apps/web/**"]
---

# apps/web boundaries

- Never import from other apps (`apps/mobile` etc.). Code shared across platforms lives in `packages/*`.
- Do not redefine theme tokens locally (`--primary`, `--grey-*` etc.) — they come from `@gogo/design-tokens`.
- This is a TEMPLATE: do not introduce business logic specific to a client/derived project.
