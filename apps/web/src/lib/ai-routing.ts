import { AI_EFFORTS, AI_PROVIDERS, type AiEffort, type AiProviderName } from "@flyee/ai/types";

/**
 * Which provider, model and thinking depth each clinical AI feature runs on.
 *
 * One env pair (REASONING_PROVIDER / REASONING_MODEL) used to move hypotheses,
 * the plan, the summary and attachment analysis TOGETHER — so trying Claude on
 * the plan also moved attachment analysis, which sends HEIC photos Claude
 * rejects, and nothing could be compared one feature at a time.
 *
 * Each feature now reads its own triplet first:
 *   HYPOTHESES_PROVIDER / HYPOTHESES_MODEL / HYPOTHESES_EFFORT
 *   PLAN_* · SUMMARY_* · ATTACHMENT_* · EXTRACTION_*
 * then the shared REASONING_*, then Gemini. A model is only ever paired with
 * the provider named at the SAME level, so HYPOTHESES_PROVIDER=anthropic never
 * inherits a Gemini model id from REASONING_MODEL.
 *
 * Two exceptions to inheriting REASONING_*:
 *   - It never moves the summary or the attachment reading to Anthropic. The
 *     summary runs by itself on every finalization, and the attachment reading
 *     takes HEIC photos Claude refuses; Anthropic has no LGPD addendum yet, so
 *     moving either is a decision taken by its OWN variable, never a side
 *     effect of trying Claude on the reasoning.
 *   - The anamnesis extraction never followed it at all: on Gemini its model
 *     falls back to TRANSCRIBE_MODEL, as it always has.
 *
 * Configuration mistakes fail loudly, naming the variable: an unknown
 * provider, or a model id that cannot belong to the provider it was paired
 * with (a Gemini id left in EXTRACTION_MODEL after EXTRACTION_PROVIDER moved
 * to Anthropic). Quietly running something else would change the processor,
 * or the model, without anyone noticing.
 */
export type ClinicalAiFeature = "extraction" | "hypotheses" | "plan" | "summary" | "attachment";

export interface ClinicalAiRoute {
  provider: AiProviderName;
  model: string;
  /** Only sent to providers that take one (Claude). */
  effort?: AiEffort;
}

const DEFAULT_PROVIDER: AiProviderName = "gemini";
const DEFAULT_MODEL = "gemini-3.6-flash";

/** The model a provider runs when one is named without a model. */
const PROVIDER_DEFAULT_MODEL: Partial<Record<AiProviderName, string>> = {
  gemini: DEFAULT_MODEL,
  anthropic: "claude-sonnet-5-5",
};

/**
 * Thinking depth per feature when nothing is configured. These routes run
 * under 120 s, and Claude's own defaults (Opus 5.5 medium, Sonnet 5.5 high)
 * were never measured against that ceiling; the summary is a paraphrase of
 * what is recorded and needs no deliberation, and the extraction copies
 * statements out of a transcript under the pipeline's own deadline.
 */
const DEFAULT_EFFORT: Record<ClinicalAiFeature, AiEffort> = {
  extraction: "low",
  hypotheses: "medium",
  plan: "medium",
  summary: "low",
  attachment: "low",
};

/** Features the shared REASONING_* may not move to Anthropic (see above). */
const OWN_VARIABLE_FOR_ANTHROPIC = new Set<ClinicalAiFeature>(["summary", "attachment"]);

const asEffort = (value: string | undefined): AiEffort | undefined =>
  value && (AI_EFFORTS as readonly string[]).includes(value) ? (value as AiEffort) : undefined;

/** Whether a model id can belong to this provider at all (OpenRouter takes any vendor's). */
function fitsProvider(provider: AiProviderName, model: string): boolean {
  const claude = model.startsWith("claude-");
  const gemini = model.startsWith("gemini-");
  if (provider === "anthropic") return claude;
  if (provider === "gemini") return gemini;
  if (provider === "openai") return !claude && !gemini;
  return true;
}

function route(provider: AiProviderName, model: string, source: string, effort: AiEffort): ClinicalAiRoute {
  if (!fitsProvider(provider, model)) {
    throw new Error(`${source}="${model}" does not name a model of ${provider}.`);
  }
  return { provider, model, effort };
}

export function clinicalAiRoute(feature: ClinicalAiFeature, env: NodeJS.ProcessEnv = process.env): ClinicalAiRoute {
  const own = feature.toUpperCase();
  const levels = feature === "extraction" ? [own] : [own, "REASONING"];

  for (const level of levels) {
    const named = env[`${level}_PROVIDER`];
    if (!named) continue;
    if (!(AI_PROVIDERS as readonly string[]).includes(named)) {
      throw new Error(`${level}_PROVIDER="${named}" is not a provider (${AI_PROVIDERS.join(", ")}).`);
    }
    const provider = named as AiProviderName;
    if (level === "REASONING" && provider === "anthropic" && OWN_VARIABLE_FOR_ANTHROPIC.has(feature)) break;
    const effort = asEffort(env[`${level}_EFFORT`]) ?? DEFAULT_EFFORT[feature];
    const configured = env[`${level}_MODEL`];
    if (configured) return route(provider, configured, `${level}_MODEL`, effort);
    // Naming Gemini alone on the extraction keeps the model it always ran.
    if (feature === "extraction" && provider === "gemini" && env.TRANSCRIBE_MODEL) {
      return route(provider, env.TRANSCRIBE_MODEL, "TRANSCRIBE_MODEL", effort);
    }
    const fallback = PROVIDER_DEFAULT_MODEL[provider];
    if (!fallback) throw new Error(`${level}_PROVIDER="${provider}" needs ${level}_MODEL.`);
    return route(provider, fallback, `${level}_PROVIDER`, effort);
  }

  // Nothing names a provider (or only REASONING_PROVIDER=anthropic, which this
  // feature does not follow): Gemini, with whichever Gemini model id is set —
  // the behaviour every deployment had before the per-feature triplets existed.
  const inherited =
    feature === "extraction" ? ["TRANSCRIBE_MODEL"] : env.REASONING_PROVIDER === "anthropic" ? [] : ["REASONING_MODEL"];
  const source = [`${own}_MODEL`, ...inherited].find((name) => env[name]);
  return route(
    DEFAULT_PROVIDER,
    source ? (env[source] as string) : DEFAULT_MODEL,
    source ?? "default",
    DEFAULT_EFFORT[feature],
  );
}
