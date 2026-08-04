import { createServiceClient } from "@flyee/auth/service";
import { getProvider } from "@flyee/billing";

/**
 * Housekeeping the billing layer never had (see docs/BILLING-AUDIT.md).
 *
 * Two leaks, both invisible until they cost money:
 *
 *  - Leases die with their worker (a serverless timeout, a deploy mid-request).
 *    Nothing ever cleared them, so `billing_operations` accumulated rows stuck
 *    in `processing` and the webhook inbox answered `event_in_progress` for
 *    five minutes after every crash.
 *
 *  - On Asaas the subscription is created at the START of checkout, before any
 *    payment. Closing the tab left a live monthly charge that nothing in the
 *    product could see or stop — the customer was billed for something she
 *    never contracted, and the local row sat `incomplete` forever.
 */

/** How long an unpaid checkout may stay open before it is retired. */
const ABANDONED_CHECKOUT_HOURS = 24;

export async function expireStaleBillingLeases(): Promise<{ operations: number; events: number }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("expire_stale_billing_leases", { target_grace: "01:00:00" });
  if (error) throw error;
  const result = data as { operations?: number; events?: number } | null;
  return { operations: result?.operations ?? 0, events: result?.events ?? 0 };
}

/**
 * Retires checkouts nobody finished, at the provider as well as locally.
 *
 * 24 hours is deliberately generous: boleto and Pix confirm out of band, and
 * cancelling a charge someone is about to pay would be worse than leaving it
 * open a little longer. The provider cancellation is what actually stops the
 * money; the local update only changes what MedChina believes, so a provider
 * failure keeps the row for the next run instead of silently orphaning it.
 */
export async function retireAbandonedCheckouts(): Promise<{ retired: number; failed: number }> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - ABANDONED_CHECKOUT_HOURS * 3_600_000).toISOString();

  const { data: stale, error } = await supabase
    .from("subscriptions")
    .select("id, org_id, provider, provider_subscription_id")
    .eq("status", "incomplete")
    .lt("created_at", cutoff)
    .limit(100);
  if (error) throw error;

  let retired = 0;
  let failed = 0;
  for (const subscription of stale ?? []) {
    try {
      if (
        subscription.provider_subscription_id &&
        (subscription.provider === "stripe" || subscription.provider === "asaas")
      ) {
        await getProvider(subscription.provider).cancelSubscription(subscription.provider_subscription_id);
      }
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("id", subscription.id)
        .eq("status", "incomplete");
      if (updateError) throw updateError;
      retired += 1;
    } catch (retireError) {
      failed += 1;
      // Left `incomplete` on purpose: the next run tries again. Marking it
      // canceled here would hide a charge that is still live at the provider.
      console.error("abandoned_checkout_retire_failed", {
        subscriptionId: subscription.id,
        orgId: subscription.org_id,
        message: retireError instanceof Error ? retireError.message : String(retireError),
      });
    }
  }
  return { retired, failed };
}
