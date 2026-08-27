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
- `TRANSCRIBE_MODEL` — optional, defaults to `gemini-3.6-flash`. Use a PINNED version, never a `-latest` alias: the alias tracks the newest generation, which is the most congested pool (measured: `gemini-flash-latest` and `gemini-3.7-flash` both 503 while 3.6/3.5/2.5 answered).
- `TRANSCRIBE_MODEL_FALLBACKS` — optional, comma-separated models tried in order when the primary fails
  TRANSIENTLY (503 overload, rate limit) or is retired (404). Defaults to `gemini-3.5-flash,gemini-2.5-flash` —
  deliberately spanning generations so one overloaded pool cannot take the chain down. Set empty to disable. Account-level
  failures (bad key, depleted credits) stop the chain immediately; a model-level 404/400 advances to the next model.
- `TRANSCRIBE_ATTEMPT_TIMEOUT_MS` / `TRANSCRIBE_TOTAL_BUDGET_MS` — per-attempt HTTP deadline (default 240000)
  and overall budget (default 285000); keeps a hung provider request from outliving the serverless function.
  MEASURED 2026-08-27: a 16m36s consultation took 197s (3.5-flash) / 53s (2.5-flash), so a 45–60 min audio does
  NOT fit in a single invocation — long consultations need an async (submit + callback) provider.
- `TRANSCRIBE_MIN_COVERAGE` (default 0.85) / `TRANSCRIBE_MAX_OUTPUT_TOKENS` (default 32768) — a model can return
  a well-formed transcript that silently STOPS EARLY (measured: both models stopped near 12:00 on a 16:26 audio,
  losing the practitioner's dictated tongue/pulse/palpation). Coverage is verified against the recorded duration:
  a short transcript makes the chain try the next model, and the fullest result is kept with a loud log.
- Migration: `packages/db/migrations/0007_transcriptions.sql`.

This also unlocks audio for Anthropic-backed assistants: transcribe first, send the text.
