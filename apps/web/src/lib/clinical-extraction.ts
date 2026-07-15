import { ANAMNESIS_BLOCKS, PROFESSIONAL_OBSERVATION_FIELDS } from "@/lib/anamnesis";
import { SENSITIVE } from "@/lib/clinical-safety";
import type { TranscriptResult } from "@flyee/transcribe";
import { GoogleGenAI } from "@google/genai";

/**
 * Turning a diarized transcript into a DRAFT anamnesis (PRD §10.2 "Extração"
 * + §10.5 "Preenchimento automático"). This module holds the clinical rules
 * the model must obey; they are stated as constraints, verified in the output,
 * and never left to the prompt alone.
 *
 * The three that matter most:
 *  1. Absence is never a negative answer — a field with no evidence is simply
 *     absent from the output (no row is written).
 *  2. Facts, observations and inferences stay distinct: only the PRACTITIONER
 *     can produce a tongue/pulse/palpation finding, never the patient's speech.
 *  3. Every value carries provenance: the transcript quote + timestamp it came
 *     from, so the professional can check it (PRD §13.1).
 */

const DEFAULT_MODEL = "gemini-2.5-flash";

export type ExtractedState = "clear" | "attention";

export interface ExtractedAnswer {
  blockKey: string;
  fieldKey: string;
  value: string;
  /** patient_report = said by the patient; professional_voice = observed/dictated by the practitioner. */
  source: "patient_report" | "professional_voice";
  /** attention = ambiguous, contradictory or clinically sensitive (PRD §10.6). */
  state: ExtractedState;
  /** Where it came from: the transcript excerpt and its timestamp. */
  provenance: { quote: string; start: string; speaker: string };
}

export interface ExtractionResult {
  answers: ExtractedAnswer[];
  /** Relevant things NOT covered in the consultation (PRD §10.7) — suggestions, never invented answers. */
  gaps: string[];
  /** Which diarized label is the practitioner (the rest is the patient). */
  practitionerSpeaker: string | null;
}

/** The field catalog the model may fill — nothing outside it is accepted. */
const fieldCatalog = () =>
  ANAMNESIS_BLOCKS.flatMap((block) =>
    block.fields.map((field) => ({
      key: `${block.key}.${field.key}`,
      observationOnly: PROFESSIONAL_OBSERVATION_FIELDS.has(`${block.key}.${field.key}`),
    })),
  );

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    practitionerSpeaker: {
      type: "string",
      description: 'Which speaker label is the practitioner (e.g. "Speaker 1"). Empty string if unclear.',
    },
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string", description: "One of the allowed field keys, exactly as given." },
          value: { type: "string", description: "The finding, in the consultation's language, concise." },
          source: { type: "string", enum: ["patient_report", "professional_voice"] },
          state: { type: "string", enum: ["clear", "attention"] },
          quote: { type: "string", description: "The transcript excerpt supporting this value, verbatim." },
          start: { type: "string", description: "mm:ss timestamp of that excerpt." },
          speaker: { type: "string", description: "Speaker label of that excerpt." },
        },
        required: ["field", "value", "source", "state", "quote", "start", "speaker"],
      },
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Relevant topics not covered — questions to investigate. Never answers.",
    },
  },
  required: ["practitionerSpeaker", "answers", "gaps"],
};

