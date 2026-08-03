import { GoogleGenAI, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { TranscriptResult } from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash";

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

async function transcribeAudio(mime: string, bytes: Uint8Array): Promise<TranscriptResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set — transcription uses Gemini.");
  const client = new GoogleGenAI({ apiKey: key });

  let audioPart: Part;
  let uploadedName: string | undefined;
  if (bytes.byteLength > INLINE_LIMIT_BYTES) {
    const uploaded = await uploadAudioFile(client, mime, bytes);
    audioPart = uploaded.part;
    uploadedName = uploaded.name;
  } else {
    audioPart = { inlineData: { mimeType: mime, data: Buffer.from(bytes).toString("base64") } };
  }

  try {
    const response = await client.models.generateContent({
      model: process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL,
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

export type TranscriptionRunResult = { ok: true; segments: number } | { ok: false; error: string };

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
    await supabase.from("transcriptions").update({ status: "error", error: message }).eq("id", transcriptionId);
    return { ok: false, error: message };
  }
}
