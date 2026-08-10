import { getDisplayPlans } from "../plans";
import { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import TrackEvent from "@/components/consent/track-event";
import Container from "@/components/marketing/container";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import PricingSection from "@/components/marketing/pricing-section";
import { COOKIE_KEYS } from "@/constants";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import { normalizeCouponCode } from "@/lib/offer-link";
import { resolvePublicCoupon } from "@flyee/billing/public";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing");
  return {
    title: t("pricing-meta-title"),
    description: t("pricing-meta-description"),
    alternates: { canonical: "/planos" },
  };
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, cookieStore] = await Promise.all([getTranslations("marketing"), searchParams, cookies()]);

  /**
   * The campaign code, straight from the link she followed or from the cookie
   * the middleware stored on an earlier page. Resolved HERE, on the server,
   * because a visitor told "use the code HELLEN" who lands on table prices
   * concludes the code failed — and leaves before reaching the sign-up.
   */
  const requestedCoupon =
    normalizeCouponCode(typeof params.cupom === "string" ? params.cupom : null) ??
    normalizeCouponCode(cookieStore.get(COOKIE_KEYS.offerCoupon)?.value);
  const coupon = requestedCoupon ? await resolvePublicCoupon(requestedCoupon) : null;
  const plans = await getDisplayPlans(coupon);

  return (
    <>
      <PricingSection
        eyebrow={t("pricing-eyebrow")}
        title={t("pricing-page-title")}
        subtitle={t("pricing-page-subtitle")}
        plans={plans}
        ctaLabel={t("cta-primary")}
        headingAs="h1"
        decor="glow"
        // A code that did not resolve is named, not ignored: she must not read
        // the table price as the discounted one.
        couponNotice={
          requestedCoupon
            ? coupon
              ? { label: t("pricing-coupon-applied", { code: coupon.code }), applied: true }
              : { label: t("pricing-coupon-unknown", { code: requestedCoupon }), applied: false }
            : undefined
        }
      />

      {/* Risk reversal, next to the price (blueprint: reduce perceived risk). */}
      <Container>
        <div className="border-grey-100 bg-background-paper mx-auto flex max-w-2xl items-start gap-4 rounded-3xl border p-6">
          <span className="bg-secondary/10 text-secondary flex h-11 w-11 flex-none items-center justify-center rounded-xl">
            <NiShieldCheck size="medium" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-text-primary font-heading text-lg font-bold">{t("pricing-guarantee-title")}</p>
            <p className="text-text-secondary text-sm leading-6">{t("pricing-guarantee-body")}</p>
          </div>
        </div>
      </Container>

      <Container>
        <p className="text-text-secondary mx-auto max-w-2xl pb-4 text-center text-sm leading-5">{t("pricing-note")}</p>
      </Container>

      {/* Marketing-only ViewContent (Meta/GA4) — no-op until consent + provider. */}
      <TrackEvent event="ViewContent" props={{ content_name: "planos", content_category: "pricing" }} />

      <Faq
        eyebrow={t("faq-eyebrow")}
        title={t("faq-title")}
        items={[1, 2, 3, 4].map((index) => ({
          question: t(`faq-${index}-question`),
          answer: t(`faq-${index}-answer`),
        }))}
      />

      <Cta
        title={t("cta-title")}
        subtitle={t("cta-subtitle")}
        cta={{ label: t("cta-primary"), href: "/auth/sign-up" }}
      />
    </>
  );
}
