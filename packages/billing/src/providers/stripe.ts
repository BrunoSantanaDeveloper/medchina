import Stripe from "stripe";

import type {
  BillingEvent,
  BillingPeriod,
  CheckoutCoupon,
  CheckoutInput,
  CheckoutMetadata,
  CheckoutResult,
  PaymentProvider,
} from "../types";

const PERIOD_TO_INTERVAL: Record<BillingPeriod, Stripe.Price.Recurring.Interval> = {
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

/** Creates (or reuses) a Stripe coupon mirroring ours, so recurring cycles stay discounted. */
async function ensureStripeCoupon(stripe: Stripe, coupon: CheckoutCoupon, currency: string): Promise<string> {
  const id = `flyee-${coupon.id}`;
  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch {
    await stripe.coupons.create({
      id,
      name: coupon.code,
      duration: "forever",
      ...(coupon.discountType === "percent"
        ? { percent_off: coupon.discountValue }
        : { amount_off: coupon.discountValue, currency: currency.toLowerCase() }),
    });
    return id;
  }
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const stripe = getStripe();
    const { plan, modules, coupon } = input;
    const currency = plan.currency.toLowerCase();
    // Recurring plans (including per-period credit grants) become Stripe
    // subscriptions; a credits plan without period is a one-off payment.
    const isSubscription = plan.period !== null;

    const metadata: Record<string, string> = {
      org_id: input.orgId,
      plan_id: plan.id,
      module_ids: modules.map((m) => m.id).join(","),
      billing_operation_key: input.idempotencyKey,
      ...(coupon ? { coupon_id: coupon.id } : {}),
    };

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: plan.priceCents,
          product_data: { name: plan.name },
          ...(isSubscription && plan.period ? { recurring: { interval: PERIOD_TO_INTERVAL[plan.period] } } : {}),
        },
      },
      ...modules.map((module) => ({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: module.priceCents,
          product_data: { name: module.name },
          // Recurring modules ride the subscription cycle; one-time
          // order bumps are charged on the first invoice only.
          ...(isSubscription && module.kind === "recurring" && plan.period
            ? { recurring: { interval: PERIOD_TO_INTERVAL[plan.period] } }
            : {}),
        },
      })),
    ];

    const session = await stripe.checkout.sessions.create(
      {
        mode: isSubscription ? "subscription" : "payment",
        customer_email: input.customerEmail,
        client_reference_id: input.orgId,
        line_items: lineItems,
        metadata,
        ...(coupon ? { discounts: [{ coupon: await ensureStripeCoupon(stripe, coupon, currency) }] } : {}),
        ...(isSubscription
          ? {
              subscription_data: {
                metadata,
                ...(plan.trialDays > 0 ? { trial_period_days: plan.trialDays } : {}),
              },
            }
          : {}),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(providerSubscriptionId);
  }

  async scheduleCancellation(providerSubscriptionId: string): Promise<{ currentPeriodEnd?: Date }> {
    const subscription = await getStripe().subscriptions.update(providerSubscriptionId, {
      cancel_at_period_end: true,
    });
    const currentPeriodEnd = subscription.items.data[0]?.current_period_end;
    return { currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : undefined };
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    await getStripe().subscriptions.update(providerSubscriptionId, { cancel_at_period_end: false });
  }

  /**
   * Stripe's hosted Billing Portal — the only place the customer can replace a
   * failed card. Returns null when the portal has no configuration in the
   * Stripe account (a setup step, not a code bug), so the caller can fall back
   * to the failed invoice's own hosted URL instead of showing an error.
   */
  async billingPortalUrl(input: { providerCustomerId: string; returnUrl: string }): Promise<string | null> {
    try {
      const session = await getStripe().billingPortal.sessions.create({
        customer: input.providerCustomerId,
        return_url: input.returnUrl,
      });
      return session.url ?? null;
    } catch {
      return null;
    }
  }

  async parseWebhook(rawBody: string, headers: Record<string, string | null>): Promise<BillingEvent[]> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    const signature = headers["stripe-signature"];
    if (!signature) throw new Error("Missing stripe-signature header");

    const stripe = getStripe();
    const event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
    const events: BillingEvent[] = [];

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // One-off payments (credits without period / one-time bumps) have
        // no subscription and no invoice.paid — record the payment here.
        if (session.mode === "payment" && session.payment_status === "paid") {
          events.push({
            providerEventId: event.id,
            type: "payment_succeeded",
            provider: "stripe",
            metadata: (session.metadata ?? {}) as Partial<CheckoutMetadata>,
            providerInvoiceId: String(session.payment_intent ?? session.id),
            amountCents: session.amount_total ?? 0,
            currency: (session.currency ?? "brl").toUpperCase(),
            paidAt: new Date(),
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        if (sub.status === "active" || sub.status === "trialing") {
          events.push({
            providerEventId: event.id,
            type: "subscription_activated",
            provider: "stripe",
            metadata: (sub.metadata ?? {}) as Partial<CheckoutMetadata>,
            providerCustomerId: String(sub.customer),
            providerSubscriptionId: sub.id,
            status: sub.status,
            // The provider's own cycle start, not "now". The handler uses this
            // to tell a real renewal from a cosmetic update (toggling
            // cancel_at_period_end emits this same event), and resetting the
            // consumption window on a cosmetic one handed out free minutes.
            currentPeriodStart: sub.items.data[0]?.current_period_start
              ? new Date(sub.items.data[0].current_period_start * 1000)
              : undefined,
            currentPeriodEnd: sub.items.data[0]?.current_period_end
              ? new Date(sub.items.data[0].current_period_end * 1000)
              : undefined,
          });
          break;
        }
        // A subscription Stripe has given up on. Only `deleted` used to cancel
        // locally, so an `incomplete_expired` (checkout never paid) or a
        // terminal `unpaid` left the workspace entitled with nothing behind it.
        if (sub.status === "incomplete_expired" || sub.status === "unpaid" || sub.status === "canceled") {
          events.push({
            providerEventId: event.id,
            type: "subscription_canceled",
            provider: "stripe",
            providerSubscriptionId: sub.id,
          });
          break;
        }
        // `past_due` deliberately emits nothing: `invoice.payment_failed`
        // below is Stripe's canonical dunning trigger and is the only one that
        // carries the invoice and its hosted recovery URL. Deriving a second
        // payment_failed from here would mint an invoice row with no id.
        console.info("stripe_subscription_status_ignored", { status: sub.status, subscriptionId: sub.id });
        break;
      }
      case "customer.subscription.deleted": {
        events.push({
          providerEventId: event.id,
          type: "subscription_canceled",
          provider: "stripe",
          providerSubscriptionId: event.data.object.id,
        });
        break;
      }
      case "charge.refunded":
      case "charge.dispute.created": {
        const charge =
          event.type === "charge.refunded"
            ? event.data.object
            : ((await getStripe().charges.retrieve(String(event.data.object.charge))) as Stripe.Charge);
        // One-off purchases (minute packs) are mirrored under the payment
        // intent — see `checkout.session.completed` above — and those are the
        // ones where an un-reverted refund leaves a spendable balance behind.
        // Subscription invoices are keyed by invoice id, which the Charge no
        // longer carries in this API version; `revert_paid_invoice` answers
        // `unknown_invoice` for those and the handler skips them.
        const invoiceId = String(charge.payment_intent ?? charge.id);
        events.push({
          providerEventId: event.id,
          type: "payment_reverted",
          provider: "stripe",
          metadata: (charge.metadata ?? {}) as Partial<CheckoutMetadata>,
          providerInvoiceId: invoiceId,
          kind: event.type === "charge.refunded" ? "refund" : "chargeback",
        });
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const subId = invoice.parent?.subscription_details?.subscription;
        events.push({
          providerEventId: event.id,
          type: "payment_succeeded",
          provider: "stripe",
          metadata: (invoice.parent?.subscription_details?.metadata ?? {}) as Partial<CheckoutMetadata>,
          providerSubscriptionId: subId ? String(subId) : undefined,
          providerInvoiceId: String(invoice.id),
          amountCents: invoice.amount_paid,
          currency: invoice.currency.toUpperCase(),
          invoiceUrl: invoice.hosted_invoice_url ?? undefined,
          paidAt: new Date(),
        });
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subId = invoice.parent?.subscription_details?.subscription;
        events.push({
          providerEventId: event.id,
          type: "payment_failed",
          provider: "stripe",
          metadata: (invoice.parent?.subscription_details?.metadata ?? {}) as Partial<CheckoutMetadata>,
          providerSubscriptionId: subId ? String(subId) : undefined,
          providerInvoiceId: String(invoice.id),
          amountCents: invoice.amount_due,
          currency: invoice.currency.toUpperCase(),
          invoiceUrl: invoice.hosted_invoice_url ?? undefined,
        });
        break;
      }
    }

    return events;
  }
}
