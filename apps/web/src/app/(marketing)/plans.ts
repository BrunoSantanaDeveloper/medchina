import { getLocale, getTranslations } from "next-intl/server";

import { PublicPlanDisplay } from "@/components/marketing/pricing-section";
import { listPublicPlans } from "@flyee/billing/public";
import { applyDiscount, type CheckoutCoupon } from "@flyee/billing/types";

const PLACEHOLDER_SLUGS = ["plan-1", "plan-2", "plan-3"] as const;

/**
 * Display-ready plans for the public pricing sections: real rows from
 * packages/billing formatted for the active locale, or the i18n placeholder
 * plans when the database is not configured (fresh clone stays browsable).
 *
 * With a campaign coupon, every paid card also carries its ORIGINAL price and
 * the discount label: a visitor who followed "use the code HELLEN" and lands on
 * table prices concludes the code failed — the page has to show her the number
 * she was promised, not just accept the code silently.
 */
export async function getDisplayPlans(coupon?: CheckoutCoupon | null): Promise<PublicPlanDisplay[]> {
  const [t, locale, plans] = await Promise.all([getTranslations("marketing"), getLocale(), listPublicPlans()]);

  if (!plans || plans.length === 0) {
    return PLACEHOLDER_SLUGS.map((slug) => ({
      slug,
      name: t(`${slug}-name`),
      description: t(`${slug}-description`),
      price: t(`${slug}-price`),
      period: t(`${slug}-period`),
      features: [t(`${slug}-feature-1`), t(`${slug}-feature-2`), t(`${slug}-feature-3`)],
      highlighted: slug === "plan-2",
    }));
  }

  // Highlight the middle plan — the conventional anchor of a 3-tier grid.
  const highlightIndex = plans.length >= 3 ? 1 : -1;

  return plans.map((plan, index) => {
    const features: string[] = [];
    if (plan.kind === "credits" && plan.creditAmount) {
      features.push(t("pricing-feature-credits", { count: plan.creditAmount }));
    }
    // Audio minutes are the real unit of a MedChina paid plan (PRD §5.4/§5.5);
    // the commercial reference (~50-minute consultations) comes with it.
    const audioMinutes = plan.limits.audio_minutes;
    if (typeof audioMinutes === "number" && audioMinutes > 0) {
      features.push(t("pricing-feature-audio", { minutes: audioMinutes, sessions: Math.floor(audioMinutes / 50) }));
    }
    // The clinical library (fases 1-4) is part of what a plan sells. Derived
    // from the SAME limits the runtime enforces: a missing library_messages
    // key means unlimited (org_message_allowance), and clinical_reasoning is
    // what unlocks reviewing a patient's own case.
    const libraryMessages = plan.limits.library_messages;
    if (typeof libraryMessages === "number" && libraryMessages > 0) {
      features.push(t("pricing-feature-library-quota", { count: libraryMessages }));
    } else if (libraryMessages === undefined) {
      features.push(t("pricing-feature-library-unlimited"));
    }
    if (typeof plan.limits.clinical_reasoning === "number" && plan.limits.clinical_reasoning > 0) {
      features.push(t("pricing-feature-case-review"));
    }
    // One professional per workspace in the MVP, so "1 member" is noise —
    // only surface the seat count when a plan actually adds seats.
    if (typeof plan.limits.members === "number" && plan.limits.members > 1) {
      features.push(t("pricing-feature-members", { count: plan.limits.members }));
    }
    if (plan.trialDays > 0) {
      features.push(t("pricing-feature-trial", { days: plan.trialDays }));
    }

    const money = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: plan.currency,
      maximumFractionDigits: 0,
    });
    // The SAME helper both providers use to charge, so the promised price and
    // the invoiced one cannot drift. A free plan has nothing to discount.
    const payableCents = plan.isFree ? 0 : applyDiscount(plan.priceCents, coupon ?? undefined);
    const discounted = !plan.isFree && payableCents !== plan.priceCents;

    return {
      slug: plan.slug,
      name: plan.name,
      description: plan.description ?? undefined,
      price: plan.isFree ? t("pricing-free") : money.format(payableCents / 100),
      originalPrice: discounted ? money.format(plan.priceCents / 100) : undefined,
      discountLabel: discounted
        ? coupon?.discountType === "percent"
          ? t("pricing-coupon-off-percent", { value: coupon.discountValue })
          : t("pricing-coupon-off-fixed", { value: money.format((coupon?.discountValue ?? 0) / 100) })
        : undefined,
      period: plan.kind === "recurring" && plan.period && !plan.isFree ? t(`pricing-period-${plan.period}`) : undefined,
      features,
      highlighted: index === highlightIndex,
      // Raw values power the Offer JSON-LD (formatted `price` is display-only).
      // Deliberately the LIST price: the structured data describes the offer
      // open to everyone, and crawlers never carry a campaign code anyway.
      priceAmount: plan.isFree ? 0 : plan.priceCents / 100,
      priceCurrency: plan.currency,
    };
  });
}
