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

/**
 * Schema-constrained output: the reply is a JSON object validated against
 * `schema` by the provider, not free text. This is how derived projects
 * enforce mandatory answer formats (e.g. diagnosis/evidence/action reports).
 */
export interface StructuredOutput {
  /** Identifier ([a-zA-Z0-9_-]) used as the tool/schema name. */
  name: string;
  description?: string;
  /** JSON Schema for the reply object (type: "object" at the root). */
  schema: Record<string, unknown>;
}

export interface ChatProvider {
  readonly name: AiProviderName;
  /** True when the given model can accept audio attachments. */
  supportsAudio(model: string): boolean;
  /** Streams the assistant reply as text deltas. */
  streamChat(config: AssistantConfig, messages: ChatMessage[]): AsyncGenerator<string>;
  /** Returns the reply as a JSON object conforming to output.schema (not streamed). */
  generateStructured(config: AssistantConfig, messages: ChatMessage[], output: StructuredOutput): Promise<unknown>;
}
