import { buildPracticeScopeContext, normalizeScope } from "./practice-scope-context";
import { describe, expect, it } from "vitest";

describe("scope of practice in the library prompt", () => {
  it("names the declared modalities in the practitioner's language", () => {
    const block = buildPracticeScopeContext(["auriculotherapy", "cupping"]);

    expect(block).toContain("auriculoterapia");
    expect(block).toContain("ventosaterapia");
    expect(block).toContain("PRIORIZE");
  });

  it("prioritises without forbidding — this is a STUDY assistant", () => {
    const block = buildPracticeScopeContext(["auriculotherapy"]);

    // Refusing to discuss an approach she is learning would make the library
    // worse, not safer. The plan is restrictive; this must not be.
    expect(block).toContain("NÃO é uma restrição");
    for (const forbidding of ["APENAS", "SOMENTE", "não responda", "recuse"]) {
      expect(block).not.toContain(forbidding);
    }
  });

  it("injects nothing when she declared no scope", () => {
    // Unlike the therapeutic plan (where empty means ALL, so a skipped step
    // cannot produce an empty plan), here there is nothing to put first.
    expect(buildPracticeScopeContext([])).toBe("");
    expect(buildPracticeScopeContext(null)).toBe("");
    expect(buildPracticeScopeContext(undefined)).toBe("");
  });

  it("injects nothing when she declared every modality", () => {
    expect(buildPracticeScopeContext(["acupuncture", "diet", "moxibustion", "auriculotherapy", "cupping"])).toBe("");
  });

  it("ignores unknown slugs instead of leaking them into the prompt", () => {
    const block = buildPracticeScopeContext(["auriculotherapy", "quiropraxia", ""]);

    expect(block).toContain("auriculoterapia");
    expect(block).not.toContain("quiropraxia");
  });

  it("normalizes to the canonical order, whatever the stored order", () => {
    expect(normalizeScope(["cupping", "acupuncture"])).toEqual(["acupuncture", "cupping"]);
  });
});
