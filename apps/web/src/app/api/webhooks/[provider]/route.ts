import { NextResponse } from "next/server";

import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { notifyUsers } from "@/lib/notifications";
import { logAuditEvent } from "@flyee/audit";
import { createServiceClient } from "@flyee/auth/service";
import { type BillingEvent, type BillingPeriod, getProvider } from "@flyee/billing";
import { sendSubscriptionActiveEmail } from "@flyee/email";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * How many times an event may fail before we stop asking the provider to
 * resend it. Five covers a genuine race with local checkout reconciliation
 * (seconds) with room to spare; beyond that the cause is structural and only
 * an operator can clear it.
 */
const MAX_HANDLER_ATTEMPTS = 5;

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
    const planId = "metadata" in event ? event.metadata.plan_id : undefined;
    // The plan filter is what keeps the fallback honest. Stripe's checkout
    // session returns no subscription id, so the local row starts with none
    // and this fallback is the ONLY match — picking "the most recent
    // incomplete row" then activated whichever plan was opened last, not the
    // one that was actually paid.
    let query = supabase.from("subscriptions").select("*").eq("org_id", orgId).eq("status", "incomplete");
    if (planId) query = query.eq("plan_id", planId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

/**
 * Ensures the org lands back on the free plan after a cancellation.
 *
 * The read-then-insert this replaced raced against
 * `settleDueBillingCancellations`, which does the same job on a cron: the
 * loser hit `subscriptions_org_live_unique` (a PARTIAL unique index, so
 * `on conflict` needed a target the caller could not name from PostgREST),
 * raised, and the provider was asked to resend a perfectly reconciled event.
 * The RPC does it in one statement, and "already live" is a success.
 */
async function ensureFreeSubscription(supabase: ServiceClient, orgId: string) {
  const { data, error } = await supabase.rpc("ensure_free_subscription", { target_org: orgId });
  if (error) throw error;
  if ((data as { ok?: boolean } | null)?.ok !== true) throw new Error("free_plan_reconciliation_failed");
}

/**
 * A provider event that is not about MedChina at all.
 *
 * Asaas delivers webhooks for EVERY charge in the account, including ones
 * created by hand in its panel. Those carry no `externalReference` of ours, so
 * they can never reconcile — and treating them as retryable failures is what
 * made the route answer 500 forever, until Asaas suspended the queue and took
 * real activations down with it. Skipping is the correct outcome, and it has
 * to leave a trace or the next incident is equally blind.
 */
function skipForeignEvent(event: BillingEvent, why: string) {
  console.warn("billing_webhook_foreign_event", {
    provider: event.provider,
    providerEventId: event.providerEventId,
    type: event.type,
    why,
  });
}

/**
 * Tells the workspace something about its billing, in the default locale
 * (notification bodies are stored text, written at creation).
 *
 * Best-effort by construction: a notification outage must never make a
 * reconciled provider event look unreconciled, which would replay it.
 */
async function notifyOrg(supabase: ServiceClient, orgId: string, input: { title: string; body: string; href: string }) {
  try {
    const { data: members } = await supabase.from("memberships").select("user_id").eq("org_id", orgId);
    const userIds = (members ?? []).map((row) => row.user_id as string);
    if (userIds.length === 0) return;
    await notifyUsers(userIds, { type: "billing", ...input });
  } catch {
    // Reconciliation already succeeded; the bell is not worth replaying it.
  }
}

/**
 * Tells the workspace its plan is live.
 *
 * Best-effort like every other notification here: the entitlement is already
 * correct in the database, and replaying the whole event to retry a bell would
 * re-run the coupon and module reconciliation above it.
 */
async function notifyActivation(supabase: ServiceClient, orgId: string, planId: string) {
  try {
    const { data: plan } = await supabase.from("plans").select("name, limits").eq("id", planId).maybeSingle();
    const minutes = Number((plan?.limits as { audio_minutes?: unknown } | null)?.audio_minutes);
    const planName = plan?.name ?? "seu plano";
    const audioMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    await notifyOrg(supabase, orgId, {
      title: `${planName} ativo`,
      body: audioMinutes
        ? `Pagamento confirmado. Seus ${audioMinutes} minutos de IA por ciclo já estão disponíveis.`
        : "Pagamento confirmado. Seu plano já está ativo.",
      href: "/inicio",
    });

    // And out of the app, because with boleto/Pix she is not here when this
    // runs. The address lives in GoTrue, which the service role reads through
    // the admin API — there is no session on a provider callback.
    const { data: owners } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"]);
    for (const owner of owners ?? []) {
      const { data: account } = await supabase.auth.admin.getUserById(owner.user_id as string);
      const email = account?.user?.email;
      if (!email) continue;
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", owner.user_id as string)
        .maybeSingle();
      await sendSubscriptionActiveEmail(email, {
        planName,
        audioMinutes,
        appUrl: `${appOrigin()}/inicio`,
        name: (profile?.display_name as string | null) ?? null,
      });
    }
  } catch {
    // The plan is already active; a bell or an email is not worth replaying it.
  }
}

/** Absolute app URL for links inside an email sent from a webhook (no request). */
function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (!configured) return "https://ai.medchinaprontuarios.com.br";
  return configured.startsWith("http") ? configured.replace(/\/+$/u, "") : `https://${configured}`;
}

