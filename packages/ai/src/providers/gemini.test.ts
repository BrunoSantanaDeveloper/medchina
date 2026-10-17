import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { GeminiProvider } from "./gemini.ts";
import { isStructuredOutputError } from "../errors.ts";
import type { AssistantConfig, ChatMessage, ChatUsage } from "../types.ts";

const config = (model: string, extra: Partial<AssistantConfig> = {}): AssistantConfig => ({
  provider: "gemini",
  model,
  systemPrompt: "You are a test.",
  temperature: 0.2,
  maxTokens: 1024,
  ...extra,
});

type Chunk = { text?: string; finishReason?: string; blockReason?: string };

/** A streamGenerateContent reply (alt=sse), as the SDK reads it off the wire. */
function sseChunks(chunks: Chunk[]): Response {
  const body = chunks
    .map((chunk, index) => {
      const data = {
        candidates: [
          {
            content: { role: "model", parts: chunk.text ? [{ text: chunk.text }] : [] },
            ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
            index: 0,
          },
        ],
        ...(chunk.blockReason ? { promptFeedback: { blockReason: chunk.blockReason } } : {}),
        // Cumulative, as Gemini reports it: the last chunk carries the total.
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 * (index + 1), thoughtsTokenCount: 300 },
      };
      return `data: ${JSON.stringify(data)}\n\n`;
    })
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Streams a reply through the provider and captures what it sent, yielded and billed. */
async function stream(
  chunks: Chunk[],
  assistant: AssistantConfig,
): Promise<{ body: Record<string, unknown>; text: string; usage: ChatUsage[]; error: unknown }> {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    return sseChunks(chunks);
  }) as typeof globalThis.fetch;
  const usage: ChatUsage[] = [];
  let text = "";
  let error: unknown;
  try {
    for await (const delta of new GeminiProvider().streamChat(assistant, ask, (reported) => usage.push(reported))) {
      text += delta;
    }
  } catch (caught) {
    error = caught;
  } finally {
    globalThis.fetch = original;
  }
  return { body, text, usage, error };
}

const ask: ChatMessage[] = [{ role: "user", content: "oi" }];

describe("Gemini provider — chat stream", () => {
  let previousKey: string | undefined;

  before(() => {
    previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
  });
  after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });

  it("gives a thinking model its reasoning room on top of the answer budget", async () => {
    // Without it the thinking ate the answer's cap and the reply was cut.
    const { body, error } = await stream([{ text: "Resposta.", finishReason: "STOP" }], config("gemini-3.6-flash"));
    assert.equal(error, undefined);
    const generation = body.generationConfig as Record<string, unknown>;
    assert.equal(generation.maxOutputTokens, 1024 + 2048);
    assert.deepEqual(generation.thinkingConfig, { thinkingBudget: 2048 });

    const legacy = await stream([{ text: "Resposta.", finishReason: "STOP" }], config("gemini-2.0-flash"));
    const legacyGeneration = legacy.body.generationConfig as Record<string, unknown>;
    assert.equal(legacyGeneration.maxOutputTokens, 1024);
    assert.equal(legacyGeneration.thinkingConfig, undefined);
  });

  it("finishes a complete reply quietly and bills it once, thinking included", async () => {
    const { text, usage, error } = await stream(
      [{ text: "Primeira parte, " }, { text: "segunda parte.", finishReason: "STOP" }],
      config("gemini-3.6-flash"),
    );
    assert.equal(error, undefined);
    assert.equal(text, "Primeira parte, segunda parte.");
    assert.equal(usage.length, 1);
    assert.equal(usage[0].tokensIn, 10);
    assert.equal(usage[0].tokensOut, 10 + 300);
  });

  it("refuses to pass a reply cut at MAX_TOKENS off as an answer, but still bills it", async () => {
    const { text, usage, error } = await stream(
      [{ text: "Uma resposta que " }, { text: "parou no meio", finishReason: "MAX_TOKENS" }],
      config("gemini-3.6-flash"),
    );
    assert.equal(text, "Uma resposta que parou no meio");
    assert.ok(isStructuredOutputError(error));
    assert.equal(error.failure, "truncated");
    assert.equal(usage.length, 1);
  });

  it("names a filtered reply as blocked, from the finish reason or the prompt feedback", async () => {
    const filtered = await stream([{ text: "Parcial", finishReason: "SAFETY" }], config("gemini-3.6-flash"));
    assert.ok(isStructuredOutputError(filtered.error));
    assert.equal(filtered.error.failure, "blocked");

    const prompt = await stream([{ blockReason: "PROHIBITED_CONTENT" }], config("gemini-3.6-flash"));
    assert.ok(isStructuredOutputError(prompt.error));
    assert.equal(prompt.error.failure, "blocked");
    assert.equal(prompt.error.finishReason, "PROHIBITED_CONTENT");
  });
});
