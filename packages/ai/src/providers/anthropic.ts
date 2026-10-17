import Anthropic from "@anthropic-ai/sdk";

import { StructuredOutputError } from "@flyee/ai/errors";
import { ANTHROPIC_SCHEMA_LIMITS, anthropicSchemaComplexity, toAnthropicJsonSchema } from "@flyee/ai/strict-schema";
import {
  type AiEffort,
  type AssistantConfig,
  type ChatAttachment,
  type ChatMessage,
  type ChatProvider,
  type ChatUsage,
  type StructuredOutput,
  type UsageSink,
  reportUsage,
} from "@flyee/ai/types";

/**
 * Claude on the first-party API, written against the request surface of the
 * 5.x models — which REJECT what the previous version of this file sent on
 * every call: `temperature` (a 400 on Opus 5.5, and on Sonnet/Haiku 5.5 for
 * anything but the default) and a forced `tool_choice` for structured output
 * (a 400 on Opus 5.5 and Sonnet 5.5).
 *
 * The per-model rules below name the LEGACY models, so an id this file has
 * never seen (the next generation) gets the current request shape instead of
 * a legacy one the new model would refuse.
 */

/** Legacy models that still take sampling parameters. Everything newer 400s on a non-default one. */
const SAMPLING_MODELS = /^claude-(3[-.]|(opus|sonnet)-4(-[0-6])?(-\d{8})?$|haiku-4-5(-\d{8})?$)/;
/** Legacy models without grammar-constrained JSON output (`output_config.format`). */
const NO_JSON_OUTPUT_MODELS = /^claude-(3[-.]|(opus|sonnet)-4(-0)?(-\d{8})?$)/;
/** Legacy models that reject `output_config.effort`. */
const NO_EFFORT_MODELS = /^claude-(3[-.]|(opus|sonnet)-4(-[01])?(-\d{8})?$|sonnet-4-5|haiku-4-5)/;
/** Every 3.x and 4.x model: none thinks unless asked, so none needs a thinking reserve. */
const LEGACY_MODELS = /^claude-(3[-.]|(opus|sonnet|haiku)-4)/;
/**
 * Models that still accept a FORCED tool call. Fable 5.1, Mythos 5.1, Opus 5.5
 * and Sonnet 5.5 reject it with a 400 — and so, by assumption, does anything
 * newer this file has not been told about.
 */
const FORCED_TOOL_MODELS = /^claude-(3[-.]|(opus|sonnet|haiku)-4|(opus|sonnet|fable)-5(-\d{8})?$|haiku-5-5)/;
/**
 * Models with a server-side refusal fallback (`fallbacks: "default"`): a request
 * a safety classifier declines is re-run on the model Anthropic recommends for
 * that category, in the same call. Haiku 5.5 has none.
 */
const FALLBACK_MODELS = /^claude-(fable-5|opus-5|sonnet-5-5)/;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Effort levels a model does not take, mapped to the nearest one it does. */
function effortFor(model: string, effort: AiEffort | undefined): AiEffort | undefined {
  if (!effort || NO_EFFORT_MODELS.test(model)) return undefined;
  if (/^claude-opus-4-5/.test(model) && (effort === "xhigh" || effort === "max")) return "high";
  if (/^claude-(opus|sonnet)-4-6/.test(model) && effort === "xhigh") return "high";
  return effort;
}

/**
 * Room for adaptive thinking ON TOP of the caller's answer budget — the same
 * contract the Gemini provider keeps with `reasoningBudget`. Thinking counts
 * against `max_tokens`, and deeper effort thinks longer; measured on the Gemini
 * side, a cap shared with thinking cut one hypotheses call in four mid-JSON.
 */
const THINKING_RESERVE: Record<AiEffort, number> = {
  low: 8_000,
  medium: 16_000,
  high: 32_000,
  xhigh: 64_000,
  max: 64_000,
};
/** What the API accepts as `max_tokens`: 128k on the 4.6+/5.x models, 64k on the older ones. */
const outputCap = (model: string) =>
  LEGACY_MODELS.test(model) && !/^claude-(opus|sonnet)-4-[6-8]/.test(model) ? 64_000 : 128_000;

/**
 * Default ceiling for a structured call, retries included. The clinical routes
 * run under maxDuration = 120: the previous 90 s per attempt × 2 attempts could
 * outlive the route, and the platform killing it leaves the caller a dead
 * connection instead of an error it can name. Chat streams get no total cap
 * unless the caller sets one — a long study answer is legitimately long.
 */
const DEFAULT_TIMEOUT_MS = 100_000;

