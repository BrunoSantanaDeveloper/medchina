import { FinishReason, GoogleGenAI, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { TranscriptResult } from "./types";
import {
  cutAtRepetitionLoop,
  formatOffset,
  mergeTranscripts,
  normalizeSpeakers,
  normalizeTimestamps,
  offsetSeconds,
  reachesEnd,
  salvageTranscriptJson,
  transcriptCoverage,
} from "./normalize";

/**
 * Pinned, never a `-latest` alias: measured against the live API on 2026-08-27,
 * `gemini-flash-latest` and `gemini-3.7-flash` BOTH answered 503 "high demand"
 * while the older generations answered normally. The alias points at the newest
 * generation, which is exactly the most congested pool — the worst possible
 * default for a background job that must not fail. Re-measured 2026-09-29 on
 * the replacement project: `-latest`, 3.8 and 3.7 still 503 on three
 * consecutive attempts; 3.6 and below answer instantly.
 *
 * It is 3.6 rather than 2.5 because THE 2.x FAMILY IS GONE for this project:
 * `gemini-2.5-flash`, `gemini-2.5-flash-lite` and `gemini-2.0-flash` all answer
 * 404 "no longer available to new users". A model a Google project has used
 * before keeps working; a project created after the retirement never gets it —
 * so rebuilding the Cloud project (as the suspension forced) silently retired
 * the primary AND its last fallback at once, and every transcription was paying
 * a wasted 404 round-trip before the chain reached a model that exists.
 */
const DEFAULT_MODEL = "gemini-3.6-flash";
/**
 * Models tried IN ORDER after the primary exhausts its transient retries.
 *
 * The chain deliberately spans GENERATIONS and TIERS (3.6 -> 3.5 -> 3.5-lite):
 * separate capacity pools, so one overloaded generation cannot take the whole
 * chain down, and the last step is a lite model because the lite pools stayed
 * clear in every probe while the flagship pools were shedding load. Override
 * with TRANSCRIBE_MODEL_FALLBACKS (comma-separated, empty disables).
 *
 * Keep these pinned and RE-MEASURE when a project is rebuilt or a version is
 * retired: availability is per Google project, not per API key, so a chain that
 * is healthy in one project can be entirely 404 in the next one.
 */
const DEFAULT_FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];

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
 * Per-CALL ceiling. Congestion on Gemini OSCILLATES minute to minute — the same
 * audio that hung past the whole budget in the 17:08 production attempt
 * answered in 35s on a probe at 17:14. Good runs measure 35–70s, so a call
 * still silent at 80s is almost certainly parked in a congested window:
 * cutting it leaves room for a SECOND fresh call inside the same invocation,
 * which may land in a clear window. On short audio, one hung call must never
 * eat the budget.
 */
const ATTEMPT_TIMEOUT_MS = Number(process.env.TRANSCRIBE_ATTEMPT_TIMEOUT_MS) || 80_000;
/**
 * ...but 80 s is a ceiling for SHORT audio only: generation time grows with the
 * length of what is transcribed. MEASURED in production on the 3.x chain: an
 * 18.6-min audio was cut at 80 s on gemini-3.6-flash and answered in ~67 s on
 * the fallback (~60-75 ms per audio second); a 47-min consultation was cut at
 * 80 s and then 75 s on every one of its 16 runs, because no call that size can
 * finish in 80 s — the cap guaranteed the failure it was meant to prevent. The
 * cap is now the larger of 80 s and twice the expected time of what the call
 * must write (bounded by one reply's worth), and it is lifted to everything
 * left when the time it would free could not host another call.
 */
