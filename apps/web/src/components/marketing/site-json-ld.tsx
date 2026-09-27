import { BRAND } from "@/brand";
import JsonLd from "@/components/marketing/json-ld";

/**
 * Site-wide identity for search and AI engines: the Organization and WebSite
 * nodes, with the stable `@id`s every page-level node points at
 * (`publisher: { "@id": ".../#organization" }`).
 *
 * One component because two layouts emit it: `(marketing)` and `(autoridade)`
 * (/china). A page inside either must NOT emit its own Organization — it
 * references this one by `@id` (docs/SEO.md, .claude/rules/marketing.md).
 * Rebrands with @flyee/content.
 */
export default function SiteJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            "@id": `${BRAND.siteUrl}/#organization`,
            name: BRAND.name,
            url: BRAND.siteUrl,
            logo: `${BRAND.siteUrl}${BRAND.favicon.light}`,
            description: BRAND.description,
          },
          {
            "@type": "WebSite",
            "@id": `${BRAND.siteUrl}/#website`,
            name: BRAND.name,
            url: BRAND.siteUrl,
            publisher: { "@id": `${BRAND.siteUrl}/#organization` },
          },
        ],
      }}
    />
  );
}
