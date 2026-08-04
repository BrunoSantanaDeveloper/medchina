import { ANAMNESIS_BLOCKS } from "@/lib/anamnesis";
import { COLLECTION_KIND, LIBRARY_COLLECTIONS } from "@/lib/clinical-library";
import { type AiProviderName, getChatProvider } from "@flyee/ai";
import { type KnowledgeSearchResult, resolveCollectionIds, searchKnowledge } from "@flyee/knowledge";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Disharmony-pattern hypotheses (PRD §10.8) — the Pro reasoning layer.
 *
 * This is the most dangerous thing the product does, so the rules are enforced
 * HERE, in code, and not merely asked for in the prompt:
 *
 *  1. A pattern is never a diagnosis. The output speaks of CORRESPONDENCE with
 *     the recorded data (weak/moderate/strong) — never confidence, never
 *     probability (PRD §10.8 rejects "confiança alta" as false precision).
 *  2. A hypothesis with no contradicting signs and no missing data is
 *     suspicious, not impressive: the model must look for what argues against
 *     it, and a hypothesis built on absent essential data MUST carry its
 *     limitation (PRD §10.8).
 *  3. Citations are verified, not trusted. Every reference must match a chunk
 *     actually retrieved from the clinical library; anything else is dropped.
 *     An invented source is worse than no source — it manufactures authority.
 *  4. Nothing is concluded and nothing is prescribed: every row lands as a
 *     draft the professional accepts, edits, rejects or reports (PRD §10.10).
 *
 * The knowledge kinds (traditional / internal protocol / scientific evidence)
 * stay classified separately, per PRD §9.9 — they are different kinds of
 * source, not a ranking.
 */

/** Bump when the prompt changes — it is recorded per hypothesis (PRD §10.10). */
export const REASONING_PROMPT_VERSION = "hypotheses-2026-07-15";

const DEFAULT_PROVIDER: AiProviderName = "gemini";
const DEFAULT_MODEL = "gemini-flash-latest";

export type Correspondence = "weak" | "moderate" | "strong";

export interface HypothesisSign {
  text: string;
  fieldKey?: string;
}

export interface HypothesisSource {
  title: string;
  source: string | null;
  kind: "traditional" | "protocol" | "evidence" | "unknown";
  documentId: string;
  chunkId: string;
}

export interface ClinicalHypothesis {
  pattern: string;
  rationale: string;
  correspondence: Correspondence;
  supportingSigns: HypothesisSign[];
  contradictingSigns: HypothesisSign[];
  missingData: string[];
  sources: HypothesisSource[];
  /** Set when essential data is missing — the UI must show it (PRD §10.8). */
  limitation: string | null;
}

export interface ReasoningResult {
  hypotheses: ClinicalHypothesis[];
  model: string;
  promptVersion: string;
  /** Retrieved chunks, for transparency about what the model could see. */
  retrieved: number;
  /**
   * The library search FAILED, as opposed to finding nothing. Both used to look
   * identical to the professional ("sem fontes"), which is the difference
   * between "the library does not cover this case" and "the library was not
   * consulted at all" — she would be reading an ungrounded answer believing it
   * was checked.
   */
  retrievalFailed: boolean;
}

/** The recorded consultation, as the reasoning sees it. */
export interface RecordedCase {
  chiefComplaint: string | null;
  answers: { blockKey: string; fieldKey: string; value: string; source: string; state: string }[];
  /** Age in years, when the birth date is recorded — several patterns read differently by age. */
  ageYears?: number | null;
  /**
   * Patterns this professional already accepted for THIS patient in earlier
   * consultations. Shown to her in the panel since 0025 and never shown to the
   * model, which therefore re-derived the case from zero every time.
   */
  priorPatterns?: string[];
  /** Patterns she rejected in THIS consultation — never propose them again. */
  rejectedPatterns?: string[];
}

/**
 * The four pillars of a TCM examination. When these are absent, a pattern
 * hypothesis is structurally under-determined and must say so (PRD §10.8) —
 * this is checked in code, because it is exactly what a fluent model glosses
 * over.
 */
const ESSENTIAL_FIELDS = ["tcm.tongue", "tcm.pulse"] as const;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The disharmony pattern, in the consultation's language." },
          rationale: { type: "string", description: "Two sentences at most, tying the pattern to recorded data." },
          correspondence: {
            type: "string",
            enum: ["weak", "moderate", "strong"],
            description: "How well the pattern matches the RECORDED data. Not a confidence, not a probability.",
          },
          supportingSigns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                fieldKey: { type: "string", description: "The anamnesis field it came from, if any." },
              },
              required: ["text"],
            },
          },
          contradictingSigns: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, fieldKey: { type: "string" } },
              required: ["text"],
            },
            description: "Recorded data that argues AGAINST this pattern. Empty only if there genuinely is none.",
          },
          missingData: {
            type: "array",
            items: { type: "string" },
            description: "What this pattern would need but the record lacks — as questions.",
          },
          citations: {
            type: "array",
            items: { type: "integer" },
            description: "Numbers of the library excerpts that support this, e.g. [1, 3]. Omit if none apply.",
          },
        },
        required: ["pattern", "rationale", "correspondence", "supportingSigns", "contradictingSigns", "missingData"],
      },
    },
  },
  required: ["hypotheses"],
};

