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

/** Ordered most-acute first, so a value matching several leads with the sharpest. */
const CATEGORY_PATTERNS: { category: SafetyCategory; pattern: RegExp }[] = [
  {
    category: "anticoagulant",
    pattern: /\b(anticoagul|varfarin|warfarin|heparin|rivaroxab|clopidogrel|aas\b|aspirin)/i,
  },
  { category: "pacemaker", pattern: /\b(marca-?passo|pacemaker|desfibril|stent|cardio-?desfibril)/i },
  { category: "pregnancy", pattern: /\b(gestante|gr[áa]vida|gravidez|pregnan|gesta[çc][ãa]o)/i },
  { category: "breastfeeding", pattern: /\b(amamenta|lactante|lacta[çc][ãa]o|breastfeed)/i },
  { category: "surgery", pattern: /\b(cirurgi|p[óo]s-?operat|surgery|surgical)/i },
  { category: "allergy", pattern: /\b(alergi|al[ée]rgic|allerg|intoler[âa]nci)/i },
  { category: "lesion", pattern: /\b(les[ãa]o|les[õo]es|ferida|[úu]lcera|varizes|trombos|ferimento|wound|injur)/i },
  // General medications last: the specific families above are more informative.
  {
    category: "medication",
    pattern: /\b(medicaç|medicament|rem[ée]dio|f[áa]rmaco|anticoncepci|anticonceptiv|corticoid|imunossupress)/i,
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
