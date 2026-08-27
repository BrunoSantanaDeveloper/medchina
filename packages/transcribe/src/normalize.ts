import type { TranscriptResult } from "./types";

/**
 * The transcript CONTRACT — pure, provider-agnostic, and the reason a second
 * provider can ever be added safely.
 *
 * Every rule here exists because breaking it fails SILENTLY downstream:
 *  - the app's parseTranscriptResult DELETES any segment whose speaker/start/
 *    text is not a string, with no error; if all of them go, a SUCCESSFUL
 *    transcription is reported to the professional as "provider_unavailable";
 *  - the anamnesis extraction decides what the PRACTITIONER said by comparing
 *    the speaker label as a string, so an unstable label silently discards the
 *    tongue/pulse/palpation findings the clinical reasoning is built on;
 *  - the transcript viewer links a chart field to its audio segment by EXACT
 *    string equality on the timestamp, so format drift breaks the audit trail;
 *  - billing uses the last timestamp as its floor, so a truncated transcript
 *    under-bills and, far worse, hides that the tail was never transcribed.
 *
 * Kept free of provider SDKs on purpose: it is unit-tested without a network.
 */

/** How close two lines must be in time to count as the same utterance re-read.
 *  The continuation deliberately rewinds, so the overlap arrives twice with
 *  slightly different timestamps. */
const DUPLICATE_WINDOW_SECONDS = 12;

/** Seconds from an "mm:ss" / "h:mm:ss" offset; -1 when unparseable. */
export function offsetSeconds(value: string): number {
  const parts = String(value ?? "").trim().split(":");
  if (parts.length < 2 || parts.length > 3) return -1;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return -1;
  return parts.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : numbers[0] * 60 + numbers[1];
}

/** How far into the audio the transcript actually reaches. */
export function transcriptCoverage(result: TranscriptResult, expectedSeconds?: number | null): number {
  if (!expectedSeconds || expectedSeconds <= 0) return 1;
  const last = (result.segments ?? []).reduce((max, segment) => Math.max(max, offsetSeconds(segment.start)), -1);
  if (last < 0) return 0;
  return Math.min(1, last / expectedSeconds);
}

/**
 * Speaker labels must be STABLE and identical per voice — the extraction drops
 * a tongue/pulse finding by comparing this string to the practitioner's label,
 * so a stray label silently discards clinical content. MEASURED: a model
 * emitted "Speaker 08:57" (a timestamp) as a third speaker on a two-voice
 * consultation. Anything that is not "Speaker <n>" is remapped, in order of
 * first appearance, onto the canonical labels.
 */
export function normalizeSpeakers(result: TranscriptResult): TranscriptResult {
  const canonical = new Map<string, string>();
  const segments = (result.segments ?? []).map((segment) => {
    const raw = String(segment.speaker ?? "").trim();
    // Deliberately no regex: "Speaker 08:57" must NOT parse as speaker 8. A
    // label counts as canonical only when the remainder is a plain integer.
    const tail = raw.toLowerCase().startsWith("speaker") ? raw.slice("speaker".length).trim() : null;
    const index = tail !== null && /^[0-9]+$/.test(tail) ? Number(tail) : NaN;
    const key = Number.isInteger(index) ? `Speaker ${index}` : raw || "Speaker ?";
    if (!canonical.has(key)) canonical.set(key, `Speaker ${canonical.size + 1}`);
    return { ...segment, speaker: canonical.get(key)! };
  });
  return { ...result, segments };
}

/**
 * Canonical offset string. `useHours` is decided ONCE PER TRANSCRIPT, never
 * per segment: a 65-minute consultation whose early segments read "05:30" and
 * late ones "1:05:30" mixes two formats inside one transcript, and the
 * provenance link compares these strings exactly.
 */
export function formatOffset(totalSeconds: number, useHours = false): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return useHours ? `${Math.floor(safe / 3600)}:${pad(minutes)}:${pad(seconds)}` : `${Math.floor(safe / 60)}:${pad(seconds)}`.padStart(5, "0");
}

/** Strip a leading "[mm:ss]" / "Speaker N:" the model sometimes bakes into the text. */
function cleanSegmentText(value: unknown): string {
  let text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "undefined" || text === "null") return "";
  // The extraction prompt renders speaker and timestamp itself; repeating them
  // inside the text inflates quote matching against unrelated segments.
  text = text.replace(/^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*/, "");
  text = text.replace(/^speaker\s*\d{1,2}\s*[:\-–]\s*/i, "");
  return text.trim();
}

/**
 * Canonicalize timestamps, clean text, drop unusable segments and sort by time.
 *
 * Every rule here exists because breaking it fails SILENTLY: a segment whose
 * `start` is not a string is deleted by `parseTranscriptResult` with no trace,
 * and if all of them are, a SUCCESSFUL transcription is reported to the
 * professional as `provider_unavailable`.
 */
