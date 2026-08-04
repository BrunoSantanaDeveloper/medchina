import { type AiProviderName, getChatProvider } from "@flyee/ai";

/**
 * AI reading of an attached document or photo (Fase B, PRD §10.2/§10.3/§16).
 *
 * Enforced in CODE, not merely asked of the prompt:
 *  - it NEVER diagnoses and NEVER concludes — for a document it extracts the
 *    values it can read; for a photo it describes only what is observable;
 *  - it is a DRAFT for the professional. Nothing here writes an anamnesis field
 *    (tongue/pulse remain HER observation, never inferred from a photo);
 *  - it states its limitations, because an image read out of clinical context
 *    is partial by construction.
 */
export const ANALYSIS_PROMPT_VERSION = "attachment-analysis-2026-08-01";

const DEFAULT_PROVIDER: AiProviderName = "gemini";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface AttachmentAnalysis {
  /** One neutral sentence: what this attachment IS. */
  summary: string;
  /** Observable features / findings — never conclusions. */
  observations: string[];
  /** For a document: labelled values read from it (e.g. lab results). */
  extractedValues: { label: string; value: string }[];
  /** Why this reading is partial (out of context, image quality, etc.). */
  limitations: string[];
}

export interface AttachmentAnalysisResult extends AttachmentAnalysis {
  model: string;
  promptVersion: string;
}

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One neutral sentence naming what the attachment is." },
    observations: {
      type: "array",
      items: { type: "string" },
      description: "Observable features/findings only. Never a diagnosis, never a conclusion.",
    },
    extractedValues: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, value: { type: "string" } },
        required: ["label", "value"],
      },
      description: "For a document: labelled values read verbatim (lab results, dates). Empty for a photo.",
    },
    limitations: {
      type: "array",
      items: { type: "string" },
      description: "Why this reading is partial. Always at least one for a clinical photo.",
    },
  },
  required: ["summary", "observations", "limitations"],
};

const PROMPT = [
  "You help a Traditional Chinese Medicine practitioner REVIEW an attachment (a photo or a document) she added to a consultation.",
  "You never diagnose, never conclude, never prescribe. Everything you write is a DRAFT for her to read and judge.",
  "",
  "HARD RULES:",
  "1. Describe ONLY what is observable in the attachment. Never infer a condition, a pattern or a cause.",
  "2. For a DOCUMENT (exam, lab result, report): extract the labelled values you can read, verbatim, into extractedValues.",
  "3. For a PHOTO: describe observable features neutrally (e.g. colour, coating, distribution). Do NOT read it as a",
  "   clinical sign of a pattern — tongue and pulse are the professional's own observation, not yours.",
  "4. Never state or imply a diagnosis, a risk level or a disease. If something looks concerning, say only that it",
  "   is worth the professional's attention — never name a condition.",
  "5. ALWAYS include at least one limitation: an image/document read outside the full clinical context is partial.",
  "6. Write in Brazilian Portuguese unless the attachment is clearly in another language.",
].join("\n");

/**
 * Read one attachment (already fetched as base64) and return a structured
 * draft. `mime` is passed to the provider as-is — a PDF goes through Gemini's
 * native document support; images work on every provider.
 */
export async function analyzeAttachment(input: {
  mime: string;
  dataBase64: string;
}): Promise<AttachmentAnalysisResult> {
  const provider = (process.env.REASONING_PROVIDER as AiProviderName) || DEFAULT_PROVIDER;
  const model = process.env.REASONING_MODEL || DEFAULT_MODEL;

  const raw = (await getChatProvider(provider).generateStructured(
    {
      provider,
      model,
      systemPrompt:
        "You are a careful assistant to a Traditional Chinese Medicine practitioner. You describe attachments for her review. You never diagnose and never overstate what an image or document supports.",
      temperature: 0,
      maxTokens: 2048,
    },
    [
      {
        role: "user",
        content: PROMPT,
        attachments: [{ kind: "image", mime: input.mime, dataBase64: input.dataBase64 }],
      },
    ],
    { name: "attachment_analysis", description: "A draft reading of a clinical attachment", schema: RESULT_SCHEMA },
  )) as {
    summary?: string;
    observations?: string[];
    extractedValues?: { label?: string; value?: string }[];
    limitations?: string[];
  };

  const cleanList = (list: unknown): string[] =>
    Array.isArray(list) ? list.map((item) => String(item ?? "").trim()).filter(Boolean) : [];

  const extractedValues = (Array.isArray(raw.extractedValues) ? raw.extractedValues : [])
    .map((entry) => ({ label: String(entry?.label ?? "").trim(), value: String(entry?.value ?? "").trim() }))
    .filter((entry) => entry.label && entry.value);

  const limitations = cleanList(raw.limitations);
  // Rule 5, verified in code: a partial reading must always say so.
  if (limitations.length === 0) {
    limitations.push("Leitura parcial: uma imagem/documento fora do contexto clínico completo é limitada.");
  }

  return {
    summary: String(raw.summary ?? "").trim(),
    observations: cleanList(raw.observations),
    extractedValues,
    limitations,
    model,
    promptVersion: ANALYSIS_PROMPT_VERSION,
  };
}
