import { NextResponse } from "next/server";

import { createServiceClient } from "@gogo/auth/service";
import { type BillingEvent, type BillingPeriod, getProvider } from "@gogo/billing";

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
    const { data } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("provider_subscription_id", event.providerSubscriptionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  const orgId = "metadata" in event ? event.metadata.org_id : undefined;
  if (orgId) {
    const { data } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("org_id", orgId)
      .eq("status", "incomplete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Ensures the org lands back on the free plan after a cancellation. */
async function ensureFreeSubscription(supabase: ServiceClient, orgId: string) {
  const { data: live } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("org_id", orgId)
    .in("status", ["trialing", "active", "past_due"])
    .limit(1);
  if (live && live.length > 0) return;

  const { data: freePlan } = await supabase
    .from("plans")
    .select("id, period")
    .eq("is_free", true)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!freePlan) return;

  await supabase
    .from("subscriptions")
    .insert({ org_id: orgId, plan_id: freePlan.id, status: "active", period: freePlan.period });
}

async function handleEvent(supabase: ServiceClient, event: BillingEvent) {
  switch (event.type) {
    case "subscription_activated": {
      const sub = await findSubscription(supabase, event);
      if (!sub) return;

      // Retire the previous live subscription (e.g. the free plan).
      await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("org_id", sub.org_id)
        .in("status", ["trialing", "active", "past_due"])
        .neq("id", sub.id);

      await supabase
        .from("subscriptions")
        .update({
          status: event.status,
          provider: event.provider,
          provider_customer_id: event.providerCustomerId ?? sub.provider_customer_id,
          provider_subscription_id: event.providerSubscriptionId,
          current_period_start: new Date().toISOString(),
          current_period_end: event.currentPeriodEnd?.toISOString() ?? sub.current_period_end,
        })
        .eq("id", sub.id);

      // Attach order-bump modules chosen at checkout.
      const moduleIds = (event.metadata.module_ids ?? "").split(",").filter(Boolean);
      for (const moduleId of moduleIds) {
        await supabase
          .from("subscription_modules")
          .upsert({ subscription_id: sub.id, module_id: moduleId }, { onConflict: "subscription_id,module_id" });
      }

      // Count the coupon redemption once, on first activation.
      if (event.metadata.coupon_id && sub.status === "incomplete" && !sub.coupon_id) {
        await supabase.from("subscriptions").update({ coupon_id: event.metadata.coupon_id }).eq("id", sub.id);
        const { data: coupon } = await supabase
          .from("coupons")
          .select("redeemed_count")
          .eq("id", event.metadata.coupon_id)
          .maybeSingle();
        if (coupon) {
          await supabase
            .from("coupons")
            .update({ redeemed_count: coupon.redeemed_count + 1 })
            .eq("id", event.metadata.coupon_id);
        }
      }
      break;
    }

    case "subscription_canceled": {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("id, org_id")
        .eq("provider_subscription_id", event.providerSubscriptionId)
        .in("status", ["trialing", "active", "past_due", "incomplete"])
        .maybeSingle();
      if (!sub) return;
      await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("id", sub.id);
      await ensureFreeSubscription(supabase, sub.org_id);
      break;
    }

    case "payment_succeeded": {
      const sub = await findSubscription(supabase, event);
      const orgId = sub?.org_id ?? event.metadata.org_id;
      if (!orgId) return;

      await supabase.from("invoices").upsert(
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

      // Credits plans grant credits on every paid cycle (or once, for
      // one-time purchases of non-expiring credits).
      const planId = event.metadata.plan_id ?? sub?.plan_id;
      if (planId) {
        const { data: plan } = await supabase
          .from("plans")
          .select("kind, credit_amount, credits_expire, period, name")
          .eq("id", planId)
          .maybeSingle();
        if (plan?.kind === "credits" && plan.credit_amount) {
          const expiresAt =
            plan.credits_expire && plan.period
              ? periodEnd(event.paidAt, plan.period as BillingPeriod).toISOString()
              : null;
          await supabase.from("credit_transactions").insert({
            org_id: orgId,
            amount: plan.credit_amount,
            kind: "purchase",
            description: `${plan.name} — ${event.provider} payment`,
            expires_at: expiresAt,
          });
        }
      }

      // A paid invoice heals a past_due subscription.
      if (sub && sub.status === "past_due") {
        await supabase.from("subscriptions").update({ status: "active" }).eq("id", sub.id);
      }
      break;
    }

    case "payment_failed": {
      const sub = await findSubscription(supabase, event);
      const orgId = sub?.org_id ?? event.metadata.org_id;
      if (orgId) {
        await supabase.from("invoices").upsert(
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
      }
      if (sub && ["trialing", "active"].includes(sub.status)) {
        await supabase.from("subscriptions").update({ status: "past_due" }).eq("id", sub.id);
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
  } catch (error) {
    console.error(`Webhook verification failed (${providerName}):`, error);
    return new NextResponse("Invalid webhook", { status: 400 });
  }

  const supabase = createServiceClient();
  for (const event of events) {
    await handleEvent(supabase, event);
  }

  return NextResponse.json({ received: true });
}
