import { describe, expect, it } from "vitest";

import { DEFAULTS } from "@/config";
import {
  buildFirstConsultationSteps,
  buildOnboardingSteps,
  buildPreparationSteps,
  type ExperienceFacts,
  firstPendingPrepStep,
  followsRecordingPath,
  getActivationFacts,
  getExperienceFacts,
  isPrepStepKey,
  ONBOARDING_ROUTE,
  PREP_STEP_KEYS,
  prepStepsDone,
  resolvePostAuthDestination,
} from "@/lib/onboarding";
import type { SupabaseClient } from "@supabase/supabase-js";

type Answer = { data?: unknown; count?: number | null; error?: { message: string } | null };

/**
 * A stand-in for the Supabase client: every query on a table resolves to the
 * answer given for that table, whatever filters were chained onto it.
 */
function client(tables: Record<string, Answer>, fallback: Answer = {}): SupabaseClient {
  const query = (answer: Answer) => {
    // Callable and thenable: `.select().eq().maybeSingle()` and `await` both work.
    const builder: unknown = new Proxy(() => undefined, {
      get: (_target, property) =>
        property === "then"
          ? (resolve: (value: unknown) => void) => resolve({ data: null, count: null, error: null, ...answer })
          : () => builder,
    });
    return builder;
  };
  return {
    from: (table: string) => query(tables[table] ?? fallback),
    rpc: () => query(fallback),
  } as unknown as SupabaseClient;
}

const facts = (overrides: Partial<ExperienceFacts> = {}): ExperienceFacts => ({
  hasProfileName: true,
  hasPracticeContext: false,
  hasPatient: false,
  hasFinalizedConsultation: false,
  hasProfessionalIdentity: false,
  hasConsultation: false,
  hasAiReadyConsent: false,
  hasRecording: false,
  hasReadyRecording: false,
  ...overrides,
});

const stored = (...completedSteps: string[]) => ({ completedSteps });

/**
 * The preparation, the home checklist and the hub all read these functions.
 * What is pinned here is the contract the three surfaces share: a step is done
 * in one place exactly when it is done in the others, and it is done because of
 * what exists in the account — not because something was clicked.
 */
describe("the preparation of the practice", () => {
  it("has four steps, and none of them is a consultation", () => {
    expect(PREP_STEP_KEYS).toEqual(["scope", "signature", "recording", "next"]);
    expect(isPrepStepKey("recording")).toBe(true);
    // The keys of the guide this replaced must not open a step.
    for (const retired of ["patient", "complaint", "anamnesis", "finalize", "consent", "record", null, undefined]) {
      expect(isPrepStepKey(retired)).toBe(false);
    }
  });

  it("opens a brand-new account on how she works", () => {
    const done = prepStepsDone(facts(), stored());
    expect(done).toEqual({ scope: false, signature: false, recording: false, next: false });
    expect(firstPendingPrepStep(done)).toBe("scope");
  });

  it("reads each step from the account before any stored flag", () => {
    const done = prepStepsDone(
      facts({ hasPracticeContext: true, hasProfessionalIdentity: true, hasRecording: true, hasConsultation: true }),
      stored(),
    );
    expect(done).toEqual({ scope: true, signature: true, recording: true, next: true });
    expect(firstPendingPrepStep(done)).toBeNull();
  });

  it("remembers 'agora não' for the steps that leave nothing behind", () => {
    const done = prepStepsDone(
      facts({ hasPracticeContext: true }),
      stored("prep-signature", "prep-recording", "prep-next"),
    );
    expect(done).toEqual({ scope: true, signature: true, recording: true, next: true });
  });

  it("never lets a stored flag stand in for saying how she works", () => {
    // The first step is the only one with clinical effect: it is done when the
    // practice context is confirmed in the database, and by nothing else.
    const done = prepStepsDone(facts(), stored("prep-scope", "welcome", "prep-signature"));
    expect(done.scope).toBe(false);
    expect(firstPendingPrepStep(done)).toBe("scope");
  });

  it("resumes on the first step that is still open", () => {
    const done = prepStepsDone(facts({ hasPracticeContext: true }), stored("prep-signature"));
    expect(firstPendingPrepStep(done)).toBe("recording");
  });

  it("lists each step with the address that opens it", () => {
    const steps = buildPreparationSteps({ scope: true, signature: false, recording: false, next: false });
    expect(steps.map((step) => [step.key, step.href, step.done])).toEqual([
      ["scope", `${ONBOARDING_ROUTE}?passo=scope`, true],
      ["signature", `${ONBOARDING_ROUTE}?passo=signature`, false],
      ["recording", `${ONBOARDING_ROUTE}?passo=recording`, false],
      ["next", `${ONBOARDING_ROUTE}?passo=next`, false],
    ]);
    // Only the first changes what the product does; the others are hers to skip.
    expect(steps.filter((step) => step.required).map((step) => step.key)).toEqual(["scope"]);
  });
});

