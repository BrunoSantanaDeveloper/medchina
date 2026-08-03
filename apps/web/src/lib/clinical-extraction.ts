import { ANAMNESIS_BLOCKS, PROFESSIONAL_OBSERVATION_FIELDS } from "@/lib/anamnesis";
import { SENSITIVE } from "@/lib/clinical-safety";
import { transcriptTimestampSeconds } from "@/lib/transcript";
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
 *     from, so the professional can check it (PRD §13.1) — and that provenance
 *     is VERIFIED against the transcript here, because a quote the model
 *     invented is worse than no quote: it manufactures proof.
 */

const DEFAULT_MODEL = "gemini-2.5-flash";

/** Bump when the prompt or the verification changes — recorded per answer. */
export const EXTRACTION_PROMPT_VERSION = "anamnesis-2026-08-02";

/** Below this share of the quote's words found in a segment, it is not a quote. */
const QUOTE_MATCH_THRESHOLD = 0.7;

/** How far a claimed timestamp may sit from the segment it anchors to. */
const TIMESTAMP_TOLERANCE_SECONDS = 30;

export type ExtractedState = "clear" | "attention";

export interface ExtractedAnswer {
  blockKey: string;
  fieldKey: string;
  value: string;
  /** patient_report = said by the patient; professional_voice = observed/dictated by the practitioner. */
  source: "patient_report" | "professional_voice";
  /** attention = ambiguous, contradictory or clinically sensitive (PRD §10.6). */
  state: ExtractedState;
  /**
   * Where it came from. `start` and `speaker` are the ANCHOR SEGMENT's own
   * values once the quote is located, not the model's claim about them — the
   * transcript viewer links a field to its segment by exact timestamp, so a
   * plausible-looking "2:05" against a segment at "02:05" silently breaks it.
   */
  provenance: { quote: string; start: string; speaker: string; verified: boolean };
}

export interface ExtractionResult {
  answers: ExtractedAnswer[];
  /** Relevant things NOT covered in the consultation (PRD §10.7) — suggestions, never invented answers. */
  gaps: string[];
  /** Which diarized label is the practitioner (the rest is the patient). */
  practitionerSpeaker: string | null;
  model: string;
  promptVersion: string;
  /** Answers dropped by the verification below, per reason — quality telemetry. */
  dropped: { unknownField: number; observationFromPatient: number; absenceAsValue: number };
  /** Answers kept whose quote could NOT be found in the transcript. */
  unverified: number;
}

/** The field catalog the model may fill — nothing outside it is accepted. */
const fieldCatalog = () =>
  ANAMNESIS_BLOCKS.flatMap((block) =>
    block.fields.map((field) => ({
      key: `${block.key}.${field.key}`,
      hint: field.hint,
      observationOnly: PROFESSIONAL_OBSERVATION_FIELDS.has(`${block.key}.${field.key}`),
    })),
  );

/**
 * A value asserting that something was NOT recorded is the invariant of PRD
 * §10.5 breaking in through the front door: it turns silence into a written
 * finding. The prompt forbids it; this is the part that cannot drift.
 *
 * Deliberately NOT matching "nega"/"denies": a patient who actually denied a
 * symptom produced a real clinical negative, and deleting that would be its own
 * falsification. Only the phrases that describe the ABSENCE OF DATA are dropped.
 */
const ABSENCE_AS_VALUE =
  /^\s*[-–]?\s*(n[ãa]o\s+(informad|relatad|referid|mencionad|avaliad|investigad|questionad|abordad|discutid|consta|h[áa]\s+(informa|dados|registro))|sem\s+(informa|dados|registro|men[çc][ãa]o|relato\s+na\s+consulta)|n[ãa]o\s+se\s+aplica|nada\s+(consta|informado|registrado)|not\s+(reported|informed|assessed|discussed|mentioned|recorded)|no\s+(information|data|record)\b|unknown|desconhecid|n\/a)\b/i;

const normalizeForMatch = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Share of the quote's meaningful words present in a candidate segment. */
function containmentScore(quote: string, haystack: string): number {
  const words = quote.split(" ").filter((word) => word.length > 2);
  if (words.length === 0) return quote.length > 0 && haystack.includes(quote) ? 1 : 0;
  const present = words.filter((word) => haystack.includes(word)).length;
  return present / words.length;
}

interface AnchoredQuote {
  segment: { speaker: string; start: string; text: string };
  verified: boolean;
}

/**
 * Locate the transcript segment a quote actually came from.
 *
 * The model supplies the quote, the timestamp AND the speaker, and until now
 * all three were persisted with nothing more than a `.trim()`. The professional
 * then saw them in a popover as PROOF. Verifying costs one pass over segments
 * the process already holds in memory, and it fixes a second defect for free:
 * the anchor's own `start` string replaces the model's, so the transcript
 * viewer — which links field to segment by exact string equality — stops
 * breaking on "2:05" versus "02:05".
 */
