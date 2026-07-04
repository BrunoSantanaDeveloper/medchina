import type { MetadataRoute } from "next";

import { BRAND } from "@/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authenticated app and API surfaces are not for crawlers.
      disallow: ["/api/", "/auth/", "/dashboards/", "/settings/", "/admin/", "/applications/"],
    },
    sitemap: `${BRAND.siteUrl}/sitemap.xml`,
  };
}
