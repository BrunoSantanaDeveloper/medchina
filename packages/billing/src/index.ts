import { AsaasProvider, asaasPixAvailable } from "./providers/asaas";
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
 * Whether the checkout should offer Pix.
 *
 * Decided by what the ACCOUNT can do, not by a switch someone has to remember
 * to flip. The first version of this was an env var defaulting to off, which
 * meant a production account with an active Pix key — verified — still only
 * offered card, and nobody could tell why from the screen.
 *
 * Offering a method the account cannot charge fails at the last step of the
 * funnel, so the account is asked. `BILLING_PIX_ENABLED=false` remains as a
 * kill switch for the day Pix has to come off in a hurry.
 */
export async function isPixAvailable(): Promise<boolean> {
  if ((process.env.BILLING_PIX_ENABLED ?? "").trim().toLowerCase() === "false") return false;
  // Pix is modelled for Asaas only; Stripe's Brazilian Pix is not wired here.
  if (defaultProvider() !== "asaas") return false;
  return asaasPixAvailable();
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
