/**
 * Single source for site identity, shared by web AND mobile. A rebrand
 * (derived project) edits THIS file plus the assets it points to:
 * - name/tagline/description → web metadata, marketing pages, OG image, mobile app chrome
 * - siteUrl → metadataBase, sitemap.ts, robots.ts (web-only; reads NEXT_PUBLIC_SITE_URL)
 * - favicons → apps/web/public/favicon/{light,dark}.png (web asset paths)
 * - logo SVGs → apps/web/src/components/logo/logo.tsx and the mobile icon assets
 *   (apps/mobile/assets/), plus apps/web/public/images/email/logo.svg
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
