import type {
  BillingEvent,
  BillingPeriod,
  CheckoutInput,
  CheckoutMetadata,
  CheckoutResult,
  PaymentProvider,
} from "../types";
import { applyDiscount } from "../types";

const PERIOD_TO_CYCLE: Record<BillingPeriod, string> = {
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

/**
 * Sandbox by default; set ASAAS_BASE_URL=https://api.asaas.com/v3 in production.
 *
 * `??` is deliberately NOT used to pick the default. A variable that is
 * DEFINED but empty — `ASAAS_BASE_URL=` on its own line, which is exactly what
 * `vercel env pull` writes for a variable with no value — is not null, so `??`
 * keeps the empty string. Every request below then becomes a relative URL that
 * `fetch` refuses to parse, and the throw happens BEFORE anything leaves the
 * server: the customer sees "checkout unavailable" while the provider never
 * saw a request at all. An unset variable and an empty one must mean the same
 * thing here.
 */
function baseUrl() {
  const configured = process.env.ASAAS_BASE_URL?.trim();
  // A trailing slash would produce `//customers`, which Asaas 404s.
  return configured ? configured.replace(/\/+$/u, "") : "https://api-sandbox.asaas.com/v3";
}

async function asaasFetch<T>(path: string, init?: RequestInit, idempotencyKey?: string): Promise<T> {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY is not set");
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: key,
      ...(idempotencyKey ? { "asaas-idempotency-key": idempotencyKey } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Asaas ${init?.method ?? "GET"} ${path} failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/gu, "");

/**
 * Resolves the Asaas customer for THIS workspace.
 *
 * Two things here are load-bearing and were both wrong before:
 *
 * 1. `cpfCnpj` is REQUIRED by `POST /v3/customers`. Sending name+email only
 *    made Asaas reject the request, `asaasFetch` throw, and the customer see
 *    "checkout unavailable" with the real cause buried in a server log.
 * 2. The lookup is by `externalReference` (our org id), not by e-mail. E-mail
 *    is global to the Asaas account, so two workspaces created by the same
 *    person — or a professional who changed her address — resolved to each
 *    other's customer, and the charges followed.
 */
async function ensureCustomer(input: {
  orgId: string;
  name: string;
  email: string;
  document: string;
  postalCode?: string | null;
  addressNumber?: string | null;
  phone?: string | null;
  idempotencyKey: string;
}): Promise<string> {
  const byReference = await asaasFetch<{ data: { id: string }[] }>(
    `/customers?externalReference=${encodeURIComponent(input.orgId)}&limit=1`,
  );
  if (byReference.data.length > 0) return byReference.data[0].id;

  // A customer created before this workspace had an externalReference. Adopt
  // it (and stamp the reference) instead of creating a duplicate that would
  // split the payment history of the same person across two records.
  const byDocument = await asaasFetch<{ data: { id: string }[] }>(
    `/customers?cpfCnpj=${encodeURIComponent(input.document)}&limit=1`,
  );
  if (byDocument.data.length > 0) {
    const id = byDocument.data[0].id;
    await asaasFetch(`/customers/${id}`, {
      method: "POST",
      body: JSON.stringify({ externalReference: input.orgId }),
    });
    return id;
  }

  const created = await asaasFetch<{ id: string }>(
    "/customers",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        cpfCnpj: input.document,
        externalReference: input.orgId,
        ...(input.postalCode ? { postalCode: input.postalCode } : {}),
        ...(input.addressNumber ? { addressNumber: input.addressNumber } : {}),
        ...(input.phone ? { mobilePhone: input.phone } : {}),
      }),
    },
    `${input.idempotencyKey}:customer`,
  );
  return created.id;
}

export class AsaasProvider implements PaymentProvider {
  readonly name = "asaas" as const;

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const { plan, modules, coupon } = input;
    const document = digits(input.payer?.document);
    // Named, not generic: this is the one failure the professional can fix
    // herself, and the caller turns it into "complete your fiscal data" rather
    // than "checkout unavailable".
    if (document.length !== 11 && document.length !== 14) {
      throw new Error("asaas_missing_document");
    }
    const customerId = await ensureCustomer({
      orgId: input.orgId,
      name: input.orgName,
      email: input.customerEmail,
      document,
      postalCode: digits(input.payer?.postalCode) || null,
      addressNumber: input.payer?.addressNumber ?? null,
      phone: digits(input.payer?.phone) || null,
      idempotencyKey: input.idempotencyKey,
    });

