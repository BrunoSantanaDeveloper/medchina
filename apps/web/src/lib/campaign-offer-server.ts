import "server-only";

import { type CampaignOffer, getCampaignOffer } from "@/lib/campaign-offer";
import { getPlanBySlug, type PublicPlan } from "@flyee/billing/public";

export type SellableCampaign = { offer: CampaignOffer; plan: PublicPlan };

/**
 * The campaign the checkout will actually sell: open AND pointing at an active
 * plan.
 *
 * `offer.closed` alone is not that answer. An enabled campaign whose
 * `plan_slug` names an inactive or missing plan (or a deploy without the
 * service key `getPlanBySlug` needs) is "open" by the setting and still renders
 * "Esta condição não está aberta no momento" on /assinar. Every page that sends
 * traffic to /assinar — /china, the live event — asks THIS function, the same
 * rule /assinar uses to decide whether it sells, so a link never promises what
 * the destination refuses.
 *
 * A separate module from `campaign-offer.ts` on purpose: that one is imported by
 * a client component (the admin card), and the plan reader uses the service
 * role.
 */
export async function resolveSellableCampaign(offer: CampaignOffer | null): Promise<SellableCampaign | null> {
  if (!offer || offer.closed || !offer.planSlug) return null;
  const plan = await getPlanBySlug(offer.planSlug);
  return plan ? { offer, plan } : null;
}

export async function getSellableCampaign(): Promise<SellableCampaign | null> {
  return resolveSellableCampaign(await getCampaignOffer());
}