const ATTEMPT_MS_PER_AUDIO_SECOND = Number(process.env.TRANSCRIBE_ATTEMPT_MS_PER_AUDIO_SECOND) || 140;
/**
 * Overall budget across every attempt. The pipeline passes a tighter SHARED
 * deadline, which always wins — this is only the ceiling when called directly.
 *
 * MEASURED 2026-08-27 on a real 16m36s consultation: 53s on gemini-2.5-flash,
 * 197s on gemini-3.5-flash. That measurement is why 2.5 leads the chain: it was
 * ~4x faster AND produced clean speaker labels, while 3.5 emitted a bogus
 * "Speaker 08:57" as a third voice on a two-voice consultation.
 *
 * The invocation ceiling really is 300s: this project is on the Vercel HOBBY
 * plan, which REFUSES a deploy declaring anything higher. So this budget is
 * deliberately smaller than what some models need — 3.5-flash at 197s does not
 * fit alongside extraction — and that is the point. 2.5 leads because it FITS
 * (53s measured), and a model that cannot is cut off by us, with a recorded
 * reason, rather than by the platform killing the whole invocation and leaving
 * the recording stranded in 'processing'.
 */
const TOTAL_BUDGET_MS = Number(process.env.TRANSCRIBE_TOTAL_BUDGET_MS) || 170_000;
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
/**
 * The most audio one reply can write out before MAX_OUTPUT_TOKENS cuts it.
 * MEASURED on the 3.x chain: ~16 output tokens per audio second, thinking
 * included (17,724 for an 1118 s consultation) — ~34 min at the default. No
 * call runs longer than writing this much: past it the reply comes back cut.
 */
const SINGLE_PASS_AUDIO_SECONDS = MAX_OUTPUT_TOKENS / 16;

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
  // The primary gets a SECOND try only when it is alone: with fallbacks
  // configured, retrying the same hung model spends exactly the window the
  // next model needed — measured in production, two consecutive cut calls on
  // one congested primary exhausted the budget before any fallback ran.
  return [{ model: primary, retryOnce: fallbacks.length === 0 }, ...fallbacks.map((model) => ({ model, retryOnce: false }))];
}

/** A failed run may still carry PROGRESS — the caller persists it for resume. */
/**
 * What one call to the model consumed. A single transcription is rarely one
 * call: a long consultation is a first pass plus continuations, and a
 * congested model sends the whole thing to a fallback — every one of those is
 * billed, so every one of them reports.
 */
export interface TranscribeUsage {
  /** The model that answered, which the fallback chain can change mid-run. */
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Audio tokens, priced apart from text by Gemini. */
  audioTokensIn: number;
}

