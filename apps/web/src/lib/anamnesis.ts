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
  /**
   * What this field means, for the extraction model. The catalog used to reach
   * the model as bare English keys ("complaint.factors", "routine.bowel") that
   * it had to map onto a Brazilian-Portuguese consultation by guesswork — the
   * cheapest avoidable source of a value landing in the wrong field. Written
   * here rather than in i18n because it instructs a model, not a person.
   */
  hint: string;
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
      { key: "onset", label: "field-onset", hint: "Início e evolução da queixa: quando começou, como progrediu." },
      {
        key: "intensity",
        label: "field-intensity",
        hint: "Intensidade/frequência da queixa, incluindo escalas ditas.",
      },
      {
        key: "factors",
        label: "field-factors",
        multiline: true,
        hint: "O que MELHORA e o que PIORA a queixa (calor, frio, repouso, esforço, horário, alimentação).",
      },
      {
        key: "treatments",
        label: "field-treatments",
        multiline: true,
        hint: "Tratamentos já tentados para esta queixa e o resultado deles.",
      },
      // Medications are clinically load-bearing (PRD §10.10: they must be
      // highlighted alongside pregnancy, anticoagulants, pacemaker, allergies).
      {
        key: "medications",
        label: "field-medications",
        multiline: true,
        hint: "Medicamentos e suplementos em uso, com dose quando dita. Inclui anticoncepcional e fitoterápicos.",
      },
    ],
  },
  {
    key: "routine",
    title: "block-routine",
    fields: [
      { key: "sleep", label: "field-sleep", hint: "Sono: horário, latência, despertares, qualidade, sonhos." },
      { key: "energy", label: "field-energy", hint: "Disposição/energia ao longo do dia, cansaço, seu horário." },
      { key: "diet", label: "field-diet", hint: "Alimentação habitual: o que come, horários, temperatura, líquidos." },
      {
        key: "digestion",
        label: "field-digestion",
        hint: "Digestão: empachamento, azia, refluxo, náusea, distensão, gases.",
      },
      { key: "bowel", label: "field-bowel", hint: "Evacuação: frequência, forma, cor, esforço." },
      { key: "urine", label: "field-urine", hint: "Urina: frequência, volume, cor, noctúria, ardência." },
      {
        key: "thirst",
        label: "field-thirst",
        hint: "Sede e boca seca: quantidade, preferência por bebida quente/fria.",
      },
      { key: "activity", label: "field-activity", hint: "Atividade física e trabalho: tipo, frequência, esforço." },
    ],
  },
  {
    key: "emotional",
    title: "block-emotional",
    fields: [
      {
        key: "state",
        label: "field-emotional-state",
        multiline: true,
        hint: "Estado emocional relatado: humor, irritabilidade, ansiedade, tristeza, medo.",
      },
      {
        key: "context",
        label: "field-life-context",
        multiline: true,
        hint: "Contexto de vida que a paciente liga ao quadro: trabalho, família, perdas, mudanças.",
      },
    ],
  },
  {
    key: "tcm",
    title: "block-tcm",
    fields: [
      {
        key: "tongue",
        label: "field-tongue",
        multiline: true,
        hint: "Exame da LÍNGUA observado pela profissional: cor do corpo, saburra, forma, umidade, fissuras.",
      },
      {
        key: "pulse",
        label: "field-pulse",
        multiline: true,
        hint: "Exame do PULSO observado pela profissional: qualidade, profundidade, força, por posição.",
      },
      {
        key: "palpation",
        label: "field-palpation",
        multiline: true,
        hint: "Palpação feita pela profissional: abdome, meridianos, pontos dolorosos, temperatura da pele.",
      },
      {
        key: "pattern",
        label: "field-pattern",
        multiline: true,
        hint: "Padrão de desarmonia CONCLUÍDO EM VOZ ALTA pela profissional. Nunca deduzir de fala da paciente.",
      },
    ],
  },
  // The old free-form "plan" block (Conduta e anotações) was retired: conduct is
  // the therapeutic plan (PlanPanel step 3 — manual for everyone, AI-drafted for
  // Pro), so keeping a parallel plan block here only duplicated it. Migration
  // 0031 already copied any legacy plan.* answers into consultation_plans; the
  // extraction iterates THIS list, so dropping the block also stops the pipeline
  // from writing plan.* again.
];

/**
 * Fields the professional OBSERVES or CONCLUDES — never inferred from patient
 * speech (PRD §10.3). `tcm.pattern` belongs here for the same reason the tongue
 * does, and for a sharper one: a disharmony pattern IS the clinical reading, so
 * letting a patient's "acho que é fogo no fígado" land in it would write a
 * diagnosis into the chart on the strength of a layperson's guess.
 */
export const PROFESSIONAL_OBSERVATION_FIELDS = new Set(["tcm.tongue", "tcm.pulse", "tcm.palpation", "tcm.pattern"]);
