import { activeTerms, TCM_VOCABULARY, toggleTerm } from "./tcm-vocabulary";
import { describe, expect, it } from "vitest";

describe("TCM vocabulary chips compose the free text", () => {
  it("appends the first term and then separates them as the phrase reads", () => {
    expect(toggleTerm("", "pálida")).toBe("pálida");
    expect(toggleTerm("pálida", "saburra branca")).toBe("pálida, saburra branca");
  });

  it("removes a term without leaving dangling separators", () => {
    expect(toggleTerm("pálida, saburra branca, fissurada", "saburra branca")).toBe("pálida, fissurada");
    expect(toggleTerm("pálida", "pálida")).toBe("");
  });

  it("never discards what she typed by hand", () => {
    const handwritten = "pálida nas bordas, com aspecto incomum hoje";
    expect(toggleTerm(handwritten, "fissurada")).toBe(`${handwritten}, fissurada`);
  });

  it("marks a chip active only on a whole term, never inside a longer one", () => {
    const groups = TCM_VOCABULARY["tcm.tongue"];
    // "saburra fina" must not light up the separate "fina" chip.
    const active = activeTerms("saburra fina", groups);
    expect(active.has("saburra fina")).toBe(true);
    expect(active.has("fina")).toBe(false);
  });

  it("recognizes terms regardless of case and trailing punctuation", () => {
    const groups = TCM_VOCABULARY["tcm.pulse"];
    expect(activeTerms("Em corda, fino.", groups).has("em corda")).toBe(true);
    expect(activeTerms("Em corda, fino.", groups).has("fino")).toBe(true);
  });

  it("offers a vocabulary exactly for the professional-observation fields", () => {
    expect(Object.keys(TCM_VOCABULARY).sort()).toEqual(["tcm.palpation", "tcm.pulse", "tcm.tongue"]);
    // tcm.pattern is deliberately absent: a disharmony pattern is a clinical
    // conclusion, not a term to pick from a list.
    expect(TCM_VOCABULARY["tcm.pattern"]).toBeUndefined();
  });
});