/** Gemini reports the prompt as a total plus a per-modality breakdown. */
function splitUsage(
  metadata:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        promptTokensDetails?: { modality?: string; tokenCount?: number }[];
      }
    | undefined,
  model: string,
): TranscribeUsage | null {
  if (!metadata) return null;
  const audio = (metadata.promptTokensDetails ?? [])
    .filter((detail) => (detail.modality ?? "").toUpperCase() === "AUDIO")
    .reduce((total, detail) => total + (detail.tokenCount ?? 0), 0);
  return {
    model,
    tokensIn: Math.max(0, (metadata.promptTokenCount ?? 0) - audio),
    // Thinking is billed as output whether or not anyone reads it.
    tokensOut: (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
    audioTokensIn: audio,
  };
}

interface PartialCarrier {
  partialTranscript?: TranscriptResult;
  /** When the failing call itself started (a continuation starts after its pass). */
  callStartedAt?: number;
}

/**
 * A transcript as far as the model replies have taken it.
 *  - `cut`: the last reply ended at the output limit, not on its own — the
 *    speech after its last finished segment was never written.
 *  - `confirmed`: a later reply re-read the end of the audio (its window was
 *    honoured) and ended on its own without finding more speech.
 */
interface Pass {
  result: TranscriptResult;
  cut: boolean;
  confirmed?: boolean;
}

/** How far before the requested window a continuation may start and still count as honouring it. */
const WINDOW_SLACK_SECONDS = 15;
/**
 * A continuation must reach this far past the last line we hold to count as an
 * advance: re-read lines come back a few seconds later than the originals
 * (the same tolerance mergeTranscripts uses to drop them as duplicates).
 */
const ADVANCE_SECONDS = 12;
/**
 * The output a reply may be asked for is sized to what it can write before our
 * own timer fires, at a conservative ~190 tokens/s after ~15 s of prefill
 * (3.6-flash was measured below ~220 tokens/s). A slow reply then ends at the
 * output limit — a prefix that is kept and resumed — instead of being aborted
 * with nothing, while Google bills the whole generation anyway.
 */
const SAFE_OUTPUT_TOKENS_PER_SECOND = 190;
const PREFILL_ALLOWANCE_MS = 15_000;

function withPartial(error: Error, partial: TranscriptResult | null): Error {
  if (partial && partial.segments.length > 0) (error as Error & PartialCarrier).partialTranscript = partial;
  return error;
}

/** One line per failed call, so the persisted error names what happened to each. */
function describeFailure(model: string, error: unknown, status: number | null, startedAt: number): string {
  const callStartedAt = (error as (Error & PartialCarrier) | null)?.callStartedAt;
  const call = callStartedAt ? `${model} continuation` : model;
  const seconds = Math.round((Date.now() - (callStartedAt ?? startedAt)) / 1000);
  const name = error instanceof Error ? error.name : "";
  // The SDK aborts with no reason, so its text cannot tell OUR limit from a
  // provider event — the error's name can.
  if (name === "AbortError" || name === "TimeoutError") return `${call} cut by our time limit after ${seconds}s`;
  if (status !== null) return `${call} failed with status ${status} after ${seconds}s`;
  const message = error instanceof Error ? error.message : String(error);
  return `${call} failed after ${seconds}s (${message.slice(0, 80)})`;
}

/**
 * The terminal error, naming every attempt. "This operation was aborted" alone
 * reached /admin/audit for a 47-min consultation and read like a Google outage;
 * it was our own time limit, twice per run. The HTTP status rides along so the
 * caller still classifies the failure from it.
 */
function failedWithCause(lastError: unknown, attempts: string[], expectedSeconds?: number | null): Error {
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const audio = expectedSeconds ? `audio ${Math.round(expectedSeconds)}s; ` : "";
  const error = new Error(`Transcription failed (${audio}${attempts.join("; ") || "no attempt completed"}): ${message}`);
  const status = (lastError as { status?: unknown } | null)?.status;
  if (typeof status === "number") (error as Error & { status: number }).status = status;
  return error;
}

/**
 * Exported for EVALUATION only (`scripts/eval-transcription.mts`), never for
 * production callers — `processTranscription` below is the one that owns the
 * row, the status machine and the resume. It is exported rather than copied
 * because an evaluation that reimplements the prompt, the schema, the coverage
 * check and the continuation loop would be measuring a different pipeline than
 * the one that runs, and would drift away from it silently.
 *
 * It reads its model from `TRANSCRIBE_MODEL`, so a comparison sets that per run.
 */
export async function transcribeAudio(
  mime: string,
  bytes: Uint8Array,
  /** Recorded duration, used to verify the transcript reaches the end. */
  expectedSeconds?: number | null,
  /** Shared pipeline deadline (epoch ms) — wins over the local budget. */
  deadlineAt?: number,
  /**
   * PARTIAL transcript persisted by a previous attempt. Every retry is a fresh
   * invocation with a fresh time budget — resuming means the new session asks
   * only for the REMAINING window instead of re-transcribing from zero, so
   * progress accumulates across congestion waves instead of being discarded by
   * each one.
   */
  resumeFrom?: TranscriptResult | null,
  /**
   * Called once per model call with what it consumed. Transcription is the
   * platform's largest AI expense and used to be entirely unmeasured.
   */
  onUsage?: (usage: TranscribeUsage) => void,
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
  /**
   * The time a fresh pass over this audio is expected to take (~70 ms per audio
   * second measured, bounded by what one reply can write). A later pass is not
   * started with less: it could not finish, and an aborted call is billed
   * anyway — cancelling the request does not cancel the work on Google's side.
   */
  const passMs = Math.max(
    20_000,
    (Math.min(expectedSeconds ?? 0, SINGLE_PASS_AUDIO_SECONDS) * ATTEMPT_MS_PER_AUDIO_SECOND) / 2,
  );
  /**
   * Done when the transcript ended on its own and its last segment starts within
   * the coverage threshold — or when a confirming reply found nothing past a
   * transcript that already reaches the end of the recording.
   */
  const isComplete = (pass: Pass) =>
    (!pass.cut && transcriptCoverage(pass.result, expectedSeconds) >= MIN_COVERAGE) ||
    (pass.confirmed === true && reachesEnd(pass.result, expectedSeconds));

  let audioPart: Part;
  let uploadedName: string | undefined;
  if (bytes.byteLength > INLINE_LIMIT_BYTES) {
    const uploaded = await uploadAudioFile(client, mime, bytes, remaining);
    audioPart = uploaded.part;
    uploadedName = uploaded.name;
  } else {
    audioPart = { inlineData: { mimeType: mime, data: Buffer.from(bytes).toString("base64") } };
  }

  const askModel = async (
    model: string,
    instruction: string,
    /** Seconds of audio this call must write out — the whole file, or a window's tail. */
    windowSeconds: number | null | undefined,
    /** A continuation: its speaker labels were anchored by the prompt and must survive. */
    anchored = false,
  ): Promise<Pass> => {
    // The deadline is whatever is LEFT of the budget, never a fixed per-call
    // timeout. MEASURED IN PRODUCTION: with a 240s per-call timeout under a
    // 285s budget, a call started with 250s left ran on to ~490s; the platform
    // killed the invocation at its own 300s cap, so the terminal fail() never
    // ran and the row stranded in 'processing' with a live lease — the UI said
    // "Processando..." for hours while the cron kept re-claiming it.
    const capMs = Math.max(
      ATTEMPT_TIMEOUT_MS,
      Math.min(windowSeconds ?? 0, SINGLE_PASS_AUDIO_SECONDS) * ATTEMPT_MS_PER_AUDIO_SECOND,
    );
    const left = remaining() - CALL_MARGIN_MS;
    // Cutting a slow call early only pays when the time it frees can host the
    // next one; otherwise it throws away a reply that is billed anyway.
    const nextCallMs = anchored ? CONTINUATION_MIN_BUDGET_MS : passMs;
    const budgetMs = Math.max(15_000, left - capMs < nextCallMs ? left : capMs);
    const outputTokens = Math.min(
      MAX_OUTPUT_TOKENS,
      Math.max(4_096, Math.floor(((budgetMs - PREFILL_ALLOWANCE_MS) / 1000) * SAFE_OUTPUT_TOKENS_PER_SECOND)),
    );
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [audioPart, { text: instruction }] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: RESULT_SCHEMA,
        temperature: 0,
        maxOutputTokens: outputTokens,
        // The client's own timer is armed per request at ATTEMPT_TIMEOUT_MS and
        // would still cut a long call at 80 s; this call's budget replaces it.
        httpOptions: { timeout: budgetMs },
        abortSignal: AbortSignal.timeout(budgetMs),
      },
    });
    // Reported before the reply is even checked: a call that came back empty
    // or cut short still consumed the whole audio.
    if (onUsage) {
      const usage = splitUsage(response.usageMetadata, model);
      if (usage) {
        try {
          onUsage(usage);
        } catch {
          // Metering never fails a transcription.
        }
      }
    }

    const finish = response.candidates?.[0]?.finishReason;
    let cut = finish === FinishReason.MAX_TOKENS;
    const text = response.text;
    if (!text) throw new Error(`Gemini returned no transcript (finishReason ${finish ?? "?"}).`);
    let parsed: TranscriptResult;
    try {
      parsed = JSON.parse(text) as TranscriptResult;
    } catch {
      // A reply cut at maxOutputTokens (thinking counts against it) is a JSON
      // prefix whose finished segments were transcribed and billed: keep them,
      // and the rest is asked for — now or by the next attempt, which resumes
      // from them. Anything else unreadable (malformed mid-transcript, SAFETY,
      // RECITATION) still fails, so another model retries it whole instead of
      // a hole being accepted.
      const salvaged = cut ? salvageTranscriptJson(text) : null;
      if (!salvaged) throw new Error(`Gemini returned an unreadable transcript (finishReason ${finish ?? "?"}).`);
      console.warn(`[transcribe] ${model} reply was cut by the output limit; kept ${salvaged.segments.length} segments`);
      parsed = salvaged;
    }
    let result = normalizeTimestamps(normalizeSpeakers(parsed, { keepCanonical: anchored }), expectedSeconds);
    // A reply that degenerates into a repetition loop is not transcript from
    // there on: keep what came before and treat the pass as cut, so the rest is
    // asked for again instead of the loop vouching for audio it never read.
    const beforeLoop = cutAtRepetitionLoop(result, { cut });
    if (beforeLoop) {
      console.warn(`[transcribe] ${model} degenerated into a repetition loop — kept ${beforeLoop.segments.length} segments`);
      result = beforeLoop;
      cut = true;
    }
    // Segments past the recorded duration are KEPT: the duration is the
    // browser's wall clock and model timestamps drift on long audio, so a
    // filter here measured as dropping real closing speech. Logged instead.
    const lastStart = result.segments.reduce((max, s) => Math.max(max, offsetSeconds(s.start)), -1);
    if (expectedSeconds && lastStart > expectedSeconds + 60) {
      console.warn(`[transcribe] ${model} placed speech at ${formatOffset(lastStart)} of a ${expectedSeconds}s recording`);
    }
    return { result, cut };
  };

  const attemptOnce = (model: string) => askModel(model, PROMPT, expectedSeconds);

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
    return askModel(model, instruction, expectedSeconds ? Math.max(0, expectedSeconds - fromSeconds) : null, true);
  };

  /**
   * Fill the tail by asking for successive windows. Every round must PROVE it
   * advanced (the window was honoured and new speech arrived past the previous
   * end) — otherwise the loop stops, because a model that keeps re-answering
   * from 00:00 would otherwise spin until the budget dies.
   */
  const completeTail = async (model: string, first: Pass): Promise<Pass> => {
    let merged = first;
    for (let round = 0; round < MAX_CONTINUATIONS; round += 1) {
      if (isComplete(merged)) return merged;
      if (remaining() < CONTINUATION_MIN_BUDGET_MS) break;

      const lastSeconds = merged.result.segments.reduce((max, s) => Math.max(max, offsetSeconds(s.start)), 0);
      // Rewind a little so a sentence straddling the boundary is not lost;
      // mergeTranscripts drops what repeats.
      const from = Math.max(0, lastSeconds - CONTINUATION_OVERLAP_SECONDS);
      const callStartedAt = Date.now();
      let next: Pass;
      try {
        next = await continueFrom(model, merged.result, from);
      } catch (error) {
        // The first pass and every merged window were already transcribed and
        // billed — they ride on the error so the caller keeps them, instead of
        // a failed continuation throwing away everything before it.
        const carrier = withPartial(error instanceof Error ? error : new Error(String(error)), merged.result);
        (carrier as Error & PartialCarrier).callStartedAt = callStartedAt;
        throw carrier;
      }
      const starts = next.result.segments.map((s) => offsetSeconds(s.start));
      const nextLast = starts.length > 0 ? Math.max(...starts) : -1;
      // Did the reply demonstrably read the requested window — start inside
      // it, not at 00:00, not relative to the window, not empty?
      const honoured = starts.length > 0 && Math.min(...starts) >= from - WINDOW_SLACK_SECONDS;
      if (nextLast <= lastSeconds + ADVANCE_SECONDS) {
        // Nothing past what we hold, or the same lines re-read a few seconds
        // later. Not an advance: a cut stays a cut and a short transcript stays
        // short. It CONFIRMS the end only when the window was honoured and the
        // reply ended on its own — and the few lines it adds are kept only then.
        if (honoured && nextLast > lastSeconds) {
          merged = { ...merged, result: mergeTranscripts(merged.result, next.result, expectedSeconds) };
        }
        if (honoured && !next.cut) merged = { ...merged, confirmed: true };
        console.warn(
          `[transcribe] continuation from ${formatOffset(from)} added nothing new` +
            `${honoured && !next.cut ? " (end confirmed)" : ""} — stopping`,
        );
        break;
      }
      if (!honoured) {
        // It ignored the window. Its lines can still be stitched — the measured
        // "re-transcribed from 00:00" reply — but only on the SAME clock: lines
        // inside what we hold must mostly be lines we already hold. Otherwise
        // (timestamps relative to the window, a drifted clock) merging would
        // plant real speech at the wrong times, where provenance points.
        const inside = next.result.segments.filter((s) => offsetSeconds(s.start) <= lastSeconds);
        const unseen =
          mergeTranscripts(merged.result, { ...next.result, segments: inside }, expectedSeconds).segments.length -
          merged.result.segments.length;
        if (inside.length > 0 && unseen > inside.length / 2) {
          console.warn(`[transcribe] continuation from ${formatOffset(from)} is on another clock — not stitched`);
          break;
        }
      }
      merged = { result: mergeTranscripts(merged.result, next.result, expectedSeconds), cut: next.cut };
      console.warn(
        `[transcribe] continuation extended transcript to ${formatOffset(nextLast)} ` +
          `(${Math.floor(transcriptCoverage(merged.result, expectedSeconds) * 100)}% of ${expectedSeconds}s` +
          `${merged.cut ? ", cut again by the output limit" : ""})`,
      );
    }
    return merged;
  };

  try {
    // One uploaded file serves every attempt — switching models is free.
    let lastError: unknown = new Error("Transcription attempts exhausted.");
    /** What happened to each call, so the persisted error names a CAUSE. */
    const attempts: string[] = [];
    /** Best INCOMPLETE result seen, kept as a floor rather than thrown away. */
    let bestPartial: { result: TranscriptResult; coverage: number; model: string; cut: boolean } | null = null;
    /** A failed call may still carry finished segments (see completeTail). */
    const keepCarried = (error: unknown, model: string) => {
      const carried = (error as (Error & PartialCarrier) | null)?.partialTranscript;
      if (!carried) return;
      const coverage = transcriptCoverage(carried, expectedSeconds);
      if (!bestPartial || coverage >= bestPartial.coverage) bestPartial = { result: carried, coverage, model, cut: false };
    };

    // ---- Resume: a previous session already transcribed part of this audio.
    // Do not start over — ask only for the rest. A persisted partial is
    // incomplete by construction and may END WHERE A REPLY WAS CUT, so it is
    // never accepted on its coverage alone: a continuation has to confirm it.
    if (resumeFrom?.segments?.length) {
      let base: Pass = { result: normalizeTimestamps(resumeFrom, expectedSeconds), cut: true };
      console.warn(
        `[transcribe] resuming from a persisted partial at ${Math.floor(transcriptCoverage(base.result, expectedSeconds) * 100)}% coverage`,
      );
      for (const step of modelChain()) {
        if (remaining() < CONTINUATION_MIN_BUDGET_MS) break;
        const stepStartedAt = Date.now();
        try {
          // Each model gives its own answer: a confirmation from the previous
          // one does not stop this one from finding more.
          base = await completeTail(step.model, { ...base, confirmed: false });
          if (isComplete(base)) {
            console.warn(`[transcribe] resumed partial completed by ${step.model}`);
            return base.result;
          }
        } catch (error) {
          const carried = (error as (Error & PartialCarrier) | null)?.partialTranscript;
          if (carried && transcriptCoverage(carried, expectedSeconds) >= transcriptCoverage(base.result, expectedSeconds)) {
            base = { result: carried, cut: true };
          }
          const failure = classifyProviderError(error);
          attempts.push(describeFailure(step.model, error, failure.status, stepStartedAt));
          if (!failure.transient && failure.scope === "account") {
            throw error instanceof Error ? withPartial(error, base.result) : error;
          }
          console.warn(`[transcribe] resume continuation on ${step.model} failed (status ${failure.status ?? "?"})`);
        }
      }
      // A re-read CONFIRMED that the speech ends where the partial does, within
      // the coverage threshold yet not near the end of the recording: a reply
      // cut just after its last line with silence after it, which no
      // continuation can finish. One fresh pass, when there is time for it,
      // ends on its own and is judged normally. Below the threshold a fresh
      // pass would stop at the same point and could never pass — only billed.
      const resumedCoverage = transcriptCoverage(base.result, expectedSeconds);
      if (base.confirmed && resumedCoverage >= MIN_COVERAGE && remaining() >= passMs) {
        bestPartial = { result: base.result, coverage: resumedCoverage, model: "resumed partial", cut: false };
      } else {
        // Still short: persist whatever we EXTENDED so the next session starts
        // even further ahead, and let the caller retry later.
        throw withPartial(
          new Error(
            `Transcription resumed but is still incomplete at ${Math.floor(transcriptCoverage(base.result, expectedSeconds) * 100)}% coverage` +
              `${attempts.length > 0 ? ` (${attempts.join("; ")})` : ""} — will resume again on the next attempt.`,
          ),
          base.result,
        );
      }
    }

    for (const step of modelChain()) {
      const tries = step.retryOnce ? 2 : 1;
      for (let attempt = 0; attempt < tries; attempt += 1) {
        // The first pass of an invocation runs with any useful time (20 s) —
        // this invocation will never have more, and on long audio its reply,
        // sized to the budget, is what the next attempt resumes from. A later
        // pass needs the time its audio is expected to take.
        const neededMs = attempts.length > 0 || bestPartial ? passMs : 20_000;
        if (remaining() < neededMs) {
          if (bestPartial) break;
          // This exit used to rethrow the raw abort, so the most common failure
          // reached /admin/audit as a bare "This operation was aborted".
          throw failedWithCause(
            lastError,
            [
              ...attempts,
              `${step.model} not tried (needs ${Math.round(neededMs / 1000)}s, ${Math.max(0, Math.round(remaining() / 1000))}s left)`,
            ],
            expectedSeconds,
          );
        }
        const attemptStartedAt = Date.now();
        try {
          let pass = await attemptOnce(step.model);
          if (!isComplete(pass)) {
            // Silent truncation (a well-formed transcript that stops early) or
            // a reply cut by the output limit. Rather than discard it, ask the
            // SAME model for the rest — measured, a window request returned
            // 11:07 → 16:00 on the audio whose single pass had died at 12:00,
            // recovering the practitioner's dictated tongue, pulse and palpation.
            const covered = Math.floor(transcriptCoverage(pass.result, expectedSeconds) * 100);
            console.warn(
              `[transcribe] ${step.model} ${pass.cut ? "was cut by the output limit" : "stopped early"} at ` +
                `${covered}% of ${expectedSeconds}s — completing the tail`,
            );
            pass = await completeTail(step.model, pass);
          }
          if (!isComplete(pass)) {
            // Still short: keep the fullest attempt and let another model try.
            const coverage = transcriptCoverage(pass.result, expectedSeconds);
            if (!bestPartial || coverage > bestPartial.coverage) {
              bestPartial = { result: pass.result, coverage, model: step.model, cut: pass.cut };
            }
            break;
          }
          if (step.model !== (process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL)) {
            console.warn(`[transcribe] fallback model ${step.model} succeeded after primary failure`);
          }
          return pass.result;
        } catch (error) {
          lastError = error;
          const failure = classifyProviderError(error);
          attempts.push(describeFailure(step.model, error, failure.status, attemptStartedAt));
          keepCarried(error, step.model);
          // An ACCOUNT failure (bad key, credits depleted) reads the same from
          // every model — stop now rather than burn the chain proving it. The
          // furthest transcript so far rides along so it is not re-bought.
          if (!failure.transient && failure.scope === "account") {
            throw error instanceof Error ? withPartial(error, bestPartial?.result ?? null) : error;
          }
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
    // Exhausted. An incomplete transcript is no longer ACCEPTED as ready (that
    // hid a missing tail of tongue/pulse findings behind a green status) — it
    // is PERSISTED as a partial, so the next session resumes from it instead of
    // starting over. And the error names its cause: "This operation was
    // aborted" alone made it impossible to tell our budget cut from a provider
    // outage without reading the code.
    if (bestPartial) {
      const how = bestPartial.cut ? "cut by the output limit" : "incomplete";
      throw withPartial(
        new Error(
          `Transcription ${how} at ${Math.floor(bestPartial.coverage * 100)}% coverage (${[`best pass ${bestPartial.model}`, ...attempts].join("; ")}) — partial saved; the next attempt resumes from it.`,
        ),
        bestPartial.result,
      );
    }
    throw failedWithCause(lastError, attempts, expectedSeconds);
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
    .select("id, org_id, audio_path, mime, result")
    .eq("id", transcriptionId)
    .maybeSingle();
  if (loadError || !row) return { ok: false, error: loadError?.message ?? "Transcription not found." };
  if (!row.audio_path) return { ok: false, error: "Transcription has no source audio (already deleted?)." };

  // A previous session may have gotten PART of the way before its budget ran
  // out — that partial is persisted in `result` alongside status='error'.
  // Resuming from it means each retry extends the work instead of redoing it,
  // which is what lets a long consultation cross congestion waves at all.
  const raw = row.result as TranscriptResult | null;
  const resumeFrom = raw && Array.isArray(raw.segments) && raw.segments.length > 0 ? raw : null;

  await supabase.from("transcriptions").update({ status: "processing", error: null }).eq("id", transcriptionId);

  // Collected during the run and written afterwards — including when the run
  // failed, because a transcription that died on the third continuation was
  // billed for all three.
  const spent: TranscribeUsage[] = [];
  const recordSpend = async () => {
    for (const [index, usage] of spent.entries()) {
      try {
        await supabase.rpc("record_ai_spend", {
          target_org: row.org_id,
          target_feature: "transcription",
          target_provider: "gemini",
          target_model: usage.model,
          target_tokens_in: usage.tokensIn,
          target_tokens_out: usage.tokensOut,
          // Only the first call carries the seconds: the continuations re-read
          // the SAME audio, and counting it again would inflate the minutes
          // the console reconciles against `audio_usage`.
          target_audio_seconds: index === 0 ? Math.max(0, Math.round(expectedSeconds ?? 0)) : 0,
          target_audio_tokens: usage.audioTokensIn,
          target_ref: transcriptionId,
          target_estimated: false,
        });
      } catch {
        // Bookkeeping never fails a transcription.
      }
    }
  };

  try {
    const { data: blob, error: downloadError } = await supabase.storage.from("transcriptions").download(row.audio_path);
    if (downloadError || !blob) throw new Error(downloadError?.message ?? "Audio download failed.");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await transcribeAudio(row.mime, bytes, expectedSeconds, deadlineAt, resumeFrom, (usage) =>
      spent.push(usage),
    );

    await supabase.from("transcriptions").update({ status: "ready", result }).eq("id", transcriptionId);
    await recordSpend();

    return { ok: true, segments: result.segments.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The error now NAMES its cause (model, elapsed, our-abort vs provider
    // status) — "This operation was aborted" alone was undiagnosable from
    // /admin/audit. Any partial progress rides along in `result` for resume.
    const partial = (error as Error & { partialTranscript?: TranscriptResult }).partialTranscript;
    await supabase
      .from("transcriptions")
      .update({ status: "error", error: message, ...(partial ? { result: partial } : {}) })
      .eq("id", transcriptionId);
    await recordSpend();
    return { ok: false, error: message, transient: classifyProviderError(error).transient };
  }
}
