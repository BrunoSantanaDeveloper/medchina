import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strictSchemaViolations, toStrictJsonSchema } from "./strict-schema.ts";

/**
 * The conversion exists so the domain schemas can keep saying "this field may
 * be absent" — the shape the clinical rules actually have — while OpenAI, which
 * has no absent field, still receives something it accepts. These cases pin
 * both halves: what the transform must add, and what it must not change.
 */
describe("toStrictJsonSchema", () => {
  it("closes every object and promotes every property into required", () => {
    const strict = toStrictJsonSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "integer" } },
      required: ["a"],
    }) as Record<string, unknown>;

    assert.equal(strict.additionalProperties, false);
    assert.deepEqual(strict.required, ["a", "b"]);
  });

  it("spells optionality as null, and only for what was optional", () => {
    const strict = toStrictJsonSchema({
      type: "object",
      properties: { kept: { type: "string" }, loose: { type: "string" } },
      required: ["kept"],
    }) as { properties: Record<string, { type: unknown }> };

    assert.equal(strict.properties.kept.type, "string", "a required field keeps its type");
    assert.deepEqual(strict.properties.loose.type, ["string", "null"]);
  });

  it("lets an optional enum actually be null", () => {
    // Without this the transform legalises a value the enum then rejects.
    const strict = toStrictJsonSchema({
      type: "object",
      properties: { grade: { type: "string", enum: ["weak", "strong"] } },
      required: [],
    }) as { properties: { grade: { enum: unknown[] } } };

    assert.ok(strict.properties.grade.enum.includes(null));
  });

  it("reaches inside arrays of objects", () => {
    const strict = toStrictJsonSchema({
      type: "object",
      properties: {
        signs: {
          type: "array",
          items: { type: "object", properties: { text: { type: "string" }, fieldKey: { type: "string" } }, required: ["text"] },
        },
      },
      required: ["signs"],
    }) as { properties: { signs: { items: Record<string, unknown> } } };

    const items = strict.properties.signs.items as { additionalProperties: unknown; required: unknown[] };
    assert.equal(items.additionalProperties, false);
    assert.deepEqual(items.required, ["text", "fieldKey"]);
  });

  it("keeps an all-optional object usable — the therapeutic plan's modality map", () => {
    // Every modality is optional ON PURPOSE (PRD §10.9: never pad a plan).
    // Strict mode cannot omit, so each one must survive as an explicit null.
    const strict = toStrictJsonSchema({
      type: "object",
      properties: {
        modalities: {
          type: "object",
          properties: {
            acupuncture: { type: "object", properties: { objective: { type: "string" } } },
            cupping: { type: "object", properties: { region: { type: "string" } } },
          },
        },
      },
      required: ["modalities"],
    }) as { properties: { modalities: { required: unknown[]; properties: Record<string, { type: unknown }> } } };

    assert.deepEqual(strict.properties.modalities.required, ["acupuncture", "cupping"]);
    assert.deepEqual(strict.properties.modalities.properties.acupuncture.type, ["object", "null"]);
  });

  it("is idempotent — a converted schema converts to itself", () => {
    const once = toStrictJsonSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "array", items: { type: "string" } } },
      required: ["a"],
    });
    assert.deepEqual(toStrictJsonSchema(once), once);
  });

  it("leaves descriptions and other keywords alone", () => {
    const strict = toStrictJsonSchema({
      type: "object",
      description: "root",
      properties: { a: { type: "string", description: "keep me" } },
      required: ["a"],
    }) as { description: string; properties: { a: { description: string } } };

    assert.equal(strict.description, "root");
    assert.equal(strict.properties.a.description, "keep me");
  });
});

describe("strictSchemaViolations", () => {
  it("names an open object and a property missing from required", () => {
    const problems = strictSchemaViolations({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a"],
    });
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => p.includes("additionalProperties")));
    assert.ok(problems.some((p) => p.includes("b")));
  });

  it("finds nothing in a converted schema", () => {
    const strict = toStrictJsonSchema({
      type: "object",
      properties: {
        list: { type: "array", items: { type: "object", properties: { x: { type: "string" } } } },
      },
      required: [],
    });
    assert.deepEqual(strictSchemaViolations(strict), []);
  });
});