describe("the home checklist", () => {
  it("starts with the preparation and ends at the first finalized record", () => {
    const steps = buildOnboardingSteps(facts({ hasPracticeContext: true, hasPatient: true }));
    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ["practice-context", true],
      ["first-patient", true],
      ["first-consultation", false],
    ]);
    expect(steps[0].href).toBe(ONBOARDING_ROUTE);
  });
});

describe("the first consultation, as the hub lists it", () => {
  it("is two steps for someone who types her records", () => {
    expect(buildFirstConsultationSteps(facts(), false).map((step) => step.key)).toEqual([
      "first-patient",
      "first-consultation",
    ]);
  });

  it("adds what a recorded consultation needs, between the patient and the closed record", () => {
    const steps = buildFirstConsultationSteps(facts({ hasPatient: true, hasAiReadyConsent: true }), true);
    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ["first-patient", true],
      ["consent", true],
      ["record", false],
      ["review", false],
      ["first-consultation", false],
    ]);
  });

  it("follows the recording path when she said so, or when the data already shows it", () => {
    expect(followsRecordingPath({ selectedTrack: "ai" }, facts())).toBe(true);
    expect(followsRecordingPath({ selectedTrack: "manual" }, facts({ hasRecording: true }))).toBe(true);
    expect(followsRecordingPath({ selectedTrack: null }, facts({ hasAiReadyConsent: true }))).toBe(true);
    expect(followsRecordingPath({ selectedTrack: "manual" }, facts())).toBe(false);
    expect(followsRecordingPath({ selectedTrack: null }, undefined)).toBe(false);
    // Rows stored before the demo track was removed still say "demo".
    expect(followsRecordingPath({ selectedTrack: "demo" }, facts())).toBe(false);
  });
});

describe("a read that failed is not a 'no'", () => {
  const down = () => client({}, { error: { message: "network down" } });

  it("throws instead of reporting that nothing was done", async () => {
    await expect(getActivationFacts(down(), "user")).rejects.toThrow(/unavailable/);
    await expect(getExperienceFacts(down(), "user")).rejects.toThrow(/unavailable/);
  });

  it("reads an empty account as empty, not as a failure", async () => {
    expect(await getExperienceFacts(client({}), "user")).toEqual({
      hasProfileName: false,
      hasPracticeContext: false,
      hasPatient: false,
      hasFinalizedConsultation: false,
      hasProfessionalIdentity: false,
      hasConsultation: false,
      hasAiReadyConsent: false,
      hasRecording: false,
      hasReadyRecording: false,
    });
  });
});

describe("where sign-in lands", () => {
  it("sends a brand-new account to the preparation", async () => {
    expect(await resolvePostAuthDestination(client({}), "user")).toBe(ONBOARDING_ROUTE);
  });

  it("never sends her back once she answered or said 'fazer depois'", async () => {
    const skipped = client({
      onboarding_state: {
        data: { completed_steps: ["welcome"], selected_track: null, dismissed: false, completed_at: null },
      },
    });
    expect(await resolvePostAuthDestination(skipped, "user")).toBe(DEFAULTS.appRoot);
  });

  it("leaves alone an account that already said how it works", async () => {
    const prepared = client({
      memberships: { data: { organizations: { timezone_confirmed_at: "2026-09-01T12:00:00Z" } } },
    });
    expect(await resolvePostAuthDestination(prepared, "user")).toBe(DEFAULTS.appRoot);
  });

  it("falls back to the app when the state cannot be read — auth never dead-ends", async () => {
    const down = client({}, { error: { message: "network down" } });
    expect(await resolvePostAuthDestination(down, "user")).toBe(DEFAULTS.appRoot);
  });
});
