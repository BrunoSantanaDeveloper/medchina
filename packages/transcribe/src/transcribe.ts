import { GoogleGenAI, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { TranscriptResult } from "./types";
import {
  formatOffset,
  mergeTranscripts,
  normalizeSpeakers,
  normalizeTimestamps,
  offsetSeconds,
  transcriptCoverage,
} from "./normalize";

const DEFAULT_MODEL = "gemini-2.5-flash";
/**
 * Models tried IN ORDER after the primary exhausts its transient retries.
 *
 * Pinned versions, never a `-latest` alias: measured against the live API on
 * 2026-08-27, `gemini-flash-latest` and `gemini-3.7-flash` BOTH answered 503
 * "high demand" while 3.6 / 3.5 / 2.5 answered normally. The alias points at
 * the newest generation, which is exactly the most congested pool — so it is
 * the worst possible default for a background job that must not fail.
 *
 * The chain deliberately spans GENERATIONS (3.6 -> 3.5 -> 2.5): separate
 * capacity pools, so one overloaded generation cannot take the whole chain
 * down. Override with TRANSCRIBE_MODEL_FALLBACKS (comma-separated, empty
 * disables). Keep these pinned and re-check when Google retires a version —
 * `gemini-2.0-flash` sat here until it was retired and started answering 404.
 */
const DEFAULT_FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash"];

/**
 * Gemini rejects generateContent requests whose inline payload exceeds ~20MB.
 * A real 50–60 min consultation easily passes that, and used to fail EVERY
 * time as an opaque provider error — at exactly the first real AI moment.
 * Above this threshold the audio goes through the Files API instead
 * (2GB limit, referenced by URI).
 */
const INLINE_LIMIT_BYTES = 15 * 1024 * 1024;
const FILE_POLL_INTERVAL_MS = 2_000;
const FILE_POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Per-attempt HTTP deadline. Without it a generateContent call is one bare
 * fetch the provider may hold open for MINUTES before answering 503 (measured:
 * 293s for a 4-minute audio) — colliding with the route's own maxDuration so
 * the terminal failure update never ran and the row stranded in 'processing'.
 * Generous, because a long consultation legitimately takes a while to
 * transcribe; bounded, because unbounded is what broke.
 */
const ATTEMPT_TIMEOUT_MS = Number(process.env.TRANSCRIBE_ATTEMPT_TIMEOUT_MS) || 300_000;
/**
 * Overall budget across every attempt. The pipeline passes a tighter SHARED
 * deadline, which always wins — this is only the ceiling when called directly.
 *
 * MEASURED 2026-08-27 on a real 16m36s consultation: 53s on gemini-2.5-flash,
 * 197s on gemini-3.5-flash. That measurement is why 2.5 leads the chain: it was
 * ~4x faster AND produced clean speaker labels, while 3.5 emitted a bogus
 * "Speaker 08:57" as a third voice on a two-voice consultation.
 *
 * The invocation ceiling is 800s (Vercel Pro/Enterprise, nodejs24.x), not the
 * 300s this file used to assume — 300 is merely the platform DEFAULT. Treating
 * it as a hard limit is what squeezed transcription into a budget SMALLER than
 * the work, aborting otherwise-good runs with "This operation was aborted".
 */
const TOTAL_BUDGET_MS = Number(process.env.TRANSCRIBE_TOTAL_BUDGET_MS) || 540_000;
/**
 * Safety margin subtracted from the remaining budget when arming each call's
 * abort signal, so the deadline is reached by US and not by the platform.
 * Overrunning is not a slow request — it is a recording STUCK in 'processing':
 * the platform kills the invocation before the terminal fail() update runs, the
 * row keeps a live lease, and the UI says "Processando..." indefinitely.
 */
const CALL_MARGIN_MS = 10_000;
/**
 * A transcript is only trustworthy if it reaches the END of the audio. Below
 * this share of the recording's duration it is treated as INCOMPLETE.
 * MEASURED: both models silently stopped near 12:00 on a 16:26 audio — and the
 * lost tail was the practitioner dictating tongue, pulse and abdominal
 * palpation, i.e. exactly the professional_voice content the whole clinical
 * reasoning depends on. A truncated transcript that reports success is the
 * worst outcome available, so coverage is checked here rather than assumed.
 */
const MIN_COVERAGE = Number(process.env.TRANSCRIBE_MIN_COVERAGE) || 0.85;
/**
 * How many "transcribe the rest" windows may be requested for one recording.
 * Bounded because each window re-sends the audio; the implicit context cache
 * makes that cheap (measured: 31,313 of 32,120 prompt tokens served from cache)
 * but it is never free, and a model that will not honour the window must not
 * be allowed to spin.
 */
const MAX_CONTINUATIONS = Number(process.env.TRANSCRIBE_MAX_CONTINUATIONS) || 4;
/** Rewind before the last known segment so a sentence on the boundary survives. */
const CONTINUATION_OVERLAP_SECONDS = Number(process.env.TRANSCRIBE_CONTINUATION_OVERLAP) || 75;
/** Do not start another window without room to finish it. */
const CONTINUATION_MIN_BUDGET_MS = 70_000;
/** Pause before re-trying the SAME model (a capacity blip needs a beat). */
const RETRY_WAIT_MS = 8_000;

/**
 * How a provider failure should be handled — decided from the HTTP status, in
 * code, so a transient capacity 503 and a fatal misconfiguration stop being
 * the same "provider_unavailable" (a billing problem must not hide behind a
 * "try again later" label, and a 404 must not burn retries).
 */
export interface ProviderFailure {
  status: number | null;
  /** True when trying again later could plausibly succeed (503, rate-limit 429, 5xx, network). */
  transient: boolean;
  /**
   * WHO the failure is about, which decides whether the chain may continue:
   *  - "model": this model is gone/refused it (404, 400) — another model can
   *    still work, so advance instead of giving up. A retired model used to
   *    abort the whole chain, which is how a live 3.6 was never reached.
   *  - "account": key invalid, credits depleted — identical from every model,
   *    so trying more only burns time and money.
   */
  scope: "model" | "account";
}

/** Markers of a 429 that is a BILLING state, not a rate limit — retrying is noise. */
const FATAL_QUOTA_MARKERS = ["prepayment", "credits are depleted", "billing"];

export function classifyProviderError(error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : String(error);
  // The SDK's ApiError carries a numeric status; the raw body also embeds it.
  const statusProperty = (error as { status?: unknown } | null)?.status;
  const parsed =
    typeof statusProperty === "number" ? statusProperty : Number(/"code"\s*:\s*(\d{3})/.exec(message)?.[1]);
  const status = Number.isInteger(parsed) ? parsed : null;

  if (status === 429) {
    const lower = message.toLowerCase();
    const depleted = FATAL_QUOTA_MARKERS.some((marker) => lower.includes(marker));
    // Depleted credits are an ACCOUNT state; a plain rate limit is transient.
    return { status, transient: !depleted, scope: depleted ? "account" : "model" };
  }
  if (status !== null && [408, 500, 502, 503, 504].includes(status)) {
    return { status, transient: true, scope: "model" };
  }
  // Credentials: no model on this key will behave differently.
  if (status === 401 || status === 403) return { status, transient: false, scope: "account" };
  // Anything else 4xx (404 retired model, 400 rejected request) is about THIS
  // model — the next one in the chain deserves its chance.
  if (status !== null && status >= 400 && status < 500) return { status, transient: false, scope: "model" };
  // No recognizable status: aborted/timeout/network — worth another try.
  return { status, transient: true, scope: "model" };
}

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", description: "BCP-47 tag of the spoken language, e.g. pt-BR" },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", description: 'Consistent label per voice: "Speaker 1", "Speaker 2", ...' },
          start: { type: "string", description: "mm:ss offset from the start of the recording" },
          text: { type: "string" },
        },
        required: ["speaker", "start", "text"],
      },
    },
  },
  required: ["language", "segments"],
};

