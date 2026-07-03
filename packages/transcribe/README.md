# @gogo/transcribe

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
- `TRANSCRIBE_MODEL` — optional, defaults to `gemini-2.5-flash`.
- Migration: `packages/db/migrations/0007_transcriptions.sql`.

This also unlocks audio for Anthropic-backed assistants: transcribe first, send the text.
