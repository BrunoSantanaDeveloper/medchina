import assert from "node:assert/strict";
import test from "node:test";

import {
  formatOffset,
  mergeTranscripts,
  normalizeSpeakers,
  normalizeTimestamps,
  offsetSeconds,
  transcriptCoverage,
} from "./normalize.ts";
import type { TranscriptResult } from "./types.ts";

const transcript = (segments: { speaker: string; start: string; text: string }[]): TranscriptResult => ({
  language: "pt-BR",
  segments,
});

test("offsetSeconds parses mm:ss and h:mm:ss, rejects anything else", () => {
  assert.equal(offsetSeconds("00:47"), 47);
  assert.equal(offsetSeconds("12:05"), 725);
  assert.equal(offsetSeconds("1:05:30"), 3930);
  // A bare number is NOT a timestamp — accepting it would place a segment at
  // second 0 and silently reorder the transcript.
  assert.equal(offsetSeconds("754"), -1);
  assert.equal(offsetSeconds("banana"), -1);
  assert.equal(offsetSeconds(""), -1);
});

test("formatOffset zero-pads, and the hour form is chosen per transcript, not per segment", () => {
  assert.equal(formatOffset(47), "00:47");
  assert.equal(formatOffset(725), "12:05");
  // Same instant, two forms: which one is used must be one decision for the
  // whole transcript, because provenance compares these strings exactly.
  assert.equal(formatOffset(3930, false), "65:30");
  assert.equal(formatOffset(3930, true), "1:05:30");
});

test("a transcript never mixes mm:ss and h:mm:ss", () => {
  // A 65-minute consultation: without a single decision, early segments would
  // read "05:30" and late ones "1:05:30" — two formats in one transcript.
  const result = normalizeTimestamps(
    transcript([
      { speaker: "Speaker 1", start: "05:30", text: "início" },
      { speaker: "Speaker 2", start: "1:05:30", text: "fim" },
    ]),
    3960,
  );
  assert.deepEqual(
    result.segments.map((segment) => segment.start),
    ["0:05:30", "1:05:30"],
  );
});

test("MEASURED FAILURE: a timestamp emitted as a speaker label never becomes a real speaker", () => {
  // Gemini returned "Speaker 08:57" as a third voice on a two-voice
  // consultation. Parsing it as speaker 8 would merge it into a real speaker;
  // keeping it as-is leaves a phantom participant.
  const result = normalizeSpeakers(
    transcript([
      { speaker: "Speaker 1", start: "00:10", text: "profissional" },
      { speaker: "Speaker 2", start: "00:20", text: "paciente" },
      { speaker: "Speaker 08:57", start: "00:30", text: "rótulo espúrio" },
      { speaker: "Speaker 1", start: "00:40", text: "profissional de novo" },
    ]),
  );
  const labels = result.segments.map((segment) => segment.speaker);
  // The real voices keep ONE stable label each across the transcript.
  assert.equal(labels[0], "Speaker 1");
  assert.equal(labels[3], "Speaker 1");
  assert.equal(labels[1], "Speaker 2");
  // The stray label is its own speaker, never folded into "Speaker 8".
  assert.equal(labels[2], "Speaker 3");
});

test("speaker labels are canonicalized by first appearance, whatever the provider emits", () => {
  // A non-Gemini provider returns integers; "0"/"1" must become stable strings.
  const result = normalizeSpeakers(
    transcript([
      { speaker: "0", start: "00:01", text: "a" },
      { speaker: "1", start: "00:02", text: "b" },
      { speaker: "0", start: "00:03", text: "c" },
    ]),
  );
  assert.deepEqual(
    result.segments.map((segment) => segment.speaker),
    ["Speaker 1", "Speaker 2", "Speaker 1"],
  );
});

test("unusable segments are dropped and the rest is sorted by time", () => {
  const result = normalizeTimestamps(
    transcript([
      { speaker: "Speaker 1", start: "02:00", text: "segundo" },
      { speaker: "Speaker 1", start: "banana", text: "sem timestamp" },
      { speaker: "Speaker 2", start: "00:30", text: "primeiro" },
      { speaker: "Speaker 2", start: "03:00", text: "   " },
    ]),
  );
  assert.deepEqual(
    result.segments.map((segment) => [segment.start, segment.text]),
    [
      ["00:30", "primeiro"],
      ["02:00", "segundo"],
    ],
  );
});

