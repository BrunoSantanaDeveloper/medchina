import "server-only";

import { type LadderFacts, ladderFacts } from "@/lib/price-ladder";
import { getPromotion, type Promotion } from "@/lib/promotion";
import { getPlanBySlug, type PublicPlan } from "@flyee/billing/public";

export type SellablePromotion = {
  promotion: Promotion;
  plan: PublicPlan;
  /** The table plan the struck price comes from; null when none is configured. */
  anchor: PublicPlan | null;
  facts: LadderFacts;
};

/**
 * The promotion the checkout will actually sell: open AND pointing at an
 * active plan — the same question `resolveSellableCampaign` answers for the
 * paid campaign, asked by every surface that announces the promotion (the
 * /black-friday page and the home's strip and card), so none of them can
 * advertise a price the checkout refuses.
 *
 * Kept apart from `promotion.ts` because the plan reader uses the service
 * role, and that module is safe to import anywhere.
 */
export async function resolveSellablePromotion(promotion: Promotion | null): Promise<SellablePromotion | null> {
  if (!promotion || promotion.closed || !promotion.planSlug) return null;
  const [plan, anchor] = await Promise.all([
    getPlanBySlug(promotion.planSlug),
    promotion.comparePlanSlug ? getPlanBySlug(promotion.comparePlanSlug) : Promise.resolve(null),
  ]);
  if (!plan || plan.isFree) return null;
  return {
    promotion,
    plan,
    anchor,
    facts: ladderFacts(
      plan,
      anchor ? { name: anchor.name, period: anchor.period, priceCents: anchor.priceCents } : null,
    ),
  };
}

export async function getSellablePromotion(): Promise<SellablePromotion | null> {
  return resolveSellablePromotion(await getPromotion());
}