/**
 * Lets the 80/95/100% audio alerts fire again after a pack purchase.
 *
 * `usage_alerts` is keyed by (org, meter, window, threshold), which is exactly
 * what makes the alerts idempotent. But buying minutes changes the
 * DENOMINATOR mid-window: without this, someone who hit 100%, bought a pack
 * and burned through it would never be warned a second time — the row saying
 * "already alerted" would still be there from before the purchase.
 *
 * Best-effort: a missed reset costs a warning, not correctness.
 */
async function reopenAudioAlerts(supabase: ServiceClient, orgId: string) {
  try {
    const { data } = await supabase.rpc("org_audio_allowance", { target_org: orgId });
    const windowStart = (data as { window_start?: string } | null)?.window_start;
    if (!windowStart) return;
    await supabase
      .from("usage_alerts")
      .delete()
      .eq("org_id", orgId)
      .eq("meter", "audio")
      .eq("window_start", windowStart);
  } catch {
    // The pack is already granted; that is the part that had to be right.
  }
}

/**
 * Stop charging a subscription the workspace no longer holds.
 *
 * Retiring the row locally only changes what MedChina believes; the provider
 * keeps its own recurring charge alive. An upgrade (Assistente → Pro) creates
 * a NEW subscription, so without this the customer is billed twice — the kind
 * of incident that ends in a chargeback and a cancelled account.
 *
 * The free plan carries no provider id and is skipped. The subscription that
 * just activated is skipped explicitly, so a provider that re-emits the same
 * activation can never cancel the very thing it activated.
 *
 * Failures are logged, not thrown: the local state is already correct, and
 * replaying the whole event to retry a provider call would re-run the coupon
 * and module reconciliation above it.
 */
async function cancelSupersededAtProvider(
  supabase: ServiceClient,
  orgId: string,
  rows: { id: string; provider: string | null; provider_subscription_id: string | null }[],
  keep: { keepProvider: string; keepProviderSubscriptionId: string },
) {
  for (const row of rows) {
    if (!row.provider_subscription_id) continue;
    if (row.provider !== "stripe" && row.provider !== "asaas") continue;
    if (row.provider === keep.keepProvider && row.provider_subscription_id === keep.keepProviderSubscriptionId) {
      continue;
    }
    try {
      await getProvider(row.provider).cancelSubscription(row.provider_subscription_id);
    } catch (error) {
      // The customer is now being charged twice and nothing in the product
      // knows it: the local row says canceled while the provider keeps
      // billing. A console line is not enough for something that ends in a
      // chargeback — this has to be reviewable in /admin/audit.
      console.error("superseded_subscription_cancel_failed", {
        orgId,
        provider: row.provider,
        providerSubscriptionId: row.provider_subscription_id,
        message: error instanceof Error ? error.message : String(error),
      });
      await logAuditEvent(supabase, {
        orgId,
        actorId: null,
        action: "billing.superseded_cancel_failed",
        entityType: "subscription",
        entityId: row.id,
        metadata: {
          provider: row.provider,
          providerSubscriptionId: row.provider_subscription_id,
          consequence: "double_charge_risk",
        },
      }).catch(() => {
        // Reconciliation already succeeded; the trail is not worth replaying it.
      });
    }
  }
}

/** How many days the dunning window lasts, as configured (migration 0054). */
async function graceDays(supabase: ServiceClient): Promise<number> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", "dunning").maybeSingle();
  const days = Number((data?.value as { grace_days?: unknown } | null)?.grace_days);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

