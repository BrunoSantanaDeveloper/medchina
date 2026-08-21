import { GoogleGenAI, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { TranscriptResult } from "./types";

const DEFAULT_MODEL = "gemini-flash-latest";
/**
 * Models tried IN ORDER after the primary exhausts its transient retries.
 * `gemini-flash-latest` is a floating alias that concentrates demand — during a
 * capacity spike it 503s while pinned models on separate pools still answer.
 * Override with TRANSCRIBE_MODEL_FALLBACKS (comma-separated, empty disables).
 */
const DEFAULT_FALLBACK_MODELS = ["gemini-2.0-flash"];

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
const ATTEMPT_TIMEOUT_MS = Number(process.env.TRANSCRIBE_ATTEMPT_TIMEOUT_MS) || 180_000;
/** Overall budget across every attempt — must finish under the caller's cap. */
const TOTAL_BUDGET_MS = Number(process.env.TRANSCRIBE_TOTAL_BUDGET_MS) || 250_000;
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
    return { status, transient: !FATAL_QUOTA_MARKERS.some((marker) => lower.includes(marker)) };
  }
  if (status !== null && [408, 500, 502, 503, 504].includes(status)) return { status, transient: true };
  if (status !== null && status >= 400 && status < 500) return { status, transient: false };
  // No recognizable status: aborted/timeout/network — worth another try.
  return { status, transient: true };
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
  "Transcribe this audio recording faithfully.",
  "Separate speakers with consistent labels (Speaker 1, Speaker 2, ...) and mm:ss timestamps.",
  "Fix punctuation and casing, keep the original language, and never invent or summarize content —",
  "if a passage is inaudible, transcribe it as [inaudible].",
].join(" ");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Upload to the Gemini Files API and wait until the file is ACTIVE. */
async function uploadAudioFile(
  client: GoogleGenAI,
  mime: string,
  bytes: Uint8Array,
): Promise<{ part: Part; name: string }> {
  const uploaded = await client.files.upload({
    file: new Blob([bytes as BlobPart], { type: mime }),
    config: { mimeType: mime },
  });
  if (!uploaded.name || !uploaded.uri) throw new Error("Gemini file upload returned no reference.");

  const deadline = Date.now() + FILE_POLL_TIMEOUT_MS;
  let state = uploaded.state as string | undefined;
  while (state === "PROCESSING") {
    if (Date.now() > deadline) throw new Error("Gemini file processing timed out.");
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

async function transcribeAudio(mime: string, bytes: Uint8Array): Promise<TranscriptResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set — transcription uses Gemini.");
  // The timeout arms an AbortController per HTTP call inside the SDK. Retries
  // stay OUT of the SDK (no retryOptions here): the loop below owns them, so a
  // fatal 404/credits-depleted is never blindly re-sent.
  const client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: ATTEMPT_TIMEOUT_MS } });

  let audioPart: Part;
  let uploadedName: string | undefined;
  if (bytes.byteLength > INLINE_LIMIT_BYTES) {
    const uploaded = await uploadAudioFile(client, mime, bytes);
    audioPart = uploaded.part;
    uploadedName = uploaded.name;
  } else {
    audioPart = { inlineData: { mimeType: mime, data: Buffer.from(bytes).toString("base64") } };
  }

  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  const attemptOnce = async (model: string): Promise<TranscriptResult> => {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [audioPart, { text: PROMPT }] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: RESULT_SCHEMA,
        temperature: 0,
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no transcript.");
    return JSON.parse(text) as TranscriptResult;
  };

  try {
    // One uploaded file serves every attempt — switching models is free.
    let lastError: unknown = new Error("Transcription attempts exhausted.");
    for (const step of modelChain()) {
      const tries = step.retryOnce ? 2 : 1;
      for (let attempt = 0; attempt < tries; attempt += 1) {
        if (remaining() < 20_000) throw lastError;
        try {
          const result = await attemptOnce(step.model);
          if (step.model !== (process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL)) {
            console.warn(`[transcribe] fallback model ${step.model} succeeded after primary failure`);
          }
          return result;
        } catch (error) {
          lastError = error;
          const failure = classifyProviderError(error);
          // A fatal failure (bad key, model gone, credits depleted) reads the
          // same from every model and every retry — stop immediately.
          if (!failure.transient) throw error;
          console.warn(
            `[transcribe] ${step.model} attempt ${attempt + 1}/${tries} failed (status ${failure.status ?? "?"}), ` +
              `${remaining() > 0 ? Math.round(remaining() / 1000) : 0}s budget left`,
          );
          const willRetrySameModel = attempt + 1 < tries;
          if (willRetrySameModel && remaining() > RETRY_WAIT_MS + 20_000) await sleep(RETRY_WAIT_MS);
        }
      }
    }
    throw lastError;
  } finally {
    // Uploaded files auto-expire in 48h; deleting sooner is hygiene, not
    // correctness — never let cleanup mask the transcription result.
    if (uploadedName) {
      try {
        await client.files.delete({ name: uploadedName });
      } catch {
        /* best effort */
      }
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
    const result = await transcribeAudio(row.mime, bytes);

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
