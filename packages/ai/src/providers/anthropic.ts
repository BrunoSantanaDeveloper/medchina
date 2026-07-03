import Anthropic from "@anthropic-ai/sdk";

import type { AssistantConfig, ChatMessage, ChatProvider } from "../types";

export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic" as const;

  supportsAudio(): boolean {
    // The Anthropic API has no audio input; send audio through a
    // Gemini-backed assistant or add a transcription step.
    return false;
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    const client = new Anthropic({ apiKey: key });

    const stream = client.messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: config.systemPrompt,
      messages: messages.map((message) => ({
        role: message.role,
        content: [
          ...(message.attachments ?? [])
            .filter((attachment) => attachment.kind === "image")
            .map((attachment) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: attachment.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: attachment.dataBase64,
              },
            })),
          { type: "text" as const, text: message.content || "(no text)" },
        ],
      })),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
