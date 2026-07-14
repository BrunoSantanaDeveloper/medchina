/**
 * The anamnesis model (PRD §9.6): expandable blocks the professional fills by
 * hand today and the AI pre-fills tomorrow. Block/field keys are STABLE — they
 * are stored in anamnesis_answers and are what AI-extracted values will map
 * onto, so never rename a key (add a new one instead).
 *
 * Titles/labels are i18n keys in the `product` namespace.
 */
export interface AnamnesisField {
  key: string;
  /** i18n key for the field label. */
  label: string;
  multiline?: boolean;
}

export interface AnamnesisBlock {
  key: string;
  /** i18n key for the block title. */
  title: string;
  fields: AnamnesisField[];
}

export const ANAMNESIS_BLOCKS: AnamnesisBlock[] = [
  {
    key: "complaint",
    // The chief complaint itself lives on the consultation row (it drives the
    // patient timeline), so it is edited above the blocks — not duplicated here.
    title: "block-complaint",
    fields: [
      { key: "onset", label: "field-onset" },
      { key: "intensity", label: "field-intensity" },
      { key: "factors", label: "field-factors", multiline: true },
      { key: "treatments", label: "field-treatments", multiline: true },
    ],
  },
  {
    key: "routine",
    title: "block-routine",
    fields: [
      { key: "sleep", label: "field-sleep" },
      { key: "energy", label: "field-energy" },
      { key: "diet", label: "field-diet" },
      { key: "digestion", label: "field-digestion" },
      { key: "bowel", label: "field-bowel" },
      { key: "urine", label: "field-urine" },
      { key: "thirst", label: "field-thirst" },
      { key: "activity", label: "field-activity" },
    ],
  },
  {
    key: "emotional",
    title: "block-emotional",
    fields: [
      { key: "state", label: "field-emotional-state", multiline: true },
      { key: "context", label: "field-life-context", multiline: true },
    ],
  },
  {
    key: "tcm",
    title: "block-tcm",
    fields: [
      { key: "tongue", label: "field-tongue", multiline: true },
      { key: "pulse", label: "field-pulse", multiline: true },
      { key: "palpation", label: "field-palpation", multiline: true },
      { key: "pattern", label: "field-pattern", multiline: true },
    ],
  },
  {
    key: "plan",
    title: "block-plan",
    fields: [
      { key: "goal", label: "field-goal", multiline: true },
      { key: "points", label: "field-points", multiline: true },
      { key: "techniques", label: "field-techniques", multiline: true },
      { key: "guidance", label: "field-guidance", multiline: true },
      { key: "frequency", label: "field-frequency" },
    ],
  },
];

/** Fields the professional OBSERVES (never inferred from patient speech, PRD §10.3). */
export const PROFESSIONAL_OBSERVATION_FIELDS = new Set(["tcm.tongue", "tcm.pulse", "tcm.palpation"]);
