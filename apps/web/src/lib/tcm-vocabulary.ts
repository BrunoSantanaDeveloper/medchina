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
  const active = new Set<string>();
  for (const group of groups) {
    for (const term of group.terms) {
      if (locateTerm(value, term)) active.add(term);
    }
  }
  return active;
}

/**
 * Adds or removes a term, keeping everything she typed by hand.
 *
 * Composition is comma-separated because that is how the phrase reads back in
 * the record ("pálida, saburra branca espessa"), but the value is NOT a list:
 * the AI draft arrives as prose ("Língua pálida com saburra branca e fina") and
 * she dictates in prose too. So a term is found wherever it stands as a whole
 * phrase, and the chip toggles THAT occurrence — matching only whole
 * comma-items is what used to append a second "pálida" to a sentence that
 * already said it.
 */
export function toggleTerm(value: string, term: string): string {
  const found = locateTerm(value, term);
  return found ? removeSpan(value, found) : appendTerm(value, term);
}

/* -------------------------------------------------------------------------- */
/* Finding a term inside her text                                              */
/* -------------------------------------------------------------------------- */

interface TermSpan {
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * A word character for boundary purposes. `\b` is ASCII-only, which would cut
 * "pálida" at the accent and refuse "à esquerda" outright — every term here is
 * Portuguese.
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function isWordCharacter(char: string | undefined): boolean {
  return char !== undefined && WORD_CHARACTER.test(char);
}

/** Punctuation that may sit against a term without being part of it. */
function isSeparator(char: string | undefined): boolean {
  return char === "," || char === ";";
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the term as a whole phrase, tolerating any run of whitespace between
 * its words — a transcript-fed draft may wrap "saburra\nbranca" across a line.
 */
function termPattern(term: string): RegExp {
  const words = term.trim().split(/\s+/u).map(escapeForRegExp);
  return new RegExp(words.join("\\s+"), "giu");
}

/** Every occurrence of the term standing on its own word boundaries, in any case. */
function locateAll(text: string, term: string): TermSpan[] {
  if (!term.trim()) return [];
  const spans: TermSpan[] = [];
  const pattern = termPattern(term);
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    // "fina" is a tongue shape; inside "afinada" it is nothing at all.
    if (!isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])) spans.push({ start, end });
  }
  return spans;
}

/** Every term the vocabulary offers, across all three fields. */
const ALL_TERMS: readonly string[] = Array.from(
  new Set(Object.values(TCM_VOCABULARY).flatMap((groups) => groups.flatMap((group) => group.terms))),
);

/**
 * For each term, the LONGER vocabulary phrases that contain it.
 *
 * A word boundary alone would read "saburra fina" as the coating AND the
 * separate "fina" shape chip, and "profundo e fraco" as three pulse qualities.
 * The longest phrase present is the one she meant, so a shorter term is only
 * active where no longer term covers it. The map spans all three fields on
 * purpose: it is built from the vocabulary, so it cannot drift from it.
 */
const COVERING_TERMS: ReadonlyMap<string, readonly string[]> = new Map(
  ALL_TERMS.map((term) => [
    term.toLowerCase(),
    ALL_TERMS.filter((other) => other.length > term.length && locateAll(other, term).length > 0),
  ]),
);

/** The first occurrence of the term that no longer term is spelling out. */
function locateTerm(text: string, term: string): TermSpan | null {
  const spans = locateAll(text, term);
  if (spans.length === 0) return null;
  const covered = (COVERING_TERMS.get(term.toLowerCase()) ?? []).flatMap((longer) => locateAll(text, longer));
  return spans.find((span) => !covered.some((other) => other.start <= span.start && other.end >= span.end)) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Editing her text around it                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cuts the term out and closes the gap.
 *
 * Whatever comes back is autosaved immediately, so this repairs only what the
 * cut broke — the spacing and the punctuation that were holding the removed
 * term. Her grammar is left as she wrote it (removing "fina" from "branca e
 * fina" leaves the "e" standing): guessing at words is how a record gets
 * rewritten, and a stray conjunction she can see is better than a word she
 * cannot get back.
 */
function removeSpan(value: string, span: TermSpan): string {
  // Trim only HORIZONTAL space. Tongue, pulse and palpation are multiline
  // fields (lib/anamnesis.ts) and she writes findings on separate lines; a
  // `\s` trim eats the newlines, so removing one chip collapsed
  // "pálida\nsaburra branca\nfissurada" into "pálida fissurada" — two lines
  // gone and two findings run together. Autosave persists that instantly.
  let head = value.slice(0, span.start).replace(TRAILING_BLANK, "");
  let tail = value.slice(span.end).replace(LEADING_BLANK, "");

  // The term sat between two marks; exactly one of them may survive, or the
  // text reads "branca, , seca" — or "Pulso:, tenso." when the mark before it
  // was not itself a list separator.
  if (isSeparator(head.at(-1)) && isClosingPunctuation(tail[0])) {
    head = head.slice(0, -1).replace(TRAILING_BLANK, "");
  } else if (isPhrasePunctuation(head.at(-1)) && isSeparator(tail[0])) {
    tail = tail.slice(1).replace(LEADING_BLANK, "");
  }

  if (head === "") return tail.replace(/^[,;.\s]+/u, "");
  if (tail === "") return head.replace(TRAILING_BLANK, "").replace(/[,;]+$/u, "");

  const headEndsLine = /[\r\n]$/u.test(head);
  const tailStartsLine = /^[\r\n]/u.test(tail);
  // Both halves kept the break that surrounded the removed term — together
  // they would leave a blank line she never wrote.
  if (headEndsLine && tailStartsLine) return head + tail.replace(/^[\r\n]+/u, "");
  // Already on separate lines, or the tail opens with punctuation that binds to
  // the word before it: nothing goes between them.
  if (headEndsLine || tailStartsLine || isClosingPunctuation(tail[0])) return head + tail;
  return `${head} ${tail}`;
}

/** Marks after which a list separator opening the tail is left orphaned. */
function isPhrasePunctuation(character: string | undefined): boolean {
  return character !== undefined && ",;:".includes(character);
}

/**
 * Punctuation that closes what came before it, so it must stay glued to the
 * previous word instead of being pushed away by a reinserted space. Limiting
 * this to `,;.` left every other mark stranded: removing "fino" from
 * "Pulso: fino, tenso." produced "Pulso:, tenso.".
 */
function isClosingPunctuation(character: string | undefined): boolean {
  return character !== undefined && ".,;:!?…)]}»".includes(character);
}

/** Horizontal whitespace only — never a line break. */
const TRAILING_BLANK = /[^\S\r\n]+$/u;
const LEADING_BLANK = /^[^\S\r\n]+/u;

/**
 * Appends the term the way the phrase reads back in the record.
 *
 * A sentence that was already closed stays closed — the term goes inside it,
 * not after the full stop.
 */
function appendTerm(value: string, term: string): string {
  // Horizontal-only, for the same reason as removeSpan: "pálida\n" + a chip
  // must not silently swallow the line she was about to write on.
  const written = value.replace(TRAILING_BLANK, "");
  const terminator = /[.!?…]+$/u.exec(written)?.[0] ?? "";
  const base = written
    .slice(0, written.length - terminator.length)
    .replace(TRAILING_BLANK, "")
    .replace(/[,;][^\S\r\n]*$/u, "");
  if (base === "") return `${term}${terminator}`;
  // A term added after a line break belongs on that line, not comma-joined to
  // the previous one.
  if (/[\r\n]$/u.test(base)) return `${base}${term}${terminator}`;
  return `${base}, ${term}${terminator}`;
}
