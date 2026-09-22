import { AsaasProvider } from "./providers/asaas";
import { StripeProvider } from "./providers/stripe";
import type { BillingProviderName, PaymentProvider } from "./types";

export * from "./types";

export const isStripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
export const isAsaasConfigured = Boolean(process.env.ASAAS_API_KEY);

/** Providers available in this deployment, in display order. */
export function configuredProviders(): BillingProviderName[] {
  const providers: BillingProviderName[] = [];
  if (isStripeConfigured) providers.push("stripe");
  if (isAsaasConfigured) providers.push("asaas");
  return providers;
}

/**
 * Whether the deployment may charge Pix.
 *
 * Not a preference: Asaas refuses a Pix charge until the account has a Pix key
 * and is approved for it, and the refusal arrives as a generic checkout
 * failure at the LAST step of the funnel. Offering a method that cannot be
 * charged is worse than not offering it, so Pix stays off until the deployment
 * says otherwise — and the deployment says so only after confirming the
 * account really can (see docs/ASAAS-GO-LIVE.md).
 */
export function isPixEnabled(): boolean {
  return (process.env.BILLING_PIX_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Deployment-owned provider choice; provider brands never leak into product UX. */
export function defaultProvider(): BillingProviderName | null {
  const preferred = process.env.BILLING_PROVIDER;
  const configured = configuredProviders();
  if ((preferred === "stripe" || preferred === "asaas") && configured.includes(preferred)) return preferred;
  return configured[0] ?? null;
}

export function getProvider(name: BillingProviderName): PaymentProvider {
  switch (name) {
    case "stripe":
      return new StripeProvider();
    case "asaas":
      return new AsaasProvider();
  }
}
