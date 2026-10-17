import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { AnthropicProvider } from "./anthropic.ts";
import { isStructuredOutputError } from "../errors.ts";
import type { AssistantConfig, ChatMessage } from "../types.ts";

const config = (model: string, extra: Partial<AssistantConfig> = {}): AssistantConfig => ({
  provider: "anthropic",
  model,
  systemPrompt: "You are a test.",
  temperature: 0.2,
  maxTokens: 1024,
  ...extra,
});

const schema = {
  type: "object",
  properties: { padrao: { type: "string", minLength: 3 }, nota: { type: "string" } },
  required: ["padrao"],
};

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };

/** A streamed Messages API reply, as the SDK reads it off the wire. */
function sseReply(
  blocks: Block[],
  stopReason: string,
  stopDetails: unknown = null,
  usageExtra: Record<string, unknown> = {},
): Response {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 1 },
        },
      },
    ],
  ];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push([
        "content_block_start",
        { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      ]);
      events.push([
        "content_block_delta",
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
      ]);
    } else {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: "toolu_1", name: block.name, input: {} },
        },
      ]);
      events.push([
        "content_block_delta",
        {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        },
      ]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails },
      usage: { output_tokens: 22, ...usageExtra },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Runs a provider call against a canned reply and captures what it sent. */
async function capture(
  reply: () => Response,
  run: () => Promise<unknown>,
): Promise<{ body: Record<string, unknown>; beta: string | null; result: unknown; error: unknown }> {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  let beta: string | null = null;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    beta = new Headers(init?.headers).get("anthropic-beta");
    return reply();
  }) as typeof globalThis.fetch;
  let result: unknown;
  let error: unknown;
  try {
    result = await run();
  } catch (caught) {
    error = caught;
  } finally {
    globalThis.fetch = original;
  }
  return { body, beta, result, error };
}

const ask: ChatMessage[] = [{ role: "user", content: "oi" }];

