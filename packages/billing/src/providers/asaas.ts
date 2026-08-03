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

async function ensureCustomer(email: string, name: string, idempotencyKey: string): Promise<string> {
  const existing = await asaasFetch<{ data: { id: string }[] }>(
    `/customers?email=${encodeURIComponent(email)}&limit=1`,
  );
  if (existing.data.length > 0) return existing.data[0].id;
  const created = await asaasFetch<{ id: string }>("/customers", {
    method: "POST",
    body: JSON.stringify({ name, email }),
  }, `${idempotencyKey}:customer`);
  return created.id;
}

export class AsaasProvider implements PaymentProvider {
  readonly name = "asaas" as const;

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const { plan, modules, coupon } = input;
    const customerId = await ensureCustomer(input.customerEmail, input.orgName, input.idempotencyKey);

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

    const event = JSON.parse(rawBody) as {
      id?: string;
      event: string;
      payment?: {
        id: string;
        customer: string;
        subscription?: string;
        value: number;
        invoiceUrl?: string;
        externalReference?: string;
        paymentDate?: string;
      };
    };

    const events: BillingEvent[] = [];
    const payment = event.payment;
    if (!payment) return events;
    const providerEventId = event.id ?? `${event.event}:${payment.id}`;

    let metadata: Partial<CheckoutMetadata> = {};
    try {
      metadata = payment.externalReference ? JSON.parse(payment.externalReference) : {};
    } catch {
      // externalReference set by someone else — ignore.
    }

    switch (event.event) {
      case "PAYMENT_CONFIRMED":
      case "PAYMENT_RECEIVED": {
        events.push({
          providerEventId,
          type: "payment_succeeded",
          provider: "asaas",
          metadata,
          providerSubscriptionId: payment.subscription,
          providerInvoiceId: payment.id,
          amountCents: Math.round(payment.value * 100),
          currency: "BRL",
          invoiceUrl: payment.invoiceUrl,
          paidAt: payment.paymentDate ? new Date(payment.paymentDate) : new Date(),
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
      case "PAYMENT_OVERDUE": {
        events.push({
          providerEventId,
          type: "payment_failed",
          provider: "asaas",
          metadata,
          providerSubscriptionId: payment.subscription,
          providerInvoiceId: payment.id,
          amountCents: Math.round(payment.value * 100),
          currency: "BRL",
          // Asaas bills per charge: this hosted invoice IS the recovery path
          // (Pix/boleto/card), so it replaces a billing portal here.
          invoiceUrl: payment.invoiceUrl,
        });
        break;
      }
      case "SUBSCRIPTION_DELETED": {
        if (payment.subscription) {
          events.push({
            providerEventId,
            type: "subscription_canceled",
            provider: "asaas",
            providerSubscriptionId: payment.subscription,
          });
        }
        break;
      }
    }

    return events;
  }
}