const fieldLabel = (blockKey: string, fieldKey: string) => `${blockKey}.${fieldKey}`;

function describeCase(recorded: RecordedCase): string {
  const lines: string[] = [];
  if (recorded.ageYears != null) lines.push(`Paciente: ${recorded.ageYears} anos`);
  if (recorded.chiefComplaint) lines.push(`Queixa principal: ${recorded.chiefComplaint}`);
  for (const answer of recorded.answers) {
    const key = fieldLabel(answer.blockKey, answer.fieldKey);
    const origin =
      answer.source === "professional_voice" || answer.source === "professional" ? "profissional" : "relato";
    // The extraction already judged this value ambiguous, contradictory or
    // sensitive. Passing it in unmarked let the reasoning build on a doubt as
    // if it were settled.
    const pending = answer.state === "attention" ? ", requer atenção — não revisado" : "";
    lines.push(`- ${key} [${origin}${pending}]: ${answer.value}`);
  }
  return lines.join("\n");
}

/** Which anamnesis fields exist in the catalog but have no recorded value. */
function absentFields(recorded: RecordedCase): string[] {
  const present = new Set(recorded.answers.map((a) => fieldLabel(a.blockKey, a.fieldKey)));
  return ANAMNESIS_BLOCKS.flatMap((block) =>
    block.fields.map((field) => fieldLabel(block.key, field.key)).filter((key) => !present.has(key)),
  );
}

