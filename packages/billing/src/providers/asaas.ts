import type {
  BillingEvent,
  BillingPeriod,
  CheckoutInput,
  CheckoutMetadata,
  CheckoutResult,
  PaymentProvider,
} from "../types";
import { applyDiscount, packCheckoutReference, parseCheckoutReference } from "../types";

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
 * Creates a charge or subscription that sends the customer BACK to the app
 * after paying.
 *
 * Asaas's hosted invoice has no notion of a return URL unless `callback` is
 * set, so without it a customer who pays by Pix or card is simply left on
 * Asaas's page — she has to remember to come back, and the activation moment
 * ("your plan is live") happens with nobody looking. `successUrl` is the same
 * URL the Stripe checkout already returns to.
 *
 * The catch, learned against the sandbox: Asaas REFUSES the request when the
 * callback domain is not registered under "Minha Conta → Informações"
 * (`invalid_object: É necessário enviar uma URL que use o mesmo domínio…`).
 * A return link is a nicety; a refused checkout is a lost sale. So the request
 * is retried without the callback on exactly that rejection, and the reason is
 * logged so the operator can register the domain.
 */
async function createWithReturnCallback<T>(
  path: string,
  body: Record<string, unknown>,
  successUrl: string | undefined,
  idempotencyKey: string,
): Promise<T> {
  const returnTo = successUrl?.trim();
  if (!returnTo) {
    return asaasFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, idempotencyKey);
  }
  try {
    return await asaasFetch<T>(
      path,
      { method: "POST", body: JSON.stringify({ ...body, callback: { successUrl: returnTo, autoRedirect: true } }) },
      idempotencyKey,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/mesmo dom[ií]nio|callback/iu.test(message)) throw error;
    console.warn("asaas_callback_domain_not_registered", { path, successUrl: returnTo });
    // A DIFFERENT idempotency key: the first attempt already spent this one,
    // and a provider that caches the rejected response under it would hand
    // back the 400 forever instead of creating the charge.
    return asaasFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, `${idempotencyKey}:nocallback`);
  }
}

/**
 * The hosted invoice of a subscription's first charge.
 *
 * Measured at ~140 ms after creation in the sandbox, so the charge is there
 * on the first read in practice — but "in practice" is not a guarantee Asaas
 * documents, and the alternative outcome is a checkout that throws AFTER the
 * subscription exists. A few short retries cost nothing on the happy path and
 * turn a rare race into a non-event.
 */
async function firstInvoiceUrl(subscriptionId: string): Promise<string> {
  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const payments = await asaasFetch<{ data: { invoiceUrl?: string }[] }>(
      `/subscriptions/${subscriptionId}/payments?limit=1`,
    );
    const url = payments.data[0]?.invoiceUrl;
    if (url) return url;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  throw new Error(`Asaas did not return an invoice URL for subscription ${subscriptionId}`);
}

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

    // Packed, not JSON: Asaas rejects an `externalReference` over 100 chars,
    // and the JSON form is 177. See packCheckoutReference.
    const externalReference = packCheckoutReference({
      org_id: input.orgId,
      plan_id: plan.id,
      ...(coupon ? { coupon_id: coupon.id } : {}),
    });

    const recurringCents =
      plan.priceCents + modules.filter((m) => m.kind === "recurring").reduce((sum, m) => sum + m.priceCents, 0);
    const oneTimeCents = modules.filter((m) => m.kind === "one_time").reduce((sum, m) => sum + m.priceCents, 0);

    if (plan.period !== null) {
      // Recurring plan → Asaas subscription. Trial is expressed by pushing
      // the first due date forward. One-time order bumps become a separate
      // immediate payment (Asaas cannot mix them into the subscription).
      const firstDue = new Date();
      firstDue.setDate(firstDue.getDate() + (plan.trialDays > 0 ? plan.trialDays : 0));

      const subscription = await createWithReturnCallback<{ id: string }>(
        "/subscriptions",
        {
          customer: customerId,
          billingType: "UNDEFINED",
          value: applyDiscount(recurringCents, coupon) / 100,
          nextDueDate: isoDate(firstDue),
          cycle: PERIOD_TO_CYCLE[plan.period],
          description: `${plan.name}${modules.length ? ` + ${modules.map((m) => m.name).join(", ")}` : ""}`,
          externalReference,
        },
        input.successUrl,
        `${input.idempotencyKey}:subscription`,
      );

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
      const url = await firstInvoiceUrl(subscription.id);
      return { url, providerCustomerId: customerId, providerSubscriptionId: subscription.id };
    }

    // One-time purchase (credits with no period + any one-time bumps).
    const totalCents = applyDiscount(plan.priceCents + oneTimeCents, coupon);
    const payment = await createWithReturnCallback<{ id: string; invoiceUrl: string }>(
      "/payments",
      {
        customer: customerId,
        billingType: "UNDEFINED",
        value: totalCents / 100,
        dueDate: isoDate(new Date()),
        description: plan.name,
        externalReference,
      },
      input.successUrl,
      `${input.idempotencyKey}:payment`,
    );
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
        /** The cycle this charge bills for — its start, for a subscription. */
        dueDate?: string;
        originalDueDate?: string;
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

    // Handles the packed form, the legacy JSON, and anything a human typed in
    // the Asaas panel (which yields {} and is skipped as a foreign event).
    const metadata: Partial<CheckoutMetadata> = parseCheckoutReference(
      payment?.externalReference ?? subscription?.externalReference,
    );

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
        //
        // The charge's due date IS the start of the cycle it pays for, and it
        // is the only cycle information Asaas sends. Without it every renewal
        // looked like a cosmetic re-emission to the handler (Stripe's
        // cancel/undo case), so the consumption window stayed pinned to the
        // FIRST month: once that `current_period_end` passed, usage fell
        // outside the window and the workspace was metered as unlimited.
        // A duplicate delivery (CONFIRMED then RECEIVED, same charge) carries
        // the same due date, which is exactly what keeps it from restarting
        // the window twice.
        if (payment.subscription) {
          const cycleStart = payment.dueDate ?? payment.originalDueDate;
          const cycleStartDate = cycleStart ? new Date(cycleStart) : undefined;
          events.push({
            providerEventId,
            type: "subscription_activated",
            provider: "asaas",
            metadata,
            providerCustomerId: payment.customer,
            providerSubscriptionId: payment.subscription,
            status: "active",
            ...(cycleStartDate && !Number.isNaN(cycleStartDate.getTime()) ? { currentPeriodStart: cycleStartDate } : {}),
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
