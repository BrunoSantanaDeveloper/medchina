import { describe, expect, it } from "vitest";

import { derivePlanFeatures } from "@/lib/billing-plan-features";
import { selectContextConsultations } from "@/lib/command-consultations";
import { deriveHypothesesPanelMode } from "@/lib/hypotheses-access";
import { type ActivationFacts, buildOnboardingSteps } from "@/lib/onboarding";

const facts = (overrides: Partial<ActivationFacts> = {}): ActivationFacts => ({
  hasProfileName: true,
  hasPracticeContext: false,
  hasPatient: false,
  hasFinalizedConsultation: false,
  ...overrides,
});

describe("product UX optimization contracts", () => {
  it("uses confirmed practice context as the first live onboarding predicate", () => {
    expect(buildOnboardingSteps(facts())[0]).toMatchObject({ key: "practice-context", done: false });
    expect(buildOnboardingSteps(facts({ hasPracticeContext: true }))[0]).toMatchObject({
      key: "practice-context",
      done: true,
    });
  });

  it("classifies contextual consultation actions without duplicating a consultation", () => {
    const rows = [
      {
        id: "scheduled-later",
        status: "scheduled",
        scheduled_for: "2030-01-03T10:00:00.000Z",
        updated_at: "2029-01-01T00:00:00.000Z",
      },
      {
        id: "scheduled-next",
        status: "scheduled",
        scheduled_for: "2030-01-02T10:00:00.000Z",
        updated_at: "2029-01-02T00:00:00.000Z",
      },
      {
        id: "draft",
        status: "draft",
        scheduled_for: null,
        updated_at: "2029-01-04T00:00:00.000Z",
      },
      {
        id: "progress",
        status: "in_progress",
        scheduled_for: null,
        updated_at: "2029-01-05T00:00:00.000Z",
      },
      {
        id: "review",
        status: "awaiting_review",
        scheduled_for: null,
        updated_at: "2029-01-06T00:00:00.000Z",
      },
    ];
    const selected = selectContextConsultations(rows, "2030-01-01T00:00:00.000Z");
    expect(selected.map(({ kind, consultation }) => [kind, consultation.id])).toEqual([
      ["review", "review"],
      ["continue", "progress"],
      ["upcoming", "scheduled-next"],
    ]);
    expect(new Set(selected.map(({ consultation }) => consultation.id)).size).toBe(selected.length);
  });

  it("derives plan resources and the most-complete signal from limits", () => {
    expect(derivePlanFeatures({ audio_minutes: 6000, library_messages: 40, clinical_reasoning: 1 })).toEqual({
      audioMinutes: 6000,
      libraryMessages: 40,
      clinicalReasoning: true,
    });
    expect(derivePlanFeatures({ audio_minutes: 3000 })).toEqual({
      audioMinutes: 3000,
      libraryMessages: null,
      clinicalReasoning: false,
    });
  });

  it.each([
    [{ reasoningEntitled: false, canPrepare: false, isFinalized: false, hasHypotheses: false }, "locked"],
    [{ reasoningEntitled: true, canPrepare: true, isFinalized: false, hasHypotheses: false }, "allowed"],
    [{ reasoningEntitled: true, canPrepare: false, isFinalized: false, hasHypotheses: true }, "read_only"],
    [{ reasoningEntitled: false, canPrepare: false, isFinalized: false, hasHypotheses: true }, "downgrade"],
  ] as const)("derives the Pro panel state", (input, expected) => {
    expect(deriveHypothesesPanelMode(input)).toBe(expected);
  });
});
