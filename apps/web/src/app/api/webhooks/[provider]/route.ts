import { NextResponse } from "next/server";

import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { createServiceClient } from "@flyee/auth/service";
import { type BillingEvent, type BillingPeriod, getProvider } from "@flyee/billing";

type ServiceClient = ReturnType<typeof createServiceClient>;

function periodEnd(from: Date, period: BillingPeriod): Date {
  const end = new Date(from);
  if (period === "weekly") end.setDate(end.getDate() + 7);
  if (period === "monthly") end.setMonth(end.getMonth() + 1);
  if (period === "yearly") end.setFullYear(end.getFullYear() + 1);
  return end;
}

/** Locates the subscription a provider event refers to. */
async function findSubscription(supabase: ServiceClient, event: { providerSubscriptionId?: string } & BillingEvent) {
  if (event.providerSubscriptionId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("provider", event.provider)
      .eq("provider_subscription_id", event.providerSubscriptionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const orgId = "metadata" in event ? event.metadata.org_id : undefined;
  if (orgId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("org_id", orgId)
      .eq("status", "incomplete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

/** Ensures the org lands back on the free plan after a cancellation. */
async function ensureFreeSubscription(supabase: ServiceClient, orgId: string) {
  const { data: live, error: liveError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("org_id", orgId)
    .in("status", ["trialing", "active", "past_due"])
    .limit(1);
  if (liveError) throw liveError;
  if (live && live.length > 0) return;

  const { data: freePlan, error: planError } = await supabase
    .from("plans")
    .select("id, period")
    .eq("is_free", true)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (planError) throw planError;
  if (!freePlan) return;

  const { error } = await supabase
    .from("subscriptions")
    .insert({ org_id: orgId, plan_id: freePlan.id, status: "active", period: freePlan.period });
  if (error) throw error;
}

async function handleEvent(supabase: ServiceClient, event: BillingEvent) {
  switch (event.type) {
    case "subscription_activated": {
      const sub = await findSubscription(supabase, event);
      // The provider may beat local checkout reconciliation. A retryable
      // failure keeps the inbox entry reclaimable instead of dropping access.
      if (!sub) throw new Error("subscription_not_ready");

      // Retire the previous live subscription (e.g. the free plan).
      const { error: retireError } = await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("org_id", sub.org_id)
        .in("status", ["trialing", "active", "past_due"])
        .neq("id", sub.id);
      if (retireError) throw new Error("subscription_reconciliation_failed");

      const { error: activationError } = await supabase
        .from("subscriptions")
        .update({
          status: event.status,
          provider: event.provider,
          provider_customer_id: event.providerCustomerId ?? sub.provider_customer_id,
          provider_subscription_id: event.providerSubscriptionId,
          current_period_start: new Date().toISOString(),
          current_period_end:
            event.currentPeriodEnd?.toISOString() ??
            sub.current_period_end ??
            (sub.period ? periodEnd(new Date(), sub.period as BillingPeriod).toISOString() : null),
        })
        .eq("id", sub.id);
      if (activationError) throw new Error("subscription_reconciliation_failed");

      // Attach order-bump modules chosen at checkout.
      const moduleIds = (event.metadata.module_ids ?? "").split(",").filter(Boolean);
      for (const moduleId of moduleIds) {
        const { error: moduleError } = await supabase
          .from("subscription_modules")
          .upsert({ subscription_id: sub.id, module_id: moduleId }, { onConflict: "subscription_id,module_id" });
        if (moduleError) throw new Error("subscription_module_reconciliation_failed");
      }

      // Count the coupon redemption once, on first activation.
      if (event.metadata.coupon_id && sub.status === "incomplete" && !sub.coupon_id) {
        const { error: subscriptionCouponError } = await supabase
          .from("subscriptions")
          .update({ coupon_id: event.metadata.coupon_id })
          .eq("id", sub.id)
          .is("coupon_id", null);
        if (subscriptionCouponError) throw new Error("coupon_reconciliation_failed");
        const { data: coupon, error: couponReadError } = await supabase
          .from("coupons")
          .select("redeemed_count")
          .eq("id", event.metadata.coupon_id)
          .maybeSingle();
        if (couponReadError) throw new Error("coupon_reconciliation_failed");
        if (coupon) {
          const { error: couponUpdateError } = await supabase
            .from("coupons")
            .update({ redeemed_count: coupon.redeemed_count + 1 })
            .eq("id", event.metadata.coupon_id);
          if (couponUpdateError) throw new Error("coupon_reconciliation_failed");
        }
      }
      break;
    }

    case "subscription_canceled": {
      const { data: sub, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select("id, org_id")
        .eq("provider", event.provider)
        .eq("provider_subscription_id", event.providerSubscriptionId)
        .in("status", ["trialing", "active", "past_due", "incomplete"])
        .maybeSingle();
      if (subscriptionError) throw new Error("subscription_reconciliation_failed");
      if (!sub) return;
      const { error: cancellationError } = await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString(), cancel_at_period_end: false })
        .eq("id", sub.id);
      if (cancellationError) throw new Error("subscription_reconciliation_failed");
      await ensureFreeSubscription(supabase, sub.org_id);
      break;
    }

    case "payment_succeeded": {
      const sub = await findSubscription(supabase, event);
      const orgId = sub?.org_id ?? event.metadata.org_id;
      if (!orgId) throw new Error("billing_context_not_ready");

      const { error: invoiceError } = await supabase.from("invoices").upsert(
        {
          org_id: orgId,
          subscription_id: sub?.id ?? null,
          provider: event.provider,
          provider_invoice_id: event.providerInvoiceId,
          amount_cents: event.amountCents,
          currency: event.currency,
          status: "paid",
          invoice_url: event.invoiceUrl,
          paid_at: event.paidAt.toISOString(),
        },
        { onConflict: "provider,provider_invoice_id" },
      );
      if (invoiceError) throw new Error("invoice_reconciliation_failed");

      // Credits plans grant credits on every paid cycle (or once, for
      // one-time purchases of non-expiring credits).
      const planId = event.metadata.plan_id ?? sub?.plan_id;
      if (planId) {
        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("kind, credit_amount, credits_expire, period, name")
          .eq("id", planId)
          .maybeSingle();
        if (planError) throw new Error("plan_reconciliation_failed");
        if (plan?.kind === "credits" && plan.credit_amount) {
          const expiresAt =
            plan.credits_expire && plan.period
              ? periodEnd(event.paidAt, plan.period as BillingPeriod).toISOString()
              : null;
          const { error: creditError } = await supabase.from("credit_transactions").upsert(
            {
              org_id: orgId,
              amount: plan.credit_amount,
              kind: "purchase",
              description: `${plan.name} — ${event.provider} payment`,
              expires_at: expiresAt,
              source_invoice_key: `${event.provider}:${event.providerInvoiceId}`,
            },
            { onConflict: "source_invoice_key", ignoreDuplicates: true },
          );
          if (creditError) throw new Error("credit_reconciliation_failed");
        }
      }

      // A paid invoice heals a past_due subscription.
      if (sub && sub.status === "past_due") {
        const { error: recoveryError } = await supabase
          .from("subscriptions")
          .update({ status: "active" })
          .eq("id", sub.id);
        if (recoveryError) throw new Error("subscription_reconciliation_failed");
      }

      // Meta CAPI — Purchase. Fired once per paid invoice (event_id is the
      // invoice id, so renewals count as distinct purchases and dedup safely).
      // The provider called us, so there is no browser here: we enrich the
      // match with the ad-click signals captured at checkout (meta_attribution)
      // — email + _fbp/_fbc + IP/UA — falling back to the hashed org id alone.
      // Best-effort: it never blocks reconciliation.
      try {
        const { data: attribution } = await supabase
          .from("meta_attribution")
          .select("fbp, fbc, email, client_ip, client_user_agent, ga_client_id")
          .eq("org_id", orgId)
          .maybeSingle();
        await sendMetaConversion({
          eventName: "Purchase",
          eventId: `${event.provider}:${event.providerInvoiceId}`,
          externalId: orgId,
          email: attribution?.email ?? null,
          fbp: attribution?.fbp ?? null,
          fbc: attribution?.fbc ?? null,
          clientIp: attribution?.client_ip ?? null,
          clientUserAgent: attribution?.client_user_agent ?? null,
          value: event.amountCents / 100,
          currency: event.currency,
          // Honest source: the webhook fired this, no browser present. The
          // match keys above still attribute it to the ad click.
          actionSource: "system_generated",
          eventTime: Math.floor(event.paidAt.getTime() / 1000),
        });
        // GA4 purchase — stitched to the web session via the _ga client id
        // captured at checkout (no _ga cookie here). transaction_id = invoice.
        await sendGa4Event({
          clientId: attribution?.ga_client_id ?? null,
          eventName: "purchase",
          eventId: `${event.provider}:${event.providerInvoiceId}`,
          eventTime: Math.floor(event.paidAt.getTime() / 1000),
          params: {
            currency: event.currency,
            value: event.amountCents / 100,
            transaction_id: `${event.provider}:${event.providerInvoiceId}`,
          },
        });
      } catch {
        // Measurement is best-effort — a paid invoice is already reconciled.
      }
      break;
    }

    case "payment_failed": {
      const sub = await findSubscription(supabase, event);
      const orgId = sub?.org_id ?? event.metadata.org_id;
      if (!orgId) throw new Error("billing_context_not_ready");
      const { error: invoiceError } = await supabase.from("invoices").upsert(
        {
          org_id: orgId,
          subscription_id: sub?.id ?? null,
          provider: event.provider,
          provider_invoice_id: event.providerInvoiceId,
          amount_cents: event.amountCents,
          currency: event.currency,
          status: "failed",
        },
        { onConflict: "provider,provider_invoice_id" },
      );
      if (invoiceError) throw new Error("invoice_reconciliation_failed");
      if (sub && ["trialing", "active"].includes(sub.status)) {
        const { error: pastDueError } = await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("id", sub.id);
        if (pastDueError) throw new Error("subscription_reconciliation_failed");
      }
      break;
    }
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  if (providerName !== "stripe" && providerName !== "asaas") {
    return new NextResponse("Unknown provider", { status: 404 });
  }

  const rawBody = await request.text();
  let events: BillingEvent[];
  try {
    events = await getProvider(providerName).parseWebhook(rawBody, {
      "stripe-signature": request.headers.get("stripe-signature"),
      "asaas-access-token": request.headers.get("asaas-access-token"),
    });
  } catch {
    console.warn("billing_webhook_rejected", { provider: providerName });
    return new NextResponse("Invalid webhook", { status: 400 });
  }

  const supabase = createServiceClient();
  let failed = false;
  for (const event of events) {
    const { data: claimData, error: claimError } = await supabase.rpc("claim_billing_webhook_event", {
      target_provider: event.provider,
      target_provider_event_id: event.providerEventId,
      target_event_type: event.type,
    });
    const claim = claimData as {
      ok?: boolean;
      code?: string;
      eventId?: string;
      claimToken?: string;
    } | null;
    if (claim?.code === "already_processed") continue;
    if (claimError || !claim?.ok || !claim.eventId || !claim.claimToken) {
      failed = true;
      continue;
    }
    try {
      await handleEvent(supabase, event);
      const { data: completionData, error: completionError } = await supabase.rpc("complete_billing_webhook_event", {
        target_event: claim.eventId,
        target_claim_token: claim.claimToken,
        target_success: true,
        target_error_code: null,
      });
      const completion = completionData as { ok?: boolean } | null;
      if (completionError || !completion?.ok) failed = true;
    } catch {
      failed = true;
      const { data: completionData, error: completionError } = await supabase.rpc("complete_billing_webhook_event", {
        target_event: claim.eventId,
        target_claim_token: claim.claimToken,
        target_success: false,
        target_error_code: "handler_failed",
      });
      const completion = completionData as { ok?: boolean } | null;
      if (completionError || !completion?.ok) {
        console.warn("billing_webhook_claim_completion_failed", {
          provider: event.provider,
          eventType: event.type,
        });
      }
    }
  }

  return NextResponse.json({ received: !failed }, { status: failed ? 500 : 200 });
}
