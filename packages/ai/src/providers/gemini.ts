import { GoogleGenAI } from "@google/genai";

import type { AssistantConfig, ChatMessage, ChatProvider } from "../types";

export class GeminiProvider implements ChatProvider {
  readonly name = "gemini" as const;

  supportsAudio(): boolean {
    // Gemini models accept audio natively (inlineData).
    return true;
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const client = new GoogleGenAI({ apiKey: key });

    const contents = messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        ...(message.attachments ?? []).map((attachment) => ({
          inlineData: { mimeType: attachment.mime, data: attachment.dataBase64 },
        })),
        { text: message.content || "(no text)" },
      ],
    }));

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
}