function buildPrompt(transcript: TranscriptResult): string {
  const catalog = fieldCatalog();
  const observationOnly = catalog.filter((f) => f.observationOnly).map((f) => f.key);

  return [
    "You are preparing a DRAFT anamnesis for a Traditional Chinese Medicine consultation.",
    "The practitioner will review, edit and validate everything you produce. You never diagnose.",
    "",
    "ALLOWED FIELDS (use these keys exactly; ignore anything that does not fit one of them):",
    catalog.map((f) => `- ${f.key}`).join("\n"),
    "",
    "HARD RULES — violating any of them makes the output unusable:",
    "1. NEVER invent. Only fill a field when the transcript supports it, and quote the exact excerpt.",
    "2. ABSENCE IS NOT A NEGATIVE ANSWER. If a topic was not discussed, OMIT the field entirely.",
    '   Do not write "not reported", "denies", "no complaints" or any negation that was not actually said.',
    `3. These fields are PRACTITIONER OBSERVATIONS: ${observationOnly.join(", ")}.`,
    "   Fill them ONLY when the practitioner states the finding out loud (source: professional_voice).",
    "   NEVER infer a tongue, pulse or palpation finding from what the patient says.",
    "4. source: patient_report when the patient reported it; professional_voice when the practitioner dictated it.",
    '5. state: "attention" when the passage is ambiguous, contradictory, marked [inaudible], or clinically',
    "   sensitive. Medication, pregnancy, anticoagulants, pacemaker, surgery and allergies are ALWAYS",
    '   "attention" (PRD §10.10) — never mark those "clear".',
    "6. Identify which speaker is the practitioner (the one conducting/asking) and which is the patient.",
    "7. gaps: AT MOST 5 short QUESTIONS, written to the practitioner in the language of the consultation,",
    "   about relevant things this case would need but that were not covered.",
    '   Write real questions ("Investigar sede e boca seca?"), NEVER field keys, never answers.',
    "",
    "Keep values concise and in the language of the consultation.",
    "",
    "TRANSCRIPT (diarized):",
    transcript.segments.map((s) => `[${s.start}] ${s.speaker}: ${s.text}`).join("\n"),
  ].join("\n");
}

/**
 * Extract a draft anamnesis from a diarized transcript. Output is filtered
 * against the rules above: unknown fields are dropped, and a practitioner
 * observation attributed to the patient is rejected rather than trusted.
 */
export async function extractAnamnesis(transcript: TranscriptResult): Promise<ExtractionResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set — clinical extraction uses Gemini.");
  if (!transcript.segments?.length) return { answers: [], gaps: [], practitionerSpeaker: null };

  const client = new GoogleGenAI({ apiKey: key });
  const response = await client.models.generateContent({
    model: process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL,
    contents: [{ role: "user", parts: [{ text: buildPrompt(transcript) }] }],
    config: { responseMimeType: "application/json", responseJsonSchema: RESULT_SCHEMA, temperature: 0 },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned no extraction.");
  const raw = JSON.parse(text) as {
    practitionerSpeaker?: string;
    answers?: {
      field: string;
      value: string;
      source: string;
      state: string;
      quote: string;
      start: string;
      speaker: string;
    }[];
    gaps?: string[];
  };

  const allowed = new Map(fieldCatalog().map((f) => [f.key, f]));
  const answers: ExtractedAnswer[] = [];

  for (const item of raw.answers ?? []) {
    const field = allowed.get(item.field);
    // Field the model made up → drop it.
    if (!field) continue;
    const value = (item.value ?? "").trim();
    if (!value) continue;

    const source = item.source === "professional_voice" ? "professional_voice" : "patient_report";

    // Rule 3, verified in code: a tongue/pulse/palpation finding attributed to
    // the patient's speech is not a valid observation — drop it rather than
    // record an inference as a fact.
    if (field.observationOnly && source !== "professional_voice") continue;

    const [blockKey, fieldKey] = item.field.split(".");

    // Rule 5, verified in code: the clinically sensitive families ALWAYS come
    // back for review, whatever the model decided (PRD §10.10). Prompts drift;
    // this does not.
    const alwaysAttention = fieldKey === "medications" || SENSITIVE.test(value);
    const state = item.state === "attention" || alwaysAttention ? "attention" : "clear";

    answers.push({
      blockKey,
      fieldKey,
      value,
      source,
      state,
      provenance: {
        quote: (item.quote ?? "").trim(),
        start: (item.start ?? "").trim(),
        speaker: (item.speaker ?? "").trim(),
      },
    });
  }

  return {
    answers,
    gaps: (raw.gaps ?? []).map((gap) => gap.trim()).filter(Boolean),
    practitionerSpeaker: raw.practitionerSpeaker?.trim() || null,
  };
}
