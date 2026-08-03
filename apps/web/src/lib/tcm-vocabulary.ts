/**
 * The consecrated vocabulary of tongue and pulse diagnosis (PRD §9.6).
 *
 * These two fields are dictated by the professional WITH A PATIENT ON THE
 * TABLE, and their vocabulary is finite and standardised — "pulso em corda,
 * fino à esquerda", "língua pálida com saburra branca espessa". Typing that
 * out during an appointment is the slowest part of recording, so the terms are
 * offered as chips that COMPOSE the free text instead of replacing it: she can
 * still write anything, and what she taps is exactly what she would have
 * typed.
 *
 * Two side effects that matter beyond speed. Consistent terminology makes the
 * RAG retrieval better (`lib/clinical-reasoning.ts` reads these fields
 * verbatim), and it is the groundwork for plotting evolution across
 * consultations — free prose cannot be compared, a shared vocabulary can.
 *
 * Terms are stored in pt-BR because they are what goes INTO the clinical
 * record, which is written in the practice's language — not UI chrome. The
 * group labels are i18n keys.
 */

export interface VocabularyGroup {
  /** i18n key (product namespace) for the group heading. */
  label: string;
  terms: string[];
}

/** Tongue examination: body colour, coating, shape, moisture. */
const TONGUE_GROUPS: VocabularyGroup[] = [
  {
    label: "vocab-tongue-body",
    terms: ["pálida", "rosada", "vermelha", "vermelha escura", "púrpura", "azulada"],
  },
  {
    label: "vocab-tongue-shape",
    terms: [
      "inchada",
      "fina",
      "com marcas de dentes",
      "fissurada",
      "com pontos vermelhos",
      "trêmula",
      "desviada",
      "rígida",
      "flácida",
    ],
  },
  {
    label: "vocab-tongue-coating",
    terms: [
      "saburra fina",
      "saburra espessa",
      "saburra branca",
      "saburra amarela",
      "saburra cinza",
      "saburra pegajosa",
      "saburra descamada",
      "sem saburra",
    ],
  },
  {
    label: "vocab-tongue-moisture",
    terms: ["seca", "úmida", "escorregadia", "veias sublinguais distendidas"],
  },
];

/** Pulse examination: depth, rate, strength, quality, position. */
const PULSE_GROUPS: VocabularyGroup[] = [
  { label: "vocab-pulse-depth", terms: ["superficial", "profundo"] },
  { label: "vocab-pulse-rate", terms: ["lento", "normal", "rápido", "irregular", "intermitente"] },
  { label: "vocab-pulse-strength", terms: ["vazio", "cheio", "fraco", "forte"] },
  {
    label: "vocab-pulse-quality",
    terms: ["em corda", "escorregadio", "rugoso", "fino", "tenso", "grande", "curto", "longo", "profundo e fraco"],
  },
  {
    label: "vocab-pulse-position",
    terms: ["à esquerda", "à direita", "em cun", "em guan", "em chi"],
  },
];

/** Palpation: what she feels, not what the patient reports. */
const PALPATION_GROUPS: VocabularyGroup[] = [
  {
    label: "vocab-palpation-finding",
    terms: [
      "abdome tenso",
      "abdome flácido",
      "dor à palpação",
      "nódulos musculares",
      "pele quente",
      "pele fria",
      "edema",
    ],
  },
];

/** Which composite field keys offer a vocabulary, and which one. */
export const TCM_VOCABULARY: Record<string, VocabularyGroup[]> = {
  "tcm.tongue": TONGUE_GROUPS,
  "tcm.pulse": PULSE_GROUPS,
  "tcm.palpation": PALPATION_GROUPS,
};

/** Terms already present in the text, so a chip can show as selected. */
export function activeTerms(value: string, groups: VocabularyGroup[]): Set<string> {
  const haystack = value.toLowerCase();
  const active = new Set<string>();
  for (const group of groups) {
    for (const term of group.terms) {
      if (containsTerm(haystack, term.toLowerCase())) active.add(term);
    }
  }
  return active;
}

/**
 * Whole-ITEM match against a comma-separated value.
 *
 * A space is NOT a boundary here: "saburra fina" must not light up the
 * separate "fina" chip, and "profundo e fraco" must not light up "profundo".
 * Only a comma, a semicolon or the ends of the text separate one term from the
 * next — surrounding spaces are skipped on the way to them.
 */
function containsTerm(haystack: string, term: string): boolean {
  const isSeparator = (char: string) => char === "," || char === ";";
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at === -1) return false;

    let before = at - 1;
    while (before >= 0 && haystack[before] === " ") before -= 1;
    let after = at + term.length;
    while (after < haystack.length && haystack[after] === " ") after += 1;

    const startsClean = before < 0 || isSeparator(haystack[before]);
    const endsClean = after >= haystack.length || isSeparator(haystack[after]) || haystack[after] === ".";
    if (startsClean && endsClean) return true;
    from = at + 1;
  }
}

/**
 * Adds or removes a term, keeping everything she typed by hand.
 *
 * Composition is comma-separated because that is how the phrase reads back in
 * the record ("pálida, saburra branca espessa"). Removing a term takes its
 * separator with it so the text never degrades into ", ,".
 */
export function toggleTerm(value: string, term: string): string {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === term.toLowerCase());
  if (index >= 0) {
    parts.splice(index, 1);
    return parts.join(", ");
  }
  // A term typed inside a longer sentence is left alone — removing it would
  // mean rewriting her words; the chip simply appends.
  return parts.length > 0 ? `${parts.join(", ")}, ${term}` : term;
}
