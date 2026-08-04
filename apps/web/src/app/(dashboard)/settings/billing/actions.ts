"use server";

import { headers } from "next/headers";

import { recordAudit } from "@/lib/audit";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";
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

/**
 * Refuses a purchase the workspace must not be able to make.
 *
 * `admin_suspended` is the superadmin kill-switch — fraud, chronic default, a
 * legal hold. `org_audio_allowance` already treats it as absolute, but no
 * screen or action checked it before starting a checkout: a suspended
 * workspace could pay for a plan and stay suspended. That is a charge with no
 * delivery, and a guaranteed refund.
 *
 * Returns the error code to answer with, or null when the purchase may go on.
 */
async function purchaseBlockedReason(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select("admin_suspended")
    .eq("org_id", orgId)
    .in("status", ["trialing", "active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.admin_suspended ? "suspended" : null;
}

/**
 * The fiscal identity Asaas requires to create a customer.
 *
 * Returned as a typed error rather than the generic "unavailable" because this
 * is the ONE checkout failure the professional can fix herself — the UI sends
 * her to the form instead of telling her to try again later.
 */
async function loadPayer(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string) {
  const { data } = await supabase
    .from("organizations")
    .select("name, billing_cpf_cnpj, billing_postal_code, billing_address_number, billing_phone")
    .eq("id", orgId)
    .single();
  return {
    orgName: data?.name ?? "Organization",
    payer: {
      document: data?.billing_cpf_cnpj ?? null,
      postalCode: data?.billing_postal_code ?? null,
      addressNumber: data?.billing_address_number ?? null,
      phone: data?.billing_phone ?? null,
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActiveBillingClaim = {
  service: ReturnType<typeof createServiceClient>;
  operationId: string;
  claimToken: string;
};

/**
 * Names the cause of a checkout failure in the server log.
 *
 * Every failure path below collapses to `{ error: "unavailable" }` on purpose
 * — provider and configuration detail must not reach the browser. But without
 * this the cause was not recorded ANYWHERE: diagnosing a customer who could
 * not subscribe meant reading `billing_operations` in production and guessing
 * between eight paths that share one code. The message is the operator's, not
 * the customer's.
 */
function logBillingFailure(stage: string, context: Record<string, unknown>, error?: unknown) {
  console.error("billing_checkout_failed", {
    stage,
    ...context,
    ...(error instanceof Error ? { message: error.message, name: error.name } : error ? { error: String(error) } : {}),
  });
}

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
    if (!UUID.test(input.idempotencyKey)) {
      logBillingFailure("invalid_idempotency_key", { orgId: input.orgId });
      return { error: "unavailable" };
    }

    const blocked = await purchaseBlockedReason(supabase, input.orgId);
    if (blocked) {
      logBillingFailure("purchase_blocked", { orgId: input.orgId, reason: blocked });
      return { error: blocked };
    }

    const [{ data: planRow }, { orgName, payer }] = await Promise.all([
      supabase.from("plans").select("*").eq("id", input.planId).eq("is_active", true).single(),
      loadPayer(supabase, input.orgId),
    ]);
    if (!planRow || planRow.is_free) {
      logBillingFailure("plan_not_purchasable", { orgId: input.orgId, planId: input.planId, found: Boolean(planRow) });
      return { error: "unavailable" };
    }
    // Asaas rejects a customer without cpfCnpj, so this would fail deep inside
    // the provider call with a generic message. Named here, the UI can send
    // her to the form that fixes it instead of "try again later".
    if (!payer.document) {
      logBillingFailure("missing_billing_document", { orgId: input.orgId });
      return { error: "billing_profile_required" };
    }

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
    if (!provider) {
      logBillingFailure("no_provider_configured", { orgId: input.orgId });
      return { error: "unavailable" };
    }
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
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) {
      logBillingFailure("claim_rejected", { orgId: input.orgId, provider, code: claim?.code }, claimError);
      return { error: "unavailable" };
    }
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };

    const origin = await appOrigin();
    const providerClient = getProvider(provider);
    const result = await providerClient.createCheckout({
      idempotencyKey: input.idempotencyKey,
      orgId: input.orgId,
      orgName,
      customerEmail: user.email ?? "",
      plan,
      modules: [],
      payer,
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
      // The provider already has a checkout at this point; only the local
      // bookkeeping failed. Worth shouting about — the customer may be looking
      // at a payment page we have no record of.
      logBillingFailure("local_reconciliation_failed", { orgId: input.orgId, planId: input.planId }, pendingError);
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

    // Measurement is best-effort and MUST NOT turn a successful checkout into
    // an error — hence its own try/catch, isolated from the outer handler.
    try {
      // Server-side (no Pixel runs on the app); reuses the request's _fbp/_fbc
      // (set by the marketing-site Pixel, same origin) so it attributes to the
      // ad click. No clinical data leaves the server.
      const metaContext = await getMetaClientContext(`${origin}/settings/billing`);
      const gaClientId = await getGaClientId();
      // Stash the tracking signals so the browserless Purchase webhook can match
      // on them later (PIX/boleto confirm out of band; renewals too). Only when
      // a signal exists (the consent + ad-attribution moment) — so a plain
      // checkout never wipes a previously stored row.
      if (metaContext.fbp || metaContext.fbc || gaClientId) {
        await service.from("meta_attribution").upsert({
          org_id: input.orgId,
          fbp: metaContext.fbp ?? null,
          fbc: metaContext.fbc ?? null,
          email: user.email ?? null,
          client_ip: metaContext.clientIp ?? null,
          client_user_agent: metaContext.clientUserAgent ?? null,
          ga_client_id: gaClientId,
          updated_at: new Date().toISOString(),
        });
      }
      await sendMetaConversion({
        eventName: "InitiateCheckout",
        eventId: input.idempotencyKey,
        email: user.email,
        externalId: input.orgId,
        value: plan.priceCents / 100,
        currency: plan.currency,
        ...metaContext,
      });
      // GA4 begin_checkout — stitched to the web session via the _ga client id.
      await sendGa4Event({
        clientId: gaClientId,
        eventName: "begin_checkout",
        eventId: input.idempotencyKey,
        params: { currency: plan.currency, value: plan.priceCents / 100 },
      });
    } catch {
      // Best-effort — the checkout URL returned below is what matters.
    }

    return { url: completed.result?.url ?? result.url };
  } catch (error) {
    // The provider call is the likeliest thing to land here, and its message
    // is the only place the real cause exists — a bad key, a rejected payload,
    // a base URL that is not a URL. Losing it is what turns "she cannot
    // subscribe" into an archaeology exercise over billing_operations.
    logBillingFailure("provider_call_threw", { orgId: input.orgId, planId: input.planId }, error);
    await failBillingClaim(activeClaim, "provider_unavailable");
    return { error: "unavailable" };
  }
}

/**
 * Buys a one-off pack of audio minutes (migration 0055).
 *
 * Deliberately NOT a variant of `startCheckout`: that flow writes a
 * `subscriptions` row and demands a billing period, both of which are right
 * for a plan and wrong for a single payment — an org may hold only one live
 * subscription, so reusing it would fight the tier the customer is already on.
 *
 * The commercial rule (a pack tops up a paid plan, it does not replace one) is
 * checked HERE as well as reported by `org_audio_allowance`. The allowance
 * drives what the UI offers; this is what actually holds, because a server
 * action is callable without the UI.
 */
export async function startPackCheckout(input: {
  orgId: string;
  planId: string;
  idempotencyKey: string;
}): Promise<StartCheckoutResult> {
  let activeClaim: ActiveBillingClaim | null = null;
  try {
    const { supabase, user } = await requireOrgManager(input.orgId);
    if (!UUID.test(input.idempotencyKey)) return { error: "unavailable" };

    const blocked = await purchaseBlockedReason(supabase, input.orgId);
    if (blocked) {
      logBillingFailure("purchase_blocked", { orgId: input.orgId, reason: blocked });
      return { error: blocked };
    }

    const [{ data: planRow }, { orgName, payer }, { data: allowance }] = await Promise.all([
      supabase.from("plans").select("*").eq("id", input.planId).eq("is_active", true).single(),
      loadPayer(supabase, input.orgId),
      supabase.rpc("org_audio_allowance", { target_org: input.orgId }),
    ]);

    const packMinutes = Number((planRow?.limits as { audio_minutes_pack?: unknown } | null)?.audio_minutes_pack);
    if (!planRow || !planRow.is_addon || !Number.isFinite(packMinutes) || packMinutes <= 0) {
      return { error: "unavailable" };
    }
    if ((allowance as { pack_purchasable?: boolean } | null)?.pack_purchasable !== true) {
      return { error: "plan_required" };
    }
    if (!payer.document) {
      logBillingFailure("missing_billing_document", { orgId: input.orgId });
      return { error: "billing_profile_required" };
    }

    const plan: CheckoutPlan = {
      id: planRow.id,
      slug: planRow.slug,
      name: planRow.name,
      kind: planRow.kind,
      // No period is what makes the provider charge once instead of
      // subscribing (Stripe: `mode: "payment"`).
      period: null,
      priceCents: planRow.price_cents,
      currency: planRow.currency,
      trialDays: 0,
      creditAmount: planRow.credit_amount,
      creditsExpire: planRow.credits_expire,
    };
    const provider = defaultProvider();
    if (!provider) {
      logBillingFailure("no_provider_configured", { orgId: input.orgId });
      return { error: "unavailable" };
    }
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
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) {
      logBillingFailure("claim_rejected", { orgId: input.orgId, provider, code: claim?.code }, claimError);
      return { error: "unavailable" };
    }
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };

    const origin = await appOrigin();
    const result = await getProvider(provider).createCheckout({
      idempotencyKey: input.idempotencyKey,
      orgId: input.orgId,
      orgName,
      customerEmail: user.email ?? "",
      plan,
      modules: [],
      payer,
      successUrl: `${origin}/settings/billing?checkout=success`,
      cancelUrl: `${origin}/settings/billing?checkout=canceled`,
    });

    const { data: completedData, error: pendingError } = await service.rpc("complete_pack_checkout_billing_operation", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_plan: plan.id,
      target_checkout_url: result.url,
    });
    const completed = completedData as { ok?: boolean; result?: { url?: string } } | null;
    if (pendingError || !completed?.ok) {
      // The provider already has a checkout at this point; only the local
      // bookkeeping failed. Worth shouting about — the customer may be looking
      // at a payment page we have no record of.
      logBillingFailure("local_reconciliation_failed", { orgId: input.orgId, planId: input.planId }, pendingError);
      await failBillingClaim(activeClaim, "local_reconciliation_failed");
      activeClaim = null;
      return { error: "unavailable" };
    }
    activeClaim = null;

    // The minutes themselves are granted by the webhook, on the paid invoice —
    // never here. A checkout that is started is not a checkout that is paid,
    // and PIX/boleto make that gap minutes or hours wide.
    await recordAudit(supabase, "billing.audio_pack_checkout_started", {
      orgId: input.orgId,
      entityType: "plan",
      entityId: plan.id,
      metadata: { minutes: packMinutes },
    });

    try {
      const metaContext = await getMetaClientContext(`${origin}/settings/billing`);
      const gaClientId = await getGaClientId();
      // Same stash as the subscription checkout. A pack paid by Pix or boleto
      // confirms out of band, so the webhook has no browser to read signals
      // from — without this the purchase reached Meta/GA4 unattributed.
      if (metaContext.fbp || metaContext.fbc || gaClientId) {
        await service.from("meta_attribution").upsert({
          org_id: input.orgId,
          fbp: metaContext.fbp ?? null,
          fbc: metaContext.fbc ?? null,
          email: user.email ?? null,
          client_ip: metaContext.clientIp ?? null,
          client_user_agent: metaContext.clientUserAgent ?? null,
          ga_client_id: gaClientId,
          updated_at: new Date().toISOString(),
        });
      }
      await sendMetaConversion({
        eventName: "InitiateCheckout",
        eventId: input.idempotencyKey,
        email: user.email,
        externalId: input.orgId,
        value: plan.priceCents / 100,
        currency: plan.currency,
        ...metaContext,
      });
      await sendGa4Event({
        clientId: gaClientId,
        eventName: "begin_checkout",
        eventId: input.idempotencyKey,
        params: { currency: plan.currency, value: plan.priceCents / 100 },
      });
    } catch {
      // Best-effort — the checkout URL returned below is what matters.
    }

    return { url: completed.result?.url ?? result.url };
  } catch (error) {
    // The provider call is the likeliest thing to land here, and its message
    // is the only place the real cause exists — a bad key, a rejected payload,
    // a base URL that is not a URL. Losing it is what turns "she cannot
    // subscribe" into an archaeology exercise over billing_operations.
    logBillingFailure("provider_call_threw", { orgId: input.orgId, planId: input.planId }, error);
    await failBillingClaim(activeClaim, "provider_unavailable");
    if (error instanceof Error && error.message === "asaas_missing_document") {
      return { error: "billing_profile_required" };
    }
    return { error: "unavailable" };
  }
}