test("a speaker or timestamp baked into the text is stripped", () => {
  // The extraction prompt renders speaker and time itself; repeating them in
  // the text inflates quote matching against unrelated segments.
  const result = normalizeTimestamps(
    transcript([
      { speaker: "Speaker 1", start: "00:10", text: "[00:10] Deixa eu ver sua língua." },
      { speaker: "Speaker 2", start: "00:20", text: "Speaker 2: Tudo bem comigo." },
      { speaker: "Speaker 1", start: "00:30", text: "undefined" },
    ]),
  );
  assert.deepEqual(
    result.segments.map((segment) => segment.text),
    ["Deixa eu ver sua língua.", "Tudo bem comigo."],
  );
});

test("coverage measures how far the transcript reaches into the audio", () => {
  // The real failure: 16:26 of speech, transcript stopped at 12:05.
  const truncated = transcript([
    { speaker: "Speaker 1", start: "00:47", text: "início" },
    { speaker: "Speaker 1", start: "12:05", text: "parou aqui" },
  ]);
  assert.ok(transcriptCoverage(truncated, 996) < 0.85);
  const complete = transcript([
    { speaker: "Speaker 1", start: "00:47", text: "início" },
    { speaker: "Speaker 1", start: "16:20", text: "chegou ao fim" },
  ]);
  assert.ok(transcriptCoverage(complete, 996) >= 0.85);
  // With no known duration there is nothing to verify against — never claim
  // a transcript is incomplete on a guess.
  assert.equal(transcriptCoverage(truncated, null), 1);
});

test("a continuation is stitched on without duplicating the overlap", () => {
  const base = transcript([
    { speaker: "Speaker 1", start: "11:30", text: "antes da fronteira" },
    { speaker: "Speaker 2", start: "12:05", text: "última conhecida" },
  ]);
  // The window is asked for slightly BEFORE the end, so it repeats a segment.
  const next = transcript([
    { speaker: "Speaker 2", start: "12:05", text: "última conhecida" },
    { speaker: "Speaker 1", start: "13:10", text: "a língua está rosada" },
    { speaker: "Speaker 1", start: "16:00", text: "sobre a palpação" },
  ]);
  const merged = mergeTranscripts(base, next, 996);
  assert.deepEqual(
    merged.segments.map((segment) => [segment.start, segment.text]),
    [
      ["11:30", "antes da fronteira"],
      ["12:05", "última conhecida"],
      ["13:10", "a língua está rosada"],
      ["16:00", "sobre a palpação"],
    ],
  );
  assert.ok(transcriptCoverage(merged, 996) >= 0.85);
});

test("merging keeps time order even when the continuation arrives out of order", () => {
  const merged = mergeTranscripts(
    transcript([{ speaker: "Speaker 1", start: "05:00", text: "meio" }]),
    transcript([
      { speaker: "Speaker 1", start: "09:00", text: "depois" },
      { speaker: "Speaker 1", start: "01:00", text: "antes" },
    ]),
    600,
  );
  assert.deepEqual(
    merged.segments.map((segment) => segment.start),
    ["01:00", "05:00", "09:00"],
  );
});

test("every normalized segment satisfies the app's parse gate", () => {
  // parseTranscriptResult silently DELETES a segment unless speaker/start/text
  // are all strings and text is non-empty. If all are deleted, a successful
  // transcription is reported as a provider outage.
  const result = normalizeTimestamps(
    normalizeSpeakers(
      transcript([
        { speaker: "0", start: "00:05", text: "  espaços  " },
        { speaker: "Speaker 08:57", start: "01:00", text: "espúrio" },
      ]),
    ),
    120,
  );
  for (const segment of result.segments) {
    assert.equal(typeof segment.speaker, "string");
    assert.equal(typeof segment.start, "string");
    assert.equal(typeof segment.text, "string");
    assert.ok(segment.text.trim().length > 0);
    assert.ok(offsetSeconds(segment.start) >= 0);
  }
  assert.equal(result.segments.length, 2);
});

