import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BRAND } from "@/brand";
import CookieConsent from "@/components/consent/cookie-consent";
import MarketingAnalytics from "@/components/consent/marketing-analytics";
import MarketingTrackers from "@/components/consent/marketing-trackers";
import MarketingFooter from "@/components/marketing/marketing-footer";
import MarketingHeader from "@/components/marketing/marketing-header";
import SiteJsonLd from "@/components/marketing/site-json-ld";
import SupportWidget from "@/components/support/support-widget";
import { getSupportChannels } from "@/lib/platform-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return {
    description: t("home-meta-description"),
    openGraph: {
      siteName: BRAND.name,
      type: "website",
      url: BRAND.siteUrl,
    },
  };
}

/**
 * Public site chrome: no admin layout, no auth required. Every route in this
 * group must be listed as public in src/middleware.ts (PUBLIC_PREFIXES).
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const support = await getSupportChannels();
  return (
    <div className="bg-background flex min-h-[100dvh] flex-col">
      {/* Site-wide identity for search + AI engines; rebrands with @flyee/content.
          Shared with the (autoridade) layout, which is why it is a component. */}
      <SiteJsonLd />
      <MarketingHeader />
      <main className="flex flex-1 flex-col">{children}</main>
      <MarketingFooter />
      <SupportWidget support={support} />
      <CookieConsent />
      {/* Marketing-only: SSR Pixel/GA4 (opt-out) + SPA pageviews. Never mounted
          on the clinical app — the compliance boundary is the layout itself. */}
      <MarketingTrackers />
      <MarketingAnalytics />
    </div>
  );
}