/**
 * Retires a checkout the customer walked away from.
 *
 * On Asaas the subscription is created at the START of checkout, before any
 * payment: closing the tab leaves a live monthly charge that nothing in the
 * product could see or stop, and the local row sat `incomplete` forever. When
 * that charge came due, the workspace received a failed invoice for something
 * it never contracted — with no button anywhere to end it.
 */
export async function abandonPendingCheckout(orgId: string, subscriptionId: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireOrgManager(orgId);
    const { data, error } = await supabase.rpc("abandon_incomplete_subscription", {
      target_org: orgId,
      target_subscription: subscriptionId,
    });
    if (error) return { error: "unavailable" };
    const result = data as { ok?: boolean; provider?: string | null; providerSubscriptionId?: string | null } | null;
    if (result?.ok !== true) return { error: "unavailable" };

    // Local state is already correct. Stopping the provider is what actually
    // prevents the charge, but a failure here must not undo the cancellation
    // the customer just asked for — it is logged and swept by the reaper.
    if (result.providerSubscriptionId && (result.provider === "stripe" || result.provider === "asaas")) {
      try {
        await getProvider(result.provider).cancelSubscription(result.providerSubscriptionId);
      } catch (providerError) {
        logBillingFailure("abandon_provider_cancel_failed", { orgId, subscriptionId }, providerError);
      }
    }
    await recordAudit(supabase, "subscription.checkout_abandoned", {
      orgId,
      entityType: "subscription",
      entityId: subscriptionId,
    });
    return {};
  } catch (error) {
    logBillingFailure("abandon_checkout_threw", { orgId, subscriptionId }, error);
    return { error: "unavailable" };
  }
}

