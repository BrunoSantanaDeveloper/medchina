import {
  ALWAYS_REVIEW_FIELDS,
  type AnamnesisApplicability,
  anamnesisBlocksFor,
  PROFESSIONAL_OBSERVATION_FIELDS,
} from "@/lib/anamnesis";
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

const DEFAULT_MODEL = "gemini-3.6-flash";

/** Ceiling for this stage even when the pipeline leaves more room. */
const EXTRACTION_MAX_MS = Number(process.env.EXTRACTION_TIMEOUT_MS) || 90_000;

/** Bump when the prompt or the verification changes — recorded per answer. */
export const EXTRACTION_PROMPT_VERSION = "anamnesis-2026-10-17";

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
   *
   * `originVerified` says whether WHO SPOKE was established by the diarization
   * instead of claimed by the model. False means the chart must not assert an
   * origin — see the source rule below.
   */
  provenance: { quote: string; start: string; speaker: string; verified: boolean; originVerified: boolean };
}

export interface ExtractionResult {
  answers: ExtractedAnswer[];
  /**
   * The complaint that brought the patient in, in one line. It lives on the
   * consultation row (it drives the patient timeline), not in a block, so the
   * field catalog deliberately excludes it — which also meant nothing could
   * ever fill it. Null when the transcript does not support one.
   */
  chiefComplaint: string | null;
  /** Relevant things NOT covered in the consultation (PRD §10.7) — suggestions, never invented answers. */
  gaps: string[];
  /** Which diarized label is the practitioner (the rest is the patient). */
  practitionerSpeaker: string | null;
  model: string;
  promptVersion: string;
  /** Answers dropped by the verification below, per reason — quality telemetry. */
  dropped: { unknownField: number; observationFromPatient: number; absenceAsValue: number };
  /** Values whose ORIGIN the diarization corrected: the model had the speaker wrong. */
  corrected: { origin: number };
  /** Answers kept whose quote could NOT be found in the transcript. */
  unverified: number;
}

/**
 * An answer already on the chart that a LATER recording of the same
 * consultation may still refine.
 */
export interface ExistingAnswer {
  blockKey: string;
  fieldKey: string;
  value: string;
  source: string;
  state: string;
  provenance?: { transcriptionId?: unknown } | null;
}

/**
 * Whether the pipeline is allowed to update an answer that already exists —
 * the TypeScript twin of the `on conflict … where` clause in migration 0092.
 * Both must agree: this one decides what the model is even told about, the SQL
 * one is the guard that cannot be talked around.
 *
 * What she typed is hers. What the pipeline dictated for her (tongue, pulse and
 * palpation carry `professional_voice` even when the MODEL wrote them) may be
 * refined by a second recording — the transcript stamp is what tells the two
 * apart. `edited`/`rejected` are hers whatever the provenance says, because
 * editing a dictated draft PRESERVES its stamp.
 */
export function isPipelineUpdatable(answer: ExistingAnswer): boolean {
  if (answer.state === "edited" || answer.state === "rejected") return false;
  if (answer.source !== "professional" && answer.source !== "professional_voice") return true;
  return answer.source === "professional_voice" && Boolean(answer.provenance?.transcriptionId);
}

/**
 * WHO SPOKE a value, decided by the diarization rather than by the model.
 *
 * The model used to label every value itself (`source`), and nothing checked
 * it outside the four exam fields — so a sentence the PRACTITIONER said could
 * be stored, and shown to her, as "relato da paciente", and then reach the
 * hypotheses prompt as the patient’s own words. Reported from a real online
 * consultation.
 *
 * Verified only when the quote was anchored in the transcript AND the
 * diarization named the practitioner. In a teleconsultation the patient’s
 * voice may never reach the microphone, and then there is no second speaker to
 * tell apart: the claim is kept as a draft and flagged, never asserted.
 */
