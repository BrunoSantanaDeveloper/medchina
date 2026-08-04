import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { OpenAiProvider } from "./providers/openai";
import { OpenRouterProvider } from "./providers/openrouter";
import { type AiProviderName, AI_PROVIDERS, type ChatProvider } from "./types";

export * from "./types";

export const isAnthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
export const isGeminiConfigured = Boolean(process.env.GEMINI_API_KEY);
export const isOpenAiConfigured = Boolean(process.env.OPENAI_API_KEY);
export const isOpenRouterConfigured = Boolean(process.env.OPENROUTER_API_KEY);

export function getChatProvider(name: AiProviderName): ChatProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "gemini":
      return new GeminiProvider();
    case "openai":
      return new OpenAiProvider();
    case "openrouter":
      return new OpenRouterProvider();
  }
}

/**
 * Which providers actually have a key in this environment.
 *
 * The admin console shows every provider but marks the unconfigured ones:
 * hiding them would make an assistant that already points at one look like it
 * lost its provider, and silently falling back to another would send clinical
 * prompts somewhere nobody chose.
 */
export function configuredProviders(): Record<AiProviderName, boolean> {
  return {
    anthropic: isAnthropicConfigured,
    gemini: isGeminiConfigured,
    openai: isOpenAiConfigured,
    openrouter: isOpenRouterConfigured,
  };
}

export { AI_PROVIDERS };
