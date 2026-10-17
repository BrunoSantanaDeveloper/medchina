import { clinicalAiRoute } from "@/lib/ai-routing";
import { type AiSpendContext, aiSpendMeter } from "@/lib/ai-spend";
import { complaintOnOneLine } from "@/lib/chief-complaint";
import { getChatProvider } from "@flyee/ai";

/**
 * An AI-suggested clinical summary of the consultation so far (PRD §10 draft
 * discipline). It is a DRAFT the professional reviews and applies — it never
 * writes her `summary` field and never concludes or diagnoses.
 *
 * Built from the same recorded data as the reasoning/plan (chief complaint +
 * anamnesis answers), so it stays consistent with what she is looking at.
 */
export const SUMMARY_PROMPT_VERSION = "clinical-summary-2026-09-02";

export interface SummaryInput {
  chiefComplaint: string | null;
  answers: {
    blockKey: string;
    fieldKey: string;
    value: string;
    /** `attention` = the extraction flagged it as ambiguous or clinically sensitive. */
    state?: string;
  }[];
}

export interface SummaryResult {
  summary: string;
  model: string;
  promptVersion: string;
}

/**
 * Exported for the strict-mode conformance test: OpenAI serves as the fallback
 * provider, and a schema it cannot accept only shows up as a 400 in production,
 * on the day the primary provider is down.
 */
export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A concise clinical summary paragraph of what is recorded. Neutral, never a diagnosis.",
    },
  },
  required: ["summary"],
};

function describeCase(input: SummaryInput): string {
  const lines: string[] = [];
  if (input.chiefComplaint) lines.push(`Queixa principal: ${complaintOnOneLine(input.chiefComplaint)}`);
  for (const answer of input.answers) {
    // A value the extraction itself flagged as ambiguous, contradictory or
    // clinically sensitive must not reach the model dressed like a reviewed
    // one — that is how a doubt becomes settled prose in her chart.
    const pending = answer.state === "attention" ? " [requer atenção — não revisado]" : "";
    lines.push(`- ${answer.blockKey}.${answer.fieldKey}${pending}: ${answer.value}`);
  }
  return lines.join("\n");
}

export async function buildClinicalSummary(
  input: SummaryInput,
  spend?: AiSpendContext,
  options: {
    /**
     * Give up after this long, on providers that honour it (Claude). For a
     * caller that stops waiting itself: a call still running past that point
     * is billed for an answer nobody keeps.
     */
    timeoutMs?: number;
  } = {},
): Promise<SummaryResult> {
  const { provider, model, effort } = clinicalAiRoute("summary");

  const prompt = [
    "You write a concise CLINICAL SUMMARY of a Traditional Chinese Medicine consultation for the practitioner to review.",
    "You never diagnose, never conclude and never prescribe. You only summarise what is RECORDED below.",
    "",
    "RULES:",
    "1. Summarise only the recorded data — never invent a symptom, a sign or a pattern.",
    "2. Absence is not a negative finding: a field with no value was simply not recorded.",
    "3. One or two short paragraphs, in the language of the recorded data (Brazilian Portuguese unless clearly not).",
    "4. Neutral clinical prose — no diagnosis, no pattern name, no treatment.",
    '5. A value marked "[requer atenção — não revisado]" has NOT been reviewed by the practitioner.',
    "   Carry that uncertainty into the summary (say it was reported/noted and still needs confirming);",
    "   never state it as an established finding.",
    "",
    "RECORDED DATA:",
    describeCase(input) || "(nothing recorded)",
  ].join("\n");

  // Metered so the account list can say what this consultation cost. The
  // meter is inert without a spend context (scripts, tests) and can never
  // fail the call.
  const meter = aiSpendMeter(spend && { ...spend, feature: "anamnesis", provider, model });
  const raw = (await getChatProvider(provider).generateStructured(
    {
      provider,
      model,
      systemPrompt:
        "You are a careful assistant to a Traditional Chinese Medicine practitioner. You summarise the recorded consultation for her review. You never diagnose and never add anything not recorded.",
      temperature: 0.2,
      maxTokens: 1024,
      effort,
      timeoutMs: options.timeoutMs,
    },
    [{ role: "user", content: prompt }],
    {
      name: "clinical_summary",
      description: "A draft clinical summary for professional review",
      schema: RESULT_SCHEMA,
    },
    meter.sink,
  )) as { summary?: string };
  await meter.settled();

  return { summary: String(raw.summary ?? "").trim(), model, promptVersion: SUMMARY_PROMPT_VERSION };
}
