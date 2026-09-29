import { describe, expect, it } from "vitest";

import { RESULT_SCHEMA as ATTACHMENT_SCHEMA } from "@/lib/attachment-analysis";
import { RESULT_SCHEMA as REASONING_SCHEMA } from "@/lib/clinical-reasoning";
import { RESULT_SCHEMA as SUMMARY_SCHEMA } from "@/lib/clinical-summary";
import { PRACTICE_MODALITIES } from "@/lib/practice-context";
import { buildResultSchema } from "@/lib/therapeutic-plan";
import { strictSchemaViolations, toStrictJsonSchema } from "@flyee/ai";

/**
 * Every structured schema the clinical features send to a model.
 *
 * Gemini is the primary provider; OpenAI exists so a Gemini outage does not
 * take the clinical reasoning down with it. But OpenAI's strict mode refuses a
 * schema with an optional property, and that refusal is a 400 at call time —
 * it would be discovered on the worst possible day. The provider converts, and
 * this is where the conversion is proved to cover the real schemas rather than
 * the small ones in the unit tests.
 */
const SCHEMAS: [name: string, schema: unknown][] = [
  ["clinical-reasoning", REASONING_SCHEMA],
  ["clinical-summary", SUMMARY_SCHEMA],
  ["attachment-analysis", ATTACHMENT_SCHEMA],
  ["therapeutic-plan (full scope)", buildResultSchema(PRACTICE_MODALITIES)],
  ["therapeutic-plan (one modality)", buildResultSchema(["acupuncture"])],
  ["therapeutic-plan (no declared scope)", buildResultSchema([])],
];

describe("clinical schemas over OpenAI strict mode", () => {
  it.each(SCHEMAS)("%s converts to something OpenAI accepts", (_name, schema) => {
    expect(strictSchemaViolations(toStrictJsonSchema(schema))).toEqual([]);
  });

  it.each(SCHEMAS)("%s is not mutated by the conversion", (_name, schema) => {
    // The schemas are module-level constants shared with the Gemini provider:
    // converting in place would rewrite what the primary provider sends.
    const before = JSON.stringify(schema);
    toStrictJsonSchema(schema);
    expect(JSON.stringify(schema)).toBe(before);
  });

  it("needs the conversion — the plan schema is not strict-compatible as written", () => {
    // Guards against this suite passing for the wrong reason. Optionality in
    // the plan is deliberate (PRD §10.9: never pad a plan with a modality
    // that does not fit), so if this ever comes back empty the schema lost
    // that property, not the transform its purpose.
    expect(strictSchemaViolations(buildResultSchema(PRACTICE_MODALITIES)).length).toBeGreaterThan(0);
  });

  it("keeps the therapeutic plan's scope fence after conversion", () => {
    // The fence is the schema itself (PRD §10.9): a modality she does not
    // practise has no property to be written into. Making every property
    // required must not smuggle the other modalities back in.
    const strict = toStrictJsonSchema(buildResultSchema(["acupuncture"])) as {
      properties: { modalities: { properties: Record<string, unknown> } };
    };
    expect(Object.keys(strict.properties.modalities.properties)).toEqual(["acupuncture"]);
  });
});
