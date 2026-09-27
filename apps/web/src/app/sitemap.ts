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
  // The congress authority page (docs/PAGINA-CHINA.md). Indexed on purpose,
  // unlike the offer pages below: it announces no price, so it does not compete
  // with /planos, and it is the link of the press release and the proposals.
  "/china",
  // NOT here on purpose, all public (PUBLIC_PREFIXES) and all robots noindex:
  // - the live event `/lei-15345` — a dated campaign page (docs/PAGINA-EVENTO.md);
  // - the offer pages `/fundadores` and `/assinar` — decision D10 of
  //   docs/FUNIL.md: a limited price that ranks on Google stops being an offer
  //   and becomes the price;
  // - `/palestra` — the speaker's instrument, opened by the congress AV machine
  //   without a session; it carries the full teleprompter and stage directions;
  // - `/palestra/publica` — the same slides without the speaker notes, the
  //   attachment /china links to (/china is the indexed narrative);
  // - `/pitch` — the investor deck.
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
