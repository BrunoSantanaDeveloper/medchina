export type AiProviderName = "anthropic" | "gemini" | "openai" | "openrouter";

/**
 * The provider list, in one place, so the admin console and any validation
 * cannot drift from the type. Mirrors the `ai_provider` enum in the database
 * (migration 0002, extended by 0067).
 */
export const AI_PROVIDERS: readonly AiProviderName[] = ["anthropic", "gemini", "openai", "openrouter"] as const;

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
  /** Budget for the ANSWER. Reasoning tokens are counted separately below. */
  maxTokens: number;
  /**
   * Tokens a reasoning model may spend thinking BEFORE the answer. Providers
   * that charge thinking against the same output cap (Gemini 2.5+/3.x) add this
   * on top of `maxTokens`, so raising a caller's answer budget never has to
   * account for the model's private reasoning. Omitted: the provider's default.
   */
  reasoningBudget?: number;
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