async function handleEvent(supabase: ServiceClient, event: BillingEvent) {
  switch (event.type) {
    case "subscription_activated": {
      const sub = await findSubscription(supabase, event);
      if (!sub) {
        // No org_id in the provider's metadata means this subscription was
        // never created by MedChina (a charge made by hand in the Asaas
        // panel). Reprocessing can only fail again — and failing forever is
        // what got the provider's queue suspended.
        if (!event.metadata.org_id) {
          skipForeignEvent(event, "unknown_subscription");
          return;
        }
        // Ours, but local checkout reconciliation has not landed yet. This one
        // IS worth retrying: the inbox entry stays reclaimable, with a cap.
        throw new Error("subscription_not_ready");
      }

      // An activation for a subscription we already retired is a stale event —
      // providers do not guarantee delivery order, and a failed event returns
      // BEHIND newer ones. Applying it would resurrect the old plan and, worse,
      // the supersedence below would cancel the new (paid) one at the provider.
      if (sub.status === "canceled") {
        skipForeignEvent(event, "obsolete_activation");
        return;
      }

      // Retire the previous live subscription (e.g. the free plan). When that
      // one was PAID, marking it canceled locally is not enough — the provider
      // keeps charging it, so an Assistente→Pro upgrade would bill both. Read
      // the rows before the update so the provider ids survive it.
      //
      // Only rows OLDER than this one are superseded. Without that bound, an
      // out-of-order event for the previous plan would cancel the newer
      // subscription the customer just paid for.
      const { data: superseded, error: supersededError } = await supabase
        .from("subscriptions")
        .select("id, provider, provider_subscription_id, created_at")
        .eq("org_id", sub.org_id)
        .in("status", ["trialing", "active", "past_due"])
        .neq("id", sub.id)
        .lt("created_at", sub.created_at);
      if (supersededError) throw new Error("subscription_reconciliation_failed");

      const { error: retireError } = await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("org_id", sub.org_id)
        .in("status", ["trialing", "active", "past_due"])
        .neq("id", sub.id)
        .lt("created_at", sub.created_at);
      if (retireError) throw new Error("subscription_reconciliation_failed");

      await cancelSupersededAtProvider(supabase, sub.org_id, superseded ?? [], {
        keepProvider: event.provider,
        keepProviderSubscriptionId: event.providerSubscriptionId,
      });

      // Whether this event opens a NEW billing cycle, or merely repeats one
      // that is already running.
      //
      // Stripe re-emits `customer.subscription.updated` for every change,
      // including the two the product itself makes (scheduling a cancellation
      // and undoing it). Stamping `now()` unconditionally restarted the audio
      // consumption window that `org_audio_allowance` measures from
      // `current_period_start` — so cancel + undo returned a full cycle of
      // minutes, repeatable at will, on a subscription that never renewed.
      const wasLive = sub.status === "trialing" || sub.status === "active";
      const storedPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
      const renewed = Boolean(event.currentPeriodEnd && storedPeriodEnd && event.currentPeriodEnd > storedPeriodEnd);
      const periodStart = event.currentPeriodStart?.toISOString() ?? new Date().toISOString();
      const nextPeriodStart = wasLive && !renewed ? (sub.current_period_start ?? periodStart) : periodStart;

      const { error: activationError } = await supabase
        .from("subscriptions")
        .update({
          status: event.status,
          provider: event.provider,
          provider_customer_id: event.providerCustomerId ?? sub.provider_customer_id,
          provider_subscription_id: event.providerSubscriptionId,
          // Activation supersedes any open dunning window.
          past_due_since: null,
          current_period_start: nextPeriodStart,
          current_period_end:
            event.currentPeriodEnd?.toISOString() ??
            sub.current_period_end ??
            (sub.period ? periodEnd(new Date(), sub.period as BillingPeriod).toISOString() : null),
        })
        .eq("id", sub.id);
      if (activationError) throw new Error("subscription_reconciliation_failed");

      // The one celebratory moment of the funnel, and it used to be silent.
      // With boleto/Pix the confirmation lands hours or days after she left
      // the app: without this she only finds out by coming back and reloading.
      if (sub.status === "incomplete") {
        await notifyActivation(supabase, sub.org_id, sub.plan_id);
      }

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
      // No local subscription AND no org in the provider's metadata: this
      // charge belongs to someone else's flow in the same Asaas account. It
      // will never reconcile, so retrying it forever only gets our queue
      // penalized — and a penalized queue stops delivering the payments that
      // ARE ours.
      if (!orgId) {
        skipForeignEvent(event, "no_billing_context");
        return;
      }

      // Asaas emits PAYMENT_CONFIRMED then PAYMENT_RECEIVED for the SAME card
      // payment. Reconciliation below is idempotent (invoice/credits dedup),
      // but the analytics Purchase must fire ONCE per invoice — so we remember
      // whether this invoice was already paid before this event and skip the
      // conversion the second time (Meta dedups by event_id anyway; GA4 does
      // not, so this is what keeps GA4 revenue honest).
      const { data: priorInvoice } = await supabase
        .from("invoices")
        .select("status")
        .eq("provider", event.provider)
        .eq("provider_invoice_id", event.providerInvoiceId)
        .maybeSingle();
      const alreadyCounted = priorInvoice?.status === "paid";

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
          .select("kind, credit_amount, credits_expire, period, name, is_addon, limits")
          .eq("id", planId)
          .maybeSingle();
        if (planError) throw new Error("plan_reconciliation_failed");

        // An à-la-carte minute pack (migration 0055). It is catalogued as a
        // one-off `credits` plan, but it grants AUDIO MINUTES, not generic
        // credits — so it takes this branch and never the one below, which
        // would otherwise hand out both currencies for a single payment.
        const packMinutes = Number((plan?.limits as { audio_minutes_pack?: unknown } | null)?.audio_minutes_pack);
        if (plan?.is_addon && Number.isFinite(packMinutes) && packMinutes > 0) {
          const { error: packError } = await supabase.from("audio_minute_packs").upsert(
            {
              org_id: orgId,
              plan_id: planId,
              source: "purchase",
              minutes_purchased: packMinutes,
              seconds_total: packMinutes * 60,
              price_cents: event.amountCents,
              currency: event.currency,
              invoice_key: `${event.provider}:${event.providerInvoiceId}`,
            },
            { onConflict: "invoice_key", ignoreDuplicates: true },
          );
          if (packError) throw new Error("audio_pack_reconciliation_failed");
          await reopenAudioAlerts(supabase, orgId);
          await notifyOrg(supabase, orgId, {
            title: `${packMinutes} minutos adicionados`,
            body: "Seus minutos avulsos não expiram e são usados depois dos minutos do seu plano.",
            href: "/settings/billing",
          });
        } else if (plan?.kind === "credits" && plan.credit_amount) {
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

      // A paid invoice heals a past_due subscription — and closes the dunning
      // window with it, so a later failure starts counting from scratch
      // instead of inheriting the previous one's clock.
      if (sub && sub.status === "past_due") {
        const { error: recoveryError } = await supabase
          .from("subscriptions")
          .update({ status: "active", past_due_since: null })
          .eq("id", sub.id);
        if (recoveryError) throw new Error("subscription_reconciliation_failed");
        await notifyOrg(supabase, orgId, {
          title: "Pagamento confirmado",
          body: "Sua assinatura está em dia e a gravação com IA segue disponível.",
          href: "/settings/billing",
        });
      }

      // Meta CAPI + GA4 — Purchase, once per paid invoice (renewals are distinct
      // invoices, so they count as distinct purchases). The provider called us,
      // so there is no browser here: we enrich the match with the ad-click
      // signals captured at checkout (meta_attribution) — email + _fbp/_fbc +
      // IP/UA + _ga client id. Best-effort: it never blocks reconciliation.
      if (!alreadyCounted)
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

          // Meta CAPI + GA4 — Subscribe, ONCE per subscription: only on its
          // FIRST paid invoice (renewals stay Purchase). Lets Meta optimize for
          // NEW paying customers, not renewals. Packs (no subscription) skip it.
          if (sub) {
            const { count: paidInvoices } = await supabase
              .from("invoices")
              .select("id", { count: "exact", head: true })
              .eq("subscription_id", sub.id)
              .eq("status", "paid");
            if (paidInvoices === 1) {
              await sendMetaConversion({
                eventName: "Subscribe",
                eventId: `subscribe:${sub.id}`,
                externalId: orgId,
                email: attribution?.email ?? null,
                fbp: attribution?.fbp ?? null,
                fbc: attribution?.fbc ?? null,
                clientIp: attribution?.client_ip ?? null,
                clientUserAgent: attribution?.client_user_agent ?? null,
                value: event.amountCents / 100,
                currency: event.currency,
                actionSource: "system_generated",
                eventTime: Math.floor(event.paidAt.getTime() / 1000),
              });
              await sendGa4Event({
                clientId: attribution?.ga_client_id ?? null,
                eventName: "subscribe",
                eventId: `subscribe:${sub.id}`,
                eventTime: Math.floor(event.paidAt.getTime() / 1000),
                params: { currency: event.currency, value: event.amountCents / 100 },
              });
            }
          }
        } catch {
          // Measurement is best-effort — a paid invoice is already reconciled.
        }
      break;
    }

    case "payment_failed": {
      const sub = await findSubscription(supabase, event);
      const orgId = sub?.org_id ?? event.metadata.org_id;
      if (!orgId) {
        skipForeignEvent(event, "no_billing_context");
        return;
      }
      const { error: invoiceError } = await supabase.from("invoices").upsert(
        {
          org_id: orgId,
          subscription_id: sub?.id ?? null,
          provider: event.provider,
          provider_invoice_id: event.providerInvoiceId,
          amount_cents: event.amountCents,
          currency: event.currency,
          status: "failed",
          // The recovery link. Persisting it is what turns "update your
          // payment" from a dead end into an action she can actually take.
          invoice_url: event.invoiceUrl,
        },
        { onConflict: "provider,provider_invoice_id" },
      );
      if (invoiceError) throw new Error("invoice_reconciliation_failed");
      if (sub && ["trialing", "active"].includes(sub.status)) {
        // The window has to count from a moment the database owns. Without
        // this stamp the grace period would have to be inferred from
        // `updated_at`, which any later write silently moves forward.
        const { error: pastDueError } = await supabase
          .from("subscriptions")
          .update({ status: "past_due", past_due_since: new Date().toISOString() })
          .eq("id", sub.id);
        if (pastDueError) throw new Error("subscription_reconciliation_failed");

        // She has to learn about it here, not by discovering mid-appointment
        // that the recorder stopped working.
        const days = await graceDays(supabase);
        await notifyOrg(supabase, orgId, {
          title: "Não conseguimos processar seu pagamento",
          body:
            days > 0
              ? `Atualize sua forma de pagamento em até ${days} dias para não interromper a gravação e a IA. Seus registros continuam acessíveis.`
              : "Atualize sua forma de pagamento para continuar usando a gravação e a IA. Seus registros continuam acessíveis.",
          href: "/settings/billing",
        });
      }
      break;
    }

    case "payment_reverted": {
      // Money that came back. The invoice must stop reading as paid, and — the
      // part that actually costs money — anything it BOUGHT has to go with it.
      // A minute pack never expires by design, so a chargeback left behind an
      // unlimited free balance nobody could see.
      const { data, error } = await supabase.rpc("revert_paid_invoice", {
        target_provider: event.provider,
        target_provider_invoice_id: event.providerInvoiceId,
        target_kind: event.kind,
      });
      if (error) throw new Error("invoice_reversal_failed");
      const result = data as { ok?: boolean; code?: string } | null;
      if (result?.ok !== true) throw new Error("invoice_reversal_failed");
      // An invoice we never recorded is not ours; the RPC says so and we stop.
      if (result.code === "unknown_invoice") skipForeignEvent(event, "unknown_invoice");
      break;
    }
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  if (providerName !== "stripe" && providerName !== "asaas") {
    return new NextResponse("Unknown provider", { status: 404 });
  }

  let rawBody: string;
  let supabase: ServiceClient;
  try {
    // Both of these used to run OUTSIDE any try. `createServiceClient()`
    // throws when its env vars are missing, which produced a 500 with no log
    // at all — indistinguishable, from the provider's side, from a handler bug.
    rawBody = await request.text();
    supabase = createServiceClient();
  } catch (error) {
    console.error("billing_webhook_bootstrap_failed", {
      provider: providerName,
      message: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse("Webhook unavailable", { status: 503 });
  }

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
      attempts?: number;
    } | null;
    if (claim?.code === "already_processed") continue;
    // Another invocation owns this event inside its 5-minute lease. Answering
    // 500 here penalizes the provider's queue for doing nothing wrong — and
    // after a crash it did so for five full minutes, for free.
    if (claim?.code === "event_in_progress") continue;
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
    } catch (error) {
      // After enough tries the problem is ours, not a race: keep answering 200
      // so the provider's queue survives, and hand the replay to an operator.
      // Without a cap a single unreconcilable event suspended the whole
      // webhook — including the payments that were reconciling fine.
      const attempts = Number(claim.attempts ?? 1);
      const permanent = attempts >= MAX_HANDLER_ATTEMPTS;
      if (!permanent) failed = true;
      // The catch used to be silent and wrote a fixed "handler_failed", so the
      // production incident could be seen but never explained.
      console.error("billing_webhook_handler_failed", {
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.type,
        attempts,
        permanent,
        message: error instanceof Error ? error.message : String(error),
      });
      const { data: completionData, error: completionError } = await supabase.rpc("complete_billing_webhook_event", {
        target_event: claim.eventId,
        target_claim_token: claim.claimToken,
        target_success: false,
        target_error_code: permanent ? "handler_failed_permanent" : "handler_failed",
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
