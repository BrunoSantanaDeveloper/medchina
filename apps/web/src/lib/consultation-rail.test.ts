import { activeRailKey, RAIL_ORDER, RAIL_TARGETS, railItems } from "./consultation-rail";
import { describe, expect, it } from "vitest";

import type { ConsultationJourney, JourneyStep, JourneyStepKey } from "@flyee/clinical";

const step = (over: Partial<JourneyStep> = {}): JourneyStep => ({
  key: "record",
  state: "available",
  optional: false,
  ...over,
});

const steps = (over: Partial<Record<JourneyStepKey, Partial<JourneyStep>>> = {}): ConsultationJourney["steps"] =>
  Object.fromEntries(
    RAIL_ORDER.map((key) => [key, step({ key, state: "available", optional: key !== "record", ...over[key] })]),
  ) as ConsultationJourney["steps"];

describe("the rail is a map of the journey, not a wizard", () => {
  it("shows every step the journey does not hide, in the screen's own order", () => {
    const items = railItems(steps());
    expect(items.map((item) => item.key)).toEqual([
      "consent",
      "record",
      "review",
      "hypotheses",
      "plan",
      "prescription",
      "finalize",
    ]);
  });

  it("drops hidden steps — the list grows and shrinks while she works", () => {
    // No Pro entitlement: reasoning steps are hidden, not blocked.
    const withoutPro = railItems(
      steps({ hypotheses: { state: "hidden" }, plan: { state: "hidden" }, prescription: { state: "hidden" } }),
    );
    expect(withoutPro.map((item) => item.key)).toEqual(["consent", "record", "review", "finalize"]);
    // Which is why a total ("step 3 of 8") would be a number about nothing.
    expect(withoutPro.length).not.toBe(railItems(steps()).length);
  });

  it("carries the journey's number and count, and invents neither", () => {
    const items = railItems(steps({ record: { number: 1 }, review: { count: 3 } }));
    expect(items.find((item) => item.key === "record")?.number).toBe(1);
    expect(items.find((item) => item.key === "review")?.count).toBe(3);
    // A step without a number or a count carries neither key: nothing to render.
    const plan = items.find((item) => item.key === "plan");
    expect(plan && "number" in plan).toBe(false);
    expect(plan && "count" in plan).toBe(false);
  });

  it("keeps a blocked step in the rail — the place of the block is the place of the fix", () => {
    const items = railItems(steps({ hypotheses: { state: "blocked", reason: "nothing_recorded" } }));
    expect(items.find((item) => item.key === "hypotheses")?.state).toBe("blocked");
  });
});

describe("where each step lives", () => {
  it("has an explicit target for every step — never a blind fallback", () => {
    for (const key of RAIL_ORDER) expect(RAIL_TARGETS[key]).toBeDefined();
    expect(RAIL_TARGETS.review).toEqual({ kind: "attention" });
    expect(RAIL_TARGETS.consent).toEqual({ kind: "anchor", id: "etapa-context" });
    expect(RAIL_TARGETS.finalize).toEqual({ kind: "anchor", id: "etapa-context" });
  });
});

describe("which step is current", () => {
  const items = railItems(steps());

  it("answers from the anchor on screen", () => {
    expect(activeRailKey(items, "etapa-hypotheses")).toBe("hypotheses");
    expect(activeRailKey(items, "etapa-record")).toBe("record");
  });

  it("answers nothing when the anchor is shared or absent", () => {
    // Consent and finalize share the context bar: being at the top says nothing.
    expect(activeRailKey(items, "etapa-context")).toBeNull();
    expect(activeRailKey(items, null)).toBeNull();
    expect(activeRailKey(items, "etapa-inexistente")).toBeNull();
  });

  it("never marks a step the rail is not showing", () => {
    const withoutPro = railItems(steps({ hypotheses: { state: "hidden" } }));
    expect(activeRailKey(withoutPro, "etapa-hypotheses")).toBeNull();
  });
});
