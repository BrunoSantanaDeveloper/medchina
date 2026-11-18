/**
 * Types and pure money helpers. Exported as `@flyee/billing/types` so client
 * components can compute what a coupon does to a price without importing the
 * root entry, which pulls the provider SDKs into the browser bundle. Keep this
 * file free of imports.
 */
export type BillingProviderName = "stripe" | "asaas";
export type PlanKind = "recurring" | "credits";
export type BillingPeriod = "weekly" | "monthly" | "yearly";
export type ModuleKind = "recurring" | "one_time";
export type DiscountType = "percent" | "fixed";

/**
 * How the customer chose to pay, decided in OUR checkout instead of the
 * provider's invoice page.
 *
 * Asaas's hosted invoice offers every method the account has enabled, and
 * `billingType: UNDEFINED` is what put boleto in front of every buyer. Boleto
 * is the one method that cannot confirm immediately, cannot be redirected back
 * to the app, and leaves the sale hanging for days — so the choice moves to a
 * page we control, and the provider is told exactly one method.
 */
export type PaymentMethod = "credit_card" | "pix";

/**
 * The most installments a card purchase may be split into.
 *
 * Shared so the form and the server cannot disagree about what is on offer —
 * a grid showing 6x against a server that caps at 5 is a refused checkout at
 * the last step of the funnel.
 */
export const MAX_INSTALLMENTS = 5;

/**
 * One step of a plan's price ladder (`plans.price_phases`, migration 0126):
 * after `afterCycles` PAID cycles, the plan costs `priceCents`.
 *
 * The plan's own `priceCents` is what the cycles BEFORE the first step cost,
 * which is why the checkout needs nothing new: it charges `priceCents` as it
 * always did, and the billing webhook moves the provider to the next price
 * when the paid-invoice count reaches a step.
 */
export interface PricePhase {
  afterCycles: number;
  priceCents: number;
}

/**
 * Reads `plans.price_phases` / `subscriptions.price_phases` as stored.
 *
 * The database already refuses a malformed ladder (`price_phases_valid`), so
 * this only translates the snake-case JSON — and answers null for anything it
 * cannot read rather than inventing a step. Null means "a single price".
 */
export function parsePricePhases(value: unknown): PricePhase[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const phases: PricePhase[] = [];
  let previous = 0;
  for (const raw of value) {
    const step = raw as { after_cycles?: unknown; price_cents?: unknown } | null;
    const afterCycles = Number(step?.after_cycles);
    const priceCents = Number(step?.price_cents);
    if (!Number.isInteger(afterCycles) || !Number.isInteger(priceCents)) return null;
    if (afterCycles <= previous || priceCents < 0) return null;
    phases.push({ afterCycles, priceCents });
    previous = afterCycles;
  }
  return phases;
}

/**
 * The price a subscription should be on once `paidCycles` invoices are paid.
 *
 * `index` counts the steps reached (0 = still on the base price) and is what
 * `subscriptions.price_phase_index` stores once the provider has accepted it.
 */
export function pricePhaseAfter(
  basePriceCents: number,
  phases: PricePhase[] | null,
  paidCycles: number,
): { index: number; priceCents: number } {
  let index = 0;
  let priceCents = basePriceCents;
  for (const phase of phases ?? []) {
    if (paidCycles < phase.afterCycles) break;
    index += 1;
    priceCents = phase.priceCents;
  }
  return { index, priceCents };
}

/**
 * The ladder as the customer reads it: which cycles cost what.
 *
 * "Ciclos 1–3: R$ 99 · 4–12: R$ 197 · do 13º em diante: R$ 299" — the last
 * stretch has no end (`toCycle: null`). One function feeds every surface that
 * prints the condition (the offer page, the home card, the checkout summary),
 * so none of them can describe a ladder the webhook would not charge.
 */
export function priceSchedule(
  basePriceCents: number,
  phases: PricePhase[] | null,
): { fromCycle: number; toCycle: number | null; priceCents: number }[] {
  const stretches: { fromCycle: number; toCycle: number | null; priceCents: number }[] = [];
  let fromCycle = 1;
  let priceCents = basePriceCents;
  for (const phase of phases ?? []) {
    stretches.push({ fromCycle, toCycle: phase.afterCycles, priceCents });
    fromCycle = phase.afterCycles + 1;
    priceCents = phase.priceCents;
  }
  stretches.push({ fromCycle, toCycle: null, priceCents });
  return stretches;
}