function anchorQuote(
  quote: string,
  claimedStart: string,
  segments: { speaker: string; start: string; text: string }[],
): AnchoredQuote | null {
  const needle = normalizeForMatch(quote);
  if (!needle) return null;

  const claimedSeconds = claimedStart ? transcriptTimestampSeconds(claimedStart) : 0;
  const scored = segments.map((segment, index) => ({ segment, index }));

  // The claimed timestamp is a hint, not an authority: try its neighbourhood
  // first (a quote may straddle a segment boundary), then fall back to the
  // whole transcript rather than trusting the number.
  const near = claimedStart
    ? scored.filter(
        ({ segment }) =>
          Math.abs(transcriptTimestampSeconds(segment.start) - claimedSeconds) <= TIMESTAMP_TOLERANCE_SECONDS,
      )
    : [];

  const evaluate = (candidates: typeof scored) => {
    let best: { segment: (typeof segments)[number]; score: number } | null = null;
    for (const { segment, index } of candidates) {
      const own = normalizeForMatch(segment.text);
      const withNext = index + 1 < segments.length ? `${own} ${normalizeForMatch(segments[index + 1].text)}` : own;
      const score = Math.max(containmentScore(needle, own), containmentScore(needle, withNext));
      if (!best || score > best.score) best = { segment, score };
    }
    return best;
  };

  const bestNear = evaluate(near);
  if (bestNear && bestNear.score >= QUOTE_MATCH_THRESHOLD) {
    return { segment: bestNear.segment, verified: true };
  }
  const bestAny = evaluate(scored);
  if (bestAny && bestAny.score >= QUOTE_MATCH_THRESHOLD) {
    return { segment: bestAny.segment, verified: true };
  }
  return null;
}

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
    catalog.map((f) => `- ${f.key}: ${f.hint}`).join("\n"),
    "",
    "HARD RULES — violating any of them makes the output unusable:",
    "1. NEVER invent. Only fill a field when the transcript supports it, and quote the exact excerpt.",
    "2. ABSENCE IS NOT A NEGATIVE ANSWER. If a topic was not discussed, OMIT the field entirely.",
    '   Do not write "not reported", "denies", "no complaints" or any negation that was not actually said.',
    `3. These fields are PRACTITIONER OBSERVATIONS: ${observationOnly.join(", ")}.`,
    "   Fill them ONLY when the practitioner states the finding out loud (source: professional_voice).",
    "   NEVER infer a tongue, pulse, palpation or disharmony-pattern finding from what the patient says.",
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
 * against the rules above: unknown fields are dropped, a practitioner
 * observation attributed to the patient is rejected rather than trusted, a
 * value that asserts absence is refused, and every quote is located in the
 * transcript before it is shown to anyone as evidence.
 */
export async function extractAnamnesis(transcript: TranscriptResult): Promise<ExtractionResult> {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.EXTRACTION_MODEL || process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL;
  const empty: ExtractionResult = {
    answers: [],
    gaps: [],
    practitionerSpeaker: null,
    model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    dropped: { unknownField: 0, observationFromPatient: 0, absenceAsValue: 0 },
    unverified: 0,
  };
  if (!key) throw new Error("GEMINI_API_KEY is not set — clinical extraction uses Gemini.");
  if (!transcript.segments?.length) return empty;

  const client = new GoogleGenAI({ apiKey: key });
  const response = await client.models.generateContent({
    model,
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
  const segments = transcript.segments;
  const practitionerSpeaker = raw.practitionerSpeaker?.trim() || null;
  const answers: ExtractedAnswer[] = [];
  const dropped = { unknownField: 0, observationFromPatient: 0, absenceAsValue: 0 };
  let unverified = 0;

  for (const item of raw.answers ?? []) {
    const field = allowed.get(item.field);
    // Field the model made up → drop it.
    if (!field) {
      dropped.unknownField += 1;
      continue;
    }
    const value = (item.value ?? "").trim();
    if (!value) continue;

    // Rule 2, verified in code: "não informado" is not an answer, it is the
    // absence of one, and the schema exists so that absence has no row at all.
    if (ABSENCE_AS_VALUE.test(value)) {
      dropped.absenceAsValue += 1;
      continue;
    }

    const source = item.source === "professional_voice" ? "professional_voice" : "patient_report";

    // Rule 3, verified in code: a tongue/pulse/palpation/pattern finding
    // attributed to the patient's speech is not a valid observation — drop it
    // rather than record an inference as a fact.
    if (field.observationOnly && source !== "professional_voice") {
      dropped.observationFromPatient += 1;
      continue;
    }

    const [blockKey, fieldKey] = item.field.split(".");
    const claimedQuote = (item.quote ?? "").trim();
    const anchor = anchorQuote(claimedQuote, (item.start ?? "").trim(), segments);

    // Rule 3, second half: the model's own `source` label was the only thing
    // standing between a patient's sentence and the tongue field. Now the
    // DIARIZATION arbitrates — an observation anchored to a segment the patient
    // spoke is dropped, whatever the model called it.
    if (field.observationOnly && anchor && practitionerSpeaker && anchor.segment.speaker !== practitionerSpeaker) {
      dropped.observationFromPatient += 1;
      continue;
    }

    if (!anchor) unverified += 1;

    // Rule 5, verified in code: the clinically sensitive families ALWAYS come
    // back for review, whatever the model decided (PRD §10.10). Prompts drift;
    // this does not. The quote is scanned too — a summarised value can lose the
    // very word (an anticoagulant's name) that makes the passage sensitive.
    const alwaysAttention = fieldKey === "medications" || SENSITIVE.test(value) || SENSITIVE.test(claimedQuote);
    // A value whose evidence could not be located is exactly the one a human
    // must look at first.
    const state = item.state === "attention" || alwaysAttention || !anchor ? "attention" : "clear";

    answers.push({
      blockKey,
      fieldKey,
      value,
      source,
      state,
      provenance: {
        quote: claimedQuote,
        // The anchor's own values, never the model's claim about them.
        start: anchor ? anchor.segment.start : (item.start ?? "").trim(),
        speaker: anchor ? anchor.segment.speaker : (item.speaker ?? "").trim(),
        verified: Boolean(anchor),
      },
    });
  }

  return {
    answers,
    // The prompt asks for at most 5; nothing enforced it, and gaps is the only
    // free-text channel the model has.
    gaps: (raw.gaps ?? [])
      .map((gap) => gap.trim())
      .filter(Boolean)
      .slice(0, 5),
    practitionerSpeaker,
    model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    dropped,
    unverified,
  };
}
