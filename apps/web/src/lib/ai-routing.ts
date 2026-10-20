import { AiConfigurationError } from "@flyee/ai/errors";
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
 *     takes HEIC photos Claude refuses; sending either to a second processor
 *     is a decision taken by its OWN variable, never a side effect of trying
 *     Claude on the reasoning.
 *   - The anamnesis extraction never followed it at all: on Gemini its model
 *     falls back to TRANSCRIBE_MODEL, as it always has.
 *
 * Gemini is also the FLOOR (`clinicalAiFloor`): the transcription already runs
 * there, so when the extraction's configured provider fails and time remains,
 * the extraction runs again on Gemini instead of leaving the consultation
 * without a draft (clinical-extraction.ts).
 *
 * Configuration mistakes fail loudly, naming the variable: an unknown
 * provider, or a model id that cannot belong to the provider it was paired
 * with (a Gemini id left in EXTRACTION_MODEL after EXTRACTION_PROVIDER moved
 * to Anthropic). Quietly running something else would change the processor,
 * or the model, without anyone noticing. The one exception is the extraction,
 * which IS the consultation loop: it drafts on the Gemini floor and records
 * why, while /admin/ai shows the routing in red. Case and stray spaces in a
 * provider or effort value are not mistakes ("Anthropic " is anthropic): they
 * are what pasting into a hosting dashboard produces.
 */
export type ClinicalAiFeature = "extraction" | "hypotheses" | "plan" | "summary" | "attachment";

/** In the order a consultation meets them — the order /admin/ai lists them. */
export const CLINICAL_AI_FEATURES: readonly ClinicalAiFeature[] = [
  "extraction",
  "hypotheses",
  "plan",
  "summary",
  "attachment",
];

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

/** A provider or effort value as pasted: case and surrounding spaces carry no meaning. */
const word = (value: string | undefined): string | undefined => value?.trim().toLowerCase() || undefined;
/** A model id is kept as written, minus the spaces around it. */
const modelId = (value: string | undefined): string | undefined => value?.trim() || undefined;

const asEffort = (value: string | undefined): AiEffort | undefined => {
  const effort = word(value);
  return effort && (AI_EFFORTS as readonly string[]).includes(effort) ? (effort as AiEffort) : undefined;
};

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
    throw new AiConfigurationError(`${source}="${model}" does not name a model of ${provider}.`);
  }
  return { provider, model, effort };
}

export function clinicalAiRoute(feature: ClinicalAiFeature, env: NodeJS.ProcessEnv = process.env): ClinicalAiRoute {
  const own = feature.toUpperCase();
  const levels = feature === "extraction" ? [own] : [own, "REASONING"];

  for (const level of levels) {
    const named = word(env[`${level}_PROVIDER`]);
    if (!named) continue;
    if (!(AI_PROVIDERS as readonly string[]).includes(named)) {
      throw new AiConfigurationError(
        `${level}_PROVIDER="${env[`${level}_PROVIDER`]}" is not a provider (${AI_PROVIDERS.join(", ")}).`,
      );
    }
    const provider = named as AiProviderName;
    if (level === "REASONING" && provider === "anthropic" && OWN_VARIABLE_FOR_ANTHROPIC.has(feature)) break;
    const effort = asEffort(env[`${level}_EFFORT`]) ?? DEFAULT_EFFORT[feature];
    const configured = modelId(env[`${level}_MODEL`]);
    if (configured) return route(provider, configured, `${level}_MODEL`, effort);
    // Naming Gemini alone on the extraction keeps the model it always ran.
    const transcribeModel = modelId(env.TRANSCRIBE_MODEL);
    if (feature === "extraction" && provider === "gemini" && transcribeModel) {
      return route(provider, transcribeModel, "TRANSCRIBE_MODEL", effort);
    }
    const fallback = PROVIDER_DEFAULT_MODEL[provider];
    if (!fallback) throw new AiConfigurationError(`${level}_PROVIDER="${provider}" needs ${level}_MODEL.`);
    return route(provider, fallback, `${level}_PROVIDER`, effort);
  }

  // Nothing names a provider (or only REASONING_PROVIDER=anthropic, which this
  // feature does not follow): Gemini, with whichever Gemini model id is set —
  // the behaviour every deployment had before the per-feature triplets existed.
  const inherited =
    feature === "extraction"
      ? ["TRANSCRIBE_MODEL"]
      : word(env.REASONING_PROVIDER) === "anthropic"
        ? []
        : ["REASONING_MODEL"];
  const source = [`${own}_MODEL`, ...inherited].find((name) => modelId(env[name]));
  return route(
    DEFAULT_PROVIDER,
    source ? (modelId(env[source]) as string) : DEFAULT_MODEL,
    source ?? "default",
    DEFAULT_EFFORT[feature],
  );
}

/**
 * The Gemini route a feature falls back to when its configured provider
 * fails: the model it ran before any routing variable existed — the
 * transcription model for the extraction, a Gemini REASONING_MODEL for the
 * others — never the failed provider's model id.
 */
export function clinicalAiFloor(feature: ClinicalAiFeature, env: NodeJS.ProcessEnv = process.env): ClinicalAiRoute {
  const candidate = modelId(feature === "extraction" ? env.TRANSCRIBE_MODEL : env.REASONING_MODEL);
  const model = candidate && fitsProvider("gemini", candidate) ? candidate : DEFAULT_MODEL;
  return { provider: "gemini", model, effort: DEFAULT_EFFORT[feature] };
}

export interface ClinicalAiRoutingRow {
  feature: ClinicalAiFeature;
  /** What the feature runs on now; absent when the configuration cannot work. */
  route?: ClinicalAiRoute;
  /** Why the configuration cannot work, naming the variable. */
  error?: string;
  /** Whether the provider it runs on has a key in this deployment. */
  keyConfigured?: boolean;
  /** Where it goes when that provider fails (the extraction only). */
  floor?: ClinicalAiRoute;
}

/**
 * The routing of every clinical feature as this deployment resolves it, for
 * the superadmin console: an operator who switches a feature to Claude sees
 * here, before any consultation runs, that it took — or why it did not.
 * Never contains a key, only whether one is set.
 */
export function describeClinicalAiRouting(
  configured: Partial<Record<AiProviderName, boolean>>,
  env: NodeJS.ProcessEnv = process.env,
): ClinicalAiRoutingRow[] {
  return CLINICAL_AI_FEATURES.map((feature) => {
    try {
      const resolved = clinicalAiRoute(feature, env);
      return {
        feature,
        route: resolved,
        keyConfigured: Boolean(configured[resolved.provider]),
        ...(feature === "extraction" && resolved.provider !== "gemini" ? { floor: clinicalAiFloor(feature, env) } : {}),
      };
    } catch (error) {
      return {
        feature,
        error: error instanceof Error ? error.message : String(error),
        // The extraction does not stop on a routing it cannot run: it drafts on the floor meanwhile.
        ...(feature === "extraction" ? { floor: clinicalAiFloor(feature, env) } : {}),
      };
    }
  });
}
