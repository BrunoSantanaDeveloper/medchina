import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AsaasProvider } from "@flyee/billing/asaas";
import type { CheckoutInput } from "@flyee/billing/types";

/**
 * PIX on our own page, against a fake Asaas.
 *
 * What matters most here is not the happy path — it is that a QR the provider
 * fails to return NEVER turns a checkout into an error. By the time the QR is
 * read the recurring charge already exists; a throw at that point would tell
 * her "it did not work" while the charge stands.
 */

const BASE = "https://fake.asaas.test/v3";
type Route = (init?: RequestInit) => { status: number; body: unknown };
let routes: Record<string, Route>;
let calls: string[];

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.ASAAS_API_KEY = "test-key";
  process.env.ASAAS_BASE_URL = BASE;
  calls = [];
  routes = {
    "GET /customers?externalReference": () => ({ status: 200, body: { data: [{ id: "cus_1" }] } }),
    "PUT /customers/cus_1": () => ({ status: 200, body: { id: "cus_1" } }),
    "POST /subscriptions": () => ({ status: 200, body: { id: "sub_1" } }),
    "GET /subscriptions/sub_1/payments": () => ({
      status: 200,
      body: { data: [{ id: "pay_1", invoiceUrl: "https://fake.asaas.test/i/pay_1" }] },
    }),
    "GET /payments/pay_1/pixQrCode": () => ({
      status: 200,
      body: {
        encodedImage: "iVBORw0KGgo=",
        payload: "00020126pix-copia-e-cola",
        expirationDate: "2026-09-24 23:59:59",
      },
    }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.replace(BASE, "");
      calls.push(`${method} ${path}`);
      const key = Object.keys(routes).find((candidate) => {
        const [m, p] = candidate.split(" ");
        return m === method && path.startsWith(p);
      });
      if (!key) return respond(404, { errors: [{ description: `no fake for ${method} ${path}` }] });
      const { status, body } = routes[key](init);
      return respond(status, body);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const checkout = (paymentMethod: "pix" | "credit_card"): CheckoutInput => ({
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  orgId: "org_1",
  orgName: "Consultorio",
  customerEmail: "a@b.c",
  plan: {
    id: "plan_1",
    slug: "pro-anual",
    name: "Pro anual",
    kind: "recurring",
    period: "yearly",
    priceCents: 229000,
    currency: "BRL",
    trialDays: 0,
    creditAmount: null,
    creditsExpire: false,
    description: null,
  },
  modules: [],
  payer: { document: "37715687731" },
  paymentMethod,
  successUrl: "https://app.test/onboarding?checkout=success",
  cancelUrl: "https://app.test/onboarding?checkout=canceled",
});

describe("AsaasProvider — PIX on our page", () => {
  it("returns the QR, the copy-and-paste and the hosted invoice for a PIX subscription", async () => {
    const result = await new AsaasProvider().createCheckout(checkout("pix"));
    expect(result.url).toBe("https://fake.asaas.test/i/pay_1");
    expect(result.pix).toEqual({
      providerPaymentId: "pay_1",
      qrCodeBase64: "iVBORw0KGgo=",
      copyPaste: "00020126pix-copia-e-cola",
      // "23:59:59" is Brasília time; UTC is three hours ahead.
      expiresAt: "2026-09-25T02:59:59.000Z",
      invoiceUrl: "https://fake.asaas.test/i/pay_1",
    });
  });

  it("never reads a QR for a card checkout", async () => {
    const result = await new AsaasProvider().createCheckout(checkout("credit_card"));
    expect(result.pix).toBeUndefined();
    expect(calls.some((call) => call.includes("pixQrCode"))).toBe(false);
  });

  it("still returns the invoice when the QR read fails — the charge already exists", async () => {
    routes["GET /payments/pay_1/pixQrCode"] = () => ({ status: 500, body: { errors: [] } });
    const result = await new AsaasProvider().createCheckout(checkout("pix"));
    expect(result.url).toBe("https://fake.asaas.test/i/pay_1");
    expect(result.pix).toBeUndefined();
  });

  it("drops a QR that arrives without its copy-and-paste", async () => {
    routes["GET /payments/pay_1/pixQrCode"] = () => ({ status: 200, body: { encodedImage: "iVBORw0KGgo=" } });
    const result = await new AsaasProvider().createCheckout(checkout("pix"));
    expect(result.pix).toBeUndefined();
  });
});

describe("AsaasProvider.pixCharge — resuming without a second charge", () => {
  const pending =
    (status: string, billingType = "PIX") =>
    () => ({
      status: 200,
      body: { data: [{ id: "pay_1", status, billingType, invoiceUrl: "https://fake.asaas.test/i/pay_1" }] },
    });

  it("re-reads the QR of an open PIX charge", async () => {
    routes["GET /subscriptions/sub_1/payments"] = pending("PENDING");
    const pix = await new AsaasProvider().pixCharge({ providerSubscriptionId: "sub_1" });
    expect(pix?.copyPaste).toBe("00020126pix-copia-e-cola");
    expect(pix?.invoiceUrl).toBe("https://fake.asaas.test/i/pay_1");
    // A READ: resuming must never create anything.
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("returns nothing once the charge is paid", async () => {
    routes["GET /subscriptions/sub_1/payments"] = pending("RECEIVED");
    expect(await new AsaasProvider().pixCharge({ providerSubscriptionId: "sub_1" })).toBeNull();
  });

  it("returns nothing for a card charge", async () => {
    routes["GET /subscriptions/sub_1/payments"] = pending("PENDING", "CREDIT_CARD");
    expect(await new AsaasProvider().pixCharge({ providerSubscriptionId: "sub_1" })).toBeNull();
  });

  it("returns nothing, instead of throwing, when the provider is unreachable", async () => {
    routes["GET /subscriptions/sub_1/payments"] = () => ({ status: 503, body: {} });
    expect(await new AsaasProvider().pixCharge({ providerSubscriptionId: "sub_1" })).toBeNull();
  });
});
