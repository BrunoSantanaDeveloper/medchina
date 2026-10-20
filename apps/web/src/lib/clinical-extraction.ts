import { clinicalAiFloor, type ClinicalAiRoute, clinicalAiRoute } from "@/lib/ai-routing";
import { type AiSpendContext, aiSpendMeter } from "@/lib/ai-spend";
import {
  ALWAYS_REVIEW_FIELDS,
  type AnamnesisApplicability,
  anamnesisBlocksFor,
  PROFESSIONAL_OBSERVATION_FIELDS,
} from "@/lib/anamnesis";
import { SENSITIVE } from "@/lib/clinical-safety";
import { transcriptTimestampSeconds } from "@/lib/transcript";
import { AiConfigurationError, classifyAiError, describeAiFailure, StructuredOutputError } from "@flyee/ai/errors";
import { AI_PROVIDERS, reportUsage } from "@flyee/ai/types";
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

/** Ceiling for this stage even when the pipeline leaves more room. */
const EXTRACTION_MAX_MS = Number(process.env.EXTRACTION_TIMEOUT_MS) || 90_000;

/** Bump when the prompt or the verification changes — recorded per answer. */
export const EXTRACTION_PROMPT_VERSION = "anamnesis-2026-10-17b";

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
  /**
   * Set when the configured provider failed and this draft was made on the
   * Gemini floor instead: which provider and model failed, and a short reason
   * (a status or a failure kind — never model output). Null when it ran where
   * it was configured.
   */
  fallbackFrom: { provider: string; model: string; reason: string } | null;
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