const PROMPT = [
  "Transcribe this audio recording faithfully and IN FULL, from 00:00 to the last audible sound.",
  "CRITICAL: the transcript must cover the ENTIRE duration. Never stop early, never summarise,",
  "never skip a passage — the final minutes matter as much as the first ones.",
  "Separate speakers with consistent labels using EXACTLY this format: 'Speaker 1', 'Speaker 2'.",
  "A speaker label is never a timestamp and never any other wording.",
  "Each segment carries the mm:ss offset of its start.",
  "Fix punctuation and casing, keep the original language, and never invent content —",
  "if a passage is inaudible, transcribe it as [inaudible].",
].join(" ");

/** Output ceiling: a 60-minute consultation is a long transcript, and the
 *  default budget is where silent truncation starts. */
const MAX_OUTPUT_TOKENS = Number(process.env.TRANSCRIBE_MAX_OUTPUT_TOKENS) || 32_768;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Upload to the Gemini Files API and wait until the file is ACTIVE. */
async function uploadAudioFile(
  client: GoogleGenAI,
  mime: string,
  bytes: Uint8Array,
  /** Milliseconds still available — the poll must not outlive the invocation. */
  remaining: () => number,
): Promise<{ part: Part; name: string }> {
  const uploaded = await client.files.upload({
    file: new Blob([bytes as BlobPart], { type: mime }),
    config: { mimeType: mime },
  });
  if (!uploaded.name || !uploaded.uri) throw new Error("Gemini file upload returned no reference.");

  // Bounded by whichever runs out first: this poll's own ceiling or the time
  // left in the invocation. It used to watch only its own 5-minute deadline, so
  // on a long consultation it could still be polling when the platform pulled
  // the plug — and a killed invocation records nothing.
  const deadline = Date.now() + Math.min(FILE_POLL_TIMEOUT_MS, Math.max(0, remaining()));
  let state = uploaded.state as string | undefined;
  while (state === "PROCESSING") {
    if (Date.now() > deadline || remaining() <= 0) throw new Error("Gemini file processing timed out.");
    await sleep(FILE_POLL_INTERVAL_MS);
    const current = await client.files.get({ name: uploaded.name });
    state = current.state as string | undefined;
  }
  if (state === "FAILED") throw new Error("Gemini could not process the uploaded audio file.");

  return { part: { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType ?? mime } }, name: uploaded.name };
}

