import { type AudioAllowance, trialDaysLeft } from "@/lib/audio-allowance";

/**
 * What the guided trail is allowed to say about money, in one line.
 *
 * The guided trail runs immediately after checkout, which is the one moment
 * where the professional has just paid and the system does not yet know it: a
 * PIX charge sits at `incomplete` until the provider's webhook confirms it.
 * Saying nothing there reads as "my payment was lost"; claiming the plan is
 * active would be a lie the webhook may never make true.
 *
 * So this derives ONE state from two facts that are already authoritative
 * elsewhere, and invents no third opinion:
 *
 *  - the allowance (`org_audio_allowance`, migration 0024) — the same source
 *    the capture gate uses, so the badge can never disagree with what she is
 *    actually allowed to do;
 *  - whether a subscription row is still `incomplete` — the provider's own
 *    "charged, not confirmed" (migration 0001, the column's default).
 *
 * Order is deliberate. A live plan wins over a pending row, because a workspace
 * that already records has been paid for whatever the older row says; a pending
 * row wins over the trial, because the payment is the newer fact and the one
 * she is waiting on.
 */
export type OnboardingStatus =
  /** Paid and confirmed. `planName` is null only if the plan lost its name. */
  | { kind: "plan"; planName: string | null }
  /**
   * Charged, waiting on the provider's webhook. Never "active" — even while the
   * plan is honoured provisionally (migration 0111), in which case
   * `provisionalUntil` says until when she can use it.
   */
  | { kind: "pending_payment"; planName: string | null; provisionalUntil: string | null }
  /**
   * The PIX was never confirmed and the provisional window closed. Pro is off;
   * what resolves it is finishing the payment, never a trial.
   */
  | { kind: "payment_unconfirmed"; planName: string | null; planSlug: string | null }
  /** The card-less Pro trial is running (PRD §5.7). */
  | { kind: "trial"; daysLeft: number | null }
  /** Gratuito: unlimited manual records, no AI minutes. Not a failure state. */
  | { kind: "free" };

/** A subscription the provider has not confirmed yet. Null when there is none. */
export type PendingSubscription = { planName: string | null };

export function deriveOnboardingStatus({
  allowance,
  pending,
}: {
  allowance: AudioAllowance | null;
  pending: PendingSubscription | null;
}): OnboardingStatus {
  // Provisional FIRST: during the window the allowance reports the plan as its
  // source, and reading that as "plan" would tell someone who has not paid yet
  // that she has.
  if (allowance?.provisional) {
    return { kind: "pending_payment", planName: allowance.planName, provisionalUntil: allowance.provisionalUntil };
  }
  if (allowance?.source === "plan") return { kind: "plan", planName: allowance.planName };
  if (allowance?.reason === "payment_unconfirmed") {
    return { kind: "payment_unconfirmed", planName: pending?.planName ?? null, planSlug: allowance.pendingPlanSlug };
  }
  // A charge with no provisional window (card, or a PIX created before 0111).
  if (pending) return { kind: "pending_payment", planName: pending.planName, provisionalUntil: null };
  if (allowance?.trialActive) return { kind: "trial", daysLeft: trialDaysLeft(allowance) };
  return { kind: "free" };
}
