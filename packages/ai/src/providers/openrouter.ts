import { StructuredOutputError } from "@flyee/ai/errors";
import {
  type AssistantConfig,
  type ChatMessage,
  type ChatProvider,
  type ChatUsage,
  type StructuredOutput,
  type UsageSink,
  reportUsage,
} from "@flyee/ai/types";

function toOpenRouterMessages(config: AssistantConfig, messages: ChatMessage[]) {
  return [
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
                input_audio: {
                  data: attachment.dataBase64,
                  format: attachment.mime.includes("wav") ? "wav" : "mp3",
                },
              },
        ),
        { type: "text" as const, text: message.content || "(no text)" },
      ],
    })),
  ];
}

/**
 * OpenRouter exposes many models behind an OpenAI-compatible API; the
 * assistant's `model` field selects which one (e.g. "openai/gpt-4o",
 * "google/gemini-2.5-pro"). Capabilities vary per model — image input is
 * widely supported, audio only on specific models, so audio attachments
 * are attempted and any provider rejection is surfaced to the caller.
 */
export class OpenRouterProvider implements ChatProvider {
  readonly name = "openrouter" as const;

  supportsAudio(): boolean {
    return true;
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[], onUsage?: UsageSink): AsyncGenerator<string> {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY is not set");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      // A bare fetch has NO timeout: a hung provider held the serverless
      // invocation open until the platform killed it mid-flight.
      signal: AbortSignal.timeout(90_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        // Without this the stream ends with no usage at all and the call
        // lands in the ledger as an unpriceable zero.
        stream_options: { include_usage: true },
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: toOpenRouterMessages(config, messages),
      }),
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: ChatUsage | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
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
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY is not set");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      // A bare fetch has NO timeout: a hung provider held the serverless
      // invocation open until the platform killed it mid-flight.
      signal: AbortSignal.timeout(90_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: toOpenRouterMessages(config, messages),
        // Model support varies; unsupported models fail with a clear provider error.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: output.name,
            strict: true,
            schema: output.schema,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
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
    const content = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason ?? undefined;
    if (data.choices?.[0]?.message?.refusal || finishReason === "content_filter") {
      throw new StructuredOutputError({ failure: "blocked", provider: "openrouter", finishReason });
    }
    if (finishReason === "length") {
      throw new StructuredOutputError({ failure: "truncated", provider: "openrouter", finishReason });
    }
    if (!content) throw new StructuredOutputError({ failure: "empty", provider: "openrouter", finishReason });
    try {
      return JSON.parse(content);
    } catch {
      // Never quote the reply: it is clinical content and this is logged.
      throw new StructuredOutputError({
        failure: "invalid_json",
        provider: "openrouter",
        finishReason,
        detail: `${content.length} characters returned`,
      });
    }
  }
}