/** The attempt plan: the primary gets one retry, each fallback one shot. */
function modelChain(): { model: string; retryOnce: boolean }[] {
  const primary = process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL;
  const fallbacksRaw = process.env.TRANSCRIBE_MODEL_FALLBACKS;
  const fallbacks = (fallbacksRaw === undefined ? DEFAULT_FALLBACK_MODELS : fallbacksRaw.split(","))
    .map((model) => model.trim())
    .filter((model) => model && model !== primary);
  return [{ model: primary, retryOnce: true }, ...fallbacks.map((model) => ({ model, retryOnce: false }))];
}

async function transcribeAudio(
  mime: string,
  bytes: Uint8Array,
  /** Recorded duration, used to verify the transcript reaches the end. */
  expectedSeconds?: number | null,
  /** Shared pipeline deadline (epoch ms) — wins over the local budget. */
  deadlineAt?: number,
): Promise<TranscriptResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set — transcription uses Gemini.");
  // The timeout arms an AbortController per HTTP call inside the SDK. Retries
  // stay OUT of the SDK (no retryOptions here): the loop below owns them, so a
  // fatal 404/credits-depleted is never blindly re-sent.
  const client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: ATTEMPT_TIMEOUT_MS } });

  // The clock starts BEFORE the upload, not after it. Starting it later left
  // the Files API upload and its ACTIVE-state poll — the most expensive part of
  // a long consultation — outside every budget: a large audio could spend
  // minutes there and still enter the generate loop with a full allowance,
  // guaranteeing the invocation died before anything was recorded.
  const startedAt = Date.now();
  // The SHARED deadline wins whenever it is tighter: this invocation's time
  // belongs to the whole pipeline, and extraction still has to run after this.
  // Budgeting the stages independently is what stranded recordings in
  // 'processing' — together they asked for more than the invocation allows.
  const remaining = () => {
    const local = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    return deadlineAt ? Math.min(local, deadlineAt - Date.now()) : local;
  };

  let audioPart: Part;
  let uploadedName: string | undefined;
  if (bytes.byteLength > INLINE_LIMIT_BYTES) {
    const uploaded = await uploadAudioFile(client, mime, bytes, remaining);
    audioPart = uploaded.part;
    uploadedName = uploaded.name;
  } else {
    audioPart = { inlineData: { mimeType: mime, data: Buffer.from(bytes).toString("base64") } };
  }

  const askModel = async (model: string, instruction: string): Promise<TranscriptResult> => {
    // The deadline is whatever is LEFT of the budget, never a fixed per-call
    // timeout. MEASURED IN PRODUCTION: with a 240s per-call timeout under a
    // 285s budget, a call started with 250s left ran on to ~490s; the platform
    // killed the invocation at its own 300s cap, so the terminal fail() never
    // ran and the row stranded in 'processing' with a live lease — the UI said
    // "Processando..." for hours while the cron kept re-claiming it.
    const budgetMs = Math.max(15_000, Math.min(ATTEMPT_TIMEOUT_MS, remaining() - CALL_MARGIN_MS));
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [audioPart, { text: instruction }] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: RESULT_SCHEMA,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(budgetMs),
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no transcript.");
    return normalizeTimestamps(normalizeSpeakers(JSON.parse(text) as TranscriptResult), expectedSeconds);
  };

  const attemptOnce = (model: string) => askModel(model, PROMPT);

  /**
   * Ask for the REST of the audio when a first pass stopped early.
   *
   * There is no native way to clip audio — `videoMetadata.startOffset` is
   * silently ignored for an audio part (measured: the model still consumed all
   * 31,891 audio tokens and transcribed from 00:00). So the window is asked for
   * in the prompt, and it works — but only when the instruction LEADS. In a
   * measured run where the speaker-anchoring context came first, the model
   * ignored the window entirely and re-transcribed from the start, so the
   * ordering below is load-bearing, and the caller verifies the answer instead
   * of trusting it.
   *
   * The anchor exists because each call labels speakers independently: without
   * naming who "Speaker 1" is, the continuation can swap the practitioner and
   * the patient — and the extraction, which matches that label by string,
   * would drop exactly the tongue/pulse findings this tail contains.
   */
  const continueFrom = async (model: string, base: TranscriptResult, fromSeconds: number) => {
    const known = base.segments.slice(-6);
    const voices = new Map<string, string[]>();
    for (const segment of known) {
      const list = voices.get(segment.speaker) ?? [];
      if (list.length < 2) list.push(segment.text.slice(0, 120));
      voices.set(segment.speaker, list);
    }
    const anchor = [...voices.entries()]
      .map(([speaker, lines]) => `- "${speaker}" já disse: ${lines.map((line) => `"${line}"`).join(" / ")}`)
      .join("\n");

    const instruction = [
      `Transcreva SOMENTE o trecho deste áudio a partir de ${formatOffset(fromSeconds)} até o último som audível.`,
      `IGNORE COMPLETAMENTE tudo antes de ${formatOffset(fromSeconds)} — esse trecho já foi transcrito.`,
      "Os timestamps devem ser ABSOLUTOS em relação ao início do arquivo, no formato mm:ss.",
      "",
      "Os rótulos de falante JÁ ESTÃO DEFINIDOS. Reutilize exatamente os mesmos para as mesmas vozes:",
      anchor,
      "Nunca renumere e nunca invente um falante novo.",
      "Transcreva literalmente, sem resumir, até o fim do áudio.",
    ].join("\n");
    return askModel(model, instruction);
  };

  /**
   * Fill the tail by asking for successive windows. Every round must PROVE it
   * advanced (the window was honoured and new speech arrived past the previous
   * end) — otherwise the loop stops, because a model that keeps re-answering
   * from 00:00 would otherwise spin until the budget dies.
   */
  const completeTail = async (model: string, first: TranscriptResult): Promise<TranscriptResult> => {
    let merged = first;
    for (let round = 0; round < MAX_CONTINUATIONS; round += 1) {
      const coverage = transcriptCoverage(merged, expectedSeconds);
      if (coverage >= MIN_COVERAGE) return merged;
      if (remaining() < CONTINUATION_MIN_BUDGET_MS) break;

      const lastSeconds = merged.segments.reduce((max, s) => Math.max(max, offsetSeconds(s.start)), 0);
      // Rewind a little so a sentence straddling the boundary is not lost;
      // mergeTranscripts drops what repeats.
      const from = Math.max(0, lastSeconds - CONTINUATION_OVERLAP_SECONDS);
      const next = await continueFrom(model, merged, from);
      const nextLast = next.segments.reduce((max, s) => Math.max(max, offsetSeconds(s.start)), -1);
      if (nextLast <= lastSeconds) {
        console.warn(`[transcribe] continuation from ${formatOffset(from)} added nothing new — stopping`);
        break;
      }
      merged = mergeTranscripts(merged, next, expectedSeconds);
      console.warn(
        `[transcribe] continuation extended transcript to ${formatOffset(nextLast)} ` +
          `(${Math.round(transcriptCoverage(merged, expectedSeconds) * 100)}% of ${expectedSeconds}s)`,
      );
    }
    return merged;
  };

  try {
    // One uploaded file serves every attempt — switching models is free.
    let lastError: unknown = new Error("Transcription attempts exhausted.");
    /** Best INCOMPLETE result seen, kept as a floor rather than thrown away. */
    let bestPartial: { result: TranscriptResult; coverage: number; model: string } | null = null;

    for (const step of modelChain()) {
      const tries = step.retryOnce ? 2 : 1;
      for (let attempt = 0; attempt < tries; attempt += 1) {
        if (remaining() < 20_000) {
          if (bestPartial) break;
          throw lastError;
        }
        try {
          let result = await attemptOnce(step.model);
          let coverage = transcriptCoverage(result, expectedSeconds);
          if (coverage < MIN_COVERAGE) {
            // Silent truncation: a well-formed transcript that simply stops
            // early. Rather than discard it, ask the SAME model for the rest —
            // measured, a window request returned 11:07 → 16:00 on the audio
            // whose single pass had died at 12:00, recovering the practitioner's
            // dictated tongue, pulse and palpation.
            console.warn(
              `[transcribe] ${step.model} covered ${Math.round(coverage * 100)}% of ${expectedSeconds}s — completing the tail`,
            );
            result = await completeTail(step.model, result);
            coverage = transcriptCoverage(result, expectedSeconds);
          }
          if (coverage < MIN_COVERAGE) {
            // Still short: keep the fullest attempt and let another model try.
            if (!bestPartial || coverage > bestPartial.coverage) {
              bestPartial = { result, coverage, model: step.model };
            }
            break;
          }
          if (step.model !== (process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL)) {
            console.warn(`[transcribe] fallback model ${step.model} succeeded after primary failure`);
          }
          return result;
        } catch (error) {
          lastError = error;
          const failure = classifyProviderError(error);
          // An ACCOUNT failure (bad key, credits depleted) reads the same from
          // every model — stop now rather than burn the chain proving it.
          if (!failure.transient && failure.scope === "account") throw error;
          console.warn(
            `[transcribe] ${step.model} attempt ${attempt + 1}/${tries} failed (status ${failure.status ?? "?"}), ` +
              `${remaining() > 0 ? Math.round(remaining() / 1000) : 0}s budget left`,
          );
          // A model-scoped refusal (404 retired, 400 rejected) will not change
          // on a retry of the SAME model — skip straight to the next one.
          if (!failure.transient) break;
          const willRetrySameModel = attempt + 1 < tries;
          if (willRetrySameModel && remaining() > RETRY_WAIT_MS + 20_000) await sleep(RETRY_WAIT_MS);
        }
      }
    }
    // Every model truncated. Returning the fullest attempt beats losing the
    // consultation entirely — but it is logged loudly, because the missing
    // tail is clinical content nobody was told about.
    if (bestPartial) {
      console.error(
        `[transcribe] INCOMPLETE transcript kept: ${Math.round(bestPartial.coverage * 100)}% coverage from ${bestPartial.model}`,
      );
      return bestPartial.result;
    }
    throw lastError;
  } finally {
    // Uploaded files auto-expire in 48h; deleting sooner is hygiene, not
    // correctness — never let cleanup mask the transcription result. It is also
    // not AWAITED: this runs when the budget is nearly spent, and spending the
    // invocation's last seconds on housekeeping instead of returning the
    // transcript we already have is how a good result gets thrown away.
    if (uploadedName) {
      void client.files.delete({ name: uploadedName }).catch(() => undefined);
    }
  }
}