describe("Anthropic provider", () => {
  const provider = new AnthropicProvider();
  let previousKey: string | undefined;

  before(() => {
    previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  after(() => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  });

  it("drops temperature on the 5.x models and keeps it on the ones that still take it", async () => {
    // A temperature on claude-opus-5-5 is a 400 — on every clinical call.
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
      const { body } = await capture(
        () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
        () => provider.generateStructured(config(model), ask, { name: "r", schema }),
      );
      assert.equal(body.temperature, undefined, model);
    }
    const { body } = await capture(
      () => sseReply([{ type: "tool_use", name: "r", input: { padrao: "x" } }], "tool_use"),
      () => provider.generateStructured(config("claude-sonnet-4-6"), ask, { name: "r", schema }),
    );
    assert.equal(body.temperature, 0.2);
  });

  it("asks the 5.x models for grammar-constrained JSON, never a forced tool", async () => {
    // A forced tool_choice is a 400 on claude-opus-5-5 and claude-sonnet-5-5.
    const { body, result } = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"Deficiência de Qi do Baço"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema }),
    );
    assert.equal(body.tool_choice, undefined);
    assert.equal(body.tools, undefined);
    const format = (body.output_config as { format: { type: string; schema: Record<string, unknown> } }).format;
    assert.equal(format.type, "json_schema");
    // Claude needs every object closed and takes no length constraints.
    assert.equal(format.schema.additionalProperties, false);
    assert.equal((format.schema.properties as Record<string, Record<string, unknown>>).padrao.minLength, undefined);
    assert.deepEqual(result, { padrao: "Deficiência de Qi do Baço" });
  });

  it("keeps a forced tool for models that predate structured outputs", async () => {
    const { body, result } = await capture(
      () => sseReply([{ type: "tool_use", name: "r", input: { padrao: "x" } }], "tool_use"),
      () => provider.generateStructured(config("claude-opus-4-0"), ask, { name: "r", schema }),
    );
    assert.deepEqual(body.tool_choice, { type: "tool", name: "r" });
    assert.equal(body.output_config, undefined);
    assert.deepEqual(result, { padrao: "x" });
  });

  it("gives a schema too complex for the grammar to a tool instead", async () => {
    // The full-scope therapeutic plan declares more optional fields than the
    // grammar compiler takes (24): sent as a format, it is a 400.
    const wide = {
      type: "object",
      properties: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, { type: "string" }])),
    };
    // Sonnet 5.5 refuses a FORCED tool: the tool is offered and the
    // instructions say to use it.
    const offered = await capture(
      () => sseReply([{ type: "tool_use", name: "r", input: { f0: "ok" } }], "tool_use"),
      () => provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema: wide }),
    );
    assert.equal((offered.body.output_config as { format?: unknown } | undefined)?.format, undefined);
    assert.deepEqual(offered.body.tool_choice, { type: "auto" });
    assert.match(String(offered.body.system), /calling the tool "r"/);
    assert.deepEqual(offered.result, { f0: "ok" });

    // Haiku 5.5 still takes a forced one.
    const forced = await capture(
      () => sseReply([{ type: "tool_use", name: "r", input: { f0: "ok" } }], "tool_use"),
      () => provider.generateStructured(config("claude-haiku-5-5"), ask, { name: "r", schema: wide }),
    );
    assert.deepEqual(forced.body.tool_choice, { type: "tool", name: "r" });

    // A model that answers in prose anyway still has its JSON read.
    const prose = await capture(
      () => sseReply([{ type: "text", text: 'Segue o plano:\n```json\n{"f0":"ok"}\n```' }], "end_turn"),
      () => provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema: wide }),
    );
    assert.deepEqual(prose.result, { f0: "ok" });
  });

  it("treats a model id it has never seen as current, not legacy", async () => {
    // The next generation must not get a forced tool or a temperature it would refuse.
    const { body } = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-opus-6"), ask, { name: "r", schema }),
    );
    assert.equal(body.temperature, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.equal((body.output_config as { format: { type: string } }).format.type, "json_schema");
  });

  it("reserves thinking room on top of the answer budget and sends effort where it is accepted", async () => {
    const thinking = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-opus-5-5", { effort: "low" }), ask, { name: "r", schema }),
    );
    assert.equal(thinking.body.max_tokens, 1024 + 8_000);
    assert.equal((thinking.body.output_config as { effort?: string }).effort, "low");

    const legacy = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-haiku-4-5", { effort: "low" }), ask, { name: "r", schema }),
    );
    // Haiku 4.5 rejects effort and does not think by default.
    assert.equal(legacy.body.max_tokens, 1024);
    assert.equal((legacy.body.output_config as { effort?: string } | undefined)?.effort, undefined);

    // No effort set: the room assumes the model's own (high) default.
    const unset = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema }),
    );
    assert.equal(unset.body.max_tokens, 1024 + 32_000);

    // A level the model does not take is mapped to one it does, not sent as a 400.
    const clamped = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-sonnet-4-6", { effort: "xhigh" }), ask, { name: "r", schema }),
    );
    assert.equal((clamped.body.output_config as { effort?: string }).effort, "high");
  });

  it("reports every billed attempt when a refusal fallback answered", async () => {
    const reported: unknown[] = [];
    await capture(
      () =>
        sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn", null, {
          iterations: [
            {
              type: "message",
              model: "claude-sonnet-5-5",
              input_tokens: 5000,
              output_tokens: 2400,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation: null,
            },
            {
              type: "fallback_message",
              model: "claude-opus-4-8",
              input_tokens: 5000,
              output_tokens: 300,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation: null,
            },
          ],
        }),
      () =>
        provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema }, (usage) => {
          reported.push(usage);
        }),
    );
    assert.deepEqual(reported, [
      { tokensIn: 5000, tokensOut: 2400, model: "claude-sonnet-5-5" },
      { tokensIn: 5000, tokensOut: 300, model: "claude-opus-4-8" },
    ]);
  });

  it("opts into the server-side refusal fallback where one exists", async () => {
    const sonnet = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema }),
    );
    assert.equal(sonnet.body.fallbacks, "default");
    assert.match(String(sonnet.beta), /server-side-fallback-2026-07-01/);

    // Haiku 5.5 has no server-side fallback: the parameter is not sent.
    const haiku = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () => provider.generateStructured(config("claude-haiku-5-5"), ask, { name: "r", schema }),
    );
    assert.equal(haiku.body.fallbacks, undefined);
  });

  it("names a refusal and an answer cut at max_tokens instead of returning them", async () => {
    const refused = await capture(
      () => sseReply([], "refusal", { type: "refusal", category: "bio", explanation: null }),
      () => provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema }),
    );
    assert.ok(isStructuredOutputError(refused.error));
    assert.equal((refused.error as { failure: string }).failure, "blocked");

    const cut = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"Defici' }], "max_tokens"),
      () => provider.generateStructured(config("claude-sonnet-5-5"), ask, { name: "r", schema }),
    );
    assert.equal((cut.error as { failure: string }).failure, "truncated");
  });

  it("fails a chat stream that ended in a refusal, after reporting what it cost", async () => {
    let usage: unknown = null;
    const { error } = await capture(
      () => sseReply([{ type: "text", text: "Começo de resposta" }], "refusal"),
      async () => {
        let text = "";
        for await (const delta of provider.streamChat(config("claude-sonnet-5-5"), ask, (reported) => {
          usage = reported;
        })) {
          text += delta;
        }
        return text;
      },
    );
    assert.ok(isStructuredOutputError(error));
    assert.deepEqual(usage, { tokensIn: 11, tokensOut: 22, model: "claude-test" });
  });

  it("sends a PDF as a document, refuses HEIC with a reason, and never starts on an assistant turn", async () => {
    const { body } = await capture(
      () => sseReply([{ type: "text", text: '{"padrao":"x"}' }], "end_turn"),
      () =>
        provider.generateStructured(
          config("claude-sonnet-5-5"),
          [
            { role: "assistant", content: "turno cortado da janela" },
            {
              role: "user",
              content: "laudo",
              attachments: [{ kind: "image", mime: "application/pdf", dataBase64: "JVBERi0=" }],
            },
          ],
          { name: "r", schema },
        ),
    );
    const messages = body.messages as { role: string; content: { type: string }[] }[];
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[0].content[0].type, "document");

    const heic = await capture(
      () => sseReply([], "end_turn"),
      () =>
        provider.generateStructured(
          config("claude-sonnet-5-5"),
          [{ role: "user", content: "foto", attachments: [{ kind: "image", mime: "image/heic", dataBase64: "AAAA" }] }],
          { name: "r", schema },
        ),
    );
    assert.match(String((heic.error as Error).message), /image\/heic/);
  });
});
