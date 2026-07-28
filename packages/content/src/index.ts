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
  name: "MedChina",
  tagline: "Atenda olhando para o paciente. O MedChina organiza o restante.",
  description: "Prontuário inteligente e assistente clínico para Medicina Tradicional Chinesa.",
  /**
   * Canonical site URL — set NEXT_PUBLIC_SITE_URL in production (no trailing
   * slash). Not `??`: a defined-but-empty variable is not null, and an empty
   * canonical would silently poison every metadata URL, the sitemap and the
   * JSON-LD rather than falling back to something visibly wrong in dev.
   */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/u, "") || "http://localhost:3000",
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
    helpCenter: "/ajuda",
  },
} as const;
