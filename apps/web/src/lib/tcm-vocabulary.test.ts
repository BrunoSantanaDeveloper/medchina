import { PULSE_POSITION_FIELDS } from "./anamnesis";
import { activeTerms, TCM_VOCABULARY, termPresence, toggleTerm, type VocabularyGroup } from "./tcm-vocabulary";
import { describe, expect, it } from "vitest";

/**
 * The chips edit a field that is autosaved on the spot, so every case here is
 * about the same two risks: a chip that does not recognise what is written
 * duplicates the term she can already read, and a chip that removes too much
 * quietly rewrites a clinical record.
 */
const TONGUE = TCM_VOCABULARY["tcm.tongue"];
const PULSE = TCM_VOCABULARY["tcm.pulse"];

/** What the extraction pipeline actually writes: prose, not a list. */
const DRAFT = "Língua pálida com saburra branca e fina";

describe("TCM vocabulary chips compose the free text", () => {
  it("appends the first term and then separates them as the phrase reads", () => {
    expect(toggleTerm("", "pálida")).toBe("pálida");
    expect(toggleTerm("pálida", "saburra branca")).toBe("pálida, saburra branca");
  });

  it("removes a term without leaving dangling separators", () => {
    expect(toggleTerm("pálida, saburra branca, fissurada", "saburra branca")).toBe("pálida, fissurada");
    expect(toggleTerm("pálida", "pálida")).toBe("");
  });

  it("never discards what she typed by hand", () => {
    const handwritten = "pálida nas bordas, com aspecto incomum hoje";
    expect(toggleTerm(handwritten, "fissurada")).toBe(`${handwritten}, fissurada`);
  });

  it("marks a chip active only on a whole term, never inside a longer one", () => {
    // "saburra fina" must not light up the separate "fina" chip.
    const active = activeTerms("saburra fina", TONGUE);
    expect(active.has("saburra fina")).toBe(true);
    expect(active.has("fina")).toBe(false);
    // Same rule for the pulse: "profundo e fraco" is one quality, not three.
    const pulse = activeTerms("profundo e fraco", PULSE);
    expect(pulse.has("profundo e fraco")).toBe(true);
    expect(pulse.has("profundo")).toBe(false);
    expect(pulse.has("fraco")).toBe(false);
  });

  it("recognizes terms regardless of case and trailing punctuation", () => {
    expect(activeTerms("Em corda, fino.", PULSE).has("em corda")).toBe(true);
    expect(activeTerms("Em corda, fino.", PULSE).has("fino")).toBe(true);
  });

  it("offers a vocabulary exactly for the professional-observation fields", () => {
    expect(Object.keys(TCM_VOCABULARY).sort()).toEqual(
      ["tcm.palpation", "tcm.pulse", "tcm.tongue", ...PULSE_POSITION_FIELDS].sort(),
    );
    // tcm.pattern is deliberately absent: a disharmony pattern is a clinical
    // conclusion, not a term to pick from a list.
    expect(TCM_VOCABULARY["tcm.pattern"]).toBeUndefined();
  });

  it("drops the position group on a position field — the field IS the position", () => {
    const labels = (groups: VocabularyGroup[]) => groups.map((group) => group.label);
    expect(labels(TCM_VOCABULARY["pulse.heart"])).toEqual([
      "vocab-pulse-depth",
      "vocab-pulse-rate",
      "vocab-pulse-strength",
      "vocab-pulse-quality",
    ]);
    // Every position offers the same four, so a term tapped on the liver reads
    // the same as the one tapped on the heart (the groundwork for comparing
    // consultations at all).
    for (const key of PULSE_POSITION_FIELDS)
      expect(labels(TCM_VOCABULARY[key])).toEqual(labels(TCM_VOCABULARY["pulse.heart"]));
    // The retired general field keeps its own, position terms included.
    expect(labels(TCM_VOCABULARY["tcm.pulse"])).toContain("vocab-pulse-position");
  });
});

describe("chips recognize the prose she dictates and the AI drafts", () => {
  it("lights up terms written inside a sentence, not only comma items", () => {
    const active = activeTerms(DRAFT, TONGUE);
    expect(active.has("pálida")).toBe(true);
    expect(active.has("saburra branca")).toBe(true);
  });

  it("still lights up a plain comma-separated list", () => {
    const active = activeTerms("pálida, saburra branca, com marcas de dentes", TONGUE);
    expect(active.has("pálida")).toBe(true);
    expect(active.has("saburra branca")).toBe(true);
    expect(active.has("com marcas de dentes")).toBe(true);
    expect(active.has("fissurada")).toBe(false);
  });

  it("reads terms across a line break, as a transcript-fed draft may wrap them", () => {
    expect(activeTerms("Língua pálida, saburra\nbranca", TONGUE).has("saburra branca")).toBe(true);
  });

  it("keeps the accents of the term as a boundary", () => {
    // "à esquerda" begins with an accented vowel, where an ASCII \b would fail.
    expect(activeTerms("pulso fino à esquerda", PULSE).has("à esquerda")).toBe(true);
  });

  it("never matches inside a longer word", () => {
    // "afinada" and "ressecada" merely contain the letters of a term.
    expect(activeTerms("Língua bem definida, não afinada", TONGUE).has("fina")).toBe(false);
    expect(activeTerms("mucosa ressecada nas bordas", TONGUE).has("seca")).toBe(false);
    expect(activeTerms("edemaciado à palpação", TCM_VOCABULARY["tcm.palpation"]).has("edema")).toBe(false);
  });
});

