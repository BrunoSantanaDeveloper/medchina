import { GoogleGenAI } from "@google/genai";

import { StructuredOutputError, structuredFailureFromGemini } from "@flyee/ai/errors";
import {
  type AssistantConfig,
  type ChatMessage,
  type ChatProvider,
  type StructuredOutput,
  type UsageSink,
  reportUsage,
} from "@flyee/ai/types";

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

/**
 * Gemini reports the prompt as one total plus a per-modality breakdown, and
 * bills audio input at its own rate. Splitting them here is what lets the
 * ledger price a transcription differently from a chat turn.
 *
 * Thinking tokens are folded into output because that is how they are billed:
 * a reasoning model that spends 2.000 tokens thinking has spent output money,
 * whether or not the caller ever sees those tokens.
 */
function geminiUsage(
  metadata:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        promptTokensDetails?: { modality?: string; tokenCount?: number }[];
      }
    | undefined,
  model: string,
) {
  if (!metadata) return null;
  const audio = (metadata.promptTokensDetails ?? [])
    .filter((detail) => (detail.modality ?? "").toUpperCase() === "AUDIO")
    .reduce((total, detail) => total + (detail.tokenCount ?? 0), 0);
  const prompt = metadata.promptTokenCount ?? 0;
  return {
    tokensIn: Math.max(0, prompt - audio),
    tokensOut: (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
    audioTokensIn: audio,
    model,
  };
}

function geminiClient(config: AssistantConfig) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  // A caller running under a shared deadline (finalization, the insights
  // rounds) passes what is left of it instead of the 90 s default.
  const httpOptions = config.timeoutMs ? { ...HTTP_OPTIONS, timeout: config.timeoutMs } : HTTP_OPTIONS;
  return new GoogleGenAI({ apiKey: key, httpOptions });
}

/** Thinking tokens granted on top of the answer budget (0 where the model cannot think). */
function reasoningBudgetFor(config: AssistantConfig): number {
  return THINKING_CAPABLE.test(config.model) ? Math.max(0, config.reasoningBudget ?? DEFAULT_REASONING_BUDGET) : 0;
}

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

  async *streamChat(config: AssistantConfig, messages: ChatMessage[], onUsage?: UsageSink): AsyncGenerator<string> {
    const client = geminiClient(config);

    // The chat had no reasoning room either: on a thinking model the answer
    // shared its cap with the thinking, was cut mid-sentence when the thinking
    // ran long — and was then stored as if complete.
    const reasoningBudget = reasoningBudgetFor(config);
    const stream = await client.models.generateContentStream({
      model: config.model,
      contents: toGeminiContents(messages),
      config: {
        systemInstruction: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens + reasoningBudget,
        ...(reasoningBudget > 0 ? { thinkingConfig: { thinkingBudget: reasoningBudget } } : {}),
      },
    });

    // Every chunk carries the usage so far; the last one carries the total and
    // the reason the reply stopped.
    let usage: ReturnType<typeof geminiUsage> = null;
    let text = "";
    let finishReason: string | undefined;
    let blockReason: string | undefined;
    try {
      for await (const chunk of stream) {
        usage = geminiUsage(chunk.usageMetadata, config.model) ?? usage;
        finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
        blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
        const delta = chunk.text;
        if (delta) {
          text += delta;
          yield delta;
        }
      }
    } finally {
      // Also when the stream broke off or the caller stopped reading: what was
      // generated so far was billed.
      if (usage) reportUsage(onUsage, usage);
    }

    // Cut at MAX_TOKENS or stopped by a filter: the text that went out is not
    // an answer, and the caller must not store or meter it as one.
    const failure = structuredFailureFromGemini({
      text,
      candidates: [{ finishReason }],
      promptFeedback: { blockReason },
    });
    if (failure) throw new StructuredOutputError({ provider: "gemini", ...failure });
  }

  async generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
    onUsage?: UsageSink,
  ): Promise<unknown> {
    const client = geminiClient(config);

    // `maxTokens` is the budget for the ANSWER. Reasoning gets its own room on
    // top, because the API counts both against the same cap.
    const reasoningBudget = reasoningBudgetFor(config);

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

    // Reported before the failure checks below on purpose: a call cut at
    // MAX_TOKENS or stopped by a safety filter was still billed in full, and a
    // ledger that only counts successes understates the bill.
    const usage = geminiUsage(response.usageMetadata, config.model);
    if (usage) reportUsage(onUsage, usage);

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
