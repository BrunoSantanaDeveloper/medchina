import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { OpenRouterProvider } from "./providers/openrouter";
import type { AiProviderName, ChatProvider } from "./types";

export * from "./types";

export const isAnthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
export const isGeminiConfigured = Boolean(process.env.GEMINI_API_KEY);
export const isOpenRouterConfigured = Boolean(process.env.OPENROUTER_API_KEY);

export function getChatProvider(name: AiProviderName): ChatProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "gemini":
      return new GeminiProvider();
    case "openrouter":
      return new OpenRouterProvider();
  }
}
