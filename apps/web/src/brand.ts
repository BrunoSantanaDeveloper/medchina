/**
 * Single source for site identity. A rebrand (derived project) edits THIS file
 * plus the assets it points to — nothing else hardcodes the brand:
 * - name/tagline/description → root layout metadata, (marketing) pages, OG image
 * - siteUrl → metadataBase, sitemap.ts, robots.ts
 * - favicons → apps/web/public/favicon/{light,dark}.png (theme-agnostic names)
 * - logo SVG → src/components/logo/logo.tsx (full + mobile variants)
 * - email logo → apps/web/public/images/email/logo.svg
 */
export const BRAND = {
  name: "Flyee",
  tagline: "The admin platform your team already knows how to use",
  description: "Multi-tenant SaaS platform with billing, AI assistants and a complete admin console.",
  /** Canonical site URL — set NEXT_PUBLIC_SITE_URL in production (no trailing slash). */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  favicon: {
    light: "/favicon/light.png",
    dark: "/favicon/dark.png",
  },
} as const;
