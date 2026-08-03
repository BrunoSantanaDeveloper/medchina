import { anchorQuote } from "./clinical-extraction";
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