/** Claude's limits: base64 images up to 10 MB each, requests up to 32 MB. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BASE64 = 10_000_000;
const MAX_PDF_BASE64 = 30_000_000;

type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

function attachmentBlock(attachment: ChatAttachment): ContentBlock | null {
  // Audio never reaches here: supportsAudio() is false and the routes refuse it.
  if (attachment.kind === "audio") return null;
  if (attachment.mime === "application/pdf") {
    if (attachment.dataBase64.length > MAX_PDF_BASE64)
      throw new Error("Claude does not accept PDFs larger than about 22 MB.");
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.dataBase64 } };
  }
  if (!IMAGE_TYPES.has(attachment.mime)) {
    // HEIC/HEIF and the rest are a 400 from the API; saying why beats that.
    throw new Error(`Claude does not accept ${attachment.mime} attachments (JPEG, PNG, GIF, WebP and PDF only).`);
  }
  if (attachment.dataBase64.length > MAX_IMAGE_BASE64)
    throw new Error("Claude does not accept images larger than 10 MB.");
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: attachment.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: attachment.dataBase64,
    },
  };
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  // A history window that starts on an assistant turn is not a conversation
  // the API takes; the turns before it were already cut by the caller.
  const firstUser = messages.findIndex((message) => message.role === "user");
  return messages.slice(Math.max(0, firstUser)).map((message) => ({
    role: message.role,
    content: [
      ...(message.attachments ?? []).map(attachmentBlock).filter((block): block is ContentBlock => block !== null),
      { type: "text" as const, text: message.content || "(no text)" },
    ],
  }));
}

/**
 * What a message cost, attempt by attempt. With a refusal fallback the
 * top-level usage covers only the attempt that answered; `iterations` is the
 * billed record of every attempt, each with its own model and price.
 */
function reportMessageUsage(onUsage: UsageSink | undefined, message: BetaMessage | undefined, requested: string) {
  const usage = message?.usage;
  if (!usage) return;
  const entries = (usage.iterations ?? []).filter(
    (entry): entry is Extract<typeof entry, { type: "message" | "fallback_message" }> =>
      entry.type === "message" || entry.type === "fallback_message",
  );
  const asChat = (entry: {
    input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    output_tokens?: number | null;
    model?: string | null;
  }): ChatUsage => ({
    tokensIn:
      (entry.input_tokens ?? 0) + (entry.cache_creation_input_tokens ?? 0) + (entry.cache_read_input_tokens ?? 0),
    tokensOut: entry.output_tokens ?? 0,
    model: entry.model ?? message?.model ?? requested,
  });
  if (entries.length > 1) {
    for (const entry of entries) reportUsage(onUsage, asChat(entry));
    return;
  }
  reportUsage(onUsage, asChat({ ...usage, model: message?.model }));
}

/** Why a finished message cannot be used as an answer, or null when it can. */
function stopFailure(message: BetaMessage): StructuredOutputError | null {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    return new StructuredOutputError({
      failure: "blocked",
      provider: "anthropic",
      finishReason: category ? `refusal:${category}` : "refusal",
    });
  }
  if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
    return new StructuredOutputError({
      failure: "truncated",
      provider: "anthropic",
      finishReason: message.stop_reason,
    });
  }
  return null;
}

/** The JSON object in a text reply, tolerating a sentence or a code fence around it. */
function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new SyntaxError("no JSON object in reply");
    return JSON.parse(text.slice(start, end + 1));
  }
}

