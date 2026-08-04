import { type AiProviderName, getChatProvider } from "@flyee/ai";

/**
 * An AI-suggested clinical summary of the consultation so far (PRD §10 draft
 * discipline). It is a DRAFT the professional reviews and applies — it never
 * writes her `summary` field and never concludes or diagnoses.
 *
 * Built from the same recorded data as the reasoning/plan (chief complaint +
 * anamnesis answers), so it stays consistent with what she is looking at.
 */
export const SUMMARY_PROMPT_VERSION = "clinical-summary-2026-08-01";

const DEFAULT_PROVIDER: AiProviderName = "gemini";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface SummaryInput {
  chiefComplaint: string | null;
  answers: { blockKey: string; fieldKey: string; value: string }[];
}

export interface SummaryResult {
  summary: string;
  model: string;
  promptVersion: string;
}

const RESULT_SCHEMA = {
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
  if (input.chiefComplaint) lines.push(`Queixa principal: ${input.chiefComplaint}`);
  for (const answer of input.answers) lines.push(`- ${answer.blockKey}.${answer.fieldKey}: ${answer.value}`);
  return lines.join("\n");
}

export async function buildClinicalSummary(input: SummaryInput): Promise<SummaryResult> {
  const provider = (process.env.REASONING_PROVIDER as AiProviderName) || DEFAULT_PROVIDER;
  const model = process.env.REASONING_MODEL || DEFAULT_MODEL;

  const prompt = [
    "You write a concise CLINICAL SUMMARY of a Traditional Chinese Medicine consultation for the practitioner to review.",
    "You never diagnose, never conclude and never prescribe. You only summarise what is RECORDED below.",
    "",
    "RULES:",
    "1. Summarise only the recorded data — never invent a symptom, a sign or a pattern.",
    "2. Absence is not a negative finding: a field with no value was simply not recorded.",
    "3. One or two short paragraphs, in the language of the recorded data (Brazilian Portuguese unless clearly not).",
    "4. Neutral clinical prose — no diagnosis, no pattern name, no treatment.",
    "",
    "RECORDED DATA:",
    describeCase(input) || "(nothing recorded)",
  ].join("\n");

  const raw = (await getChatProvider(provider).generateStructured(
    {
      provider,
      model,
      systemPrompt:
        "You are a careful assistant to a Traditional Chinese Medicine practitioner. You summarise the recorded consultation for her review. You never diagnose and never add anything not recorded.",
      temperature: 0.2,
      maxTokens: 1024,
    },
    [{ role: "user", content: prompt }],
    {
      name: "clinical_summary",
      description: "A draft clinical summary for professional review",
      schema: RESULT_SCHEMA,
    },
  )) as { summary?: string };

  return { summary: String(raw.summary ?? "").trim(), model, promptVersion: SUMMARY_PROMPT_VERSION };
}