/** The reply the model is asked for — exported so an evaluation sends the exact same contract. */
export const EXTRACTION_SCHEMA = {
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
  /**
   * Where the calls are billed (`ai_spend`, feature "anamnesis") — every
   * attempt, the floor's included. Absent in scripts and tests: nothing is
   * written then.
   */
  spend?: AiSpendContext,
): Promise<ExtractionResult> {
  // EXTRACTION_PROVIDER moves this stage off Gemini (default) without touching
  // the rest of the pipeline. On Gemini the model still falls back to
  // TRANSCRIBE_MODEL, as it always has.
  //
  // A routing that cannot work (a Gemini id left in EXTRACTION_MODEL after the
  // provider moved, a typo) is the operator's to fix — /admin/ai shows it in
  // red — but this stage is the consultation loop itself: the draft is made on
  // the Gemini floor meanwhile, and the record says why, instead of every
  // recording failing until someone reads a log.
  let route: ClinicalAiRoute;
  let misrouted: unknown = null;
  try {
    route = clinicalAiRoute("extraction");
  } catch (error) {
    misrouted = error;
    route = clinicalAiFloor("extraction");
  }
  const empty: ExtractionResult = {
    answers: [],
    chiefComplaint: null,
    gaps: [],
    practitionerSpeaker: null,
    model: route.model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    dropped: { unknownField: 0, observationFromPatient: 0, absenceAsValue: 0 },
    corrected: { origin: 0 },
    unverified: 0,
    fallbackFrom: null,
  };
  if (route.provider === "gemini" && !process.env.GEMINI_API_KEY) {
    throw new AiConfigurationError("GEMINI_API_KEY is not set — clinical extraction uses Gemini.");
  }
  if (!transcript.segments?.length) return empty;

  // The budget is what REMAINS of the invocation, never a fixed timeout: this
  // stage runs LAST, after transcription, inside the same serverless call.
  // Measured, that overshoot is what stranded recordings in 'processing' — the
  // platform killed the process before the pipeline's terminal fail() could run.
  // The SDK arms its abort timer once per request (retries share it), so the
  // ceiling below is the real wall-clock cost, retries included.
  const remainingMs = deadlineAt ? deadlineAt - Date.now() : EXTRACTION_MAX_MS;
  const budgetMs = Math.max(STAGE_MIN_MS, Math.min(EXTRACTION_MAX_MS, remainingMs));
  const stageEndsAt = Date.now() + budgetMs;
  const prompt = buildPrompt(transcript, existing, applicability);

  if (misrouted) {
    // The full message — which quotes the variable as written — goes to the
    // server log and /admin/ai only; the record keeps a fixed reason.
    console.warn("[extraction] routing cannot work — drafting on the Gemini floor", {
      floorModel: route.model,
      ...describeAiFailure(misrouted),
    });
    const raw = await extractOnGemini(route.model, prompt, budgetMs, spend);
    return {
      ...verifyExtraction(raw, transcript, applicability, route.model),
      fallbackFrom: {
        provider: recordedProvider(process.env.EXTRACTION_PROVIDER),
        model: recordedModel(process.env.EXTRACTION_MODEL),
        reason: "routing_invalid",
      },
    };
  }

  if (route.provider === "gemini") {
    const raw = await extractOnGemini(route.model, prompt, budgetMs, spend);
    return verifyExtraction(raw, transcript, applicability, route.model);
  }

  try {
    const raw = await extractOnProvider(route, prompt, budgetMs, spend);
    return verifyExtraction(raw, transcript, applicability, route.model);
  } catch (error) {
    // The configured provider failed: a revoked or expired key, an outage, its
    // rate limit, a refusal, a generation too slow for the stage. The
    // transcription already went to Gemini, so running the extraction there
    // adds no processor — and a draft from the floor serves the professional
    // better than a consultation with none.
    //
    // Its room is what the PIPELINE has left (capped at the stage ceiling),
    // not what the stage had: on a retry the transcript is already done and
    // most of the invocation is free, so a Claude call cut at the stage's 90 s
    // must still leave the floor its turn instead of burning every attempt.
    if (!process.env.GEMINI_API_KEY) throw error;
    const leftMs = Math.min(EXTRACTION_MAX_MS, (deadlineAt ?? stageEndsAt) - Date.now());
    if (leftMs < FLOOR_MIN_MS) {
      // No room for the floor in THIS invocation — but the next attempt starts
      // with the transcript ready and a full budget. A refusal that would end
      // the recording here (a dead key) is passed on as retryable, so that
      // attempt gets to draft on the floor.
      if (classifyAiError(error).transient) throw error;
      console.warn("[extraction] configured provider refused with no time left for the floor", {
        provider: route.provider,
        model: route.model,
        ...describeAiFailure(error),
      });
      throw new Error("extraction floor skipped for lack of time", { cause: error });
    }
    const floor = clinicalAiFloor("extraction");
    console.warn("[extraction] configured provider failed — drafting on the Gemini floor", {
      provider: route.provider,
      model: route.model,
      floorModel: floor.model,
      ...describeAiFailure(error),
    });
    const raw = await extractOnGemini(floor.model, prompt, leftMs, spend);
    return {
      ...verifyExtraction(raw, transcript, applicability, floor.model),
      fallbackFrom: { provider: route.provider, model: recordedModel(route.model), reason: failureReason(error) },
    };
  }
}

/** The least time this stage is ever given, even past the pipeline's deadline. */
const STAGE_MIN_MS = 20_000;

/**
 * Room the Gemini floor needs to be worth starting once the configured
 * provider has failed. Strictly below STAGE_MIN_MS: a stage that started at
 * its minimum and failed at once must still be able to reach the floor.
 */
const FLOOR_MIN_MS = 15_000;

/**
 * What a TENANT-READABLE record (transcriptions.metadata) may say about the
 * routing that failed: a known provider name and a model id shaped like one —
 * never the raw variable, which an operator could have pasted a key into.
 */
function recordedProvider(value: string | undefined): string {
  const named = value?.trim().toLowerCase() ?? "";
  if (!named) return "gemini";
  return (AI_PROVIDERS as readonly string[]).includes(named) ? named : "(invalid)";
}

function recordedModel(value: string | undefined): string {
  const model = value?.trim() ?? "";
  if (!model) return "";
  return !/^sk-/i.test(model) && /^[a-z0-9][a-z0-9.:/_-]{0,80}$/i.test(model) ? model : "(invalid)";
}