function buildPrompt(recorded: RecordedCase, context: string, absent: string[]): string {
  return [
    "You prepare DISHARMONY PATTERN HYPOTHESES for a Traditional Chinese Medicine practitioner to validate.",
    "You never diagnose, never prescribe and never conclude. Everything you write is a draft for her review.",
    "",
    "HARD RULES — violating any of them makes the output unusable:",
    "1. Work ONLY from the recorded data below. Never invent a sign that is not there.",
    "2. ABSENCE IS NOT A NEGATIVE FINDING. A field with no value was not asked or not answered —",
    "   it does NOT mean the patient denied it. Never treat absence as evidence for or against a pattern.",
    "3. correspondence = how well the pattern matches the RECORDED DATA:",
    '   "strong" only when the classic signs of the pattern are actually recorded, including tongue and pulse;',
    '   "moderate" when several fit but key examination data is missing;',
    '   "weak" when it is a thin match worth considering but poorly supported.',
    "   This is NOT a confidence or a probability. Never imply clinical certainty.",
    "4. contradictingSigns: actively look for recorded data that argues AGAINST each pattern and list it.",
    "   A hypothesis presented without its counter-evidence is dishonest. Leave empty ONLY if none exists.",
    "5. missingData: what this pattern would need but the record lacks — written as short QUESTIONS.",
    "6. Propose AT MOST 3 patterns, ordered by correspondence. Fewer is better than padded.",
    "7. Cite library excerpts by number in `citations` ONLY when an excerpt genuinely supports the pattern.",
    "   Never cite an excerpt you did not use. If nothing in the library applies, omit citations.",
    "8. Write in the language of the recorded data (Brazilian Portuguese unless it clearly is not).",
    "9. Reason through the classical frameworks — Ba Gang (eight principles), zang-fu, and the state of the",
    "   substances (Qi, Xue, Jin-Ye) — and make each hypothesis DISCRIMINABLE: `rationale` must name the",
    "   recorded finding that distinguishes this pattern from the neighbouring ones you considered.",
    '10. A value marked "requer atenção — não revisado" was flagged as ambiguous by the extraction and the',
    "    professional has not reviewed it yet. You may use it, but never let it carry a hypothesis alone.",
    "",
    "RECORDED DATA:",
    describeCase(recorded) || "(nothing recorded)",
    "",
    absent.length > 0
      ? `NOT RECORDED (absent — never read as negative): ${absent.join(", ")}`
      : "Every anamnesis field has a recorded value.",
    // Her own past decisions about THIS patient. Context, never a conclusion:
    // a pattern accepted three months ago is not evidence about today.
    (recorded.priorPatterns?.length ?? 0) > 0
      ? `\nPADRÕES QUE A PROFISSIONAL JÁ VALIDOU PARA ESTA PACIENTE (contexto, não verdade atual — o quadro pode ter mudado): ${recorded.priorPatterns!.join("; ")}`
      : "",
    (recorded.rejectedPatterns?.length ?? 0) > 0
      ? `\nPADRÕES QUE ELA JÁ REJEITOU NESTA CONSULTA — não os proponha de novo, nem reescritos com outras palavras: ${recorded.rejectedPatterns!.join("; ")}`
      : "",
    context
      ? `\nCLINICAL LIBRARY EXCERPTS (cite by number):\n${context}`
      : "\n(The clinical library returned nothing relevant. Do not cite anything.)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Excerpts as a numbered block the model can cite — and we can verify.
 *
 * Labelled by KIND and trust level, which the library chat has always done and
 * this one did not: without them the model cannot tell a classical source from
 * the professional's own unreviewed protocol while weighing a pattern, and PRD
 * §9.9 keeps those separate precisely because they are different kinds of claim.
 */
function buildLibraryContext(results: KnowledgeSearchResult[], kindBySlug: Map<string, string>): string {
  const kindLabel: Record<string, string> = {
    traditional: "fonte tradicional",
    protocol: "protocolo interno",
    evidence: "evidência científica",
  };
  return results
    .map((result, index) => {
      const source = result.source ? ` — ${result.source}` : "";
      const kind = kindLabel[kindBySlug.get(result.collection_id) ?? ""] ?? "origem não classificada";
      return `[${index + 1}] (${kind}, confiança ${result.trust_level}) ${result.title}${source}\n${result.content}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Retrieval, decomposed.
 *
 * The whole chart used to be flattened into ONE embedding: a long, many-topic
 * vector whose nearest neighbours are the library's most average passages, not
 * the ones about this tongue or this complaint. Several short queries — the
 * complaint, the examination, the systemic review, each previously validated
 * pattern — each retrieve for what they are about, and the union is deduplicated
 * by chunk. No extra model call; only cheap embeddings.
 */
function retrievalQueries(recorded: RecordedCase): string[] {
  const byKey = new Map(recorded.answers.map((answer) => [fieldLabel(answer.blockKey, answer.fieldKey), answer.value]));
  const pick = (keys: string[]) =>
    keys
      .map((key) => (byKey.get(key) ? `${key.split(".")[1]}: ${byKey.get(key)}` : null))
      .filter(Boolean)
      .join(". ");

  const queries = [
    [recorded.chiefComplaint, pick(["complaint.onset", "complaint.factors", "complaint.intensity"])]
      .filter(Boolean)
      .join(". "),
    pick(["tcm.tongue", "tcm.pulse", "tcm.palpation"]),
    pick(["routine.sleep", "routine.digestion", "routine.bowel", "routine.urine", "routine.thirst"]),
    pick(["emotional.state", "routine.energy"]),
    ...(recorded.priorPatterns ?? []),
  ].filter((query): query is string => Boolean(query && query.trim()));

  return queries.length > 0 ? queries.slice(0, 6) : [describeCase(recorded)];
}

async function retrieveForCase(
  supabase: SupabaseClient,
  recorded: RecordedCase,
): Promise<{ results: KnowledgeSearchResult[]; failed: boolean }> {
  const collectionIds = await resolveCollectionIds(supabase, [...LIBRARY_COLLECTIONS]);
  if (collectionIds.length === 0) return { results: [], failed: false };

  const outcomes = await Promise.allSettled(
    retrievalQueries(recorded).map((query) =>
      searchKnowledge(supabase, query, { collectionIds, matchCount: 6, minSimilarity: 0.25 }),
    ),
  );

  const merged = new Map<string, KnowledgeSearchResult>();
  let anySucceeded = false;
  let anyFailed = false;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      anyFailed = true;
      console.error("[clinical-reasoning] retrieval query failed", outcome.reason);
      continue;
    }
    anySucceeded = true;
    for (const hit of outcome.value) {
      const existing = merged.get(hit.chunk_id);
      if (!existing || hit.similarity > existing.similarity) merged.set(hit.chunk_id, hit);
    }
  }

  const results = [...merged.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 8);
  return { results, failed: anyFailed && !anySucceeded };
}

/**
 * Retrieve from the clinical library, then reason over the recorded case.
 * `supabase` must be able to read the knowledge collections (RLS applies).
 */
export async function buildHypotheses(supabase: SupabaseClient, recorded: RecordedCase): Promise<ReasoningResult> {
  const provider = (process.env.REASONING_PROVIDER as AiProviderName) || DEFAULT_PROVIDER;
  const model = process.env.REASONING_MODEL || DEFAULT_MODEL;

  if (recorded.answers.length === 0 && !recorded.chiefComplaint) {
    return { hypotheses: [], model, promptVersion: REASONING_PROMPT_VERSION, retrieved: 0, retrievalFailed: false };
  }

  // ---- Retrieve (RAG) ------------------------------------------------------
  let retrieved: KnowledgeSearchResult[] = [];
  let retrievalFailed = false;
  try {
    const outcome = await retrieveForCase(supabase, recorded);
    retrieved = outcome.results;
    retrievalFailed = outcome.failed;
  } catch (error) {
    // An unavailable library must not block the reasoning — but it must not
    // masquerade as an empty one either. The caller reports the difference.
    console.error("[clinical-reasoning] library retrieval failed", error);
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
  const kindByCollection = new Map(
    [...collectionSlug.entries()].map(([id, slug]) => [id, COLLECTION_KIND[slug] ?? "unknown"]),
  );

  // ---- Reason --------------------------------------------------------------
  const absent = absentFields(recorded);
  const prompt = buildPrompt(recorded, buildLibraryContext(retrieved, kindByCollection), absent);

  const raw = (await getChatProvider(provider).generateStructured(
    {
      provider,
      model,
      systemPrompt:
        "You are a careful assistant to a Traditional Chinese Medicine practitioner. You prepare hypotheses for her to validate. You never diagnose and never overstate what the data supports.",
      temperature: 0,
      maxTokens: 4096,
    },
    [{ role: "user", content: prompt }],
    {
      name: "disharmony_hypotheses",
      description: "Pattern hypotheses for professional validation",
      schema: RESULT_SCHEMA,
    },
  )) as {
    hypotheses?: {
      pattern?: string;
      rationale?: string;
      correspondence?: string;
      supportingSigns?: { text?: string; fieldKey?: string }[];
      contradictingSigns?: { text?: string; fieldKey?: string }[];
      missingData?: string[];
      citations?: number[];
    }[];
  };

  // ---- Verify (the rules the prompt cannot be trusted with) ----------------
  const recordedFields = new Set(recorded.answers.map((a) => fieldLabel(a.blockKey, a.fieldKey)));
  const missingEssentials = ESSENTIAL_FIELDS.filter((key) => !recordedFields.has(key));

  const hypotheses: ClinicalHypothesis[] = [];

  for (const item of (raw.hypotheses ?? []).slice(0, 3)) {
    const pattern = (item.pattern ?? "").trim();
    if (!pattern) continue;

    const correspondence: Correspondence =
      item.correspondence === "strong" ? "strong" : item.correspondence === "moderate" ? "moderate" : "weak";

    // Rule 3, verified: a citation is only real if it points at a chunk we
    // actually retrieved. Anything else is dropped rather than shown.
    const sources: HypothesisSource[] = [];
    for (const number of item.citations ?? []) {
      const hit = retrieved[number - 1];
      if (!hit) continue;
      const slug = collectionSlug.get(hit.collection_id) ?? "";
      sources.push({
        title: hit.title,
        source: hit.source,
        kind: COLLECTION_KIND[slug] ?? "unknown",
        documentId: hit.document_id,
        chunkId: hit.chunk_id,
      });
    }

    const clean = (signs: { text?: string; fieldKey?: string }[] | undefined): HypothesisSign[] =>
      (signs ?? [])
        .map((sign) => ({ text: (sign.text ?? "").trim(), fieldKey: sign.fieldKey?.trim() || undefined }))
        .filter((sign) => sign.text.length > 0);

    const missingData = (item.missingData ?? []).map((entry) => entry.trim()).filter(Boolean);

    // Rule 2, verified: the tongue and the pulse are how this medicine reads a
    // pattern. Without them nothing may be presented as a strong match, and the
    // limitation is stated whatever the model chose to say.
    let limitation: string | null = null;
    let finalCorrespondence = correspondence;
    if (missingEssentials.length > 0) {
      const names = missingEssentials.map((key) => key.split(".")[1]).join(", ");
      limitation = `Dados essenciais do exame não registrados (${names}). Qualquer padrão aqui é uma leitura parcial até que a profissional os observe.`;
      if (finalCorrespondence === "strong") finalCorrespondence = "moderate";
      for (const key of missingEssentials) {
        const question = `Observar ${key.split(".")[1]}?`;
        if (!missingData.some((entry) => entry.toLowerCase().includes(key.split(".")[1]))) missingData.push(question);
      }
    }

    hypotheses.push({
      pattern,
      rationale: (item.rationale ?? "").trim(),
      correspondence: finalCorrespondence,
      supportingSigns: clean(item.supportingSigns),
      contradictingSigns: clean(item.contradictingSigns),
      missingData,
      sources,
      limitation,
    });
  }

  // Strongest correspondence first — the professional reads the best-supported
  // reading first, not the model's arbitrary order.
  const rank: Record<Correspondence, number> = { strong: 0, moderate: 1, weak: 2 };
  hypotheses.sort((a, b) => rank[a.correspondence] - rank[b.correspondence]);

  return { hypotheses, model, promptVersion: REASONING_PROMPT_VERSION, retrieved: retrieved.length, retrievalFailed };
}
