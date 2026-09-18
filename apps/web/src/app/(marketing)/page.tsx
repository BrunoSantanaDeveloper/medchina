import "./clinical-source-home.css";

import { getDisplayPlans } from "./plans";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import ClinicalSourceHome from "@/components/marketing/clinical-source-home";
import { getHomeCopy } from "@/components/marketing/home-copy";
import { COOKIE_KEYS } from "@/constants";
import { resolveRequestLocale } from "@/lib/locale-request";
import { normalizeCouponCode } from "@/lib/offer-link";
import { resolvePublicCoupon } from "@flyee/billing/public";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await resolveRequestLocale();
  const copy = await getHomeCopy(locale);

  return {
    title: { absolute: copy.meta.title },
    description: copy.meta.description,
    // Canonical (resolved against metadataBase = NEXT_PUBLIC_SITE_URL) so search
    // engines pick the subdomain as the preferred URL, avoiding duplicate
    // content. There is ONE URL per page: language is a cookie, so a crawler
    // only ever sees pt-BR here and no hreflang set can be declared honestly
    // (docs/SEO.md — "Indexable language").
    alternates: { canonical: "/" },
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, cookieStore, { locale, autoSwitched }] = await Promise.all([
    getTranslations("marketing"),
    searchParams,
    cookies(),
    resolveRequestLocale(),
  ]);

  /**
   * The home's copy for the active language. Resolved HERE, on the server, and
   * handed down as data: the page is a client component, so importing all six
   * languages into it would ship six copies of the page to every visitor.
   */
  const copy = await getHomeCopy(locale);

  /**
   * Prices and limits are read here, on the server, and handed to the home as
   * data. They used to be constants inside the component, which meant a price
   * change in /admin/billing updated /planos and the checkout while the home
   * went on advertising the old one (docs/FUNIL.md D12).
   */
  const requestedCoupon =
    normalizeCouponCode(typeof params.cupom === "string" ? params.cupom : null) ??
    normalizeCouponCode(cookieStore.get(COOKIE_KEYS.offerCoupon)?.value);
  const coupon = requestedCoupon ? await resolvePublicCoupon(requestedCoupon) : null;
  const plans = await getDisplayPlans(coupon);

  return (
    <ClinicalSourceHome
      plans={plans}
      copy={copy}
      locale={locale}
      autoSwitched={autoSwitched}
      couponNotice={
        requestedCoupon
          ? coupon
            ? { label: t("pricing-coupon-applied", { code: coupon.code }), applied: true }
            : { label: t("pricing-coupon-unknown", { code: requestedCoupon }), applied: false }
          : undefined
      }
    />
  );
}