export type PaymentRecoveryResult = { url?: string; error?: "unavailable" | "not_needed" };

/**
 * Where a workspace with a failed charge actually pays.
 *
 * Every dunning surface in the app points at "update your payment", and until
 * now that led to a page with a plan grid and no way to fix a card — the grace
 * window counted down on someone who had no action available. Two providers,
 * two shapes: Stripe has a hosted Billing Portal for the card behind the
 * subscription; Asaas bills per charge, so the failed invoice's own hosted URL
 * IS the payment page. Prefer the portal, fall back to the invoice, and say
 * "unavailable" only when neither exists.
 */
export async function startPaymentRecovery(orgId: string): Promise<PaymentRecoveryResult> {
  try {
    const { supabase } = await requireOrgManager(orgId);

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, status, provider, provider_customer_id, provider_subscription_id")
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub?.provider === "stripe" && sub.provider_customer_id) {
      const provider = getProvider("stripe");
      const url = await provider.billingPortalUrl?.({
        providerCustomerId: sub.provider_customer_id,
        providerSubscriptionId: sub.provider_subscription_id ?? undefined,
        returnUrl: `${await appOrigin()}/settings/billing`,
      });
      if (url) return { url };
    }

    // The most recent unpaid invoice OF THIS SUBSCRIPTION — for Asaas this is
    // the payment page, and for Stripe the fallback when the portal has no
    // configuration yet.
    //
    // Scoping to the subscription is what keeps the button honest: a
    // PAYMENT_OVERDUE from an abandoned MINUTE PACK also writes a failed
    // invoice on the same org, and the unscoped query happily returned it. She
    // clicked "update payment" to fix her plan and was handed the boleto of a
    // pack she gave up on — paying it leaves the subscription past_due with
    // the grace window still running.
    let invoiceQuery = supabase
      .from("invoices")
      .select("invoice_url, status, created_at")
      .eq("org_id", orgId)
      .eq("status", "failed")
      .not("invoice_url", "is", null);
    if (sub?.id) invoiceQuery = invoiceQuery.eq("subscription_id", sub.id);
    const { data: invoice } = await invoiceQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (invoice?.invoice_url) return { url: invoice.invoice_url };

    // Nothing to recover: no failed charge on file and no portal.
    if (sub?.status !== "past_due") return { error: "not_needed" };
    return { error: "unavailable" };
  } catch {
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
