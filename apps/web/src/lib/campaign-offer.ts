import { createAnonClient } from "@/lib/public-content";

/** Where the setting lives. Superadmin writes it in `/admin/billing → Offers`. */
export const CAMPAIGN_OFFER_KEY = "campaign_offer";

export type CampaignOfferReason = "open" | "disabled" | "expired" | "not_configured";

export type CampaignOffer = {
  /** Plan the campaign sells by default. In a two-price campaign, the monthly. */
  planSlug: string | null;
  /**
   * Second plan offered beside the first, normally the annual line.
   *
   * Optional and additive on purpose: a setting written before this existed
   * has no such key, and everything keeps working with a single price. The
   * shape stayed two named slugs rather than a list because every reader wants
   * to know WHICH is the default, and a list would make that positional.
   */
  annualPlanSlug: string | null;
  /**
   * Whether the PUBLIC HOME shows this offer in place of its ordinary plans.
   *
   * A separate switch from `enabled`, and the separation is the point. `enabled`
   * decides whether the campaign SELLS — it opens `/assinar` and it is what the
   * checkout enforces. This one decides whether the offer also takes over the
   * home, which is the site's trial-first front door: every button there opens
   * a free account, by design. Turning the campaign on must not silently
   * rewrite the page the organic audience lands on.
   */
  showOnHome: boolean;
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
  annual_plan_slug?: string | null;
  show_on_home?: boolean;
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
  const annualSlug = typeof value?.annual_plan_slug === "string" ? value.annual_plan_slug.trim() : "";
  const compareSlug = typeof value?.compare_plan_slug === "string" ? value.compare_plan_slug.trim() : "";
  const rawDeadline = typeof value?.deadline === "string" ? value.deadline.trim() : "";
  const deadline = rawDeadline ? new Date(rawDeadline) : null;
  const deadlineValid = deadline && !Number.isNaN(deadline.getTime()) ? deadline : null;

  // Named cause, never inferred from the absence of a plan: "the operator has
  // not opened it" and "the deadline passed" read the same from `closed` alone,
  // and the page has to say something different for each.
  //
  // Driven by `plan_slug` alone, deliberately: the second price is an extra
  // choice, never the thing that decides whether a campaign exists. An annual
  // slug on its own opens nothing.
  const reason: CampaignOfferReason = !planSlug
    ? "not_configured"
    : value?.enabled !== true
      ? "disabled"
      : deadlineValid && deadlineValid.getTime() <= Date.now()
        ? "expired"
        : "open";

  return {
    planSlug: planSlug || null,
    // Never the same row twice: a console typo pointing both fields at one
    // plan would otherwise render the identical price as two choices.
    annualPlanSlug: annualSlug && annualSlug !== planSlug ? annualSlug : null,
    // Strict `true`, like `enabled`: a missing key is a home that was never
    // asked to change, and the front door is not something to flip by accident.
    showOnHome: value?.show_on_home === true,
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