export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic" as const;

  supportsAudio(): boolean {
    // The Anthropic API has no audio input; send audio through a
    // Gemini-backed assistant or add a transcription step.
    return false;
  }

  private client(timeout: number) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    // The SDK retries 408/409/429/5xx/529 by itself; the signal handed to each
    // request (when there is one) bounds the whole thing, retries included.
    return new Anthropic({ apiKey: key, timeout, maxRetries: 2 });
  }

  /** The request fields every call shares, with the per-model rules applied in ONE place. */
  private baseParams(config: AssistantConfig, messages: ChatMessage[], extraSystem?: string) {
    const effort = effortFor(config.model, config.effort);
    const reserve = LEGACY_MODELS.test(config.model)
      ? 0
      : Math.max(0, config.reasoningBudget ?? THINKING_RESERVE[effort ?? "high"]);
    return {
      model: config.model,
      max_tokens: Math.min(outputCap(config.model), config.maxTokens + reserve),
      system: extraSystem ? `${config.systemPrompt}\n\n${extraSystem}` : config.systemPrompt,
      messages: toAnthropicMessages(messages),
      ...(SAMPLING_MODELS.test(config.model) ? { temperature: config.temperature } : {}),
      ...(FALLBACK_MODELS.test(config.model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      ...(effort ? { output_config: { effort } } : {}),
    };
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[], onUsage?: UsageSink): AsyncGenerator<string> {
    const client = this.client(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const stream = client.beta.messages.stream(
      this.baseParams(config, messages),
      config.timeoutMs ? { signal: AbortSignal.timeout(config.timeoutMs) } : {},
    );

    let final: BetaMessage;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      final = await stream.finalMessage();
    } catch (error) {
      // Cut off mid-answer (deadline, network, client gone): what streamed so
      // far was still billed.
      reportMessageUsage(onUsage, stream.currentMessage, config.model);
      throw error;
    }

    // Usage only settles on the assembled message, and it is reported before
    // the stop check: a refused or truncated answer was billed all the same.
    reportMessageUsage(onUsage, final, config.model);
    // A refusal mid-stream or an answer cut at max_tokens is not a complete
    // reply — the caller must not store or meter it as one.
    const failure = stopFailure(final);
    if (failure) throw failure;
  }

  async generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
    onUsage?: UsageSink,
  ): Promise<unknown> {
    const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const client = this.client(timeout);
    const schema = toAnthropicJsonSchema(output.schema) as Record<string, unknown>;
    const complexity = anthropicSchemaComplexity(schema);
    const fitsGrammar =
      complexity.optional <= ANTHROPIC_SCHEMA_LIMITS.optional && complexity.unions <= ANTHROPIC_SCHEMA_LIMITS.unions;

    // How the JSON comes back, by what the model accepts:
    //  - grammar: `output_config.format`, schema-guaranteed (the 5.x default);
    //  - a forced tool call, where the grammar cannot be used and the model
    //    still accepts one (older models; the full-scope therapeutic plan
    //    declares more optional fields than the grammar compiler takes);
    //  - an OFFERED tool plus the instruction to use it, on models that refuse
    //    a forced one. Its input arrives as parsed JSON, which beats asking for
    //    JSON in prose. The domain keeps its shape either way: the caller
    //    already validates what comes back.
    const grammar = fitsGrammar && !NO_JSON_OUTPUT_MODELS.test(config.model);
    const forced = !grammar && FORCED_TOOL_MODELS.test(config.model);
    const offered = !grammar && !forced;
    const base = this.baseParams(
      config,
      messages,
      offered
        ? `Answer ONLY by calling the tool "${output.name}" exactly once, with the complete answer as its input.`
        : undefined,
    );
    const tool = {
      name: output.name,
      description: output.description ?? "Produce the answer in the required structured format.",
      input_schema: schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    };

    const stream = client.beta.messages.stream(
      {
        ...base,
        ...(grammar
          ? { output_config: { ...base.output_config, format: { type: "json_schema" as const, schema } } }
          : {}),
        ...(forced ? { tools: [tool], tool_choice: { type: "tool" as const, name: output.name } } : {}),
        ...(offered ? { tools: [tool], tool_choice: { type: "auto" as const } } : {}),
      },
      { signal: AbortSignal.timeout(timeout) },
    );
    let final: BetaMessage;
    try {
      final = await stream.finalMessage();
    } catch (error) {
      reportMessageUsage(onUsage, stream.currentMessage, config.model);
      throw error;
    }

    // Reported before the failure checks below: a call cut at max_tokens or
    // refused was still billed, and a ledger that counts only successes
    // understates the bill.
    reportMessageUsage(onUsage, final, config.model);
    const failure = stopFailure(final);
    if (failure) throw failure;

    const toolUse = final.content.find((block) => block.type === "tool_use" && block.name === output.name);
    if (toolUse && toolUse.type === "tool_use") return toolUse.input;
    if (forced) {
      throw new StructuredOutputError({
        failure: "empty",
        provider: "anthropic",
        finishReason: final.stop_reason ?? undefined,
      });
    }

    // Text blocks only: thinking and refusal-fallback blocks are not the answer.
    const text = final.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    if (!text) {
      throw new StructuredOutputError({
        failure: "empty",
        provider: "anthropic",
        finishReason: final.stop_reason ?? undefined,
      });
    }
    try {
      return grammar ? JSON.parse(text) : parseJsonText(text);
    } catch {
      // The reply is never quoted here: it is clinical content and this is logged.
      throw new StructuredOutputError({
        failure: "invalid_json",
        provider: "anthropic",
        finishReason: final.stop_reason ?? undefined,
        detail: `${text.length} characters returned`,
      });
    }
  }
}
