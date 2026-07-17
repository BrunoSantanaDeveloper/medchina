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
