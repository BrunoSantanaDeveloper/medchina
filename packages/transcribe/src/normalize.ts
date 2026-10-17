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
 * A segment lasts at least as long as its words take to say, at a FAST pace,
 * so it is never credited with more audio than it covers. Capped, so one
 * runaway segment (a repetition loop, a known long-audio failure) cannot vouch
 * for minutes it never reached.
 */
const SPOKEN_WORDS_PER_SECOND = 4;
const MAX_SEGMENT_CREDIT_SECONDS = 90;
/**
 * Audio a recording keeps after its last word: the time to reach for "finish"
 * and confirm. MEASURED on production transcripts: 5–26 s between the end of
 * the last utterance and the end of the recording, whatever its length.
 */
const STOP_OVERHEAD_SECONDS = 30;

/**
 * A repetition loop inside one segment: many words, almost none distinct
 * ("sim sim sim …"). A known long-audio failure — never speech.
 */
export function isDegenerateSegment(text: unknown): boolean {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 40) return false;
  return new Set(words).size / words.length < 0.15;
}

/**
 * How many lines a repeating pattern must span to count as a loop, by period
 * (1: the same line; 2-3: a pair or triple cycling). High on purpose: real
 * speech repeats too — a listener's "Uhum." while the other voice holds the
 * floor, a palpation's "Dói aqui?" / "Não." a few times — while a looping reply
 * repeats itself dozens of times.
 */
const LOOP_SPAN: Record<number, number> = { 1: 8, 2: 12, 3: 12 };

/**
 * The transcript up to where the reply degenerated into a repetition loop, or
 * null when it did not. Everything from the loop on is dropped: a loop runs its
 * timestamps on past the speech it replaced (even past the end of the audio),
 * and kept, it vouches for audio that was never transcribed.
 *
 * Placeholders ("[inaudível]") count only in a reply CUT by the output limit:
 * a reply that ended on its own keeps them — a quiet stretch such as the
 * needle-retention rest legitimately repeats them — but a cut reply is where a
 * loop that ate the output budget leaves them in place of the speech.
 */
export function cutAtRepetitionLoop(result: TranscriptResult, options: { cut?: boolean } = {}): TranscriptResult | null {
  const segments = result.segments ?? [];
  const texts = segments.map((segment) => String(segment.text ?? "").trim());
  let loopAt = texts.findIndex((text) => isDegenerateSegment(text));
  for (const [periodKey, span] of Object.entries(LOOP_SPAN)) {
    const period = Number(periodKey);
    let run = 0;
    for (let index = period; index < texts.length; index += 1) {
      const placeholder = /^\[[^\]]*\]$/.test(texts[index]);
      if (texts[index] === texts[index - period] && (!placeholder || options.cut)) {
        run += 1;
        if (run >= span - period) {
          const start = index - run - period + 1;
          if (loopAt < 0 || start < loopAt) loopAt = start;
          break;
        }
      } else run = 0;
    }
  }
  return loopAt >= 0 ? { ...result, segments: segments.slice(0, loopAt) } : null;
}

/** Where the transcript's speech ENDS, in seconds (-1 when it has none). */
export function transcriptReach(result: TranscriptResult): number {
  return (result.segments ?? []).reduce((max, segment) => {
    const start = offsetSeconds(segment.start);
    if (start < 0 || isDegenerateSegment(segment.text)) return max;
    const words = String(segment.text ?? "")
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(max, start + Math.min(words / SPOKEN_WORDS_PER_SECOND, MAX_SEGMENT_CREDIT_SECONDS));
  }, -1);
}

/**
 * Whether the transcript's speech runs to within the stop overhead of the end
 * of the recording (and covers at least half of it).
 *
 * Coverage is measured from the last segment's START, and against the 15% rule
 * that failed every short clip whose speech simply ended before the recording
 * did — two 58 s recordings judged 66% and 71% covered, one of them inside the
 * first-consultation guide, every retry identical. Reaching the end is NOT
 * enough to accept a transcript on its own: the caller also needs a second
 * reply, re-reading the end of the audio, that found nothing more.
 */
