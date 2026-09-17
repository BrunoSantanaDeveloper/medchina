import type { BillingPeriod } from "@flyee/billing";

/**
 * Which consumption window a subscription activation opens.
 *
 * `org_audio_allowance` meters audio inside `[current_period_start,
 * current_period_end)`. Get this wrong in either direction and money is lost:
 *
 *  - Restart the window on an event that is NOT a renewal (Stripe re-emits
 *    `customer.subscription.updated` when the product schedules or undoes a
 *    cancellation) and cancel + undo hands out a fresh cycle of minutes.
 *  - FAIL to advance it on an event that IS a renewal and, once the first
 *    `current_period_end` passes, usage falls outside the window entirely:
 *    the workspace is metered as unlimited. Asaas sends no period at all, only
 *    the charge's due date, so this was the case for every Asaas renewal.
 *
 * Pure, so the rule can be tested without a provider or a database.
 */
export type StoredSubscriptionWindow = {
  status: string;
  period: BillingPeriod | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
};

export type ActivationCycle = {
  /** The provider's own cycle start, when it reports one. */
  currentPeriodStart?: Date;
  /** The provider's own cycle end, when it reports one. */
  currentPeriodEnd?: Date;
};

export type ResolvedWindow = {
  start: string;
  end: string | null;
  /** True when this activation opened a NEW cycle rather than repeating one. */
  renewed: boolean;
};

export function periodEnd(from: Date, period: BillingPeriod): Date {
  const end = new Date(from);
  if (period === "weekly") end.setDate(end.getDate() + 7);
  if (period === "monthly") end.setMonth(end.getMonth() + 1);
  if (period === "yearly") end.setFullYear(end.getFullYear() + 1);
  return end;
}

const parse = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function resolveBillingWindow(
  stored: StoredSubscriptionWindow,
  event: ActivationCycle,
  now: Date = new Date(),
): ResolvedWindow {
  const wasLive = stored.status === "trialing" || stored.status === "active";
  const storedStart = parse(stored.currentPeriodStart);
  const storedEnd = parse(stored.currentPeriodEnd);

  // A cycle is new when the provider's dates move PAST what is stored. Equal
  // dates (Stripe's cosmetic update; Asaas's CONFIRMED-then-RECEIVED for the
  // same charge) are the same cycle and must not touch the window.
  const renewedByEnd = Boolean(event.currentPeriodEnd && storedEnd && event.currentPeriodEnd > storedEnd);
  const renewedByStart = Boolean(event.currentPeriodStart && storedStart && event.currentPeriodStart > storedStart);
  const renewed = renewedByEnd || renewedByStart;

  if (wasLive && !renewed) {
    // Same cycle, re-emitted: keep what is running. A subscription that was
    // live without any window recorded (hand-edited) gets one from now.
    const start = storedStart ?? event.currentPeriodStart ?? now;
    const end = storedEnd ?? event.currentPeriodEnd ?? (stored.period ? periodEnd(start, stored.period) : null);
    return { start: start.toISOString(), end: end ? end.toISOString() : null, renewed: false };
  }

  // First activation, recovery from past_due/incomplete, or a genuine renewal:
  // the cycle starts where the provider says it does — the charge's due date
  // on Asaas, the subscription period on Stripe — and ends one period later
  // unless the provider names the end itself.
  const start = event.currentPeriodStart ?? now;
  const end = event.currentPeriodEnd ?? (stored.period ? periodEnd(start, stored.period) : storedEnd);
  return { start: start.toISOString(), end: end ? end.toISOString() : null, renewed };
}
