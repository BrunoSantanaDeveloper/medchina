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

/**
 * What one provider call consumed, as the provider itself reported it.
 *
 * Nothing here is derived or estimated: this is the only honest input to
 * "what did that cost?", and a caller that cannot get it should record the
 * call with no usage rather than guess (see `ai_spend.priced` in 0115).
 */
export interface ChatUsage {
  /** Text/image input tokens, EXCLUDING audio when the provider separates it. */
  tokensIn: number;
  /** Everything billed as output, reasoning tokens included. */
  tokensOut: number;
  /** Audio input tokens, when the provider prices them apart from text. */
  audioTokensIn?: number;
  /** The model that actually served the call — a fallback chain may differ. */
  model?: string;
}

/**
 * Called once per provider call, after the reply, with what it consumed.
 *
 * Optional everywhere on purpose: metering must never be able to fail a
 * clinical call. Providers invoke it in a try/catch; callers hand it to
 * `recordAiSpend`.
 */
export type UsageSink = (usage: ChatUsage) => void;

export interface ChatProvider {
  readonly name: AiProviderName;
  /** True when the given model can accept audio attachments. */
  supportsAudio(model: string): boolean;
  /** Streams the assistant reply as text deltas. */
  streamChat(config: AssistantConfig, messages: ChatMessage[], onUsage?: UsageSink): AsyncGenerator<string>;
  /** Returns the reply as a JSON object conforming to output.schema (not streamed). */
  generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
    onUsage?: UsageSink,
  ): Promise<unknown>;
}

/**
 * Hands usage to the sink without letting a metering bug reach the caller.
 * Every provider funnels through this for the same reason: the ledger is
 * bookkeeping, and bookkeeping does not get to break a consultation.
 */
export function reportUsage(onUsage: UsageSink | undefined, usage: ChatUsage): void {
  if (!onUsage) return;
  try {
    onUsage(usage);
  } catch {
    // Deliberately swallowed: see above.
  }
}
