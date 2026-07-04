import type { MetadataRoute } from "next";

import { BRAND } from "@/brand";

/** Public marketing routes only — the authenticated app must stay out. */
const MARKETING_ROUTES = ["/", "/pricing", "/about", "/contact", "/legal/terms", "/legal/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_ROUTES.map((route) => ({
    url: `${BRAND.siteUrl}${route === "/" ? "" : route}`,
    changeFrequency: "monthly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
