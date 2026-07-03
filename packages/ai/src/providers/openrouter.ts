import type { AssistantConfig, ChatMessage, ChatProvider } from "../types";

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

  async *streamChat(config: AssistantConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY is not set");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          { role: "system", content: config.systemPrompt },
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
        ],
      }),
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Partial/keep-alive line — skip.
        }
      }
    }
  }
}
