import { createAnonClient } from "@/lib/public-content";

/** Where the setting lives. Superadmin writes it in `/admin/billing → Offers`. */
export const CAMPAIGN_OFFER_KEY = "campaign_offer";

export type CampaignOfferReason = "open" | "disabled" | "expired" | "not_configured";

export type CampaignOffer = {
  /** Plan the campaign sells. */
  planSlug: string | null;
  /** Table plan whose price is struck through as the anchor. Optional. */
  comparePlanSlug: string | null;
  /** When the condition stops being sold. Null = no deadline. */
  deadline: string | null;
  closed: boolean;
  reason: CampaignOfferReason;
};

export type CampaignOfferSetting = {
  enabled?: boolean;
  plan_slug?: string | null;
  compare_plan_slug?: string | null;
  deadline?: string | null;
};

/**
 * The paid-campaign offer: one plan, one optional anchor, one optional
 * deadline.
 *
 * Deliberately NOT a second copy of the founders mechanism (migration 0087).
 * That one counts seats, which needs a privileged aggregate over
 * `subscriptions` and therefore an RPC; this one only has to answer "is the
 * condition still on sale?", which is a row in `platform_settings` — readable by
 * anon, written only by the superadmin — and a clock. No migration, one console,
 * and the landing page and the checkout guard read the SAME function, so the
 * deadline printed on the page is the deadline that refuses the sale.
 *
 * `resolve` is exported separately because the guard reads the row through the
 * caller's own authenticated client: the rule must not exist twice.
 */
export function resolveCampaignOffer(value: CampaignOfferSetting | null | undefined): CampaignOffer {
  const planSlug = typeof value?.plan_slug === "string" ? value.plan_slug.trim() : "";
  const compareSlug = typeof value?.compare_plan_slug === "string" ? value.compare_plan_slug.trim() : "";
  const rawDeadline = typeof value?.deadline === "string" ? value.deadline.trim() : "";
  const deadline = rawDeadline ? new Date(rawDeadline) : null;
  const deadlineValid = deadline && !Number.isNaN(deadline.getTime()) ? deadline : null;

  // Named cause, never inferred from the absence of a plan: "the operator has
  // not opened it" and "the deadline passed" read the same from `closed` alone,
  // and the page has to say something different for each.
  const reason: CampaignOfferReason = !planSlug
    ? "not_configured"
    : value?.enabled !== true
      ? "disabled"
      : deadlineValid && deadlineValid.getTime() <= Date.now()
        ? "expired"
        : "open";

  return {
    planSlug: planSlug || null,
    comparePlanSlug: compareSlug || null,
    deadline: deadlineValid ? deadlineValid.toISOString() : null,
    closed: reason !== "open",
    reason,
  };
}

/**
 * Reads the offer for a public page (no session).
 *
 * Returns null when Supabase is not configured (fresh clone) — callers MUST
 * treat that as "no offer to show", never as an open one.
 */
export async function getCampaignOffer(): Promise<CampaignOffer | null> {
  const supabase = createAnonClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", CAMPAIGN_OFFER_KEY)
    .maybeSingle();

  if (error) return null;
  return resolveCampaignOffer((data?.value ?? null) as CampaignOfferSetting | null);
}
