export type AiProviderName = "anthropic" | "gemini" | "openrouter";

export interface ChatAttachment {
  kind: "image" | "audio";
  mime: string;
  /** Raw content, base64-encoded (no data: prefix). */
  dataBase64: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

/** Runtime configuration resolved from the assistants table. */
export interface AssistantConfig {
  provider: AiProviderName;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatProvider {
  readonly name: AiProviderName;
  /** True when the given model can accept audio attachments. */
  supportsAudio(model: string): boolean;
  /** Streams the assistant reply as text deltas. */
  streamChat(config: AssistantConfig, messages: ChatMessage[]): AsyncGenerator<string>;
}
