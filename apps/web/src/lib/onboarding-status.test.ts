import { describe, expect, it } from "vitest";

import type { AudioAllowance } from "@/lib/audio-allowance";
import { deriveOnboardingStatus } from "@/lib/onboarding-status";

const allowance = (overrides: Partial<AudioAllowance>): AudioAllowance =>
  ({
    source: "none",
    planSlug: null,
    planName: null,
    suspended: false,
    minutesLimit: 0,
    minutesUsed: 0,
    cycleMinutesRemaining: 0,
    packMinutesRemaining: 0,
    minutesRemaining: 0,
    percent: 0,
    windowStart: null,
    windowEnd: null,
    trialActive: false,
    trialEndsAt: null,
    trialAvailable: true,
    canStart: false,
    clinicalReasoning: false,
    reason: "no_plan",
    cycleExpired: false,
    pastDue: false,
    dunning: false,
    graceEndsAt: null,
    packPurchasable: false,
    ...overrides,
  }) as AudioAllowance;

describe("deriveOnboardingStatus", () => {
  it("names the contracted plan once the workspace actually has one", () => {
    expect(
      deriveOnboardingStatus({ allowance: allowance({ source: "plan", planName: "Pro" }), pending: null }),
    ).toEqual({ kind: "plan", planName: "Pro" });
  });

  it("reports a charge the provider has not confirmed yet", () => {
    expect(deriveOnboardingStatus({ allowance: allowance({}), pending: { planName: "Assistente" } })).toEqual({
      kind: "pending_payment",
      planName: "Assistente",
      provisionalUntil: null,
    });
  });

  it("prefers the live plan over a stale unconfirmed row", () => {
    // She paid by PIX, the webhook confirmed it, and the old `incomplete` row
    // was left behind. Saying "confirming payment" to someone who is already
    // recording would be worse than saying nothing.
    const status = deriveOnboardingStatus({
      allowance: allowance({ source: "plan", planName: "Pro" }),
      pending: { planName: "Pro" },
    });
    expect(status.kind).toBe("plan");
  });

  it("prefers the pending payment over a running trial", () => {
    // The payment is the newer fact and the one she is waiting on; the trial
    // is what she already had.
    const status = deriveOnboardingStatus({
      allowance: allowance({ source: "trial", trialActive: true }),
      pending: { planName: "Pro" },
    });
    expect(status.kind).toBe("pending_payment");
  });

  it("counts the days left in a running trial", () => {
    const endsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(
      deriveOnboardingStatus({
        allowance: allowance({ source: "trial", trialActive: true, trialEndsAt: endsAt }),
        pending: null,
      }),
    ).toEqual({ kind: "trial", daysLeft: 3 });
  });

  it("keeps saying the payment is being confirmed while the plan is honoured provisionally", () => {
    // Migration 0111: the allowance reports the plan as its source during the
    // window. Reading that as "plan" would tell her she has what she has not
    // paid for yet.
    const until = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      deriveOnboardingStatus({
        allowance: allowance({ source: "plan", planName: "Pro anual", provisional: true, provisionalUntil: until }),
        pending: { planName: "Pro anual" },
      }),
    ).toEqual({ kind: "pending_payment", planName: "Pro anual", provisionalUntil: until });
  });

  it("names an unconfirmed payment once the window has closed — never offers a trial", () => {
    expect(
      deriveOnboardingStatus({
        allowance: allowance({ reason: "payment_unconfirmed", pendingPlanSlug: "pro-anual" }),
        pending: { planName: "Pro anual" },
      }),
    ).toEqual({ kind: "payment_unconfirmed", planName: "Pro anual", planSlug: "pro-anual" });
  });

  it("falls back to free rather than inventing a state when nothing is known", () => {
    expect(deriveOnboardingStatus({ allowance: null, pending: null })).toEqual({ kind: "free" });
  });
});