export function reachesEnd(result: TranscriptResult, expectedSeconds?: number | null): boolean {
  if (!expectedSeconds || expectedSeconds <= 0) return true;
  const reach = transcriptReach(result);
  return reach >= expectedSeconds / 2 && expectedSeconds - reach <= STOP_OVERHEAD_SECONDS;
}

/**
 * The complete segments of a transcript reply that was CUT OFF mid-JSON.
 *
 * A reply that hits maxOutputTokens is not garbage — it is a valid prefix whose
 * every finished segment was transcribed and billed. Parsing it as a whole
 * throws, and the call used to be discarded as if it had never happened; on a
 * long consultation that is exactly the call that got furthest. Each finished
 * `{speaker, start, text}` object is parsed on its own; the cut one is dropped
 * (the continuation re-reads that stretch anyway). Only a CONTIGUOUS prefix of
 * usable segments is kept: an object that fails to parse, or that
 * normalizeTimestamps would drop (no readable start, no text), ends it — so a
 * hole in the middle is never hidden behind the segments after it. Null when
 * nothing usable.
 */
export function salvageTranscriptJson(text: string): TranscriptResult | null {
  const source = String(text ?? "");
  const arrayAt = /"segments"\s*:\s*\[/.exec(source);
  if (!arrayAt) return null;

  const segments: TranscriptResult["segments"] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  for (let index = arrayAt.index + arrayAt[0].length; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) objectStart = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        const segment = usableSegment(source.slice(objectStart, index + 1));
        if (!segment) break;
        segments.push(segment);
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) break;
  }
  if (segments.length === 0) return null;

  const language = /"language"\s*:\s*"([^"\\]*)"/.exec(source)?.[1] ?? "";
  return { language, segments };
}

/** One finished segment object, or null when normalizeTimestamps would drop it. */
function usableSegment(json: string): TranscriptResult["segments"][number] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const segment = parsed as TranscriptResult["segments"][number];
  return offsetSeconds(String(segment.start ?? "")) >= 0 && cleanSegmentText(segment.text).length > 0 ? segment : null;
}

/**
 * Speaker labels must be STABLE and identical per voice — the extraction drops
 * a tongue/pulse finding by comparing this string to the practitioner's label,
 * so a stray label silently discards clinical content. MEASURED: a model
 * emitted "Speaker 08:57" (a timestamp) as a third speaker on a two-voice
 * consultation. Anything that is not "Speaker <n>" is remapped, in order of
 * first appearance, onto the canonical labels.
 */
export function normalizeSpeakers(
  result: TranscriptResult,
  /**
   * For a continuation: its prompt NAMED which label belongs to which voice, and
   * renumbering by first appearance undoes that whenever the other voice speaks
   * first in the window — the practitioner's tongue/pulse dictation would then
   * merge under the patient's label when the overlap gives alignSpeakers no
   * votes. "Speaker N" (N >= 1) is kept as emitted; anything else is remapped
   * onto the next free number.
   */
  options: { keepCanonical?: boolean } = {},
): TranscriptResult {
  const canonicalIndex = (raw: string) => {
    // Deliberately no regex: "Speaker 08:57" must NOT parse as speaker 8. A
    // label counts as canonical only when the remainder is a plain integer.
    const tail = raw.toLowerCase().startsWith("speaker") ? raw.slice("speaker".length).trim() : null;
    const index = tail !== null && /^[0-9]+$/.test(tail) ? Number(tail) : NaN;
    return Number.isInteger(index) ? index : null;
  };
  const canonical = new Map<string, string>();
  const taken = new Set<number>();
  if (options.keepCanonical) {
    for (const segment of result.segments ?? []) {
      const index = canonicalIndex(String(segment.speaker ?? "").trim());
      if (index !== null && index >= 1) {
        canonical.set(`Speaker ${index}`, `Speaker ${index}`);
        taken.add(index);
      }
    }
  }
  const segments = (result.segments ?? []).map((segment) => {
    const raw = String(segment.speaker ?? "").trim();
    const index = canonicalIndex(raw);
    const key = index !== null ? `Speaker ${index}` : raw || "Speaker ?";
    if (!canonical.has(key)) {
      let next = 1;
      while (taken.has(next)) next += 1;
      taken.add(next);
      canonical.set(key, `Speaker ${next}`);
    }
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