const SYSTEM_PROMPT =
  "You prepare a DRAFT anamnesis for a Traditional Chinese Medicine practitioner to review. You never diagnose and never invent.";

/**
 * Any provider other than Gemini goes through packages/ai with the SAME
 * prompt, schema and verification — switching EXTRACTION_PROVIDER changes the
 * model and nothing the chart relies on. Loaded only here: the default Gemini
 * path never pulls the other providers' SDKs into the pipeline.
 */
async function extractOnProvider(
  route: ClinicalAiRoute,
  prompt: string,
  timeoutMs: number,
  spend?: AiSpendContext,
): Promise<RawExtraction> {
  const { getChatProvider } = await import("@flyee/ai");
  const meter = aiSpendMeter(spend && { ...spend, feature: "anamnesis", provider: route.provider, model: route.model });
  try {
    return (await getChatProvider(route.provider).generateStructured(
      {
        provider: route.provider,
        model: route.model,
        systemPrompt: SYSTEM_PROMPT,
        temperature: 0,
        maxTokens: 8192,
        effort: route.effort,
        timeoutMs,
      },
      [{ role: "user", content: prompt }],
      {
        name: "anamnesis_extraction",
        description: "A draft anamnesis for professional review",
        schema: EXTRACTION_SCHEMA,
      },
      meter.sink,
    )) as RawExtraction;
  } finally {
    // Billed whether or not it answered: a refused or cut call cost the same.
    await meter.settled();
  }
}

async function extractOnGemini(
  model: string,
  prompt: string,
  timeoutMs: number,
  spend?: AiSpendContext,
): Promise<RawExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiConfigurationError("GEMINI_API_KEY is not set — clinical extraction uses Gemini.");
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 3 } } });
  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: EXTRACTION_SCHEMA,
      temperature: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });

  const usage = response.usageMetadata;
  if (usage) {
    const meter = aiSpendMeter(spend && { ...spend, feature: "anamnesis", provider: "gemini", model });
    // Thinking is billed as output whether or not anyone reads it.
    reportUsage(meter.sink, {
      tokensIn: usage.promptTokenCount ?? 0,
      tokensOut: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      model,
    });
    await meter.settled();
  }
  const text = response.text;
  if (!text) throw new Error("Gemini returned no extraction.");
  try {
    return JSON.parse(text) as RawExtraction;
  } catch {
    // Never the parser's own message: V8 quotes the text around the bad token,
    // that text is the patient's anamnesis, and the pipeline logs this error.
    throw new StructuredOutputError({
      failure: "invalid_json",
      provider: "gemini",
      finishReason: response.candidates?.[0]?.finishReason ?? undefined,
      detail: `${text.length} characters returned`,
    });
  }
}

/**
 * Why the configured provider failed, for the transcription's metadata — which
 * the professional's browser reads. A status or a failure kind only: never a
 * message, since a configuration message quotes the variable as written.
 */
function failureReason(error: unknown): string {
  const failure = describeAiFailure(error);
  if (failure.failure)
    return `${String(failure.failure)}${failure.finishReason ? ` (${String(failure.finishReason)})` : ""}`;
  if (failure.name === "AiConfigurationError") return "configuration";
  if (failure.status) return `HTTP ${String(failure.status)}`;
  return String(failure.name ?? "error");
}

/** What the model returns, before any of it is trusted. */
export interface RawExtraction {
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
}

/**
 * Hold a model's raw extraction to the rules above: unknown fields dropped, a
 * practitioner observation attributed to the patient rejected, a value that
 * asserts absence refused, every quote located in the transcript. Pure — the
 * same function judges every provider's reply, in production and in evaluation.
 */
export function verifyExtraction(
  raw: RawExtraction,
  transcript: TranscriptResult,
  applicability: AnamnesisApplicability,
  model: string,
): ExtractionResult {
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
    fallbackFrom: null,
  };
}
