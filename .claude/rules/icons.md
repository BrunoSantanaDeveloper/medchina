---
paths: ["apps/web/src/icons/**", "apps/web/src/app/**"]
---

# Icon contract

- Pages import icons only as `@/icons/nexture/ni-*` (the alias may be remapped per project to an adapter set — see `apps/web/src/icons/README.md`). Never import an icon library (Phosphor, Lucide, MUI icons for decoration) directly in a page.
- Every icon component implements `NextureIconsProps` (`size`, `variant`, `className`, `oneTone`) and is a default export.
- Alternative sets live in sibling folders (`src/icons/phosphor/`, ...) with identical file names; gaps are filled by `npm run icons:stubs -w @gogo/web` (fallback re-exports, never overwritten).
- Adapters import icon libs from their SSR-safe entry (e.g. `@phosphor-icons/react/dist/ssr`) so they work in Server Components.
