import assert from "node:assert/strict";
import test from "node:test";

import {
  cutAtRepetitionLoop,
  formatOffset,
  mergeTranscripts,
  normalizeSpeakers,
  normalizeTimestamps,
  offsetSeconds,
  reachesEnd,
  salvageTranscriptJson,
  transcriptCoverage,
  transcriptReach,
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

test("MEASURED FAILURE: a short clip whose speech ends before the recording does reaches the end", () => {
  // Production, 2026-09-12 (QR) and 2026-10-02 (web, first-consultation
  // guide): 58 s clips whose last words started at 0:38 and 0:41 were judged
  // 66% and 71% covered, every retry failed, and the professional had to
  // discard the recording. The rest of the clip was the stop confirmation.
  const qr = transcript([
    { speaker: "Speaker 1", start: "00:21", text: "um" },
    { speaker: "Speaker 1", start: "00:23", text: "dois" },
    { speaker: "Speaker 1", start: "00:38", text: "e é isso por hoje" },
  ]);
  assert.ok(transcriptCoverage(qr, 58) < 0.85);
  assert.ok(reachesEnd(qr, 58));
  const web = transcript([
    { speaker: "Speaker 1", start: "00:36", text: "vamos ver agora" },
    { speaker: "Speaker 2", start: "00:41", text: "está bem obrigada até logo" },
  ]);
  assert.ok(reachesEnd(web, 58));
});

test("a closing dictation reaches the end of the audio, not just where it starts", () => {
  // An 8-minute recording that ends with one long segment of tongue, pulse and
  // palpation findings starting 44 s before the end.
  const dictation =
    "Língua pálida e aumentada com marcas de dentes nas bordas, saburra branca fina e úmida na raiz. " +
    "Pulso em corda à esquerda, fino e fraco na posição do baço à direita, mais profundo no pé. " +
    "Abdome distendido, sensível à palpação no hipocôndrio direito, sem massa palpável. " +
    "Extremidades frias, sudorese noturna leve, sono agitado e sede discreta ao acordar, segundo a própria paciente.";
  const result = transcript([
    { speaker: "Speaker 2", start: "00:10", text: "bom dia" },
    { speaker: "Speaker 1", start: "07:16", text: dictation },
  ]);
  assert.ok(transcriptReach(result) > 450);
  assert.ok(reachesEnd(result, 480));
});

test("reaching the end never covers for a truncated transcript", () => {
  // Five minutes of audio, transcript stopped at 3:40: 80 s are missing.
  const truncated = transcript([
    { speaker: "Speaker 1", start: "00:05", text: "início" },
    { speaker: "Speaker 1", start: "03:40", text: "parou aqui" },
  ]);
  assert.equal(reachesEnd(truncated, 300), false);
  // The measured failure: 16:26 of speech, transcript stopped at 12:05.
  const measured = transcript([{ speaker: "Speaker 1", start: "12:05", text: "parou aqui" }]);
  assert.equal(reachesEnd(measured, 996), false);
  // A short clip must still reach half of itself: 50 s transcribed to 0:20.
  const half = transcript([{ speaker: "Speaker 1", start: "00:20", text: "pulso" }]);
  assert.equal(reachesEnd(half, 50), false);
  // With no known duration there is nothing to verify against.
  assert.equal(reachesEnd(truncated, null), true);
});

test("a runaway segment cannot vouch for minutes it never reached", () => {
  // A 47-minute audio where the model stops at 30:00 inside a repetition loop.
  const loop = Array.from({ length: 2000 }, () => "sim").join(" ");
  const result = transcript([
    { speaker: "Speaker 1", start: "00:10", text: "bom dia" },
    { speaker: "Speaker 2", start: "30:00", text: loop },
  ]);
  assert.ok(transcriptReach(result) <= 1890);
  assert.equal(reachesEnd(result, 2817), false);
});

test("a repetition loop ends the transcript where it starts", () => {
  const speech = [
    { speaker: "Speaker 1", start: "29:40", text: "E a dor piora à noite?" },
    { speaker: "Speaker 2", start: "29:50", text: "Piora, principalmente depois do jantar." },
  ];
  // One segment that loops on a single word.
  const loopWord = Array.from({ length: 2000 }, () => "sim").join(" ");
  assert.deepEqual(
    cutAtRepetitionLoop(transcript([...speech, { speaker: "Speaker 2", start: "30:00", text: loopWord }]))?.segments,
    speech,
  );
  // The same line repeated as segments, with its timestamps running on.
  const repeated = Array.from({ length: 12 }, (_, index) => ({
    speaker: "Speaker 2",
    start: formatOffset(1800 + index * 2),
    text: "sim",
  }));
  assert.deepEqual(cutAtRepetitionLoop(transcript([...speech, ...repeated]))?.segments, speech);
  // Neither counts toward where the speech ends.
  assert.ok(transcriptReach(transcript([...speech, { speaker: "Speaker 2", start: "30:00", text: loopWord }])) < 1800);
});

test("backchannels and inaudible stretches are speech, not a loop", () => {
  // A listener's "Uhum." four times while the other voice holds the floor.
  const backchannels = [
    { speaker: "Speaker 1", start: "10:00", text: "Então eu comecei a sentir aquele aperto no peito todo fim de tarde…" },
    ...Array.from({ length: 4 }, (_, index) => ({ speaker: "Speaker 2", start: formatOffset(605 + index * 7), text: "Uhum." })),
  ];
  assert.equal(cutAtRepetitionLoop(transcript(backchannels)), null);
  // A silent stretch (the needle-retention rest) transcribed as placeholders.
  const rest = Array.from({ length: 10 }, (_, index) => ({
    speaker: "Speaker 1",
    start: formatOffset(1200 + index * 30),
    text: "[inaudible]",
  }));
  assert.equal(cutAtRepetitionLoop(transcript(rest)), null);
  // A palpation round trip repeated a few times is dialogue, not a loop.
  const palpation = Array.from({ length: 4 }, (_, index) => [
    { speaker: "Speaker 1", start: formatOffset(900 + index * 10), text: "Dói aqui?" },
    { speaker: "Speaker 2", start: formatOffset(903 + index * 10), text: "Não." },
  ]).flat();
  assert.equal(cutAtRepetitionLoop(transcript(palpation)), null);
});

test("in a reply cut by the output limit, a loop of placeholders or alternating lines is a loop", () => {
  const speech = [{ speaker: "Speaker 1", start: "09:50", text: "Vamos ver o pulso agora." }];
  // The loop that ate the output budget left placeholders where speech was.
  const placeholders = Array.from({ length: 40 }, (_, index) => ({
    speaker: "Speaker 2",
    start: formatOffset(600 + index * 10),
    text: "[inaudível]",
  }));
  assert.equal(cutAtRepetitionLoop(transcript([...speech, ...placeholders])), null);
  assert.deepEqual(cutAtRepetitionLoop(transcript([...speech, ...placeholders]), { cut: true })?.segments, speech);
  // Two lines alternating, long enough to be no palpation.
  const alternating = Array.from({ length: 14 }, (_, index) => ({
    speaker: index % 2 === 0 ? "Speaker 1" : "Speaker 2",
    start: formatOffset(600 + index * 4),
    text: index % 2 === 0 ? "Certo." : "Isso.",
  }));
  assert.deepEqual(cutAtRepetitionLoop(transcript([...speech, ...alternating]))?.segments, speech);
});

test("a reply cut at the output limit keeps every finished segment", () => {
  const cut =
    '{"language":"pt-BR","segments":[' +
    '{"speaker":"Speaker 1","start":"00:01","text":"Ela disse \\"chega {de} dor\\""},' +
    '{"speaker":"Speaker 2","start":"00:09","text":"Desde ontem."},' +
    '{"speaker":"Speaker 1","start":"00:15","text":"Deixa eu ver a lín';
  const salvaged = salvageTranscriptJson(cut);
  assert.ok(salvaged);
  assert.equal(salvaged.language, "pt-BR");
  assert.deepEqual(
    salvaged.segments.map((segment) => [segment.start, segment.text]),
    [
      ["00:01", 'Ela disse "chega {de} dor"'],
      ["00:09", "Desde ontem."],
    ],
  );
  // Nothing finished, or no segments at all: nothing to keep.
  assert.equal(salvageTranscriptJson('{"language":"pt-BR","segments":[{"speaker":"Speaker 1","sta'), null);
  assert.equal(salvageTranscriptJson("not json"), null);
});

test("a malformed segment ends the salvaged prefix instead of leaving a hidden hole", () => {
  // The 00:05 object holds an invalid escape: keeping 00:09 after it would hide
  // the missing finding from every end-based coverage check.
  const cut =
    '{"language":"pt-BR","segments":[' +
    '{"speaker":"Speaker 1","start":"00:01","text":"Bom dia."},' +
    '{"speaker":"Speaker 1","start":"00:05","text":"Língua pálida \\x pulso fino"},' +
    '{"speaker":"Speaker 2","start":"00:09","text":"Obrigada."},' +
    '{"speaker":"Speaker 1","start":"00:12","text":"Vam';
  const salvaged = salvageTranscriptJson(cut);
  assert.ok(salvaged);
  assert.deepEqual(
    salvaged.segments.map((segment) => segment.start),
    ["00:01"],
  );
  // Same for a segment that parses but would be dropped later (no usable start).
  const unusable =
    '{"segments":[{"speaker":"Speaker 1","start":"00:01","text":"Bom dia."},' +
    '{"speaker":"Speaker 1","start":"5","text":"língua pálida"},' +
    '{"speaker":"Speaker 2","start":"00:09","text":"Obrigada."},{"spe';
  assert.deepEqual(
    salvageTranscriptJson(unusable)?.segments.map((segment) => segment.start),
    ["00:01"],
  );
});

test("a continuation keeps the labels its prompt anchored, even when the other voice speaks first", () => {
  // The window starts with the patient (anchored as Speaker 2). Renumbering by
  // first appearance would hand her label to the practitioner's dictation.
  const window = transcript([
    { speaker: "Speaker 2", start: "31:00", text: "Tá." },
    { speaker: "Speaker 1", start: "31:05", text: "Língua pálida, pulso em corda." },
    { speaker: "Speaker 08:57", start: "31:20", text: "rótulo espúrio" },
  ]);
  assert.deepEqual(
    normalizeSpeakers(window, { keepCanonical: true }).segments.map((segment) => segment.speaker),
    ["Speaker 2", "Speaker 1", "Speaker 3"],
  );
  // A first pass still canonicalizes by first appearance.
  assert.deepEqual(
    normalizeSpeakers(window).segments.map((segment) => segment.speaker),
    ["Speaker 1", "Speaker 2", "Speaker 3"],
  );
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
