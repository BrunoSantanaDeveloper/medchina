"use server";

import { headers } from "next/headers";

import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import {
  applyDiscount,
  type BillingProviderName,
  type CheckoutCoupon,
  type CheckoutModule,
  type CheckoutPlan,
  getProvider,
} from "@flyee/billing";

async function requireOrgManager(orgId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("Only organization owners/admins can manage billing.");
  }
  return { supabase, user };
}

async function appOrigin() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export type StartCheckoutResult = { url?: string; error?: string };

export async function startCheckout(input: {
  orgId: string;
  planId: string;
  moduleIds: string[];
  couponCode?: string;
  provider: BillingProviderName;
}): Promise<StartCheckoutResult> {
  try {
    const { supabase, user } = await requireOrgManager(input.orgId);

    const [{ data: planRow }, { data: moduleRows }, { data: org }] = await Promise.all([
      supabase.from("plans").select("*").eq("id", input.planId).eq("is_active", true).single(),
      input.moduleIds.length
        ? supabase.from("modules").select("*").in("id", input.moduleIds).eq("is_active", true)
        : Promise.resolve({ data: [] as never[] }),
      supabase.from("organizations").select("name").eq("id", input.orgId).single(),
    ]);
    if (!planRow) return { error: "Plan not found." };
    if (planRow.is_free) return { error: "The free plan does not require checkout." };

    let coupon: CheckoutCoupon | undefined;
    if (input.couponCode?.trim()) {
      const { data: couponRows } = await supabase.rpc("validate_coupon", {
        coupon_code: input.couponCode.trim(),
      });
      const validated = couponRows?.[0];
      if (!validated) return { error: "Invalid or expired coupon." };
      coupon = {
        id: validated.id,
        code: validated.code,
        discountType: validated.discount_type,
        discountValue: validated.discount_value,
      };
    }

    const plan: CheckoutPlan = {
      id: planRow.id,
      slug: planRow.slug,
      name: planRow.name,
      kind: planRow.kind,
      period: planRow.period,
      priceCents: planRow.price_cents,
      currency: planRow.currency,
      trialDays: planRow.trial_days,
      creditAmount: planRow.credit_amount,
      creditsExpire: planRow.credits_expire,
    };
    const modules: CheckoutModule[] = (moduleRows ?? []).map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      kind: m.kind,
      priceCents: m.price_cents,
    }));

    const origin = await appOrigin();
    const result = await getProvider(input.provider).createCheckout({
      orgId: input.orgId,
      orgName: org?.name ?? "Organization",
      customerEmail: user.email ?? "",
      plan,
      modules,
      coupon,
      successUrl: `${origin}/settings/billing?checkout=success`,
      cancelUrl: `${origin}/settings/billing?checkout=canceled`,
    });

    // Pending row the webhook will promote on activation. Uses the service
    // client because users have no direct write access to subscriptions.
    const service = createServiceClient();
    await service.from("subscriptions").insert({
      org_id: input.orgId,
      plan_id: plan.id,
      status: "incomplete",
      provider: input.provider,
      provider_subscription_id: result.providerSubscriptionId ?? null,
      provider_customer_id: result.providerCustomerId ?? null,
      period: plan.period,
      coupon_id: coupon?.id ?? null,
    });

    return { url: result.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Checkout failed." };
  }
}

export async function cancelSubscription(orgId: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireOrgManager(orgId);

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, provider, provider_subscription_id, plans(is_free)")
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return { error: "No active subscription." };
    const planInfo = sub.plans as unknown as { is_free: boolean } | null;
    if (planInfo?.is_free) return { error: "The free plan cannot be canceled." };

    if (sub.provider && sub.provider_subscription_id) {
      await getProvider(sub.provider).cancelSubscription(sub.provider_subscription_id);
    }

    // Provider webhooks also handle this, but settle locally right away so
    // the UI reflects the cancellation without waiting for the webhook.
    const service = createServiceClient();
    await service
      .from("subscriptions")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", sub.id);
    const { data: freePlan } = await service
      .from("plans")
      .select("id, period")
      .eq("is_free", true)
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (freePlan) {
      await service
        .from("subscriptions")
        .insert({ org_id: orgId, plan_id: freePlan.id, status: "active", period: freePlan.period });
    }

    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Cancellation failed." };
  }
}

/** Preview of the checkout total with an optional coupon, for the UI. */
export async function previewTotal(input: {
  planId: string;
  moduleIds: string[];
  couponCode?: string;
}): Promise<{ totalCents?: number; error?: string }> {
  const supabase = await createClient();
  const [{ data: plan }, { data: moduleRows }] = await Promise.all([
    supabase.from("plans").select("price_cents").eq("id", input.planId).single(),
    input.moduleIds.length
      ? supabase.from("modules").select("price_cents").in("id", input.moduleIds)
      : Promise.resolve({ data: [] as { price_cents: number }[] }),
  ]);
  if (!plan) return { error: "Plan not found." };
  let coupon: CheckoutCoupon | undefined;
  if (input.couponCode?.trim()) {
    const { data: rows } = await supabase.rpc("validate_coupon", { coupon_code: input.couponCode.trim() });
    const validated = rows?.[0];
    if (!validated) return { error: "Invalid or expired coupon." };
    coupon = {
      id: validated.id,
      code: validated.code,
      discountType: validated.discount_type,
      discountValue: validated.discount_value,
    };
  }
  const total = plan.price_cents + (moduleRows ?? []).reduce((sum, m) => sum + m.price_cents, 0);
  return { totalCents: applyDiscount(total, coupon) };
}
