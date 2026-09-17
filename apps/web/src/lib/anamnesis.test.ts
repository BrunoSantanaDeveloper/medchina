import { ALWAYS_REVIEW_FIELDS, ANAMNESIS_BLOCKS, anamnesisBlocksFor } from "./anamnesis";
import { buildPrompt } from "./clinical-extraction";
import { describe, expect, it } from "vitest";

const keysOf = (blocks: typeof ANAMNESIS_BLOCKS) => blocks.map((block) => block.key);

describe("the anamnesis catalog", () => {
  it("never repeats a key — they are stored forever and the extraction maps onto them", () => {
    const composite = ANAMNESIS_BLOCKS.flatMap((block) => block.fields.map((field) => `${block.key}.${field.key}`));
    expect(new Set(composite).size).toBe(composite.length);
    expect(new Set(keysOf(ANAMNESIS_BLOCKS)).size).toBe(ANAMNESIS_BLOCKS.length);
  });

  it("keeps the fields the professional asked for", () => {
    const routine = ANAMNESIS_BLOCKS.find((block) => block.key === "routine");
    expect(routine?.fields.map((field) => field.key)).toEqual(
      expect.arrayContaining(["tobacco", "alcohol", "substances"]),
    );
    const complaint = ANAMNESIS_BLOCKS.find((block) => block.key === "complaint");
    // Supplements live WITH medications on purpose (one field, one history).
    expect(complaint?.fields.some((field) => field.key === "supplements")).toBe(false);
    expect(complaint?.fields.find((field) => field.key === "medications")?.hint).toMatch(/suplementos/);
    // Diagnoses are the patient's REPORT, never a deduction.
    expect(complaint?.fields.find((field) => field.key === "treatments")?.hint).toMatch(/NUNCA deduza/);
  });

  it("sends the sensitive fields back for review, by declaration and not by name", () => {
    expect([...ALWAYS_REVIEW_FIELDS].sort()).toEqual(
      [
        "complaint.medications",
        "gyneco.libido",
        "gyneco.obstetric",
        "routine.alcohol",
        "routine.substances",
        "routine.tobacco",
      ].sort(),
    );
  });
});

describe("the cycle and fertility block is conditional", () => {
  it("is left out unless the practice follows fertility AND the patient is marked", () => {
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: false }))).not.toContain("gyneco");
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: true }))).toContain("gyneco");
    // Everything else is always there, in catalog order.
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: false }))).toEqual(["complaint", "routine", "emotional", "tcm"]);
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: true }))).toEqual([
      "complaint",
      "routine",
      "gyneco",
      "emotional",
      "tcm",
    ]);
  });

  it("stays visible while it holds something, so nothing recorded is hidden", () => {
    // The mark was removed after the cycle was recorded.
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: false }, ["gyneco.cycle", "routine.sleep"]))).toContain("gyneco");
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: false }, ["routine.sleep"]))).not.toContain("gyneco");
  });

  it("is never offered to the extraction where it does not apply", () => {
    const transcript = {
      text: "",
      segments: [{ speaker: "A", start: "00:00:01", end: "00:00:02", text: "Minha menstruação atrasou." }],
    } as unknown as Parameters<typeof buildPrompt>[0];

    const closed = buildPrompt(transcript);
    expect(closed).not.toContain("gyneco.");
    expect(closed).toContain("routine.tobacco");

    const open = buildPrompt(transcript, [], { fertilityCare: true });
    expect(open).toContain("gyneco.lmp");
    expect(open).toContain("gyneco.libido");
  });
});
