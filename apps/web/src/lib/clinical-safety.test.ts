import { detectSafetyFlags, safetyFlagTerm } from "./clinical-safety";
import { describe, expect, it } from "vitest";

describe("what a document that leaves the practice may show about a safety flag", () => {
  it("keeps the whole recorded text as evidence for the professional", () => {
    const [flag] = detectSafetyFlags([
      { text: "Usa ansiolítico à noite e fuma maconha desde os 20", fieldKey: "routine.substances" },
    ]);
    expect(flag.category).toBe("medication");
    expect(flag.matchedText).toBe("Usa ansiolítico à noite e fuma maconha desde os 20");
  });

  it("prints only the word that raised it — never the sentence", () => {
    // The stem in the pattern is "ansiol[íi]tic"; the patient reads the full word.
    expect(
      safetyFlagTerm({ category: "medication", matchedText: "Usa ansiolítico à noite e fuma maconha desde os 20" }),
    ).toBe("ansiolítico");
    expect(safetyFlagTerm({ category: "anticoagulant", matchedText: "tomo Xarelto 20mg desde março" })).toBe("Xarelto");
    expect(safetyFlagTerm({ category: "pacemaker", matchedText: "Tem marca-passo desde 2019" })).toBe("marca-passo");
    expect(safetyFlagTerm({ category: "pregnancy", matchedText: "Está grávida de 8 semanas" })).toBe("grávida");
  });

  it("falls back to the category alone when the text no longer matches", () => {
    expect(safetyFlagTerm({ category: "allergy", matchedText: "texto editado depois" })).toBe("");
    expect(safetyFlagTerm({ category: "unknown", matchedText: "alergia" })).toBe("");
    expect(safetyFlagTerm({ category: "allergy", matchedText: null })).toBe("");
  });
});