/** What the ladder charges over its first `cycles` cycles, in cents. */
export function scheduleTotalCents(basePriceCents: number, phases: PricePhase[] | null, cycles: number): number {
  let total = 0;
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    total += pricePhaseAfter(basePriceCents, phases, cycle - 1).priceCents;
  }
  return total;
}

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
  /**
   * What the plan includes, in customer-facing words — `plans.description`,
   * superadmin-editable in /admin/billing and possibly empty. Printed on the
   * invoice; see `invoiceDescription`.
   */
  description?: string | null;
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
  /**
   * The method the customer picked. Omitted means "let the provider offer
   * everything", which is the template's old behaviour and the one that shows
   * boleto.
   */
  paymentMethod?: PaymentMethod;
  /**
   * Card installments, 1 means a single charge.
   *
   * Only meaningful for a one-off purchase: Asaas subscriptions have no
   * installment concept at all, so a recurring plan ignores this. The caller
   * is responsible for only offering it where it applies.
   */
  installments?: number;
}

/**
 * A PIX charge, rendered on OUR page instead of the provider's.
 *
 * Optional everywhere it appears, deliberately. `url` below stays the contract:
 * Stripe has no PIX here, an Asaas account with no active key has no PIX, and
 * reading the QR can fail on its own after the charge already exists. All three
 * arrive as the same shape — absent — which every caller reads as "no QR, use
 * the url". That is what lets this be added without touching Stripe at all.
 */
export interface PixCharge {
  /** The charge at the provider; re-reading the QR later depends on it. */
  providerPaymentId: string;
  /** PNG in base64, WITHOUT the `data:` prefix — the page builds the src. */
  qrCodeBase64: string;
  /** Copy-and-paste (EMV payload) — the string that actually gets pasted. */
  copyPaste: string;
  /** ISO 8601, from the provider. Never a deadline we invented. */
  expiresAt: string | null;
  /**
   * The provider's hosted page for THIS charge — the fallback that always works
   * (it shows the same QR). Carried with the charge so a resumed checkout has
   * somewhere to send her without a second lookup. Null when not known.
   */
  invoiceUrl?: string | null;
}

export interface CheckoutResult {
  /** Where to redirect the customer to pay. */
  url: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  /** Present only when the charge is PIX and its QR could be read. */
  pix?: PixCharge;
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
   * Moves a live subscription to a new recurring price — the next step of a
   * price ladder (`plans.price_phases`, migration 0126).
   *
   * Applies to the charges not yet paid, including one the provider already
   * generated for the coming cycle; never to a paid one. Optional: a provider
   * without it cannot sell a plan with phases, and the checkout refuses that
   * combination before any money moves (`phased_plan_unsupported`).
   */
  updateSubscriptionPrice?(providerSubscriptionId: string, priceCents: number): Promise<void>;
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
   * The PIX QR of a charge that ALREADY exists — the same shape `createCheckout`
   * returns inline, read again later (a reload, a second tab, a replayed
   * submit). Null when the provider has no PIX, when the charge is not PIX, or
   * when it has already been paid; callers handle null and fall back to the
   * hosted invoice.
   *
   * It is a READ. Calling it again never creates a charge and never bills —
   * which is the whole point: re-running `createCheckout` to get the QR back
   * would open a SECOND recurring subscription.
   */
  pixCharge?(input: { providerPaymentId?: string; providerSubscriptionId?: string }): Promise<PixCharge | null>;
  /**
   * Verifies and parses a webhook request into normalized events.
   * Throws on signature/token mismatch.
   */
  parseWebhook(rawBody: string, headers: Record<string, string | null>): Promise<BillingEvent[]>;
}

