import { AiConfigurationError, StructuredOutputError } from "@flyee/ai/errors";
import { toStrictJsonSchema } from "@flyee/ai/strict-schema";
import {
  type AssistantConfig,
  type ChatMessage,
  type ChatProvider,
  type ChatUsage,
  type StructuredOutput,
  type UsageSink,
  reportUsage,
} from "@flyee/ai/types";

/** Models that accept audio parts on the chat-completions API. */
const AUDIO_MODEL_PATTERN = /audio-preview|gpt-4o-audio|gpt-audio/i;

/**
 * Models whose sampling parameters are fixed by the API. The reasoning family
 * (o1/o3/o4, gpt-5) rejects `temperature` and takes `max_completion_tokens`
 * instead of `max_tokens` — sending the wrong one is a 400, not a warning.
 */
const REASONING_MODEL_PATTERN = /^(o\d|gpt-5)/i;

const AUDIO_FORMATS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "opus",
};

const audioFormat = (mime: string) => AUDIO_FORMATS[mime.split(";")[0].trim().toLowerCase()] ?? "mp3";

function toOpenAiMessages(config: AssistantConfig, messages: ChatMessage[]) {
  return [
    // Reasoning models call it "developer", but they still accept "system" as
    // an alias — one shape keeps this readable across both families.
    { role: "system" as const, content: config.systemPrompt },
    ...messages.map((message) => ({
      role: message.role,
      content: [
        ...(message.attachments ?? []).map((attachment) =>
          attachment.kind === "image"
            ? {
                type: "image_url" as const,
                image_url: { url: `data:${attachment.mime};base64,${attachment.dataBase64}` },
              }
            : {
                type: "input_audio" as const,
                input_audio: { data: attachment.dataBase64, format: audioFormat(attachment.mime) },
              },
        ),
        { type: "text" as const, text: message.content || "(no text)" },
      ],
    })),
  ];
}

/**
 * OpenAI, direct (not through OpenRouter).
 *
 * Kept separate from the OpenRouter provider even though both speak the
 * chat-completions dialect: the model ids differ ("gpt-4o" vs "openai/gpt-4o"),
 * the keys are different accounts, and only here do the reasoning-family
 * parameter rules apply. Merging them would mean one provider guessing which
 * account and which parameter set an assistant meant.
 *
 * `OPENAI_BASE_URL` is honoured so an Azure/proxy deployment that speaks the
 * same API can be pointed at without a code change.
 */
export class OpenAiProvider implements ChatProvider {
  readonly name = "openai" as const;

  supportsAudio(model: string): boolean {
    return AUDIO_MODEL_PATTERN.test(model);
  }

  private endpoint(): { url: string; key: string } {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new AiConfigurationError("OPENAI_API_KEY is not set");
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    return { url: `${base}/chat/completions`, key };
  }

  /**
   * Body shared by both calls, with the reasoning-family differences applied
   * in ONE place — the parameter names are the thing most likely to drift.
   */
  private baseBody(config: AssistantConfig, messages: ChatMessage[]): Record<string, unknown> {
    const reasoning = REASONING_MODEL_PATTERN.test(config.model);
    return {
      model: config.model,
      messages: toOpenAiMessages(config, messages),
      ...(reasoning
        ? { max_completion_tokens: config.maxTokens }
        : { max_tokens: config.maxTokens, temperature: config.temperature }),
    };
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[], onUsage?: UsageSink): AsyncGenerator<string> {
    const { url, key } = this.endpoint();

    const response = await fetch(url, {
      // A bare fetch has NO timeout: a hung provider held the serverless
      // invocation open until the platform killed it mid-flight.
      signal: AbortSignal.timeout(90_000),
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // Without stream_options the stream ends with no usage at all and
      // the call lands in the ledger as an unpriceable zero.
      body: JSON.stringify({
        ...this.baseBody(config, messages),
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${body}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: ChatUsage | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // The last piece may be half an event; keep it for the next chunk.
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          if (usage) reportUsage(onUsage, usage);
          return;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            model?: string;
          };
          // The usage chunk has no choices: it is the last thing the stream
          // sends before [DONE], and it is the only place a cost can come from.
          if (parsed.usage) {
            usage = {
              tokensIn: parsed.usage.prompt_tokens ?? 0,
              tokensOut: parsed.usage.completion_tokens ?? 0,
              model: parsed.model ?? config.model,
            };
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Partial/keep-alive line — skip.
        }
      }
    }
  }

  async generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
    onUsage?: UsageSink,
  ): Promise<unknown> {
    const { url, key } = this.endpoint();

    const response = await fetch(url, {
      // A bare fetch has NO timeout: a hung provider held the serverless
      // invocation open until the platform killed it mid-flight.
      signal: AbortSignal.timeout(90_000),
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...this.baseBody(config, messages),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: output.name,
            description: output.description,
            strict: true,
            // Translated, not written this way at the source: the domain
            // schemas mark a field optional by leaving it out of `required`,
            // and strict mode has no absent field — only an explicit null.
            // Sending them unconverted is a 400 on every clinical call.
            schema: toStrictJsonSchema(output.schema),
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string; refusal?: string | null }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    // Before the failure checks below: a refused or truncated answer was
    // billed like any other.
    if (data.usage) {
      reportUsage(onUsage, {
        tokensIn: data.usage.prompt_tokens ?? 0,
        tokensOut: data.usage.completion_tokens ?? 0,
        model: data.model ?? config.model,
      });
    }
    const choice = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason ?? undefined;
    // A refusal is a deliberate model decision, not a malformed reply: saying
    // so beats "returned no structured output" when a clinical prompt trips a
    // safety rule.
    if (choice?.refusal || finishReason === "content_filter") {
      throw new StructuredOutputError({ failure: "blocked", provider: "openai", finishReason });
    }
    // An answer cut at the token cap is incomplete JSON — a budget problem the
    // caller can name instead of reporting a malformed model.
    if (finishReason === "length") {
      throw new StructuredOutputError({ failure: "truncated", provider: "openai", finishReason });
    }
    const content = choice?.content;
    if (!content) throw new StructuredOutputError({ failure: "empty", provider: "openai", finishReason });
    try {
      return JSON.parse(content);
    } catch {
      // The reply is never quoted here: it is clinical content and this is logged.
      throw new StructuredOutputError({
        failure: "invalid_json",
        provider: "openai",
        finishReason,
        detail: `${content.length} characters returned`,
      });
    }
  }
}