export function resolveAnswerOrigin(input: {
  /** Speaker label of the anchored segment, or null when the quote was not found. */
  spokenBy: string | null;
  /** Diarized label of the practitioner, or null when the model could not say. */
  practitionerSpeaker: string | null;
  /** What the model claimed — used only while nothing can be verified. */
  claimedSource: "patient_report" | "professional_voice";
}): { source: "patient_report" | "professional_voice"; originVerified: boolean } {
  if (!input.spokenBy || !input.practitionerSpeaker) {
    return { source: input.claimedSource, originVerified: false };
  }
  return {
    source: input.spokenBy === input.practitionerSpeaker ? "professional_voice" : "patient_report",
    originVerified: true,
  };
}

/** A consultation where no conditional block applies — the safe default. */
const NO_CONDITIONAL_BLOCKS: AnamnesisApplicability = { fertilityCare: false };

/**
 * The field catalog the model may fill — nothing outside it is accepted. A
 * conditional block (fertility) is in it only when it applies to this
 * consultation, so a field that does not exist on her screen can neither be
 * asked for nor written.
 */
const fieldCatalog = (applicability: AnamnesisApplicability) =>
  anamnesisBlocksFor(applicability).flatMap((block) =>
    block.fields.map((field) => {
      const key = `${block.key}.${field.key}`;
      return {
        key,
        hint: field.hint,
        observationOnly: PROFESSIONAL_OBSERVATION_FIELDS.has(key),
        alwaysReview: ALWAYS_REVIEW_FIELDS.has(key),
      };
    }),
  );

/**
 * A value asserting that something was NOT recorded is the invariant of PRD
 * §10.5 breaking in through the front door: it turns silence into a written
 * finding. The prompt forbids it; this is the part that cannot drift.
 *
 * Deliberately NOT matching "nega"/"denies": a patient who actually denied a
 * symptom produced a real clinical negative, and deleting that would be its own
 * falsification. Only the phrases that describe the ABSENCE OF DATA are dropped.
 *
 * The stems below are truncated ON PURPOSE (informad → informado/informada/
 * informados), so each one must be followed by an OPTIONAL SUFFIX — never by
 * `\b`. That `\b` is what the list used to end with, and it silently disabled
 * the whole Portuguese half of the rule: a word boundary has to fall between
 * two characters of different classes, and "informad|o" is letter-letter, so
 * the match failed on exactly the phrases a pt-BR model writes most. Only the
 * branches ending in a complete word ("não consta", "not reported", "unknown")
 * ever fired — and "sem informação" fired by accident, because "ç" is not an
 * ASCII word character, so a boundary happened to exist there.
 */
const ABSENCE_STEMS = "informad|relatad|referid|mencionad|avaliad|investigad|questionad|abordad|discutid";

const ABSENCE_AS_VALUE = new RegExp(
  `^\\s*[-–]?\\s*(?:${[
    `n[ãa]o\\s+(?:${ABSENCE_STEMS})[a-zà-ú]*`,
    "n[ãa]o\\s+consta",
    "n[ãa]o\\s+h[áa]\\s+(?:informa[çc][ãa]o|informa[çc][õo]es|dados|registro)",
    "sem\\s+(?:informa[çc][ãa]o|informa[çc][õo]es|dados|registro|men[çc][ãa]o|relato\\s+na\\s+consulta)",
    "n[ãa]o\\s+se\\s+aplica",
    "nada\\s+(?:consta|informado|registrado)",
    "desconhecid[a-zà-ú]*",
    "not\\s+(?:reported|informed|assessed|discussed|mentioned|recorded)",
    "no\\s+(?:information|data|record)\\b",
    "unknown\\b",
    "n\\/a\\b",
  ].join("|")})`,
  "i",
);

/**
 * Whether a value asserts the ABSENCE OF DATA and must therefore not be stored
 * (PRD §10.5). Exported so the rule can be tested directly — it is the kind of
 * regression that is invisible in production until a chart says a symptom was
 * ruled out when nobody asked about it.
 */
export const isAbsenceValue = (value: string) => ABSENCE_AS_VALUE.test(value);