test("MEASURED FAILURE: a continuation that inverts the voices is realigned by the overlap", () => {
  // Real behaviour: the window that recovered the tongue/pulse examination came
  // back with the practitioner labelled as the patient. The extraction reads
  // that label as a string, so the findings would have been discarded.
  const base = transcript([
    { speaker: "Speaker 1", start: "11:30", text: "Certo. Teve depressão pós-luto dos avós e tratou por dois anos." },
    { speaker: "Speaker 2", start: "11:50", text: "Isso mesmo, doutora, foi nessa época." },
  ]);
  const inverted = transcript([
    // Same two lines, labels swapped — this is what the model returned.
    { speaker: "Speaker 2", start: "11:31", text: "Certo. Teve depressão pós-luto dos avós e tratou por dois anos." },
    { speaker: "Speaker 1", start: "11:51", text: "Isso mesmo, doutora, foi nessa época." },
    { speaker: "Speaker 2", start: "12:06", text: "A língua está rosada, inchada, com saburra fina." },
  ]);
  const merged = mergeTranscripts(base, inverted, 996);
  const exam = merged.segments.find((segment) => segment.text.includes("saburra"));
  // The examination must end up attributed to the practitioner's ORIGINAL label.
  assert.equal(exam?.speaker, "Speaker 1");
  // And the overlap is not duplicated.
  assert.equal(merged.segments.length, 3);
});

test("with no shared overlap the labels are left alone rather than guessed", () => {
  const base = transcript([{ speaker: "Speaker 1", start: "00:10", text: "uma fala completamente distinta" }]);
  const next = transcript([{ speaker: "Speaker 2", start: "05:00", text: "outra fala sem nada em comum" }]);
  const merged = mergeTranscripts(base, next, 600);
  assert.equal(merged.segments[1].speaker, "Speaker 2");
});

test("MEASURED: alignment works on RE-TRANSCRIBED overlap, not just identical text", () => {
  // The two passes never produce byte-identical lines. Exact matching found
  // nothing on the real overlap and the inverted labels survived — which is
  // the whole reason this matches on word similarity at a nearby time.
  const base = transcript([
    { speaker: "Speaker 1", start: "11:40", text: "Certo. Teve depressão pós-luto dos avós e tratou por dois anos na época." },
    { speaker: "Speaker 2", start: "11:55", text: "Isso mesmo, depois eu parei e não tive mais nada." },
  ]);
  const inverted = transcript([
    // Same speech, re-transcribed with small differences AND swapped labels.
    { speaker: "Speaker 2", start: "11:41", text: "Teve depressão pós-luto dos avós, tratou por dois anos na época." },
    { speaker: "Speaker 1", start: "11:56", text: "Isso mesmo, depois eu parei, não tive mais nada." },
    { speaker: "Speaker 2", start: "12:10", text: "Deixa eu ver sua língua, a língua está rosada e inchada." },
  ]);
  const merged = mergeTranscripts(base, inverted, 996);
  const exam = merged.segments.find((segment) => segment.text.includes("rosada"));
  // The practitioner opened the consultation as Speaker 1; the examination she
  // dictates must land on Speaker 1 too, or the extraction discards it.
  assert.equal(exam?.speaker, "Speaker 1");
});

test("a phrase repeated much later does not vote on the alignment", () => {
  // "Certo." recurs all consultation long; only the same MOMENT can be the
  // same utterance.
  const base = transcript([{ speaker: "Speaker 1", start: "02:00", text: "Certo, entendi perfeitamente o que houve." }]);
  const next = transcript([{ speaker: "Speaker 2", start: "14:00", text: "Certo, entendi perfeitamente o que houve." }]);
  const merged = mergeTranscripts(base, next, 996);
  // No trustworthy overlap -> labels untouched, and the far-away line is kept.
  assert.equal(merged.segments.length, 2);
  assert.equal(merged.segments[1].speaker, "Speaker 2");
});
