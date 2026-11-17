import { getLocale, getTranslations } from "next-intl/server";

import { PublicPlanDisplay } from "@/components/marketing/pricing-section";
import type { CampaignOffer } from "@/lib/campaign-offer";
import { getPlanBySlug, listPublicPlans, type PublicPlan } from "@flyee/billing/public";
import { applyDiscount, type CheckoutCoupon } from "@flyee/billing/types";

const PLACEHOLDER_SLUGS = ["plan-1", "plan-2", "plan-3"] as const;

type Translate = Awaited<ReturnType<typeof getTranslations<"marketing">>>;

/**
 * What a plan SELLS, derived from the same limits the runtime enforces.
 *
 * Extracted so the ordinary catalogue and the campaign cards cannot drift:
 * two copies of this list would mean the home eventually promising one thing on
 * a normal day and another during a campaign, from the same database row.
 */
function planFeatures(plan: PublicPlan, t: Translate): string[] {
  const features: string[] = [];
  if (plan.kind === "credits" && plan.creditAmount) {
    features.push(t("pricing-feature-credits", { count: plan.creditAmount }));
  }
  // Audio minutes are the real unit of a MedChina paid plan (PRD §5.4/§5.5);
  // the commercial reference (~50-minute consultations) comes with it.
  //
  // The franchise is spent inside ONE billing cycle, so the period word has to
  // come from the plan and not from the string: "72.000 minutos por mês" on a
  // yearly line — the shape the home takes during a two-price campaign — is a
  // twelvefold promise the runtime never honours.
  const audioMinutes = plan.limits.audio_minutes;
  if (typeof audioMinutes === "number" && audioMinutes > 0) {
    const audioKey =
      plan.period === "yearly"
        ? "pricing-feature-audio-yearly"
        : plan.period === "monthly"
          ? "pricing-feature-audio"
          : // A one-off pack has no cycle to be "per" anything.
            "pricing-feature-audio-pack";
    features.push(t(audioKey, { minutes: audioMinutes, sessions: Math.floor(audioMinutes / 50) }));
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
  return features;
}

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

  /**
   * The anchor card is DATA (`plans.is_highlighted`, migration 0124), chosen in
   * /admin/billing. It used to be the plan at index 1 — the middle of three —
   * which meant promoting a tier required reordering the whole grid through
   * `sort`, "no anchor at all" could not be expressed, and adding or
   * unpublishing a plan silently moved the emphasis to whatever slid into
   * position 2. There is deliberately no positional fallback here: a second
   * rule would decide the page whenever the first says "none", which is exactly
   * the state an operator picks on purpose.
   */
  return plans.map((plan) => {
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
      features: planFeatures(plan, t),
      highlighted: plan.isHighlighted,
      // Raw values power the Offer JSON-LD (formatted `price` is display-only).
      // Deliberately the LIST price: the structured data describes the offer
      // open to everyone, and crawlers never carry a campaign code anyway.
      priceAmount: plan.isFree ? 0 : plan.priceCents / 100,
      priceCurrency: plan.currency,
    };
  });
}

/**
 * The campaign offer, rendered as the home's pricing cards.
 *
 * Returns an empty array when the offer cannot be sold — a closed campaign, a
 * slug that matches no active plan — and the caller then shows the ordinary
 * catalogue. The home must never end up with an empty pricing section because
 * someone mistyped a slug.
 *
 * Two things make these cards different from the catalogue ones, and both are
 * the point of the feature:
 *
 *  - the price is the CAMPAIGN line, with the table plan struck through beside
 *    it. The anchor is a real catalogue price, annualized when a monthly plan
 *    anchors a yearly offer — never a yearly number nobody was ever charged;
 *  - the button goes to the CHECKOUT, not to the free sign-up the home sends
 *    everyone to by default. A campaign that lands on "create a free account"
 *    is a campaign whose purchase event never fires.
 */
export async function getCampaignDisplayPlans(offer: CampaignOffer | null): Promise<PublicPlanDisplay[]> {
  if (!offer || offer.closed || !offer.planSlug) return [];

  const [t, locale, plan, annualPlan, comparePlan] = await Promise.all([
    getTranslations("marketing"),
    getLocale(),
    getPlanBySlug(offer.planSlug),
    offer.annualPlanSlug ? getPlanBySlug(offer.annualPlanSlug) : Promise.resolve(null),
    offer.comparePlanSlug ? getPlanBySlug(offer.comparePlanSlug) : Promise.resolve(null),
  ]);
  if (!plan) return [];

  const toCard = (row: PublicPlan, highlighted: boolean): PublicPlanDisplay => {
    const money = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: row.currency,
      maximumFractionDigits: 0,
    });
    // Same normalization /assinar uses, so the two pages cannot disagree about
    // what the struck price means: a monthly table price anchoring a yearly
    // offer is multiplied by twelve, and periods that cannot be compared yield
    // no anchor at all rather than an invented one.
    const anchorCents = comparePlan
      ? comparePlan.period === "monthly" && row.period === "yearly"
        ? comparePlan.priceCents * 12
        : comparePlan.period === row.period
          ? comparePlan.priceCents
          : 0
      : 0;
    const savings =
      anchorCents > row.priceCents ? Math.round(((anchorCents - row.priceCents) / anchorCents) * 100) : null;

    return {
      slug: row.slug,
      name: row.name,
      description: row.description ?? undefined,
      price: money.format(row.priceCents / 100),
      originalPrice: savings ? money.format(anchorCents / 100) : undefined,
      discountLabel: savings ? t("pricing-coupon-off-percent", { value: savings }) : undefined,
      period: row.period ? t(`pricing-period-${row.period}`) : undefined,
      features: planFeatures(row, t),
      highlighted,
      // Through the sign-up door, like /assinar: the middleware bounces an
      // anonymous visitor from the checkout to sign-IN, which is the wrong door
      // for someone who has never had an account, and it already forwards an
      // ALREADY signed-in visitor from sign-up straight to the destination.
      checkoutHref: `/auth/sign-up?next=${encodeURIComponent(`/assinatura?plan=${row.slug}`)}`,
      // The campaign price IS the offer open to everyone while the home carries
      // it, so the structured data says so.
      priceAmount: row.priceCents / 100,
      priceCurrency: row.currency,
    };
  };

  // The default line leads, as it does on /assinar: it is the lower barrier,
  // and the second cycle is the upgrade standing next to it.
  return [toCard(plan, true), ...(annualPlan ? [toCard(annualPlan, false)] : [])];
}
