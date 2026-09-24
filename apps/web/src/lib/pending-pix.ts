import "server-only";

import { type BillingProviderName, getProvider, type PixCharge } from "@flyee/billing";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The QR of the PIX charge a workspace is ALREADY waiting on, read again.
 *
 * WHY THIS EXISTS. Rendering the QR on our own page opens a trap the hosted
 * invoice never had: the QR lives only in React state, so a reload, a second
 * tab or a replayed submit loses it — and the obvious way to get it back,
 * calling the checkout again, opens a SECOND recurring subscription. This reads
 * the charge that already exists instead. It never creates one.
 *
 * WHY NO MIGRATION. `complete_checkout_billing_operation` (0069) writes the
 * subscription row as `incomplete` with `provider_subscription_id` at checkout
 * time, before any webhook. The charge — and its QR — is derivable from that id
 * on demand, so there is nothing new to store.
 *
 * The caller must have authorised the read: it uses the caller's own client,
 * so row-level security already limits it to the workspace's members.
 */
export async function pendingPixCharge(
  supabase: SupabaseClient,
  orgId: string,
  planId: string,
): Promise<PixCharge | null> {
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("provider, provider_subscription_id")
      .eq("org_id", orgId)
      .eq("plan_id", planId)
      .eq("status", "incomplete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.provider || !data.provider_subscription_id) return null;
    const provider = getProvider(data.provider as BillingProviderName);
    // Optional on the interface: a provider without PIX simply has no QR.
    return (await provider.pixCharge?.({ providerSubscriptionId: String(data.provider_subscription_id) })) ?? null;
  } catch {
    // Losing the QR costs a redirect to the hosted invoice, which shows the
    // same QR. Throwing here would cost the whole page.
    return null;
  }
}