    const metadata: CheckoutMetadata = {
      org_id: input.orgId,
      plan_id: plan.id,
      module_ids: modules.map((m) => m.id).join(","),
      billing_operation_key: input.idempotencyKey,
      ...(coupon ? { coupon_id: coupon.id } : {}),
    };
    const externalReference = JSON.stringify(metadata);

    const recurringCents =
      plan.priceCents + modules.filter((m) => m.kind === "recurring").reduce((sum, m) => sum + m.priceCents, 0);
    const oneTimeCents = modules.filter((m) => m.kind === "one_time").reduce((sum, m) => sum + m.priceCents, 0);

    if (plan.period !== null) {
      // Recurring plan → Asaas subscription. Trial is expressed by pushing
      // the first due date forward. One-time order bumps become a separate
      // immediate payment (Asaas cannot mix them into the subscription).
      const firstDue = new Date();
      firstDue.setDate(firstDue.getDate() + (plan.trialDays > 0 ? plan.trialDays : 0));

      const subscription = await asaasFetch<{ id: string }>("/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType: "UNDEFINED",
          value: applyDiscount(recurringCents, coupon) / 100,
          nextDueDate: isoDate(firstDue),
          cycle: PERIOD_TO_CYCLE[plan.period],
          description: `${plan.name}${modules.length ? ` + ${modules.map((m) => m.name).join(", ")}` : ""}`,
          externalReference,
        }),
      }, `${input.idempotencyKey}:subscription`);

      if (oneTimeCents > 0) {
        await asaasFetch("/payments", {
          method: "POST",
          body: JSON.stringify({
            customer: customerId,
            billingType: "UNDEFINED",
            value: oneTimeCents / 100,
            dueDate: isoDate(new Date()),
            description: `Add-ons: ${modules
              .filter((m) => m.kind === "one_time")
              .map((m) => m.name)
              .join(", ")}`,
            externalReference,
          }),
        }, `${input.idempotencyKey}:addons`);
      }

      // Redirect the customer to the first payment's hosted invoice.
      const payments = await asaasFetch<{ data: { invoiceUrl?: string }[] }>(
        `/subscriptions/${subscription.id}/payments?limit=1`,
      );
      const url = payments.data[0]?.invoiceUrl;
      if (!url) throw new Error("Asaas did not return an invoice URL for the subscription");
      return { url, providerCustomerId: customerId, providerSubscriptionId: subscription.id };
    }

    // One-time purchase (credits with no period + any one-time bumps).
    const totalCents = applyDiscount(plan.priceCents + oneTimeCents, coupon);
    const payment = await asaasFetch<{ id: string; invoiceUrl: string }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "UNDEFINED",
        value: totalCents / 100,
        dueDate: isoDate(new Date()),
        description: plan.name,
        externalReference,
      }),
    }, `${input.idempotencyKey}:payment`);
    return { url: payment.invoiceUrl, providerCustomerId: customerId };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await asaasFetch(`/subscriptions/${providerSubscriptionId}`, { method: "DELETE" });
  }

  // Asaas supports an endDate on the subscription. It stops future charge
  // generation while the already paid period remains available in MedChina.
  async scheduleCancellation(
    providerSubscriptionId: string,
    currentPeriodEnd?: Date,
  ): Promise<{ currentPeriodEnd?: Date }> {
    if (!currentPeriodEnd) return {};
    const lastRenewalDate = new Date(currentPeriodEnd);
    lastRenewalDate.setDate(lastRenewalDate.getDate() - 1);
    await asaasFetch(`/subscriptions/${providerSubscriptionId}`, {
      method: "PUT",
      body: JSON.stringify({ endDate: isoDate(lastRenewalDate) }),
    });
    return { currentPeriodEnd };
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    await asaasFetch(`/subscriptions/${providerSubscriptionId}`, {
      method: "PUT",
      body: JSON.stringify({ endDate: null }),
    });
  }

  async parseWebhook(rawBody: string, headers: Record<string, string | null>): Promise<BillingEvent[]> {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected) throw new Error("ASAAS_WEBHOOK_TOKEN is not set");
    if (headers["asaas-access-token"] !== expected) {
      throw new Error("Invalid asaas-access-token header");
    }

    const body = JSON.parse(rawBody) as {
      id?: string;
      event: string;
      payment?: {
        id: string;
        customer: string;
        subscription?: string;
        value?: number;
        invoiceUrl?: string;
        externalReference?: string;
        paymentDate?: string;
        clientPaymentDate?: string;
        confirmedDate?: string;
      };
      // The Subscription event group carries THIS, never `payment`. Reading
      // `payment.subscription` for SUBSCRIPTION_DELETED meant the cancellation
      // never arrived: an org kept a paid plan alive with no charge behind it.
      subscription?: { id: string; customer?: string; externalReference?: string };
    };

    const events: BillingEvent[] = [];
    const payment = body.payment;
    const subscription = body.subscription;
    if (!payment && !subscription) return events;

    const providerEventId = body.id ?? `${body.event}:${payment?.id ?? subscription?.id}`;

    let metadata: Partial<CheckoutMetadata> = {};
    try {
      const reference = payment?.externalReference ?? subscription?.externalReference;
      const parsed: unknown = reference ? JSON.parse(reference) : {};
      // A charge created in the Asaas panel can carry any string here. Only an
      // object is our metadata; a number or an array would otherwise be spread
      // into `metadata` and read as a malformed org id downstream.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Partial<CheckoutMetadata>;
      }
    } catch {
      // externalReference set by someone else — ignore.
    }

    /** Asaas sends "yyyy-MM-dd"; anything unparseable must not become an Invalid Date. */
    const paidAt = (): Date => {
      const raw = payment?.paymentDate ?? payment?.confirmedDate ?? payment?.clientPaymentDate;
      if (!raw) return new Date();
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    };
    /** `amount_cents` is NOT NULL: a missing value must be 0, never NaN. */
    const amountCents = (): number => {
      const value = Number(payment?.value);
      return Number.isFinite(value) ? Math.round(value * 100) : 0;
    };

    switch (body.event) {
      case "PAYMENT_CONFIRMED":
      case "PAYMENT_RECEIVED": {
        if (!payment) break;
        events.push({
          providerEventId,
          type: "payment_succeeded",
          provider: "asaas",
          metadata,
          providerSubscriptionId: payment.subscription,
          providerInvoiceId: payment.id,
          amountCents: amountCents(),
          currency: "BRL",
          invoiceUrl: payment.invoiceUrl,
          paidAt: paidAt(),
        });
        // A confirmed payment on a subscription also (re)activates it —
        // Asaas has no separate "subscription active" webhook.
        if (payment.subscription) {
          events.push({
            providerEventId,
            type: "subscription_activated",
            provider: "asaas",
            metadata,
            providerCustomerId: payment.customer,
            providerSubscriptionId: payment.subscription,
            status: "active",
          });
        }
        break;
      }
      case "PAYMENT_OVERDUE":
      // Recurring card capture was refused. This used to be dropped with a
      // 200, so `past_due` was never set, the dunning window never opened and
      // the workspace kept consuming AI minutes on a subscription nobody was
      // paying. PAYMENT_OVERDUE only ever covered the boleto/Pix world.
      case "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED": {
        if (!payment) break;
        events.push({
          providerEventId,
          type: "payment_failed",
          provider: "asaas",
          metadata,
          providerSubscriptionId: payment.subscription,
          providerInvoiceId: payment.id,
          amountCents: amountCents(),
          currency: "BRL",
          // Asaas bills per charge: this hosted invoice IS the recovery path
          // (Pix/boleto/card), so it replaces a billing portal here.
          invoiceUrl: payment.invoiceUrl,
        });
        break;
      }
      case "PAYMENT_REFUNDED":
      case "PAYMENT_PARTIALLY_REFUNDED":
      case "PAYMENT_CHARGEBACK_REQUESTED":
      case "PAYMENT_CHARGEBACK_DISPUTE": {
        if (!payment) break;
        events.push({
          providerEventId,
          type: "payment_reverted",
          provider: "asaas",
          metadata,
          providerInvoiceId: payment.id,
          kind: body.event.startsWith("PAYMENT_CHARGEBACK") ? "chargeback" : "refund",
        });
        break;
      }
      case "SUBSCRIPTION_DELETED": {
        const subscriptionId = subscription?.id ?? payment?.subscription;
        if (subscriptionId) {
          events.push({
            providerEventId,
            type: "subscription_canceled",
            provider: "asaas",
            providerSubscriptionId: subscriptionId,
          });
        }
        break;
      }
      default:
        // No derived event: the route answers 200. But it now leaves a trace,
        // instead of vanishing (PAYMENT_CREATED, INVOICE_*, TRANSFER_*…).
        console.info("asaas_webhook_ignored", { event: body.event, providerEventId });
    }

    return events;
  }
}
