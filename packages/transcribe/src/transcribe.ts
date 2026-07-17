import { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { TranscriptResult } from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash";

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

async function transcribeAudio(mime: string, dataBase64: string): Promise<TranscriptResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set — transcription uses Gemini.");
  const client = new GoogleGenAI({ apiKey: key });

  const response = await client.models.generateContent({
    model: process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: dataBase64 } }, { text: PROMPT }] }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: RESULT_SCHEMA,
      temperature: 0,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned no transcript.");
  return JSON.parse(text) as TranscriptResult;
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

    const dataBase64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const result = await transcribeAudio(row.mime, dataBase64);

    await supabase.from("transcriptions").update({ status: "ready", result }).eq("id", transcriptionId);

    return { ok: true, segments: result.segments.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("transcriptions").update({ status: "error", error: message }).eq("id", transcriptionId);
    return { ok: false, error: message };
  }
}
