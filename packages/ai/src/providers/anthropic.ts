import Anthropic from "@anthropic-ai/sdk";

import type { AssistantConfig, ChatMessage, ChatProvider, StructuredOutput } from "../types";

function toAnthropicMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
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
  }));
}

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
      messages: toAnthropicMessages(messages),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }

  async generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
  ): Promise<unknown> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    const client = new Anthropic({ apiKey: key });

    // Forced tool use: the reply IS the tool input, validated against the schema.
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: config.systemPrompt,
      messages: toAnthropicMessages(messages),
      tools: [
        {
          name: output.name,
          description: output.description ?? "Produce the answer in the required structured format.",
          input_schema: output.schema as Anthropic.Tool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: output.name },
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Anthropic returned no structured output.");
    }
    return toolUse.input;
  }
}
