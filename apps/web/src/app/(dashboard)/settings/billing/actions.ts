"use server";

import { headers } from "next/headers";

import { recordAudit } from "@/lib/audit";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getMetaClientContext } from "@/lib/meta-capi-context";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { type CheckoutPlan, defaultProvider, getProvider } from "@flyee/billing";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActiveBillingClaim = {
  service: ReturnType<typeof createServiceClient>;
  operationId: string;
  claimToken: string;
};

async function failBillingClaim(claim: ActiveBillingClaim | null, errorCode: string) {
  if (!claim) return;
  try {
    await claim.service.rpc("complete_billing_operation", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_success: false,
      target_result: {},
      target_error_code: errorCode,
    });
  } catch {
    // The short server lease remains the retry boundary if Supabase is down.
  }
}

export async function checkoutAvailability(): Promise<boolean> {
  return defaultProvider() !== null;
}

export async function startCheckout(input: {
  orgId: string;
  planId: string;
  idempotencyKey: string;
}): Promise<StartCheckoutResult> {
  let activeClaim: ActiveBillingClaim | null = null;
  try {
    const { supabase, user } = await requireOrgManager(input.orgId);
    if (!UUID.test(input.idempotencyKey)) return { error: "unavailable" };

    const [{ data: planRow }, { data: org }] = await Promise.all([
      supabase.from("plans").select("*").eq("id", input.planId).eq("is_active", true).single(),
      supabase.from("organizations").select("name").eq("id", input.orgId).single(),
    ]);
    if (!planRow || planRow.is_free) return { error: "unavailable" };

    const plan: CheckoutPlan = {
      id: planRow.id,
      slug: planRow.slug,
      name: planRow.name,
      kind: planRow.kind,
      period: planRow.period,
      priceCents: planRow.price_cents,
      currency: planRow.currency,
      // MedChina's promotional access is cardless and lives exclusively in
      // pro_trials/org_audio_allowance; provider checkout never starts it.
      trialDays: 0,
      creditAmount: planRow.credit_amount,
      creditsExpire: planRow.credits_expire,
    };
    const provider = defaultProvider();
    if (!provider) return { error: "unavailable" };
    const service = createServiceClient();
    const { data: claimData, error: claimError } = await service.rpc("claim_billing_operation", {
      target_org: input.orgId,
      target_actor: user.id,
      target_kind: "checkout",
      target_idempotency_key: input.idempotencyKey,
      target_provider: provider,
      target_plan: plan.id,
      target_subscription: null,
    });
    const claim = claimData as {
      ok?: boolean;
      code?: string;
      operationId?: string;
      claimToken?: string;
      result?: { url?: string };
    } | null;
    if (claim?.code === "completed" && claim.result?.url) return { url: claim.result.url };
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) return { error: "unavailable" };
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };

    const origin = await appOrigin();
    const providerClient = getProvider(provider);
    const result = await providerClient.createCheckout({
      idempotencyKey: input.idempotencyKey,
      orgId: input.orgId,
      orgName: org?.name ?? "Organization",
      customerEmail: user.email ?? "",
      plan,
      modules: [],
      successUrl: `${origin}/settings/billing?checkout=success`,
      cancelUrl: `${origin}/settings/billing?checkout=canceled`,
    });

    const { data: completedData, error: pendingError } = await service.rpc("complete_checkout_billing_operation", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_plan: plan.id,
      target_period: plan.period,
      target_provider_customer: result.providerCustomerId ?? null,
      target_provider_subscription: result.providerSubscriptionId ?? null,
      target_checkout_url: result.url,
    });
    const completed = completedData as { ok?: boolean; result?: { url?: string } } | null;
    if (pendingError || !completed?.ok) {
      await failBillingClaim(activeClaim, "local_reconciliation_failed");
      activeClaim = null;
      return { error: "unavailable" };
    }
    activeClaim = null;
    await recordAudit(supabase, "subscription.checkout_started", {
      orgId: input.orgId,
      entityType: "plan",
      entityId: plan.id,
    });

    // Meta CAPI — InitiateCheckout. Server-side (no Pixel runs on the app);
    // reuses the idempotency key as event_id and the request's _fbp/_fbc so it
    // attributes to the ad click. No clinical data leaves the server.
    const metaContext = await getMetaClientContext(`${origin}/settings/billing`);
    await sendMetaConversion({
      eventName: "InitiateCheckout",
      eventId: input.idempotencyKey,
      email: user.email,
      externalId: input.orgId,
      value: plan.priceCents / 100,
      currency: plan.currency,
      ...metaContext,
    });

    return { url: completed.result?.url ?? result.url };
  } catch {
    await failBillingClaim(activeClaim, "provider_unavailable");
    return { error: "unavailable" };
  }
}

