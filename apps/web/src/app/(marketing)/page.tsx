import "./clinical-source-home.css";

import { getCampaignDisplayPlans, getDisplayPlans } from "./plans";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import ClinicalSourceHome from "@/components/marketing/clinical-source-home";
import { getHomeCopy } from "@/components/marketing/home-copy";
import { COOKIE_KEYS } from "@/constants";
import { getCampaignOffer } from "@/lib/campaign-offer";
import { getGuaranteeDays } from "@/lib/guarantee";
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

  /**
   * The campaign takes the pricing section over, when it is told to.
   *
   * Two switches, not one: `enabled` opens `/assinar` and is what the checkout
   * enforces; `show_on_home` decides whether the home — the trial-first front
   * door, where every button opens a free account — also sells it. Starting a
   * campaign must not silently rewrite the page the organic audience lands on.
   *
   * It falls back to the catalogue whenever the offer cannot actually be sold
   * (closed, or a slug matching no active plan), so a mistyped slug can never
   * leave the home with an empty pricing section.
   *
   * The coupon path is left alone: a visitor who arrived with a code still sees
   * the code's price. Campaign and coupon are two different promises and the
   * one she was shown is the one she followed.
   */
  const campaignOffer = await getCampaignOffer();
  const campaignPlans = campaignOffer?.showOnHome && !coupon ? await getCampaignDisplayPlans(campaignOffer) : [];
  const selling = campaignPlans.length > 0;
  const plans = selling ? campaignPlans : await getDisplayPlans(coupon);

  /**
   * What the section can still say truthfully once the free card and the trial
   * card are gone. Both are real state — the guarantee from its own setting,
   * the deadline from the offer's own row — and the deadline is formatted HERE
   * because the home is a client component: a date formatted in the browser
   * would not match the one the server rendered.
   */
  const offer = selling
    ? {
        guaranteeDays: await getGuaranteeDays(),
        deadlineLabel: campaignOffer?.deadline
          ? new Intl.DateTimeFormat(locale, {
              day: "2-digit",
              month: "long",
              timeZone: "America/Sao_Paulo",
            }).format(new Date(campaignOffer.deadline))
          : null,
      }
    : null;

  return (
    <ClinicalSourceHome
      plans={plans}
      offer={offer}
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
