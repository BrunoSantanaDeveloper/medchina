import { COLLECTION_KIND, LIBRARY_COLLECTIONS } from "@/lib/clinical-library";
import { detectSafetyFlags, type SafetyFlag } from "@/lib/clinical-safety";
import { PRACTICE_MODALITIES, type PracticeModality } from "@/lib/practice-context";
import { type AiProviderName, getChatProvider } from "@flyee/ai";
import { type KnowledgeSearchResult, resolveCollectionIds, searchKnowledge } from "@flyee/knowledge";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The therapeutic plan (PRD §10.9) — a DRAFT the practitioner validates and,
 * later, signs into a document. Built on the pattern hypotheses she accepted,
 * not re-derived: the plan follows her clinical direction.
 *
 * The safety contract (PRD §10.10) is enforced in CODE:
 *  - contraindications and sensitive factors (medications, pregnancy,
 *    anticoagulants, pacemaker, surgery, lesions, allergies) are derived from
 *    the recorded anamnesis by lib/clinical-safety — never the model's to omit;
 *  - a modality that requires a contraindication checklist before application
 *    (moxibustion, PRD §10.9) never ships without one;
 *  - nothing is prescribed or concluded: the plan is a draft, and only a
 *    professional action validates it.
 */

export const PLAN_PROMPT_VERSION = "therapeutic-plan-2026-07-15";

const DEFAULT_PROVIDER: AiProviderName = "gemini";
const DEFAULT_MODEL = "gemini-2.5-flash";

export type AcupunctureStrategy = "tonify" | "disperse" | "harmonize" | "warm" | "regulate";

export interface AcupunctureModality {
  enabled: true;
  objective: string;
  mainPoints: string[];
  complementaryPoints: string[];
  meridians: string[];
  strategy: AcupunctureStrategy | null;
  frequency: string;
}

export interface DietModality {
  enabled: true;
  thermalNature: string;
  favor: string[];
  reduce: string[];
  mealSuggestions: string[];
  restrictions: string;
}

export interface MoxibustionModality {
  enabled: true;
  technique: string;
  pointsOrRegion: string;
  objective: string;
  /** Verified BEFORE application (PRD §10.9) — guaranteed non-empty in code. */
  contraindicationChecklist: string[];
}

export interface AuriculotherapyModality {
  enabled: true;
  points: string[];
  material: string;
  side: string;
  stimulationGuidance: string;
  reassessment: string;
}

export interface CuppingModality {
  enabled: true;
  technique: string;
  region: string;
  intensity: string;
  duration: string;
  postSessionGuidance: string;
}

export interface PlanModalities {
  acupuncture?: AcupunctureModality;
  diet?: DietModality;
  moxibustion?: MoxibustionModality;
  auriculotherapy?: AuriculotherapyModality;
  cupping?: CuppingModality;
}

export interface PlanSource {
  title: string;
  source: string | null;
  kind: "traditional" | "protocol" | "evidence" | "unknown";
  documentId: string;
  chunkId: string;
}

export interface TherapeuticPlanResult {
  objective: string;
  modalities: PlanModalities;
  safetyFlags: SafetyFlag[];
  sources: PlanSource[];
  model: string;
  promptVersion: string;
  retrieved: number;
  /** The library search FAILED — different from finding nothing (see the hypotheses). */
  retrievalFailed: boolean;
  /** The modalities the plan was allowed to propose (PRD §10.9 scope). */
  scope: PracticeModality[];
}

export interface PlanInput {
  chiefComplaint: string | null;
  answers: { blockKey: string; fieldKey: string; value: string; source: string }[];
  /** Patterns the professional accepted or edited — the plan follows these. */
  acceptedPatterns: string[];
  /**
   * What this practitioner actually treats with (`profiles.practice_modalities`).
   * A plan she cannot apply is noise at best and, since a validated plan is
   * signed into a QR-verifiable document (PRD §9.8), a scope-of-practice
   * problem at worst.
   */
  practiceModalities: readonly string[];
}

/**
 * Her declared practice decides what the plan may propose. An empty declaration
 * means she never answered the activation step — fall back to ALL modalities,
 * never to none, so a skipped step can never produce an empty plan.
 */
export function resolvePlanScope(declared: readonly string[]): PracticeModality[] {
  const scoped = PRACTICE_MODALITIES.filter((slug) => declared.includes(slug));
  return scoped.length > 0 ? scoped : [...PRACTICE_MODALITIES];
}

const stringArray = { type: "array", items: { type: "string" } };