/**
 * The checkout metadata, packed to survive a provider's field limit.
 *
 * Asaas caps `externalReference` at **100 characters** — measured against the
 * API, not documented (101 is rejected with `invalid_externalReference`). The
 * obvious encoding, `JSON.stringify(metadata)`, produces 177: three UUIDs plus
 * their long key names. So EVERY Asaas checkout was refused before the
 * customer ever saw a payment page — subscriptions and minute packs alike —
 * and the only trace was a generic "unavailable".
 *
 * The packed form is the three ids that the webhook actually reads, stripped
 * of their hyphens and joined by a dot: `<org>.<plan>[.<coupon>]`. Worst case
 * 98 characters, which the unit test pins. What it deliberately drops is what
 * nothing consumes: `billing_operation_key` (never read) and `module_ids`
 * (MedChina ships no order-bump modules, and Stripe — whose metadata has no
 * such limit — still carries both).
 */
const HEX32 = /^[0-9a-f]{32}$/u;
const compactId = (id: string) => id.replace(/-/gu, "").toLowerCase();
const expandId = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

export function packCheckoutReference(metadata: {
  org_id: string;
  plan_id: string;
  coupon_id?: string;
}): string {
  const parts = [compactId(metadata.org_id), compactId(metadata.plan_id)];
  if (metadata.coupon_id) parts.push(compactId(metadata.coupon_id));
  return parts.join(".");
}

/**
 * Reads back what `packCheckoutReference` wrote.
 *
 * Also accepts the legacy JSON shape, because a charge created before this
 * change still has to reconcile, and returns `{}` for anything else — an
 * Asaas account delivers webhooks for charges created by hand in its panel,
 * whose reference is any string the operator typed.
 */
export function parseCheckoutReference(reference: string | null | undefined): Partial<CheckoutMetadata> {
  const raw = reference?.trim();
  if (!raw) return {};

  const segments = raw.split(".");
  if (segments.length >= 2 && segments.length <= 3 && segments.every((part) => HEX32.test(part))) {
    return {
      org_id: expandId(segments[0]),
      plan_id: expandId(segments[1]),
      ...(segments[2] ? { coupon_id: expandId(segments[2]) } : {}),
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    // Only an object is our metadata; a number or an array would otherwise be
    // spread and read as a malformed org id downstream.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Partial<CheckoutMetadata>;
    }
  } catch {
    // Someone else's reference — not ours to interpret.
  }
  return {};
}

/**
 * The longest description Asaas accepts on a charge.
 *
 * Measured, not documented: a subscription with 501 characters is refused
 * with "A descrição da assinatura não deve ultrapassar 500 caracteres". The
 * limit matters because the text comes from `plans.description`, which a
 * superadmin edits freely — one generous paragraph in the admin would
 * otherwise refuse EVERY checkout of that plan, at the last step of the
 * funnel, with a generic "unavailable".
 */
export const INVOICE_DESCRIPTION_LIMIT = 500;

/**
 * The text shown under "Descrição" on the provider's invoice.
 *
 * It used to be the plan's name alone ("Pro anual"), which answers "what did
 * I buy?" only for someone who already knows the catalogue. The plan's own
 * description says what the money pays for; the name stays in front of it,
 * because the description by itself ("Tudo do Assistente, mais…") would leave
 * the invoice without saying WHICH plan it is — and that is the first thing
 * support is asked when a charge is questioned.
 *
 * Whitespace is collapsed (an admin textarea happily produces line breaks) and
 * the result is clamped to the provider's limit so no edit in the admin can
 * break the checkout.
 */
export function invoiceDescription(
  plan: { name: string; description?: string | null },
  extras: string[] = [],
): string {
  const title = extras.length > 0 ? `${plan.name} + ${extras.join(", ")}` : plan.name;
  const detail = (plan.description ?? "").replace(/\s+/gu, " ").trim();
  const full = detail ? `${title} — ${detail}` : title;
  if (full.length <= INVOICE_DESCRIPTION_LIMIT) return full;
  return `${full.slice(0, INVOICE_DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

/** Discounted total in cents for a one-off charge (plan + one-time modules). */
export function applyDiscount(totalCents: number, coupon?: CheckoutCoupon): number {
  if (!coupon) return totalCents;
  if (coupon.discountType === "percent") {
    return Math.max(0, Math.round(totalCents * (1 - coupon.discountValue / 100)));
  }
  return Math.max(0, totalCents - coupon.discountValue);
}
