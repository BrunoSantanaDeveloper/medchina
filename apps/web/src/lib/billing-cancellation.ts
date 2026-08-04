import { createServiceClient } from "@flyee/auth/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The same single statement the webhook uses (migration 0067).
 *
 * This job and the webhook settle the same cancellations, so they raced: the
 * read-then-insert this replaced lost against `subscriptions_org_live_unique`
 * and raised, which in the webhook's case became a 500 and a provider retry.
 */
async function ensureFreeSubscription(supabase: ServiceClient, orgId: string) {
  const { error } = await supabase.rpc("ensure_free_subscription", { target_org: orgId });
  if (error) throw error;
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
