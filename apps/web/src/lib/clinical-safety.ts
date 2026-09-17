/**
 * Clinically sensitive factors that must never be hidden (PRD §10.10:
 * "Não ocultar contraindicações conhecidas. Destacar medicamentos, gestação,
 * anticoagulantes, marcapasso, cirurgias, lesões e alergias relevantes").
 *
 * This lives on its own because it is enforced in TWO places — the anamnesis
 * extraction flags these for review, and the therapeutic plan surfaces them as
 * cautions on every modality — and both must agree. It is CODE, not prompt: a
 * model that forgets to mention an anticoagulant cannot make the alert vanish.
 *
 * Multilingual: the consultation language follows the workspace, not the code.
 *
 * A flag says "this factor is present, verify its implications" — never "do X".
 * The professional judges the contraindication; the software only refuses to
 * let it go unnoticed.
 */

export type SafetyCategory =
  | "medication"
  | "anticoagulant"
  | "pacemaker"
  | "pregnancy"
  | "breastfeeding"
  | "surgery"
  | "allergy"
  | "lesion";

/**
 * Ordered most-acute first, so a value matching several leads with the sharpest.
 *
 * Brand names matter as much as the generic stems: a patient says "tomo
 * Xarelto", never "tomo um inibidor do fator Xa", and a scan that only knew the
 * stems read that sentence as unremarkable. The list covers what is actually
 * dispensed in Brazil; add to it rather than relying on the model to notice.
 */
const CATEGORY_PATTERNS: { category: SafetyCategory; pattern: RegExp }[] = [
  {
    category: "anticoagulant",
    pattern:
      /\b(anticoagul|antiagreg|varfarin|warfarin|heparin|enoxaparin|rivaroxab|apixab|dabigatr|edoxab|clopidogrel|ticagrelor|prasugrel|aas\b|aspirin|marevan|coumadin|xarelto|eliquis|pradaxa|lixiana|clexane|plavix|iscover|marcoumar)/i,
  },
  {
    category: "pacemaker",
    pattern: /\b(marca-?passo|pacemaker|desfibril|stent|cardio-?desfibril|cdi\b|ressincroniz|bomba de insulina)/i,
  },
  {
    category: "pregnancy",
    pattern:
      /\b(gestante|gr[áa]vida|gravidez|pregnan|gesta[çc][ãa]o|semanas de gesta|trimestre|nul[íi]par|gest[aá]cional)/i,
  },
  { category: "breastfeeding", pattern: /\b(amamenta|lactante|lacta[çc][ãa]o|breastfeed|puerp[ée]rio)/i },
  {
    category: "surgery",
    pattern: /\b(cirurgi|p[óo]s-?operat|surgery|surgical|artroplast|pr[óo]tese|implante met[áa]lic)/i,
  },
  { category: "allergy", pattern: /\b(alergi|al[ée]rgic|allerg|intoler[âa]nci|anafila|urtic[áa]ri)/i },
  {
    category: "lesion",
    pattern:
      /\b(les[ãa]o|les[õo]es|ferida|[úu]lcera|varizes|trombos|tvp\b|ferimento|wound|injur|dermatit|queimadur|micose)/i,
  },
  // General medications last: the specific families above are more informative.
  {
    category: "medication",
    pattern:
      /\b(medicaç|medicament|rem[ée]dio|f[áa]rmaco|anticoncepci|anticonceptiv|corticoid|imunossupress|quimioterap|insulina|metformin|levotiroxin|antidepress|ansiol[íi]tic|benzodiazep|opioid|anticonvulsiv)/i,
  },
];

/** The union used by the anamnesis extraction to force state=attention. */
export const SENSITIVE = new RegExp(CATEGORY_PATTERNS.map((entry) => entry.pattern.source).join("|"), "i");

export interface SafetyFlag {
  category: SafetyCategory;
  /** The recorded text that triggered it (evidence, so she can check). */
  matchedText: string;
  /** Where it was recorded, when known. */
  fieldKey?: string;
}

/**
 * The word that raised a flag — what a document that LEAVES the practice may
 * show.
 *
 * `matchedText` keeps the whole recorded value, because on her screen it is
 * the evidence she checks. The printed plan the patient takes home used to copy
 * it too, so a sentence like "usa ansiolítico e fuma maconha desde os 20" came
 * out whole under "Medicamentos" — and the flags are immutable, so she could
 * not remove it. The term is the full word around the match: the pattern
 * "ansiol[íi]tic" prints as "ansiolítico", "Xarelto 20mg" as "Xarelto".
 *
 * Empty when the text no longer matches its category (an old or edited flag):
 * the document then shows the category alone.
 */
export function safetyFlagTerm(flag: { category: string; matchedText?: string | null }): string {
  const entry = CATEGORY_PATTERNS.find((candidate) => candidate.category === flag.category);
  const text = flag.matchedText ?? "";
  if (!entry || !text) return "";
  const match = new RegExp(entry.pattern.source, entry.pattern.flags.replace("g", "")).exec(text);
  if (!match) return "";
  const wordChar = /[\p{L}\p{N}-]/u;
  let start = match.index;
  let end = match.index + match[0].length;
  while (start > 0 && wordChar.test(text[start - 1])) start -= 1;
  while (end < text.length && wordChar.test(text[end])) end += 1;
  return text.slice(start, end);
}

/**
 * Scan recorded values for sensitive factors. Deduplicated by category — one
 * pregnancy flag, not one per mention — keeping the most specific matched text.
 */
export function detectSafetyFlags(values: { text: string; fieldKey?: string }[]): SafetyFlag[] {
  const byCategory = new Map<SafetyCategory, SafetyFlag>();
  for (const { text, fieldKey } of values) {
    if (!text) continue;
    for (const { category, pattern } of CATEGORY_PATTERNS) {
      if (pattern.test(text) && !byCategory.has(category)) {
        byCategory.set(category, { category, matchedText: text.trim(), fieldKey });
      }
    }
  }
  // Preserve the acuity order of CATEGORY_PATTERNS.
  return CATEGORY_PATTERNS.map((entry) => byCategory.get(entry.category)).filter((flag): flag is SafetyFlag =>
    Boolean(flag),
  );
}