function fallbackPeriodEnd(period: string | null): Date {
  const end = new Date();
  if (period === "weekly") end.setDate(end.getDate() + 7);
  else if (period === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

export async function scheduleSubscriptionCancellation(
  orgId: string,
  idempotencyKey: string,
): Promise<{ error?: string }> {
  let activeClaim: ActiveBillingClaim | null = null;
  try {
    const { supabase, user } = await requireOrgManager(orgId);
    if (!UUID.test(idempotencyKey)) return { error: "unavailable" };

    const { data: sub } = await supabase
      .from("subscriptions")
      .select(
        "id, provider, provider_subscription_id, period, current_period_end, cancel_at_period_end, plans(is_free)",
      )
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return { error: "unavailable" };
    const planInfo = sub.plans as unknown as { is_free: boolean } | null;
    if (planInfo?.is_free) return { error: "unavailable" };
    if (sub.cancel_at_period_end) return {};

    const providerName = sub.provider ?? defaultProvider();
    if (!providerName) return { error: "unavailable" };
    const service = createServiceClient();
    const { data: claimData, error: claimError } = await service.rpc("claim_billing_operation", {
      target_org: orgId,
      target_actor: user.id,
      target_kind: "cancel",
      target_idempotency_key: idempotencyKey,
      target_provider: providerName,
      target_plan: null,
      target_subscription: sub.id,
    });
    const claim = claimData as {
      ok?: boolean;
      code?: string;
      operationId?: string;
      claimToken?: string;
    } | null;
    if (claim?.code === "completed") return {};
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) return { error: "unavailable" };
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };

    const storedEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
    const expectedPeriodEnd = storedEnd && storedEnd > new Date() ? storedEnd : fallbackPeriodEnd(sub.period);
    let providerPeriodEnd: Date | undefined;
    if (sub.provider && sub.provider_subscription_id) {
      const result = await getProvider(sub.provider).scheduleCancellation(
        sub.provider_subscription_id,
        expectedPeriodEnd,
      );
      providerPeriodEnd = result.currentPeriodEnd;
    }

    const currentPeriodEnd = providerPeriodEnd ?? expectedPeriodEnd;
    const { data: completionData, error: completionError } = await service.rpc("commit_billing_subscription_change", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_subscription: sub.id,
      target_kind: "cancel",
      target_current_period_end: currentPeriodEnd.toISOString(),
    });
    const completion = completionData as { ok?: boolean } | null;
    if (completionError || !completion?.ok) {
      await failBillingClaim(activeClaim, "local_reconciliation_failed");
      activeClaim = null;
      return { error: "unavailable" };
    }
    activeClaim = null;
    await recordAudit(supabase, "subscription.cancellation_scheduled", {
      orgId,
      entityType: "subscription",
      entityId: sub.id,
      metadata: { currentPeriodEnd: currentPeriodEnd.toISOString() },
    });

    return {};
  } catch {
    await failBillingClaim(activeClaim, "provider_unavailable");
    return { error: "unavailable" };
  }
}

export async function undoSubscriptionCancellation(orgId: string, idempotencyKey: string): Promise<{ error?: string }> {
  let activeClaim: ActiveBillingClaim | null = null;
  try {
    const { supabase, user } = await requireOrgManager(orgId);
    if (!UUID.test(idempotencyKey)) return { error: "unavailable" };
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, provider, provider_subscription_id, cancel_at_period_end, current_period_end")
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .eq("cancel_at_period_end", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub || (sub.current_period_end && new Date(sub.current_period_end) <= new Date()))
      return { error: "unavailable" };
    const providerName = sub.provider ?? defaultProvider();
    if (!providerName) return { error: "unavailable" };
    const service = createServiceClient();
    const { data: claimData, error: claimError } = await service.rpc("claim_billing_operation", {
      target_org: orgId,
      target_actor: user.id,
      target_kind: "resume",
      target_idempotency_key: idempotencyKey,
      target_provider: providerName,
      target_plan: null,
      target_subscription: sub.id,
    });
    const claim = claimData as {
      ok?: boolean;
      code?: string;
      operationId?: string;
      claimToken?: string;
    } | null;
    if (claim?.code === "completed") return {};
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) return { error: "unavailable" };
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };
    if (sub.provider && sub.provider_subscription_id) {
      await getProvider(sub.provider).resumeSubscription(sub.provider_subscription_id);
    }
    const { data: completionData, error: completionError } = await service.rpc("commit_billing_subscription_change", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_subscription: sub.id,
      target_kind: "resume",
      target_current_period_end: null,
    });
    const completion = completionData as { ok?: boolean } | null;
    if (completionError || !completion?.ok) {
      await failBillingClaim(activeClaim, "local_reconciliation_failed");
      activeClaim = null;
      return { error: "unavailable" };
    }
    activeClaim = null;
    await recordAudit(supabase, "subscription.cancellation_undone", {
      orgId,
      entityType: "subscription",
      entityId: sub.id,
    });
    return {};
  } catch {
    await failBillingClaim(activeClaim, "provider_unavailable");
    return { error: "unavailable" };
  }
}
