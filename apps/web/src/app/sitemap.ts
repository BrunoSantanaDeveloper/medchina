import type { MetadataRoute } from "next";

import { BRAND } from "@/brand";
import { DEFAULTS } from "@/config";
import { listBlogSlugs, listHelpSlugs } from "@/lib/public-content";

/** Public marketing routes only — the authenticated app must stay out. */
const MARKETING_ROUTES = [
  "/",
  "/planos",
  "/como-funciona",
  "/recursos",
  "/seguranca",
  "/migracao",
  "/sobre",
  "/contato",
  "/ajuda",
  "/blog",
  "/legal/termos",
  "/legal/privacidade",
  "/legal/cookies",
  // A commercial promise the offer pages link to: it has to be findable on its
  // own, not only reachable from a checkout (docs/FUNIL.md T1.5).
  "/legal/garantia",
  // NOT here on purpose: the offer pages `/fundadores` and `/assinar` (noindex
  // by decision D10 of docs/FUNIL.md — a limited price that ranks on Google
  // stops being an offer and becomes the price), and `/palestra`, which is in
  // PUBLIC_PREFIXES so the congress
  // AV machine can open it without a session, but it carries the speaker's full
  // teleprompter (including a personal health account) and stage directions —
  // presentation material, not marketing. The page also sets robots noindex.
];

/**
 * Static marketing routes plus the DB-managed public content (help center
 * articles) in the default locale — crawlers see the default locale only
 * (cookie-based i18n). Degrades to the static list without Supabase env.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = MARKETING_ROUTES.map((route) => ({
    url: `${BRAND.siteUrl}${route === "/" ? "" : route}`,
    changeFrequency: "monthly",
    priority: route === "/" ? 1 : 0.7,
  }));

  const [helpSlugs, blogSlugs] = await Promise.all([listHelpSlugs(DEFAULTS.locale), listBlogSlugs(DEFAULTS.locale)]);
  const helpEntries: MetadataRoute.Sitemap = helpSlugs.map((slug) => ({
    url: `${BRAND.siteUrl}/ajuda/${slug}`,
    changeFrequency: "weekly",
    priority: 0.5,
  }));
  const blogEntries: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${BRAND.siteUrl}/blog/${slug}`,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticEntries, ...helpEntries, ...blogEntries];
}
