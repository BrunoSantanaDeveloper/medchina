import { MAX_INSTALLMENTS, type PaymentMethod } from "@flyee/billing/types";

/**
 * What the customer may actually be charged, decided on the server.
 *
 * The form offers what it offers, but a form is a suggestion: a server action
 * is a public endpoint, and the values that reach the provider are settled
 * here. Three rules, all of them money:
 *
 *  - **Installments only on a card.** Pix has no instalment concept at Asaas;
 *    asking for 5x on Pix would silently produce five separate charges the
 *    customer has to pay by hand, which is not what either side agreed to.
 *  - **Installments only off a monthly plan.** Splitting a monthly price into
 *    5 would sell a year of billing cycles for one month's money.
 *  - **Clamped to the offer.** A crafted request asking for 12x must not open
 *    a 12x checkout just because the grid showed 5.
 *
 * Pure, so the rule can be tested without a provider or a network.
 */
export type ResolvedPaymentChoice = { method: PaymentMethod | undefined; installments: number };

export function resolvePaymentChoice(input: {
  method?: string | null;
  installments?: number | null;
  planPeriod: string | null;
}): ResolvedPaymentChoice {
  const method: PaymentMethod | undefined =
    input.method === "credit_card" || input.method === "pix" ? input.method : undefined;

  const asked = Number(input.installments);
  const wanted = Number.isFinite(asked) ? Math.floor(asked) : 1;
  const splittable = method === "credit_card" && input.planPeriod !== null && input.planPeriod !== "monthly";
  const installments = splittable ? Math.min(Math.max(wanted, 1), MAX_INSTALLMENTS) : 1;

  return { method, installments };
}
