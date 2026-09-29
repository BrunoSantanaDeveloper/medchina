import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { OpenAiProvider } from "./openai.ts";
import { strictSchemaViolations } from "../strict-schema.ts";
import type { AssistantConfig } from "../types.ts";

const config = (model: string): AssistantConfig => ({
  provider: "openai",
  model,
  systemPrompt: "You are a test.",
  temperature: 0.4,
  maxTokens: 1024,
});

/** Captures the request body the provider would send, without a network call. */
async function captureRequest(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const original = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? "{}"));
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
      text: async () => "",
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return captured;
}

describe("OpenAI provider", () => {
  const provider = new OpenAiProvider();
  let previousKey: string | undefined;

  before(() => {
    previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
  });
  after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });

  it("declares audio support only for models that actually accept it", () => {
    assert.equal(provider.supportsAudio("gpt-4o-audio-preview"), true);
    assert.equal(provider.supportsAudio("gpt-audio"), true);
    // Claiming audio on a text-only model would send a request that 400s with
    // the patient's consultation already uploaded.
    assert.equal(provider.supportsAudio("gpt-4o"), false);
    assert.equal(provider.supportsAudio("o4-mini"), false);
  });

  it("sends temperature and max_tokens on the standard chat models", async () => {
    const body = await captureRequest(() =>
      provider.generateStructured(config("gpt-4o"), [{ role: "user", content: "oi" }], {
        name: "reply",
        schema: { type: "object" },
      }),
    );

    assert.equal(body.temperature, 0.4);
    assert.equal(body.max_tokens, 1024);
    assert.equal(body.max_completion_tokens, undefined);
  });

  it("switches to max_completion_tokens and drops temperature on reasoning models", async () => {
    // The o-series and gpt-5 REJECT both `temperature` and `max_tokens` with a
    // 400 — the wrong parameter name is a failed request, not a warning.
    for (const model of ["o4-mini", "o3", "gpt-5"]) {
      const body = await captureRequest(() =>
        provider.generateStructured(config(model), [{ role: "user", content: "oi" }], {
          name: "reply",
          schema: { type: "object" },
        }),
      );
      assert.equal(body.max_completion_tokens, 1024, `${model} should send max_completion_tokens`);
      assert.equal(body.max_tokens, undefined, `${model} must not send max_tokens`);
      assert.equal(body.temperature, undefined, `${model} must not send temperature`);
    }
  });

  it("asks for a strict JSON schema when structured output is requested", async () => {
    const body = await captureRequest(() =>
      provider.generateStructured(config("gpt-4o"), [{ role: "user", content: "oi" }], {
        name: "hypotheses",
        schema: { type: "object", properties: { a: { type: "string" } } },
      }),
    );

    const format = body.response_format as { type?: string; json_schema?: { name?: string; strict?: boolean } };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema?.name, "hypotheses");
    assert.equal(format.json_schema?.strict, true);
  });

  it("converts the schema on the way out, so an optional field is not a 400", async () => {
    // The domain schemas mark a field optional by leaving it out of `required`.
    // Strict mode has no absent field, so the provider translates: everything is
    // listed, objects close, and what was optional becomes nullable. Sending
    // them as written fails every clinical call with a 400.
    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        cupping: { type: "object", properties: { region: { type: "string" } } },
      },
      required: ["summary"],
    } as Record<string, any>;

    const body = await captureRequest(() =>
      provider.generateStructured(config("gpt-4o"), [{ role: "user", content: "oi" }], {
        name: "plan",
        schema,
      }),
    );

    const sent = (body.response_format as { json_schema: { schema: Record<string, any> } }).json_schema.schema;
    assert.equal(sent.additionalProperties, false);
    assert.deepEqual(sent.required, ["summary", "cupping"]);
    assert.equal(sent.properties.summary.type, "string");
    assert.deepEqual(sent.properties.cupping.type, ["object", "null"]);
    assert.equal(sent.properties.cupping.additionalProperties, false);
    assert.deepEqual(strictSchemaViolations(sent), []);
    // The domain schema is a module-level constant shared with the Gemini
    // provider: mutating it here would quietly rewrite the other provider too.
    assert.deepEqual(schema.required, ["summary"]);
    assert.equal(schema.additionalProperties, undefined);
  });

  it("maps audio attachments to the format the API names", async () => {
    const body = await captureRequest(() =>
      provider.generateStructured(
        config("gpt-4o-audio-preview"),
        [
          {
            role: "user",
            content: "transcreva",
            attachments: [{ kind: "audio", mime: "audio/webm;codecs=opus", dataBase64: "AAA" }],
          },
        ],
        { name: "reply", schema: { type: "object" } },
      ),
    );

    const messages = body.messages as { role: string; content: { type: string; input_audio?: { format?: string } }[] }[];
    const audioPart = messages[1].content.find((part) => part.type === "input_audio");
    // The codec suffix must not leak into the format field.
    assert.equal(audioPart?.input_audio?.format, "webm");
  });

  it("surfaces a model refusal as such, not as an empty reply", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ choices: [{ message: { refusal: "I cannot help with that." } }] }),
        text: async () => "",
      }) as unknown as Response) as typeof globalThis.fetch;
    try {
      await assert.rejects(
        () =>
          provider.generateStructured(config("gpt-4o"), [{ role: "user", content: "x" }], {
            name: "reply",
            schema: { type: "object" },
          }),
        (error: unknown) => {
          // The refusal is carried as a TAG, not as prose: the caller branches on
          // `failure` (blocked is not retryable), and the model's own words are
          // kept out of a message that ends up in the server log.
          const failure = error as { name?: string; failure?: string };
          assert.equal(failure.name, "StructuredOutputError");
          assert.equal(failure.failure, "blocked");
          assert.ok(!String((error as Error).message).includes("I cannot help"));
          return true;
        },
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("fails clearly when the key is absent instead of calling the API", async () => {
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(
      () =>
        provider.generateStructured(config("gpt-4o"), [{ role: "user", content: "x" }], {
          name: "reply",
          schema: { type: "object" },
        }),
      /OPENAI_API_KEY/,
    );
    process.env.OPENAI_API_KEY = "test-key";
  });
});