describe("toggling a term already written in prose", () => {
  it("does not append a duplicate of a term already written in the sentence", () => {
    // The chip reads the prose (it lights up) but the text is hers: tapping it
    // neither duplicates the term nor cuts it out of her sentence.
    expect(termPresence(DRAFT, "pálida")).toBe("phrase");
    expect(toggleTerm(DRAFT, "pálida")).toBe(DRAFT);
  });

  it("round-trips without changing the meaning of the sentence", () => {
    const removed = toggleTerm("Língua pálida, saburra branca", "saburra branca");
    expect(removed).toBe("Língua pálida");
    expect(toggleTerm(removed, "saburra branca")).toBe("Língua pálida, saburra branca");
  });

  it("leaves no orphan punctuation or double space behind", () => {
    // Comma of the removed item goes with it, from any position in the list.
    expect(toggleTerm("pálida, fissurada, seca", "fissurada")).toBe("pálida, seca");
    expect(toggleTerm("pálida, fissurada, seca", "pálida")).toBe("fissurada, seca");
    expect(toggleTerm("pálida, fissurada, seca", "seca")).toBe("pálida, fissurada");
    // A closed sentence stays closed, with no comma stranded before the stop.
    expect(toggleTerm("Língua pálida, saburra branca.", "saburra branca")).toBe("Língua pálida.");
    expect(toggleTerm("pálida, fissurada, seca", "fissurada")).not.toMatch(/ {2}|,\s*,/u);
  });

  it("appends inside a sentence that was already closed", () => {
    expect(toggleTerm("Língua pálida com saburra branca e fina.", "fissurada")).toBe(
      "Língua pálida com saburra branca e fina, fissurada.",
    );
  });

  it("adds the shorter term a longer one was hiding, then takes it back", () => {
    // The "fina" chip reads as inactive while only "saburra fina" is written,
    // so tapping it must ADD the tongue shape — and tapping again remove that
    // one, never the coating.
    const added = toggleTerm("saburra fina", "fina");
    expect(added).toBe("saburra fina, fina");
    expect(toggleTerm(added, "fina")).toBe("saburra fina");
  });

  it("does not touch a word that merely contains the term", () => {
    const handwritten = "Língua bem definida, não afinada";
    expect(toggleTerm(handwritten, "fina")).toBe(`${handwritten}, fina`);
  });
});

/**
 * Tongue, pulse and palpation are multiline fields and she writes findings on
 * separate lines. An earlier version of the removal trimmed `\s` — which eats
 * newlines — so clearing one chip collapsed her lines and ran two findings
 * together, and autosave persisted it before she could see it. These are the
 * exact shapes that broke.
 */
describe("removing a term never rewrites what she wrote around it", () => {
  const line = (value: string, term: string) => toggleTerm(value, term);

  it("keeps each finding on its own line", () => {
    expect(line("pálida\nsaburra branca\nfissurada", "saburra branca")).toBe("pálida\nfissurada");
  });

  it("does not merge two lines into one", () => {
    expect(line("pálida\nPulso fino", "pálida")).toBe("Pulso fino");
  });

  it("leaves a bullet list as a list", () => {
    expect(line("- pálida\n- fissurada", "pálida")).toBe("-\n- fissurada");
  });

  it("keeps punctuation glued to the word before it", () => {
    // Limiting the repair to `,;.` stranded every other mark: this produced
    // "Pulso:, tenso." before.
    expect(line("Pulso: fino, tenso.", "fino")).toBe("Pulso: tenso.");
  });

  it("adds a term on the line she was writing on, not comma-joined to the last", () => {
    expect(line("pálida\n", "fissurada")).toBe("pálida\nfissurada");
  });
});

/**
 * Reported from real use: she writes the pulse by organ ("pulso do coração
 * fraco"), the chips light up because the terms ARE in the text, and tapping a
 * lit chip deleted the word from inside her sentence — autosaved on the spot.
 *
 * The rule that settles it: a chip owns a term only where the term stands as
 * its own item, which is the only shape a chip ever writes.
 */
describe("a term written inside her own phrase belongs to her", () => {
  const BY_ORGAN = "pulso do coração fraco, pulso do intestino grosso forte";

  it("lights the chip up without claiming the word", () => {
    expect(activeTerms(BY_ORGAN, PULSE).has("fraco")).toBe(true);
    expect(termPresence(BY_ORGAN, "fraco")).toBe("phrase");
    expect(termPresence(BY_ORGAN, "forte")).toBe("phrase");
  });

  it("leaves her sentence exactly as she wrote it", () => {
    expect(toggleTerm(BY_ORGAN, "fraco")).toBe(BY_ORGAN);
    expect(toggleTerm(BY_ORGAN, "forte")).toBe(BY_ORGAN);
  });

  it("still removes what the chip itself wrote, in the same text", () => {
    const withChip = toggleTerm(BY_ORGAN, "profundo");
    expect(withChip).toBe(`${BY_ORGAN}, profundo`);
    expect(termPresence(withChip, "profundo")).toBe("item");
    expect(toggleTerm(withChip, "profundo")).toBe(BY_ORGAN);
  });
});