const MODALITY_SCHEMAS: Record<PracticeModality, object> = {
  acupuncture: {
    type: "object",
    properties: {
      objective: { type: "string" },
      mainPoints: stringArray,
      complementaryPoints: stringArray,
      meridians: stringArray,
      strategy: { type: "string", enum: ["tonify", "disperse", "harmonize", "warm", "regulate"] },
      frequency: { type: "string", description: "Suggested frequency — always the professional's to edit." },
    },
  },
  diet: {
    type: "object",
    properties: {
      thermalNature: { type: "string", description: "Predominant thermal nature observed." },
      favor: stringArray,
      reduce: { ...stringArray, description: "Foods to reduce TEMPORARILY." },
      mealSuggestions: stringArray,
      restrictions: { type: "string", description: "Clinical/nutritional restrictions, allergies, preferences." },
    },
  },
  moxibustion: {
    type: "object",
    properties: {
      technique: { type: "string" },
      pointsOrRegion: { type: "string" },
      objective: { type: "string" },
      contraindicationChecklist: {
        ...stringArray,
        description: "Items to verify BEFORE applying moxibustion. Required for this modality.",
      },
    },
  },
  auriculotherapy: {
    type: "object",
    properties: {
      points: stringArray,
      material: { type: "string" },
      side: { type: "string" },
      stimulationGuidance: { type: "string" },
      reassessment: { type: "string" },
    },
  },
  cupping: {
    type: "object",
    properties: {
      technique: { type: "string" },
      region: { type: "string" },
      intensity: { type: "string" },
      duration: { type: "string" },
      postSessionGuidance: { type: "string" },
    },
  },
};

/**
 * The scope is enforced by the SCHEMA, not only by the prompt: a modality she
 * does not practise has no property to be written into, so a fluent model
 * cannot talk her into one.
 */
function buildResultSchema(scope: readonly PracticeModality[]) {
  return {
    type: "object",
    properties: {
      objective: { type: "string", description: "The overall therapeutic aim, in the consultation's language." },
      modalities: {
        type: "object",
        description: "Only include the modalities that fit this case. Omit the rest — do not pad.",
        properties: Object.fromEntries(scope.map((slug) => [slug, MODALITY_SCHEMAS[slug]])),
      },
      citations: {
        type: "array",
        items: { type: "integer" },
        description: "Library excerpt numbers used, e.g. [1,2].",
      },
    },
    required: ["objective", "modalities"],
  };
}

function describeCase(input: PlanInput): string {
  const lines: string[] = [];
  if (input.chiefComplaint) lines.push(`Queixa principal: ${input.chiefComplaint}`);
  for (const answer of input.answers) {
    // Origin travels with the value here too: the hypotheses prompt has always
    // distinguished the patient's report from the practitioner's observation,
    // and the plan — which ends up in a signed document — read them as equals.
    const origin =
      answer.source === "professional_voice" || answer.source === "professional" ? "profissional" : "relato";
    lines.push(`- ${answer.blockKey}.${answer.fieldKey} [${origin}]: ${answer.value}`);
  }
  return lines.join("\n");
}

function buildPrompt(
  input: PlanInput,
  context: string,
  flags: SafetyFlag[],
  scope: readonly PracticeModality[],
): string {
  return [
    "You prepare a DRAFT therapeutic plan for a Traditional Chinese Medicine practitioner to validate and sign.",
    "You never prescribe, never conclude and never finalize. Everything is a draft for her review (PRD §10.9/§10.10).",
    "",
    "Base the plan on the ACCEPTED PATTERN HYPOTHESES below — follow her clinical direction, do not re-diagnose.",
    "",
    "HARD RULES:",
    `1. SCOPE OF PRACTICE — this practitioner treats ONLY with: ${scope.join(", ")}. Propose modalities ONLY from`,
    "   that list. Never propose, mention or hint at one outside it: she cannot apply it, and a validated plan is",
    "   signed into a document under her professional responsibility.",
    "2. Within that scope, include ONLY the modalities that genuinely fit this case. Omit the rest — never pad to",
    "   look complete.",
    "3. For moxibustion you MUST provide a contraindication checklist to verify before application (PRD §10.9).",
    "4. NEVER hide a contraindication. The recorded case has these sensitive factors flagged; every modality you",
    "   propose must be compatible with them, and where one matters (e.g. cupping with an anticoagulant, moxa or",
    "   certain points in pregnancy, electro-stimulation with a pacemaker) say so plainly rather than omit it.",
    flags.length > 0
      ? `   SENSITIVE FACTORS ON RECORD: ${flags.map((f) => `${f.category} ("${f.matchedText}")`).join("; ")}.`
      : "   No sensitive factors were flagged, but stay alert to anything the record implies.",
    "5. Frequencies and quantities are SUGGESTIONS, always the professional's to edit.",
    "6. Cite library excerpts by number in `citations` only when one genuinely informs the plan; never invent one.",
    "7. Write in the language of the recorded data (Brazilian Portuguese unless it clearly is not).",
    "8. ABSENCE IS NOT A NEGATIVE FINDING. A field absent from the record below was not asked or not answered —",
    "   never build a recommendation on the assumption that something unrecorded is normal or absent.",
    "",
    "ACCEPTED PATTERN HYPOTHESES:",
    input.acceptedPatterns.length > 0 ? input.acceptedPatterns.map((p) => `- ${p}`).join("\n") : "(none accepted yet)",
    "",
    "RECORDED CASE:",
    describeCase(input) || "(nothing recorded)",
    context
      ? `\nCLINICAL LIBRARY EXCERPTS (cite by number):\n${context}`
      : "\n(The clinical library returned nothing relevant. Do not cite anything.)",
  ].join("\n");
}

