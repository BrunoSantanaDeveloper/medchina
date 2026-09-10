import { GoogleGenAI } from "@google/genai";

import { StructuredOutputError, structuredFailureFromGemini } from "@flyee/ai/errors";
import type { AssistantConfig, ChatMessage, ChatProvider, StructuredOutput } from "../types";

/**
 * Reasoning tokens a structured call may spend BEFORE the answer.
 *
 * On Gemini 2.5+/3.x `maxOutputTokens` covers the thinking tokens too, and this
 * provider used to set no `thinkingConfig` at all: the model spent 1.900–3.700
 * tokens reasoning inside a 4.096 cap, hit MAX_TOKENS mid-JSON, and the caller
 * saw invalid JSON. Measured on the real schemas: hypotheses failed about one
 * call in four (the "works on the third try" report) and the 1.024-token
 * summary failed on every realistic chart. With this budget reserved ON TOP of
 * the caller's answer budget, four of four succeeded for both.
 */
const DEFAULT_REASONING_BUDGET = 2048;

/** Older models reject `thinkingConfig`, so only ask for it where it exists. */
const THINKING_CAPABLE = /gemini-(?:2\.5|[3-9])/i;

/**
 * Bounded deadline + the SDK's built-in retry on transient statuses (408/429/
 * 5xx). Without these each call is one bare fetch: a "model overloaded" 503
 * fails the request outright, and a hung connection blocks until the platform
 * kills the function.
 */
// 90s, not 120: several callers run under routes capped at maxDuration = 120,
// and a 120s provider timeout guarantees the PLATFORM kills the route before
// the provider gives up — the caller then sees a dead connection instead of an
// error it can name. The SDK arms this timer once per request; retries share it.
const HTTP_OPTIONS = { timeout: 90_000, retryOptions: { attempts: 3 } };

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      ...(message.attachments ?? []).map((attachment) => ({
        inlineData: { mimeType: attachment.mime, data: attachment.dataBase64 },
      })),
      { text: message.content || "(no text)" },
    ],
  }));
}

export class GeminiProvider implements ChatProvider {
  readonly name = "gemini" as const;

  supportsAudio(): boolean {
    // Gemini models accept audio natively (inlineData).
    return true;
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const client = new GoogleGenAI({ apiKey: key, httpOptions: HTTP_OPTIONS });

    const contents = toGeminiContents(messages);

    const stream = await client.models.generateContentStream({
      model: config.model,
      contents,
      config: {
        systemInstruction: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }

  async generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
  ): Promise<unknown> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const client = new GoogleGenAI({ apiKey: key, httpOptions: HTTP_OPTIONS });

    // `maxTokens` is the budget for the ANSWER. Reasoning gets its own room on
    // top, because the API counts both against the same cap.
    const reasoningBudget = THINKING_CAPABLE.test(config.model)
      ? Math.max(0, config.reasoningBudget ?? DEFAULT_REASONING_BUDGET)
      : 0;

    const response = await client.models.generateContent({
      model: config.model,
      contents: toGeminiContents(messages),
      config: {
        systemInstruction: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens + reasoningBudget,
        ...(reasoningBudget > 0 ? { thinkingConfig: { thinkingBudget: reasoningBudget } } : {}),
        responseMimeType: "application/json",
        // Raw JSON Schema (Gemini 2.5+); older models need the OpenAPI subset.
        responseJsonSchema: output.schema,
      },
    });

    // Ask WHY it stopped before trying to read it: a reply cut at MAX_TOKENS is
    // a budget problem the caller can name, not "invalid JSON".
    const failure = structuredFailureFromGemini({
      text: response.text,
      candidates: response.candidates,
      promptFeedback: response.promptFeedback,
    });
    if (failure) throw new StructuredOutputError({ provider: "gemini", ...failure });

    const text = response.text as string;
    try {
      return JSON.parse(text);
    } catch {
      // The model's text is NOT put in the message: it is the patient's record,
      // and this error is logged.
      throw new StructuredOutputError({
        failure: "invalid_json",
        provider: "gemini",
        finishReason: response.candidates?.[0]?.finishReason,
        detail: `${text.length} characters returned`,
      });
    }
  }
}
