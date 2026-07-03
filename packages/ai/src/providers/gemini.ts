import { GoogleGenAI } from "@google/genai";

import type { AssistantConfig, ChatMessage, ChatProvider, StructuredOutput } from "../types";

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
    const client = new GoogleGenAI({ apiKey: key });

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
    const client = new GoogleGenAI({ apiKey: key });

    const response = await client.models.generateContent({
      model: config.model,
      contents: toGeminiContents(messages),
      config: {
        systemInstruction: config.systemPrompt,
        temperature: config.temperature,
        maxOutputTokens: config.maxTokens,
        responseMimeType: "application/json",
        // Raw JSON Schema (Gemini 2.5+); older models need the OpenAPI subset.
        responseJsonSchema: output.schema,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Gemini returned no structured output.");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }
}
