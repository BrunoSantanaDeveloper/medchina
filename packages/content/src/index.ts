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
  /**
   * Quick-support channels for the floating widget (web marketing +
   * dashboard). Leave a channel empty ("") to hide it; leave all empty
   * and the widget renders nothing. whatsapp is digits only, with the
   * country code (e.g. "5511999999999" → wa.me deep link).
   */
  support: {
    whatsapp: "",
    email: "",
    helpCenter: "/help",
  },
} as const;
