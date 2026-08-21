# @flyee/transcribe

Audio → **diarized transcript** (speaker separation + `mm:ss` timestamps) via Gemini, with configurable **source-audio retention**.

## Flow

1. Upload the audio to the private `transcriptions` bucket (`<org_id>/...` path, member-only policies).
2. `requestTranscription(supabase, { orgId, audioPath, mime, createdBy, deleteAudioAfter })` creates the row and queues the `transcribe/audio.transcribe` Inngest job (inline `processTranscription` fallback when the event cannot be sent).
3. The job downloads the audio, calls Gemini with a structured-output schema (`{ language, segments: [{ speaker, start, text }] }`, temperature 0, "never invent content — mark [inaudible]") and stores the result on the row (`status: ready`).
4. **Retention**: with `deleteAudioAfter`, the source audio is removed from storage the moment the transcript is stored, and `audio_path` is nulled — for recordings that must not outlive their transcript (e.g. consultations).

## Reading the result

```ts
const { data } = await supabase.from("transcriptions").select("status, result").eq("id", id).maybeSingle();
// result.segments: [{ speaker: "Speaker 1", start: "00:12", text: "..." }]
```

Speaker labels are generic (`Speaker 1`, `Speaker 2`); projects relabel them in their own UI (e.g. therapist/patient).

## Configuration

- `GEMINI_API_KEY` — required (clear error without it; nothing else breaks).
- `TRANSCRIBE_MODEL` — optional, defaults to `gemini-flash-latest`.
- `TRANSCRIBE_MODEL_FALLBACKS` — optional, comma-separated models tried in order when the primary fails
  TRANSIENTLY (503 overload, rate limit). Defaults to `gemini-2.0-flash`; set empty to disable. Fatal
  provider errors (bad key, model gone, depleted credits) are never retried on any model.
- `TRANSCRIBE_ATTEMPT_TIMEOUT_MS` / `TRANSCRIBE_TOTAL_BUDGET_MS` — optional per-attempt HTTP deadline
  (default 180000) and overall retry budget (default 250000); keeps a hung provider request from
  outliving the serverless function.
- Migration: `packages/db/migrations/0007_transcriptions.sql`.

This also unlocks audio for Anthropic-backed assistants: transcribe first, send the text.