const cleanList = (list: unknown): string[] =>
  Array.isArray(list) ? list.map((item) => String(item ?? "").trim()).filter(Boolean) : [];

/**
 * Prepare a therapeutic-plan draft. `supabase` must read the knowledge
 * collections (RLS applies).
 */
export async function buildTherapeuticPlan(supabase: SupabaseClient, input: PlanInput): Promise<TherapeuticPlanResult> {
  const provider = (process.env.REASONING_PROVIDER as AiProviderName) || DEFAULT_PROVIDER;
  const model = process.env.REASONING_MODEL || DEFAULT_MODEL;
  const scope = resolvePlanScope(input.practiceModalities);
  const inScope = new Set<PracticeModality>(scope);

  // Safety flags come from the RECORD, in code, before any model call — so they
  // exist whether or not the model cooperates (PRD §10.10). The chief complaint
  // is part of that record: "gestante de 12 semanas com lombalgia" lives there
  // and nowhere else, and scanning only the anamnesis answers missed it.
  const safetyFlags = detectSafetyFlags([
    ...(input.chiefComplaint ? [{ text: input.chiefComplaint, fieldKey: "chiefComplaint" }] : []),
    ...input.answers.map((a) => ({ text: a.value, fieldKey: `${a.blockKey}.${a.fieldKey}` })),
  ]);

  // ---- Retrieve (RAG) ------------------------------------------------------
  let retrieved: KnowledgeSearchResult[] = [];
  let retrievalFailed = false;
  try {
    const collectionIds = await resolveCollectionIds(supabase, [...LIBRARY_COLLECTIONS]);
    if (collectionIds.length > 0) {
      // One query per accepted pattern plus one for the case: a plan is built
      // FROM the patterns she accepted, so those are the terms the library
      // should be searched by — not the chart flattened into one vector.
      const queries = [
        ...input.acceptedPatterns,
        [input.chiefComplaint, describeCase(input)].filter(Boolean).join("\n"),
      ].filter((query) => query.trim());
      const outcomes = await Promise.allSettled(
        queries
          .slice(0, 5)
          .map((query) => searchKnowledge(supabase, query, { collectionIds, matchCount: 6, minSimilarity: 0.25 })),
      );
      const merged = new Map<string, KnowledgeSearchResult>();
      let anySucceeded = false;
      let anyFailed = false;
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          anyFailed = true;
          console.error("[therapeutic-plan] retrieval query failed", outcome.reason);
          continue;
        }
        anySucceeded = true;
        for (const hit of outcome.value) {
          const existing = merged.get(hit.chunk_id);
          if (!existing || hit.similarity > existing.similarity) merged.set(hit.chunk_id, hit);
        }
      }
      retrieved = [...merged.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 8);
      retrievalFailed = anyFailed && !anySucceeded;
    }
  } catch (error) {
    console.error("[therapeutic-plan] library retrieval failed", error);
    retrieved = [];
    retrievalFailed = true;
  }

  const collectionSlug = new Map<string, string>();
  if (retrieved.length > 0) {
    const { data: collections } = await supabase
      .from("knowledge_collections")
      .select("id, slug")
      .in("id", [...new Set(retrieved.map((r) => r.collection_id))]);
    for (const row of collections ?? []) collectionSlug.set(row.id as string, row.slug as string);
  }

  const kindLabel: Record<string, string> = {
    traditional: "fonte tradicional",
    protocol: "protocolo interno",
    evidence: "evidência científica",
  };
  const context = retrieved
    .map((result, index) => {
      const kind =
        kindLabel[COLLECTION_KIND[collectionSlug.get(result.collection_id) ?? ""] ?? ""] ?? "origem não classificada";
      return `[${index + 1}] (${kind}, confiança ${result.trust_level}) ${result.title}${result.source ? ` — ${result.source}` : ""}\n${result.content}`;
    })
    .join("\n\n---\n\n");

  const raw = (await getChatProvider(provider).generateStructured(
    {
      provider,
      model,
      systemPrompt:
        "You are a careful assistant to a Traditional Chinese Medicine practitioner. You prepare a therapeutic plan draft for her to validate and sign. You never prescribe and never hide a contraindication.",
      temperature: 0.2,
      maxTokens: 4096,
    },
    [{ role: "user", content: buildPrompt(input, context, safetyFlags, scope) }],
    {
      name: "therapeutic_plan",
      description: "A therapeutic plan draft for professional validation",
      schema: buildResultSchema(scope),
    },
  )) as {
    objective?: string;
    modalities?: Record<string, Record<string, unknown>>;
    citations?: number[];
  };

  // ---- Verify + assemble ---------------------------------------------------
  // The scope is re-applied here on purpose: the schema already excludes what
  // she does not practise, but a modality outside it must never survive into a
  // plan she may sign, whatever the provider returns.
  const m = raw.modalities ?? {};
  const modalities: PlanModalities = {};

  if (inScope.has("acupuncture") && m.acupuncture) {
    const a = m.acupuncture;
    modalities.acupuncture = {
      enabled: true,
      objective: String(a.objective ?? "").trim(),
      mainPoints: cleanList(a.mainPoints),
      complementaryPoints: cleanList(a.complementaryPoints),
      meridians: cleanList(a.meridians),
      strategy: (["tonify", "disperse", "harmonize", "warm", "regulate"] as const).includes(
        a.strategy as AcupunctureStrategy,
      )
        ? (a.strategy as AcupunctureStrategy)
        : null,
      frequency: String(a.frequency ?? "").trim(),
    };
  }
  if (inScope.has("diet") && m.diet) {
    const d = m.diet;
    modalities.diet = {
      enabled: true,
      thermalNature: String(d.thermalNature ?? "").trim(),
      favor: cleanList(d.favor),
      reduce: cleanList(d.reduce),
      mealSuggestions: cleanList(d.mealSuggestions),
      restrictions: String(d.restrictions ?? "").trim(),
    };
  }
  if (inScope.has("moxibustion") && m.moxibustion) {
    const mo = m.moxibustion;
    const checklist = cleanList(mo.contraindicationChecklist);
    // PRD §10.9: moxibustion never ships without its pre-application checklist.
    // If the model dropped it, seed one from the record's sensitive factors so
    // the requirement cannot be silently skipped — the professional edits it.
    if (checklist.length === 0) {
      checklist.push("Revisar contraindicações locais e sistêmicas antes da aplicação.");
      for (const flag of safetyFlags) checklist.push(`Verificar: ${flag.matchedText}`);
    }
    modalities.moxibustion = {
      enabled: true,
      technique: String(mo.technique ?? "").trim(),
      pointsOrRegion: String(mo.pointsOrRegion ?? "").trim(),
      objective: String(mo.objective ?? "").trim(),
      contraindicationChecklist: checklist,
    };
  }
  if (inScope.has("auriculotherapy") && m.auriculotherapy) {
    const au = m.auriculotherapy;
    modalities.auriculotherapy = {
      enabled: true,
      points: cleanList(au.points),
      material: String(au.material ?? "").trim(),
      side: String(au.side ?? "").trim(),
      stimulationGuidance: String(au.stimulationGuidance ?? "").trim(),
      reassessment: String(au.reassessment ?? "").trim(),
    };
  }
  if (inScope.has("cupping") && m.cupping) {
    const c = m.cupping;
    modalities.cupping = {
      enabled: true,
      technique: String(c.technique ?? "").trim(),
      region: String(c.region ?? "").trim(),
      intensity: String(c.intensity ?? "").trim(),
      duration: String(c.duration ?? "").trim(),
      postSessionGuidance: String(c.postSessionGuidance ?? "").trim(),
    };
  }

  // Citations verified against what we actually retrieved (invented → dropped).
  const sources: PlanSource[] = [];
  for (const number of raw.citations ?? []) {
    const hit = retrieved[number - 1];
    if (!hit) continue;
    sources.push({
      title: hit.title,
      source: hit.source,
      kind: COLLECTION_KIND[collectionSlug.get(hit.collection_id) ?? ""] ?? "unknown",
      documentId: hit.document_id,
      chunkId: hit.chunk_id,
    });
  }

  return {
    objective: String(raw.objective ?? "").trim(),
    modalities,
    safetyFlags,
    sources,
    model,
    promptVersion: PLAN_PROMPT_VERSION,
    retrieved: retrieved.length,
    retrievalFailed,
    scope,
  };
}