export function normalizeTimestamps(result: TranscriptResult, expectedSeconds?: number | null): TranscriptResult {
  const rows = (result.segments ?? [])
    .map((segment) => ({ ...segment, text: cleanSegmentText(segment.text), seconds: offsetSeconds(segment.start) }))
    .filter((segment) => segment.seconds >= 0 && segment.text.length > 0)
    .sort((a, b) => a.seconds - b.seconds);
  const longest = Math.max(expectedSeconds ?? 0, rows.length > 0 ? rows[rows.length - 1].seconds : 0);
  const useHours = longest >= 3600;
  const segments = rows.map(({ seconds, ...segment }) => ({
    ...segment,
    speaker: String(segment.speaker ?? ""),
    start: formatOffset(seconds, useHours),
  }));
  return { language: typeof result.language === "string" ? result.language : "", segments };
}

/** Comparable form of a line: no case, no punctuation, single spaces. */
const comparable = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Re-map a continuation's speaker labels onto the ones already established.
 *
 * Each request labels speakers independently, so a continuation may call the
 * practitioner "Speaker 2" when the first pass called her "Speaker 1".
 * MEASURED on a real consultation: the window that recovered the tongue and
 * pulse examination came back with the voices INVERTED — and since the
 * extraction decides what counts as a practitioner observation by comparing
 * that label as a string, those findings would have been silently discarded.
 *
 * Asking the model to keep the labels is not enough (it was asked, and it did
 * not). So the mapping is DERIVED from the overlap the windows share: lines
 * present in both are matched by text, each match votes for a mapping, and the
 * majority wins. With no usable overlap nothing is remapped — a guess here
 * would be worse than leaving the labels alone.
 */
export function alignSpeakers(base: TranscriptResult, next: TranscriptResult): TranscriptResult {
  // Word sets, because the two passes re-transcribe the same speech with small
  // differences ("OK. Deixa eu ver sua língua" vs "Deixa eu ver sua língua").
  // MEASURED: exact-text matching found nothing on a real overlap and the
  // inverted labels survived, so similarity is what makes this work at all.
  const words = (text: string) => new Set(comparable(text).split(" ").filter((word) => word.length > 2));
  const overlapScore = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared += 1;
    return shared / Math.min(a.size, b.size);
  };

  const baseRows = base.segments
    .map((segment) => ({ speaker: segment.speaker, at: offsetSeconds(segment.start), words: words(segment.text) }))
    .filter((row) => row.words.size >= 3);

  const votes = new Map<string, Map<string, number>>();
  for (const segment of next.segments) {
    const candidate = words(segment.text);
    if (candidate.size < 3) continue;
    const at = offsetSeconds(segment.start);
    let best: { speaker: string; score: number } | null = null;
    for (const row of baseRows) {
      // Only the same moment can be the same utterance — a phrase repeated
      // minutes later is a different turn and must not vote.
      if (Math.abs(row.at - at) > DUPLICATE_WINDOW_SECONDS) continue;
      const score = overlapScore(candidate, row.words);
      if (score >= 0.6 && (!best || score > best.score)) best = { speaker: row.speaker, score };
    }
    if (!best) continue;
    const tally = votes.get(segment.speaker) ?? new Map<string, number>();
    tally.set(best.speaker, (tally.get(best.speaker) ?? 0) + 1);
    votes.set(segment.speaker, tally);
  }
  if (votes.size === 0) return next;

  const mapping = new Map<string, string>();
  for (const [label, tally] of votes) {
    const winner = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (winner) mapping.set(label, winner[0]);
  }
  // A mapping that collapses two distinct voices into one is not an alignment,
  // it is a corruption — keep the original labels instead.
  const targets = new Set(mapping.values());
  if (targets.size < mapping.size) return next;

  return {
    ...next,
    segments: next.segments.map((segment) => ({ ...segment, speaker: mapping.get(segment.speaker) ?? segment.speaker })),
  };
}

/**
 * Stitch a continuation window onto the transcript we already have.
 *
 * Overlap is expected (the window is asked for slightly BEFORE the last known
 * segment, so a sentence spanning the boundary is not lost) — so a segment is
 * dropped when it repeats one we already hold at the same second. Ordering is
 * by time, never by arrival.
 */
export function mergeTranscripts(
  base: TranscriptResult,
  next: TranscriptResult,
  expectedSeconds?: number | null,
): TranscriptResult {
  // Labels first: appending a window whose voices are inverted would be worse
  // than not extending the transcript at all.
  const aligned = alignSpeakers(base, next);

  const merged = [...base.segments];
  const isDuplicate = (candidate: { start: string; text: string }) => {
    const key = comparable(candidate.text);
    if (!key) return true;
    const at = offsetSeconds(candidate.start);
    return merged.some((existing) => {
      const other = comparable(existing.text);
      if (!other) return false;
      // The same sentence rarely lands on the same second across two calls, so
      // matching on text alone within a small window is what actually removes
      // the overlap the continuation deliberately re-reads.
      const near = Math.abs(offsetSeconds(existing.start) - at) <= DUPLICATE_WINDOW_SECONDS;
      return near && (other === key || other.includes(key) || key.includes(other));
    });
  };

  for (const segment of aligned.segments) {
    if (isDuplicate(segment)) continue;
    merged.push(segment);
  }
  return normalizeTimestamps({ ...base, segments: merged }, expectedSeconds);
}
