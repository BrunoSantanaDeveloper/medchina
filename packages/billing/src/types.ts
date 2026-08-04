export type BillingProviderName = "stripe" | "asaas";
export type PlanKind = "recurring" | "credits";
export type BillingPeriod = "weekly" | "monthly" | "yearly";
export type ModuleKind = "recurring" | "one_time";
export type DiscountType = "percent" | "fixed";

export interface CheckoutPlan {
  id: string;
  slug: string;
  name: string;
  kind: PlanKind;
  /** Null on a credits plan means a one-time purchase of non-expiring credits. */
  period: BillingPeriod | null;
  priceCents: number;
  currency: string;
  trialDays: number;
  creditAmount: number | null;
  creditsExpire: boolean;
}

export interface CheckoutModule {
  id: string;
  slug: string;
  name: string;
  kind: ModuleKind;
  priceCents: number;
}

export interface CheckoutCoupon {
  id: string;
  code: string;
  discountType: DiscountType;
  /** percent: 1-100; fixed: cents. Applied to the recurring total. */
  discountValue: number;
}

/**
 * Who is paying, in the terms a Brazilian gateway needs.
 *
 * Asaas refuses `POST /customers` without `cpfCnpj`, so this is not optional
 * decoration: without it the checkout throws before the customer ever reaches
 * a payment page, and the only trace is a server log. Everything is stored and
 * passed as DIGITS — the mask belongs to the form, never to the wire.
 */
export interface CheckoutPayer {
  /** CPF (11) or CNPJ (14), digits only. */
  document?: string | null;
  /** CEP, 8 digits. */
  postalCode?: string | null;
  addressNumber?: string | null;
  /** DDD + number, 10 or 11 digits. */
  phone?: string | null;
}

export interface CheckoutInput {
  /** Stable caller key reused across retries and provider requests. */
  idempotencyKey: string;
  orgId: string;
  orgName: string;
  customerEmail: string;
  plan: CheckoutPlan;
  /** Order-bump add-ons selected at checkout. */
  modules: CheckoutModule[];
  coupon?: CheckoutCoupon;
  successUrl: string;
  cancelUrl: string;
  /** Fiscal identity of the workspace; required by Asaas, ignored by Stripe. */
  payer?: CheckoutPayer;
}

export interface CheckoutResult {
  /** Where to redirect the customer to pay. */
  url: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
}

/** Metadata round-tripped through the provider so webhooks can act. */
export interface CheckoutMetadata {
  org_id: string;
  plan_id: string;
  module_ids: string;
  coupon_id?: string;
  [key: string]: string | undefined;
}

export type BillingEvent = { providerEventId: string } & (
  | {
      type: "subscription_activated";
      provider: BillingProviderName;
      metadata: Partial<CheckoutMetadata>;
      providerCustomerId?: string;
      providerSubscriptionId: string;
      status: "trialing" | "active";
      /**
       * The provider's own cycle start, when it reports one.
       *
       * The handler needs it to tell a RENEWAL from a cosmetic update: Stripe
       * re-emits `customer.subscription.updated` for every change, including
       * the two the product itself makes (scheduling and undoing a
       * cancellation). Stamping "now" on those restarted the audio consumption
       * window, so cancel + undo handed out a fresh cycle of minutes.
       */
      currentPeriodStart?: Date;
      currentPeriodEnd?: Date;
    }
  | {
      type: "subscription_canceled";
      provider: BillingProviderName;
      providerSubscriptionId: string;
    }
  | {
      type: "payment_succeeded";
      provider: BillingProviderName;
      metadata: Partial<CheckoutMetadata>;
      providerSubscriptionId?: string;
      providerInvoiceId: string;
      amountCents: number;
      currency: string;
      invoiceUrl?: string;
      paidAt: Date;
    }
  | {
      type: "payment_failed";
      provider: BillingProviderName;
      metadata: Partial<CheckoutMetadata>;
      providerSubscriptionId?: string;
      providerInvoiceId: string;
      amountCents: number;
      currency: string;
      /**
       * Where the customer can actually pay this invoice. Without it, every
       * "update your payment" prompt in the app is a dead end and the dunning
       * window expires on someone who had no way to act.
       */
      invoiceUrl?: string;
    }
  | {
      /**
       * The money went back — refunded by us or pulled by the card issuer.
       *
       * Until this existed the invoice stayed `paid` forever and, worse, the
       * minute pack it had granted stayed spendable. A pack does not expire by
       * design, so an un-reverted chargeback is an unlimited free balance.
       */
      type: "payment_reverted";
      provider: BillingProviderName;
      metadata: Partial<CheckoutMetadata>;
      providerInvoiceId: string;
      kind: "refund" | "chargeback";
    }
);

export interface PaymentProvider {
  readonly name: BillingProviderName;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Keep access until the paid period ends; the caller persists the effective date. */
  scheduleCancellation(providerSubscriptionId: string, currentPeriodEnd?: Date): Promise<{ currentPeriodEnd?: Date }>;
  /** Undo a previously scheduled cancellation while the subscription is still active. */
  resumeSubscription(providerSubscriptionId: string): Promise<void>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  /**
   * A hosted page where the customer updates the card behind a live
   * subscription. Returns null when the provider has no such surface (Asaas
   * bills per charge, so recovery goes through the failed invoice's own
   * payment link instead) — callers must handle null and fall back.
   */
  billingPortalUrl?(input: {
    providerCustomerId: string;
    providerSubscriptionId?: string;
    returnUrl: string;
  }): Promise<string | null>;
  /**
   * Verifies and parses a webhook request into normalized events.
   * Throws on signature/token mismatch.
   */
  parseWebhook(rawBody: string, headers: Record<string, string | null>): Promise<BillingEvent[]>;
}

/** Discounted total in cents for a one-off charge (plan + one-time modules). */
export function applyDiscount(totalCents: number, coupon?: CheckoutCoupon): number {
  if (!coupon) return totalCents;
  if (coupon.discountType === "percent") {
    return Math.max(0, Math.round(totalCents * (1 - coupon.discountValue / 100)));
  }
  return Math.max(0, totalCents - coupon.discountValue);
}