const normalizeForMatch = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Share of the quote's meaningful words present in a candidate segment.
 *
 * Matched on WORD boundaries, not substrings: "dor" occurs inside "dormir", and
 * counting that as a hit inflates the score of unrelated segments — precisely
 * the failure that would make a fabricated quote look verified.
 */
function containmentScore(quote: string, haystack: string): number {
  const padded = ` ${haystack} `;
  const words = quote.split(" ").filter((word) => word.length > 2);
  if (words.length === 0) return quote.length > 0 && padded.includes(` ${quote} `) ? 1 : 0;
  const present = words.filter((word) => padded.includes(` ${word} `)).length;
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
export function anchorQuote(
  quote: string,
  claimedStart: string,
  segments: { speaker: string; start: string; text: string }[],
): AnchoredQuote | null {
  const needle = normalizeForMatch(quote);
  if (!needle) return null;

  const claimedSeconds = claimedStart ? transcriptTimestampSeconds(claimedStart) : 0;
  const all = segments.map((segment, index) => ({ segment, index }));

  // The claimed timestamp is a hint, not an authority: try its neighbourhood
  // first, then fall back to the whole transcript rather than trusting a number
  // the model may simply have guessed.
  const near = claimedStart
    ? all.filter(
        ({ segment }) =>
          Math.abs(transcriptTimestampSeconds(segment.start) - claimedSeconds) <= TIMESTAMP_TOLERANCE_SECONDS,
      )
    : [];

  const own = (index: number) => containmentScore(needle, normalizeForMatch(segments[index].text));
  /** A quote may straddle a boundary — but only as a FALLBACK (see below). */
  const spanning = (index: number) =>
    index + 1 < segments.length
      ? containmentScore(
          needle,
          `${normalizeForMatch(segments[index].text)} ${normalizeForMatch(segments[index + 1].text)}`,
        )
      : 0;

  const best = (candidates: typeof all, score: (index: number) => number) => {
    let winner: { segment: (typeof segments)[number]; score: number } | null = null;
    for (const { segment, index } of candidates) {
      const value = score(index);
      if (!winner || value > winner.score) winner = { segment, score: value };
    }
    return winner;
  };

  // Order matters, and getting it wrong is worse than not verifying at all: a
  // segment joined with its neighbour also "contains" everything the neighbour
  // says, so scoring both together in one pass anchored quotes to the segment
  // BEFORE the one they came from. Whole-segment matches are resolved first,
  // and the spanning pass only runs for quotes no single segment satisfies.
  for (const [candidates, score] of [
    [near, own],
    [all, own],
    [near, spanning],
    [all, spanning],
  ] as const) {
    const winner = best(candidates, score);
    if (winner && winner.score >= QUOTE_MATCH_THRESHOLD) return { segment: winner.segment, verified: true };
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
    chiefComplaint: {
      type: "object",
      description: "The reason for the visit, in one short line. Empty strings if the transcript does not state one.",
      properties: {
        value: { type: "string", description: "One short line in the patient's own terms. Never a diagnosis." },
        quote: { type: "string", description: "The transcript excerpt supporting it, verbatim." },
        start: { type: "string", description: "mm:ss timestamp of that excerpt." },
      },
      required: ["value", "quote", "start"],
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Relevant topics not covered — questions to investigate. Never answers.",
    },
  },
  required: ["practitionerSpeaker", "answers", "chiefComplaint", "gaps"],
};

export function buildPrompt(
  transcript: TranscriptResult,
  existing: ExistingAnswer[] = [],
  applicability: AnamnesisApplicability = NO_CONDITIONAL_BLOCKS,
): string {
  const catalog = fieldCatalog(applicability);
  const observationOnly = catalog.filter((f) => f.observationOnly).map((f) => f.key);
  // A second recording of the SAME consultation used to see only its own audio,
  // so a field it mentioned replaced what the first one had captured. Telling
  // the model what is already on the chart is what turns "replace" into
  // "complete". Only entries the merge may actually update are listed —
  // anything she typed stays out of the prompt entirely.
  const alreadyFilled = existing
    .filter(isPipelineUpdatable)
    .map((answer) => `- ${answer.blockKey}.${answer.fieldKey}: ${answer.value.slice(0, 300)}`);

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
    "8. chiefComplaint: the reason for the visit in ONE short line, in the patient's own terms",
    '   ("Dor lombar há 3 meses"). Never a diagnosis, never a disharmony pattern. Leave the',
    "   strings empty when the transcript does not state a reason for the visit.",
    // The pulse is read position by position (12 fields). A reading she gave
    // without naming the position cannot be placed without inventing one — and
    // spreading it over all twelve would manufacture eleven findings. It goes
    // back to her as a question instead, with her own words in it.
    "9. PULSE BY POSITION (the pulse.* fields): each field is ONE position. Fill it only when the",
    "   practitioner named that organ/position out loud. A pulse dictated with NO position",
    '   ("o pulso está fino e rápido") must NOT be spread across the positions and must NOT be',
    "   guessed into one: add a gap question asking which position she read it on, quoting her words.",
    ...(alreadyFilled.length > 0
      ? [
          "",
          "ALREADY ON THE CHART from an earlier recording of this SAME consultation:",
          alreadyFilled.join("\n"),
          "Return one of these fields ONLY if THIS transcript adds something new to it.",
          "When you do, return the MERGED text (what is there + what is new) as the value,",
          "and let the quote support only the NEW part. If this transcript adds nothing to a",
          "field, OMIT it — repeating it unchanged is not useful.",
        ]
      : []),
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
export async function extractAnamnesis(
  transcript: TranscriptResult,
  /**
   * Absolute epoch-ms deadline shared with the rest of the pipeline.
   *
   * MEASURED: with a fixed 120s timeout and 3 SDK retries this stage could take
   * 360s on its own, on top of transcription, inside a 300s invocation. The
   * platform then killed the process before the pipeline's terminal fail()
   * could run, leaving the recording in 'processing' with a live lease — the
   * UI said "Processando..." for hours while the recovery cron re-ran it.
   */
  deadlineAt?: number,
  /**
   * What a previous recording of this consultation already wrote, so this one
   * completes the chart instead of overwriting it. Only entries the merge may
   * update are used (see `isPipelineUpdatable`).
   */
  existing: ExistingAnswer[] = [],
  /**
   * Which conditional blocks apply to this consultation (`fertility_care_applies`,
   * 0103). Defaults to none, so a caller that does not know never opens them.
   */
  applicability: AnamnesisApplicability = NO_CONDITIONAL_BLOCKS,
): Promise<ExtractionResult> {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.EXTRACTION_MODEL || process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL;
  const empty: ExtractionResult = {
    answers: [],
    chiefComplaint: null,
    gaps: [],
    practitionerSpeaker: null,
    model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    dropped: { unknownField: 0, observationFromPatient: 0, absenceAsValue: 0 },
    corrected: { origin: 0 },
    unverified: 0,
  };
  if (!key) throw new Error("GEMINI_API_KEY is not set — clinical extraction uses Gemini.");
  if (!transcript.segments?.length) return empty;

  // The budget is what REMAINS of the invocation, never a fixed timeout: this
  // stage runs LAST, after transcription, inside the same serverless call.
  // Measured, that overshoot is what stranded recordings in 'processing' — the
  // platform killed the process before the pipeline's terminal fail() could run.
  // The SDK arms its abort timer once per request (retries share it), so the
  // ceiling below is the real wall-clock cost, retries included.
  const remainingMs = deadlineAt ? deadlineAt - Date.now() : EXTRACTION_MAX_MS;
  const budgetMs = Math.max(20_000, Math.min(EXTRACTION_MAX_MS, remainingMs));
  const client = new GoogleGenAI({
    apiKey: key,
    httpOptions: { timeout: budgetMs, retryOptions: { attempts: 3 } },
  });
  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: buildPrompt(transcript, existing, applicability) }] }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: RESULT_SCHEMA,
      temperature: 0,
      abortSignal: AbortSignal.timeout(budgetMs),
    },
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
    chiefComplaint?: { value?: string; quote?: string; start?: string };
    gaps?: string[];
  };

  const allowed = new Map(fieldCatalog(applicability).map((f) => [f.key, f]));
  const segments = transcript.segments;
  const practitionerSpeaker = raw.practitionerSpeaker?.trim() || null;
  const answers: ExtractedAnswer[] = [];
  const dropped = { unknownField: 0, observationFromPatient: 0, absenceAsValue: 0 };
  /** Values whose origin the diarization had to correct — the model guessed wrong. */
  const corrected = { origin: 0 };
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

    const claimedSource = item.source === "professional_voice" ? "professional_voice" : "patient_report";

    // Rule 3, verified in code: a tongue/pulse/palpation/pattern finding
    // attributed to the patient's speech is not a valid observation — drop it
    // rather than record an inference as a fact.
    if (field.observationOnly && claimedSource !== "professional_voice") {
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
    if (!anchor) unverified += 1;

    /**
     * WHO SPOKE is decided by the diarization, for EVERY field — not only the
     * exam ones.
     *
     * The model's own `source` label used to be written to the chart unchecked,
     * so a sentence the PRACTITIONER said could be stored, and shown to her, as
     * "relato da paciente" — and then reach the hypotheses prompt as the
     * patient's own words. Reported from a real online consultation, where the
     * excerpt under a field was her own voice.
     *
     * When the speakers cannot be told apart (no anchor, or the model could not
     * say which label is the practitioner — common in a teleconsultation, where
     * the patient's voice may never reach the microphone), the chart asserts
     * NOTHING: the claim is kept as a draft, flagged unverified, and comes back
     * for her review.
     */
    const spokenBy = anchor && practitionerSpeaker ? anchor.segment.speaker : null;
    const originVerified = spokenBy !== null;
    const source = spokenBy
      ? spokenBy === practitionerSpeaker
        ? "professional_voice"
        : "patient_report"
      : claimedSource;
    if (originVerified && source !== claimedSource) corrected.origin += 1;

    // An observation that the diarization places in the patient's mouth is
    // dropped, whatever the model called it (rule 3, second half).
    if (field.observationOnly && originVerified && source !== "professional_voice") {
      dropped.observationFromPatient += 1;
      continue;
    }

    // Rule 5, verified in code: the clinically sensitive families ALWAYS come
    // back for review, whatever the model decided (PRD §10.10). Prompts drift;
    // this does not. The quote is scanned too — a summarised value can lose the
    // very word (an anticoagulant's name) that makes the passage sensitive.
    const alwaysAttention = field.alwaysReview || SENSITIVE.test(value) || SENSITIVE.test(claimedQuote);
    // A value whose evidence could not be located — or whose SPEAKER could not
    // be established — is exactly the one a human must look at first.
    const state = item.state === "attention" || alwaysAttention || !anchor || !originVerified ? "attention" : "clear";

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
        originVerified,
      },
    });
  }

  // The chief complaint is held to the same bar as any other value: absence is
  // not an answer, and it is kept only when its quote is found in the
  // transcript. Unlike a block answer it has no `attention` state to carry a
  // doubt with it — it is a headline the timeline repeats everywhere — so an
  // unverifiable one is dropped instead of shown.
  const claimedComplaint = (raw.chiefComplaint?.value ?? "").trim();
  const complaintAnchor = claimedComplaint
    ? anchorQuote((raw.chiefComplaint?.quote ?? "").trim(), (raw.chiefComplaint?.start ?? "").trim(), segments)
    : null;
  const chiefComplaint =
    claimedComplaint && !ABSENCE_AS_VALUE.test(claimedComplaint) && complaintAnchor ? claimedComplaint : null;

  return {
    answers,
    chiefComplaint,
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
    corrected,
    unverified,
  };
}
