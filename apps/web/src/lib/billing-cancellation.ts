import { createServiceClient } from "@flyee/auth/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

async function ensureFreeSubscription(supabase: ServiceClient, orgId: string) {
  const { data: live } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("org_id", orgId)
    .in("status", ["trialing", "active", "past_due"])
    .limit(1);
  if (live?.length) return;
  const { data: freePlan } = await supabase
    .from("plans")
    .select("id, period")
    .eq("is_free", true)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (freePlan) {
    await supabase.from("subscriptions").insert({
      org_id: orgId,
      plan_id: freePlan.id,
      status: "active",
      period: freePlan.period,
    });
  }
}

/** Finalizes due cancellations; safe to retry because only live scheduled rows are selected. */
export async function settleDueBillingCancellations() {
  const supabase = createServiceClient();
  const { data: due, error } = await supabase
    .from("subscriptions")
    .select("id, org_id, provider, provider_subscription_id")
    .eq("cancel_at_period_end", true)
    .in("status", ["trialing", "active", "past_due"])
    .lte("current_period_end", new Date().toISOString());
  if (error) throw error;

  let settled = 0;
  let failed = 0;
  for (const subscription of due ?? []) {
    try {
      // Both providers were already instructed to stop renewal when the user
      // scheduled cancellation. This job only settles local entitlement.
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
          status: "canceled",
          canceled_at: new Date().toISOString(),
          cancel_at_period_end: false,
        })
        .eq("id", subscription.id)
        .eq("cancel_at_period_end", true);
      if (updateError) throw updateError;
      await ensureFreeSubscription(supabase, subscription.org_id);
      settled += 1;
    } catch (settleError) {
      failed += 1;
      console.error("Could not settle scheduled subscription cancellation", subscription.id, settleError);
    }
  }
  return { settled, failed };
}
