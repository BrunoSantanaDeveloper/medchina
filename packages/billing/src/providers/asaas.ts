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

function baseUrl() {
  // Sandbox by default; set ASAAS_BASE_URL=https://api.asaas.com/v3 in production.
  return process.env.ASAAS_BASE_URL ?? "https://api-sandbox.asaas.com/v3";
}

async function asaasFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY is not set");
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: key,
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

async function ensureCustomer(email: string, name: string): Promise<string> {
  const existing = await asaasFetch<{ data: { id: string }[] }>(
    `/customers?email=${encodeURIComponent(email)}&limit=1`,
  );
  if (existing.data.length > 0) return existing.data[0].id;
  const created = await asaasFetch<{ id: string }>("/customers", {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
  return created.id;
}

export class AsaasProvider implements PaymentProvider {
  readonly name = "asaas" as const;

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const { plan, modules, coupon } = input;
    const customerId = await ensureCustomer(input.customerEmail, input.orgName);

    const metadata: CheckoutMetadata = {
      org_id: input.orgId,
      plan_id: plan.id,
      module_ids: modules.map((m) => m.id).join(","),
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
      });

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
        });
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
    });
    return { url: payment.invoiceUrl, providerCustomerId: customerId };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await asaasFetch(`/subscriptions/${providerSubscriptionId}`, { method: "DELETE" });
  }

  async parseWebhook(rawBody: string, headers: Record<string, string | null>): Promise<BillingEvent[]> {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected) throw new Error("ASAAS_WEBHOOK_TOKEN is not set");
    if (headers["asaas-access-token"] !== expected) {
      throw new Error("Invalid asaas-access-token header");
    }

    const event = JSON.parse(rawBody) as {
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
          type: "payment_failed",
          provider: "asaas",
          metadata,
          providerSubscriptionId: payment.subscription,
          providerInvoiceId: payment.id,
          amountCents: Math.round(payment.value * 100),
          currency: "BRL",
        });
        break;
      }
      case "SUBSCRIPTION_DELETED": {
        if (payment.subscription) {
          events.push({
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
