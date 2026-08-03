import { compareAnswer, type PreviousConsultation, summarizeChanges } from "./previous-consultation";
import { describe, expect, it } from "vitest";

const previous: PreviousConsultation = {
  id: "prev",
  when: "2026-06-01T10:00:00Z",
  chiefComplaint: "Insônia",
  summary: null,
  answers: {
    "sleep.quality": { key: "sleep.quality", value: "Acorda 3x por noite", source: "ai" },
    "complaint.intensity": { key: "complaint.intensity", value: "8", source: "professional" },
    "tcm.pulse": { key: "tcm.pulse", value: "Fino e em corda", source: "professional_voice" },
  },
  patterns: ["Deficiência de Qi do Baço"],
  gaps: [],
};

describe("comparing a return consultation with the previous one", () => {
  it("names each kind of difference", () => {
    expect(compareAnswer("Acorda 1x por noite", "Acorda 3x por noite")).toBe("changed");
    expect(compareAnswer("Acorda 3x por noite", "Acorda 3x por noite")).toBe("same");
    expect(compareAnswer("Dor no ombro", undefined)).toBe("new");
  });

  it("treats a blank field as still-to-ask, never as a negative (PRD §10.5)", () => {
    // Recorded last time, empty now: the patient did not say it stopped — the
    // question simply has not been asked yet in this consultation.
    expect(compareAnswer(undefined, "Fino e em corda")).toBe("missing");
    expect(compareAnswer("   ", "Fino e em corda")).toBe("missing");
    // Never recorded on either side is not a difference to report.
    expect(compareAnswer(undefined, undefined)).toBe("same");
  });

  it("ignores whitespace-only edits so a stray space is not a clinical change", () => {
    expect(compareAnswer("  Acorda 3x por noite  ", "Acorda 3x por noite")).toBe("same");
  });

  it("summarizes the differences over the declared fields only", () => {
    const summary = summarizeChanges(
      {
        "sleep.quality": "Acorda 1x por noite", // changed
        "complaint.intensity": "8", // same
        "energy.level": "Melhor pela manhã", // new
        // tcm.pulse absent → missing
      },
      previous,
      ["sleep.quality", "complaint.intensity", "energy.level", "tcm.pulse"],
    );
    expect(summary).toEqual({ changed: 1, new: 1, missing: 1 });
  });

  it("reports nothing for a first consultation", () => {
    expect(summarizeChanges({ "sleep.quality": "Dorme bem" }, null, ["sleep.quality"])).toEqual({
      changed: 0,
      new: 0,
      missing: 0,
    });
  });
});
