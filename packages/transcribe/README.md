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
  TRANSIENTLY (503 overload, rate limit) or is retired (404). Defaults to `gemini-3.5-flash,gemini-3.5-flash-lite`.
  Note: Google now routes `gemini-3.5-flash` to `gemini-3.6-flash`, so the first fallback is the same model. Set empty
  to disable. Account-level failures (bad key, depleted credits) stop the chain immediately; a model-level 404/400
  advances to the next model.
- `TRANSCRIBE_ATTEMPT_TIMEOUT_MS` (default 80000) / `TRANSCRIBE_ATTEMPT_MS_PER_AUDIO_SECOND` (default 140) /
  `TRANSCRIBE_TOTAL_BUDGET_MS` (default 170000) — per-call cap = max(80 s, min(window, ~34 min of audio) × 140 ms),
  i.e. twice the measured ~70 ms per audio second; lifted to everything left when the time it would free could not
  host another call; always inside the pipeline's shared deadline. The SDK's own per-request timer is overridden per
  call. Before this, an 80 s cap cut every call on audio longer than ~15-20 min: a 47-min consultation failed 16
  runs in a row. A later fresh pass is only started with the time its audio is expected to take — an aborted call
  is still billed by Google.
- `TRANSCRIBE_MIN_COVERAGE` (default 0.85) — a model can return a well-formed transcript that silently STOPS EARLY
  (measured: both models stopped near 12:00 on a 16:26 audio, losing the practitioner's dictated
  tongue/pulse/palpation). Coverage is the last segment's START over the recorded duration. Below the threshold the
  same model is asked for the rest (a continuation window), then the next model; the fullest result is persisted as
  a partial and the next attempt resumes from it. A transcript whose speech reaches within 30 s of the end (segment
  start plus its words at 4/s, at most 90 s per segment, and at least half the clip) is also accepted — but only
  after a continuation that demonstrably re-read the end of the audio found no more speech. That is what short
  clips ending in the stop confirmation need (two 58 s recordings used to fail forever at 66%/71%).
- `TRANSCRIBE_MAX_OUTPUT_TOKENS` (default 32768) — thinking counts against it (~16 output tokens per audio second,
  so one reply holds ~34 min of audio). Each call asks only for what it can write before our timer fires (~190
  tokens/s after 15 s), so a slow reply ends at the output limit instead of being aborted with nothing. A reply cut
  by the limit (`finishReason MAX_TOKENS`) keeps its finished segments (a contiguous prefix) but is never accepted
  on coverage: a continuation must take it to the end, now or on the next attempt. Any other unreadable reply still
  fails and moves to the next model.
- Continuations count as an advance only when they reach 12 s past the last line held (re-read lines come back a
  few seconds late); a reply that ignored its window is stitched only if its lines on the held stretch match ours
  (same clock). A reply that degenerates into a repetition loop (one segment with ≥40 words and <15% distinct; the
  same line 8 times in a row; or a pair/triple cycling over 12 lines) is kept up to the loop and treated as cut.
  Placeholders such as "[inaudível]" count as loop material only in a reply cut by the output limit — a reply that
  ended on its own keeps them (quiet stretches like the needle-retention rest repeat them legitimately). Segments
  past the recorded duration are kept and logged: the duration is the browser's wall clock and timestamps drift.
- Migration: `packages/db/migrations/0007_transcriptions.sql`.

This also unlocks audio for Anthropic-backed assistants: transcribe first, send the text.