export type TranscriptionRunResult =
  | { ok: true; segments: number }
  | {
      ok: false;
      error: string;
      /**
       * Whether retrying later could plausibly succeed. False for definitive
       * provider refusals (bad key, model gone, credits depleted) — the caller
       * must surface those instead of re-burning retries on them.
       */
      transient?: boolean;
    };

/**
 * Download + transcribe + persist one transcriptions row. Idempotent.
 * Source audio is deliberately retained when the transcript becomes ready.
 * A separate professional validation + deletion request is the retention
 * boundary; a provider response alone must never destroy clinical evidence.
 * Runs under whatever client it is given (Inngest job: service role;
 * inline fallback: the user's client, RLS applies).
 */
export async function processTranscription(
  supabase: SupabaseClient,
  transcriptionId: string,
  /** Recorded duration in seconds — lets the run verify the transcript is complete. */
  expectedSeconds?: number | null,
  /**
   * Absolute epoch-ms deadline SHARED with the rest of the pipeline. The caller
   * owns the invocation's time: transcription is only the first stage, and
   * extraction still has to run after it in the SAME invocation.
   */
  deadlineAt?: number,
): Promise<TranscriptionRunResult> {
  const { data: row, error: loadError } = await supabase
    .from("transcriptions")
    .select("id, audio_path, mime")
    .eq("id", transcriptionId)
    .maybeSingle();
  if (loadError || !row) return { ok: false, error: loadError?.message ?? "Transcription not found." };
  if (!row.audio_path) return { ok: false, error: "Transcription has no source audio (already deleted?)." };

  await supabase.from("transcriptions").update({ status: "processing", error: null }).eq("id", transcriptionId);

  try {
    const { data: blob, error: downloadError } = await supabase.storage.from("transcriptions").download(row.audio_path);
    if (downloadError || !blob) throw new Error(downloadError?.message ?? "Audio download failed.");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await transcribeAudio(row.mime, bytes, expectedSeconds, deadlineAt);

    await supabase.from("transcriptions").update({ status: "ready", result }).eq("id", transcriptionId);

    return { ok: true, segments: result.segments.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The RAW provider message is persisted — it is the diagnosis (/admin/audit
    // reads it); the transient flag is how the pipeline decides retry-vs-stop.
    await supabase.from("transcriptions").update({ status: "error", error: message }).eq("id", transcriptionId);
    return { ok: false, error: message, transient: classifyProviderError(error).transient };
  }
}
