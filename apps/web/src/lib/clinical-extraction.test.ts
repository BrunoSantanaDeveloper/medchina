import { anchorQuote, type ExistingAnswer, isAbsenceValue, isPipelineUpdatable } from "./clinical-extraction";
import { describe, expect, it } from "vitest";

/**
 * Provenance is the product's promise that a drafted value can be checked. The
 * model supplies the quote, the timestamp and the speaker, so the only thing
 * standing between a fabricated citation and the professional reading it as
 * proof is this anchoring. These cases pin the behaviour that matters:
 * a real quote resolves to its segment (with the segment's OWN timestamp), and
 * an invented one resolves to nothing at all.
 */
const SEGMENTS = [
  { speaker: "Speaker 1", start: "00:12", text: "Como tem sido o seu sono nas últimas semanas?" },
  { speaker: "Speaker 2", start: "00:20", text: "Durmo mal, acordo sempre por volta das três da manhã." },
  { speaker: "Speaker 1", start: "01:05", text: "A língua está pálida com saburra branca e fina." },
  { speaker: "Speaker 2", start: "02:30", text: "Sinto muito frio nos pés, principalmente à noite." },
];

describe("provenance anchoring", () => {
  it("locates a verbatim quote and returns the SEGMENT's own timestamp and speaker", () => {
    // The model claimed "0:20"; the viewer links by exact string, so the
    // anchor's "00:20" is what must be persisted.
    const anchor = anchorQuote("acordo sempre por volta das três da manhã", "0:20", SEGMENTS);
    expect(anchor).not.toBeNull();
    expect(anchor?.segment.start).toBe("00:20");
    expect(anchor?.segment.speaker).toBe("Speaker 2");
  });

  it("locates a quote whose timestamp the model got wrong", () => {
    const anchor = anchorQuote("a língua está pálida com saburra branca", "07:41", SEGMENTS);
    expect(anchor?.segment.start).toBe("01:05");
  });

  it("refuses a quote that is not in the transcript", () => {
    expect(anchorQuote("a paciente relatou palpitações e sudorese noturna", "00:20", SEGMENTS)).toBeNull();
  });

  it("refuses an empty quote instead of anchoring it anywhere", () => {
    expect(anchorQuote("", "00:20", SEGMENTS)).toBeNull();
  });

  it("does not count a word matched inside a longer one", () => {
    // "dor" lives inside "Durmo"? No — but it does inside "dormir"-family words
    // generally, and "frio" inside "friorento". A substring match would score
    // this invented sentence high enough to look verified.
    expect(anchorQuote("dor no ombro e no joelho direito", "02:30", SEGMENTS)).toBeNull();
  });

  it("tolerates accents and punctuation differing from the transcript", () => {
    const anchor = anchorQuote("Sinto muito frio nos pes, principalmente a noite!", "02:30", SEGMENTS);
    expect(anchor?.segment.start).toBe("02:30");
  });

  it("anchors a quote spanning a segment boundary", () => {
    const anchor = anchorQuote("Como tem sido o seu sono nas últimas semanas? Durmo mal", "00:12", SEGMENTS);
    expect(anchor?.segment.start).toBe("00:12");
  });
});

/**
 * PRD §10.5: a field nobody asked about has NO row — silence is never written
 * down as a finding. The prompt says so and this filter is the part that cannot
 * drift, so it is pinned here in the language the model actually answers in.
 *
 * The regression these cases exist for: the Portuguese branches were written as
 * truncated stems followed by `\b`, which can never match an inflected word, so
 * every phrase below passed straight into the chart — and froze there when the
 * consultation was finalized.
 */
describe("absence is never stored as an answer", () => {
  it.each([
    "Não informado",
    "Não informada",
    "Nao informado",
    "Não relatado",
    "Não referido",
    "Não mencionado",
    "Não avaliado",
    "Não investigado",
    "Não questionado",
    "Não abordado",
    "Não discutido",
    "Não informados durante a consulta",
    "Desconhecido",
    "Desconhecida",
    "Não consta",
    "Não há informação",
    "Não há dados",
    "Sem informação",
    "Sem informações",
    "Sem dados",
    "Sem menção",
    "Não se aplica",
    "Nada consta",
    "Nada informado",
    "- Não informado",
    "not reported",
    "No information",
    "unknown",
    "N/A",
  ])("refuses %j", (value) => {
    expect(isAbsenceValue(value)).toBe(true);
  });

  /**
   * A patient who actually denied a symptom produced a real clinical negative.
   * Deleting THAT would be its own falsification — so "nega" and friends must
   * survive the filter.
   */
  it.each([
    "Nega febre",
    "Nega uso de anticoagulante",
    "Não relatou dor durante a palpação",
    "Nenhuma alergia conhecida",
    "Dorme mal há 3 meses, acorda às 3h",
    "Língua pálida com saburra branca e fina",
    "Refere melhora com calor local",
    "Informou uso de losartana 50mg",
    "Sem melhora com o tratamento anterior",
  ])("keeps %j", (value) => {
    expect(isAbsenceValue(value)).toBe(false);
  });
});

/**
 * A consultation can be recorded in more than one take (a pause, a resumed
 * session, a finding dictated at the end). What the second take may touch is
 * the whole difference between "completes the chart" and "silently replaces
 * it" — and this predicate must stay identical to the `on conflict … where`
 * clause in migration 0092, because the two decide the same question from
 * different sides.
 */
describe("what a later recording may update", () => {
  const answer = (over: Partial<ExistingAnswer>): ExistingAnswer => ({
    blockKey: "tcm",
    fieldKey: "pulse",
    value: "Pulso fino e profundo",
    source: "professional_voice",
    state: "clear",
    provenance: { transcriptionId: "8f1d1b7e-0000-4000-8000-000000000000" },
    ...over,
  });

  it("updates a finding the pipeline itself dictated", () => {
    expect(isPipelineUpdatable(answer({}))).toBe(true);
  });

  it("never touches an observation she typed by hand", () => {
    // Typed tongue/pulse carry `professional_voice` too — the transcript stamp
    // is the only thing that tells them apart, and a hand-typed one has none.
    expect(isPipelineUpdatable(answer({ provenance: {} }))).toBe(false);
    expect(isPipelineUpdatable(answer({ provenance: null }))).toBe(false);
  });

  it("never touches what she wrote in a normal field", () => {
    expect(isPipelineUpdatable(answer({ source: "professional", provenance: {} }))).toBe(false);
  });

  it("never touches a draft she corrected, even though the stamp survived the edit", () => {
    // save_consultation_answer PRESERVES the provenance when she edits an
    // AI-drafted value, so the stamp alone would wave this through.
    expect(isPipelineUpdatable(answer({ state: "edited" }))).toBe(false);
    expect(isPipelineUpdatable(answer({ state: "rejected" }))).toBe(false);
  });

  it("updates an ordinary AI draft", () => {
    expect(isPipelineUpdatable(answer({ source: "patient_report", fieldKey: "sleep", blockKey: "routine" }))).toBe(
      true,
    );
    expect(isPipelineUpdatable(answer({ source: "ai_inference" }))).toBe(true);
  });
});
