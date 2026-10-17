import {
  ALWAYS_REVIEW_FIELDS,
  ANAMNESIS_BLOCKS,
  anamnesisBlocksFor,
  countedAnamnesisBlocks,
  PROFESSIONAL_OBSERVATION_FIELDS,
  PULSE_POSITION_FIELDS,
} from "./anamnesis";
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
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: false }))).toEqual([
      "complaint",
      "routine",
      "emotional",
      "tcm",
      "pulse",
    ]);
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: true }))).toEqual([
      "complaint",
      "routine",
      "gyneco",
      "emotional",
      "tcm",
      "pulse",
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

/**
 * Reported from real use (2026-10-17): every item of the pulse — profundidade,
 * ritmo, força, qualidade — is read per organ, so the pulse is twelve readings
 * and the single prose field could never say WHICH position was fraco.
 */
describe("the pulse is read by position", () => {
  const pulse = ANAMNESIS_BLOCKS.find((block) => block.key === "pulse");

  it("carries the twelve organs she named, in her order", () => {
    expect(pulse?.fields.map((field) => field.key)).toEqual([
      "heart",
      "small-intestine",
      "liver",
      "gallbladder",
      "kidney",
      "bladder",
      "lung",
      "large-intestine",
      "spleen",
      "stomach",
      "pericardium",
      "triple-burner",
    ]);
    expect(PULSE_POSITION_FIELDS).toHaveLength(12);
  });

  it("is a professional observation in every position — never read off the patient's words", () => {
    for (const key of PULSE_POSITION_FIELDS) expect(PROFESSIONAL_OBSERVATION_FIELDS.has(key)).toBe(true);
  });

  it("tells the extraction which organ each position reads", () => {
    const transcript = {
      text: "",
      segments: [{ speaker: "A", start: "00:00:01", end: "00:00:02", text: "Pulso do coração fraco." }],
    } as unknown as Parameters<typeof buildPrompt>[0];

    const prompt = buildPrompt(transcript);
    expect(prompt).toContain("pulse.heart");
    expect(prompt).toContain("Coração");
    // The rule that keeps a reading she gave without a position from being
    // spread over twelve fields — eleven findings nobody observed.
    expect(prompt).toMatch(/must NOT be spread across the positions/);
  });

  it("retires the general field: not on a fresh chart, kept where it was written", () => {
    const fresh = anamnesisBlocksFor({ fertilityCare: false });
    const tcm = fresh.find((block) => block.key === "tcm");
    expect(tcm?.fields.some((field) => field.key === "pulse")).toBe(false);
    // The extraction is never offered it either, so nothing writes it again.
    const transcript = {
      text: "",
      segments: [{ speaker: "A", start: "00:00:01", end: "00:00:02", text: "Pulso fino." }],
    } as unknown as Parameters<typeof buildPrompt>[0];
    expect(buildPrompt(transcript)).not.toContain("tcm.pulse:");

    // A consultation that HAS one keeps it on the chart, readable and
    // correctable — hiding it would read as "não informado" about a pulse
    // that was informed.
    const recorded = anamnesisBlocksFor({ fertilityCare: false }, ["tcm.pulse"]);
    expect(recorded.find((block) => block.key === "tcm")?.fields.some((field) => field.key === "pulse")).toBe(true);
  });

  it("counts the twelve only once she has read one of them", () => {
    const fieldsOf = (blocks: typeof ANAMNESIS_BLOCKS) =>
      blocks.flatMap((block) => block.fields.map((field) => `${block.key}.${field.key}`));

    // Folded and untouched: on screen, outside the "X de Y" total and outside
    // the absence list the hypotheses prompt is given.
    expect(keysOf(countedAnamnesisBlocks({ fertilityCare: false }))).not.toContain("pulse");
    expect(keysOf(anamnesisBlocksFor({ fertilityCare: false }))).toContain("pulse");

    // One position recorded and the whole reading becomes part of the chart:
    // the eleven she has not palpated yet are a real gap now.
    const counted = countedAnamnesisBlocks({ fertilityCare: false }, ["pulse.heart"]);
    expect(keysOf(counted)).toContain("pulse");
    expect(fieldsOf(counted)).toContain("pulse.liver");
  });
});
