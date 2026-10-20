import type { AiProviderName } from "./types";

/**
 * Why a schema-constrained generation produced no usable JSON.
 *
 * The distinction is not academic: a `truncated` answer means the model ran out
 * of output budget (retrying often works, and the CAP is the real fix), while
 * `blocked` means the provider refused (retrying the same prompt will not).
 * Collapsing both into "the AI failed" is what made a reproducible bug look
 * random to the professional — see packages/ai/src/providers/gemini.ts.
 */
export type StructuredOutputFailure = "truncated" | "blocked" | "empty" | "invalid_json";

export interface StructuredOutputErrorInput {
  failure: StructuredOutputFailure;
  provider: AiProviderName;
  /** The provider's own reason string (Gemini finishReason, Anthropic stop_reason…). */
  finishReason?: string;
  /**
   * Extra context for the SERVER LOG only. Never put model output here: these
   * messages are logged, and the model was reading a clinical record.
   */
  detail?: string;
}

export class StructuredOutputError extends Error {
  readonly failure: StructuredOutputFailure;
  readonly provider: AiProviderName;
  readonly finishReason?: string;

  constructor({ failure, provider, finishReason, detail }: StructuredOutputErrorInput) {
    super(
      `${provider} structured output ${failure}` +
        (finishReason ? ` (finishReason ${finishReason})` : "") +
        (detail ? `: ${detail}` : ""),
    );
    this.name = "StructuredOutputError";
    this.failure = failure;
    this.provider = provider;
    this.finishReason = finishReason;
  }
}

export function isStructuredOutputError(error: unknown): error is StructuredOutputError {
  // `instanceof` alone breaks across duplicated module instances (a bundler can
  // ship two copies of this file), so the name is checked too.
  return (
    error instanceof StructuredOutputError ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "StructuredOutputError")
  );
}

/**
 * The deployment cannot make this call as configured: a provider without its
 * key, an unknown provider name, a model id that belongs to another provider.
 *
 * Its own type because the remedy is not "try again later" — it is an operator
 * changing an environment variable — and a plain Error read as a transient
 * failure: the professional was told to wait for a service that would refuse
 * her again on every retry.
 */
export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export function isAiConfigurationError(error: unknown): error is AiConfigurationError {
  // Name-checked for the same reason as StructuredOutputError: duplicated module instances.
  return (
    error instanceof AiConfigurationError ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AiConfigurationError")
  );
}

/** Gemini finish reasons that mean "the provider refused", not "it ran out of room". */
const GEMINI_BLOCKED_FINISH = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
]);

export interface GeminiStructuredResponse {
  text?: string | null;
  candidates?: { finishReason?: string | null }[] | null;
  promptFeedback?: { blockReason?: string | null } | null;
}

/**
 * Read WHY the generation stopped, before trying to parse it.
 *
 * Returns null when the response looks usable. This is a pure function so the
 * decision is testable without a network call.
 */
export function structuredFailureFromGemini(
  response: GeminiStructuredResponse,
): { failure: StructuredOutputFailure; finishReason?: string } | null {
  const blockReason = response.promptFeedback?.blockReason ?? undefined;
  if (blockReason) return { failure: "blocked", finishReason: blockReason };

  const finishReason = response.candidates?.[0]?.finishReason ?? undefined;
  if (finishReason === "MAX_TOKENS") return { failure: "truncated", finishReason };
  if (finishReason && GEMINI_BLOCKED_FINISH.has(finishReason)) return { failure: "blocked", finishReason };
  if (!response.text || !response.text.trim()) return { failure: "empty", finishReason };
  return null;
}

/** Markers of a 429 that is a BILLING state, not a rate limit — retrying is noise. */
const FATAL_QUOTA_MARKERS = ["prepayment", "credits are depleted", "billing"];

const STATUS_PATTERNS = [/"code"\s*:\s*(\d{3})/, /\((\d{3})\)/, /\bstatus\s*(?:code)?\s*[:=]?\s*(\d{3})\b/i];

export interface AiFailure {
  status: number | null;
  /** True when trying again later could plausibly succeed. */
  transient: boolean;
}

/**
 * Decide from the HTTP status whether trying again could work — the same rule
 * `packages/transcribe/src/transcribe.ts` uses for the transcription chain, so
 * a capacity 503 and a dead API key stop looking identical to the caller.
 */
export function classifyAiError(error: unknown): AiFailure {
  if (isStructuredOutputError(error)) {
    // A refusal repeats; an exhausted budget or a mangled answer usually does not.
    return { status: null, transient: error.failure !== "blocked" };
  }
  // Nothing about the call changes until someone fixes the configuration.
  if (isAiConfigurationError(error)) return { status: null, transient: false };
  // @google/genai with httpOptions.retryOptions rethrows every status it will
  // not retry (a 4xx other than 408/429: a revoked key, a retired model) as a
  // plain Error with no status — read as an outage, it was retried in vain.
  if (error instanceof Error && /^Non-retryable exception\b/.test(error.message)) {
    return { status: null, transient: false };
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusProperty = (error as { status?: unknown } | null)?.status;
  let status = typeof statusProperty === "number" && Number.isInteger(statusProperty) ? statusProperty : null;
  if (status === null) {
    for (const pattern of STATUS_PATTERNS) {
      const parsed = Number(pattern.exec(message)?.[1]);
      if (Number.isInteger(parsed)) {
        status = parsed;
        break;
      }
    }
  }

  if (status === 429) {
    const lower = message.toLowerCase();
    return { status, transient: !FATAL_QUOTA_MARKERS.some((marker) => lower.includes(marker)) };
  }
  // 529 is Anthropic's "overloaded" — capacity, exactly like a 503.
  if (status !== null && [408, 500, 502, 503, 504, 529].includes(status)) return { status, transient: true };
  // Credentials, a retired model, a rejected request: retrying changes nothing.
  if (status !== null && status >= 400 && status < 500) return { status, transient: false };
  // No recognizable status: aborted/timeout/network — worth another try.
  return { status, transient: true };
}

/**
 * The stable clinical error code for a provider failure. `provider_unavailable`
 * is retryable and says so on screen; `provider_rejected` tells the
 * professional that clicking again cannot help.
 */
export function clinicalProviderCode(error: unknown): "provider_unavailable" | "provider_rejected" {
  return classifyAiError(error).transient ? "provider_unavailable" : "provider_rejected";
}

/**
 * What to write in the server log. Deliberately excludes the message of an
 * unknown error only when it could carry model output — provider SDK messages
 * are kept because they carry the status and the provider's own reason.
 */
export function describeAiFailure(error: unknown): Record<string, unknown> {
  const { status, transient } = classifyAiError(error);
  if (isStructuredOutputError(error)) {
    return {
      name: error.name,
      provider: error.provider,
      failure: error.failure,
      finishReason: error.finishReason,
      transient,
    };
  }
  return {
    name: error instanceof Error ? error.name : typeof error,
    status,
    transient,
    message: error instanceof Error ? error.message.slice(0, 300) : undefined,
  };
}
