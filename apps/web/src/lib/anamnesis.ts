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
  /**
   * Every value the extraction writes here comes back for her review, whatever
   * the model decided. Medications have always had this (PRD §10.10); it used
   * to be a comparison against the field NAME inside the extraction, which a
   * new field silently escaped. Declared here, it travels with the field.
   */
  alwaysReview?: boolean;
  /**
   * A field that left the model. It is no longer offered to her or to the
   * extraction, but where a record ALREADY holds one it stays on the chart,
   * readable and correctable — see `anamnesisBlocksFor`. Hiding it outright
   * would show a consultation as "não informado" about something that was
   * informed.
   */
  retired?: boolean;
}

/** What decides whether a conditional block applies to a consultation. */
export type AnamnesisCondition = "fertility";

export interface AnamnesisBlock {
  key: string;
  /** i18n key for the block title. */
  title: string;
  fields: AnamnesisField[];
  /**
   * A block that does not apply to every patient. It is shown, counted and
   * offered to the extraction only when its condition holds — see
   * `anamnesisBlocksFor`.
   */
  when?: AnamnesisCondition;
  /**
   * A block that is always on screen but joins the "X de Y campos" total and
   * the absence list sent to the AI only once it holds an answer — see
   * `countedAnamnesisBlocks`.
   */
  optional?: boolean;
  /** i18n key for a line under the block title, when it needs one. */
  note?: string;
  /**
   * The fields of this block share ONE vocabulary, so their chips are offered
   * under the field she is writing in instead of under all of them at once.
   * The twelve pulse positions would otherwise put some 240 chips on screen.
   */
  vocabularyOnDemand?: boolean;
}

/**
 * The twelve pulse positions (reported from real use, 2026-10-17): every item
 * of the pulse — profundidade, ritmo, força, qualidade — is read PER ORGAN, so
 * the pulse is twelve readings and not one line of prose. "Posição" stopped
 * being a term to tap, because the field itself is the position.
 *
 * She asked for the organ alone, without cun/guan/chi and without the wrist:
 * which finger feels what is her hand's knowledge, and repeating it in every
 * label would only make the chart longer to read.
 *
 * Keys are English and FOREVER (they are stored in anamnesis_answers); the
 * organ in pt-BR is what the extraction is told to listen for and what the
 * library retrieval searches with.
 */
const PULSE_POSITIONS: { key: string; organ: string }[] = [
  { key: "heart", organ: "Coração" },
  { key: "small-intestine", organ: "Intestino delgado" },
  { key: "liver", organ: "Fígado" },
  { key: "gallbladder", organ: "Vesícula biliar" },
  { key: "kidney", organ: "Rim" },
  { key: "bladder", organ: "Bexiga" },
  { key: "lung", organ: "Pulmão" },
  { key: "large-intestine", organ: "Intestino grosso" },
  { key: "spleen", organ: "Baço" },
  { key: "stomach", organ: "Estômago" },
  { key: "pericardium", organ: "Pericárdio" },
  { key: "triple-burner", organ: "Triplo Aquecedor" },
];

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
        // The label says "relatados" on purpose: when she types the value the
        // origin becomes "professional", and the label is the only thing left
        // saying the diagnosis is the patient's report, not her conclusion.
        hint:
          "Tratamentos já tentados para esta queixa e o resultado; exames já feitos e o que a paciente disse deles; " +
          "diagnósticos que ELA RELATA ter recebido de outro profissional (ex.: 'o médico disse que é hérnia'). " +
          "Escreva sempre como relato ('relata diagnóstico de ...'). NUNCA deduza nem escreva um diagnóstico a partir dos sintomas.",
      },
      // Medications are clinically load-bearing (PRD §10.10: they must be
      // highlighted alongside pregnancy, anticoagulants, pacemaker, allergies).
      // One field for both, on purpose: the line between "a vitamin D the
      // doctor prescribed" and "a supplement" is not clean, and splitting it
      // would scatter the same item across consultations.
      {
        key: "medications",
        label: "field-medications",
        multiline: true,
        alwaysReview: true,
        hint:
          "Medicamentos E suplementos em uso, com dose e frequência quando ditas: remédios contínuos ou recentes, " +
          "anticoncepcional, fitoterápicos, chás medicinais, vitaminas, minerais, antioxidantes, ômega-3, probióticos e " +
          "outros suplementos. Um item por linha; não omita um suplemento por parecer 'natural'.",
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
      // Substances (PRD §9.6). Always reviewed: it is the topic where speech
      // about OTHER people ("meu marido bebe") is most common, and the
      // pipeline checks who spoke, not whom the sentence is about.
      {
        key: "tobacco",
        label: "field-tobacco",
        alwaysReview: true,
        hint:
          "Uso de tabaco pela PRÓPRIA paciente: cigarro, cigarro eletrônico/vape, narguilé; quantidade, frequência, " +
          "há quanto tempo e, se parou, quando. Fala sobre outra pessoa (familiar que fuma) não entra aqui.",
      },
      {
        key: "alcohol",
        label: "field-alcohol",
        alwaysReview: true,
        hint:
          "Consumo de álcool pela PRÓPRIA paciente: tipo de bebida, quantidade, frequência e contexto, nas palavras dela. " +
          "Fala sobre outra pessoa não entra aqui.",
      },
      {
        key: "substances",
        label: "field-substances",
        alwaysReview: true,
        hint:
          "Uso de outras substâncias pela PRÓPRIA paciente (maconha, estimulantes, uso de remédio sem prescrição etc.): " +
          "o quê, frequência e há quanto tempo, apenas como ela relatou. Nunca inferir uso a partir de comportamento ou " +
          "sintoma; fala sobre outra pessoa não entra aqui.",
      },
    ],
  },
  {
    // Conditional (0103): only when the patient is marked for fertility care
    // AND the practice declares the area. "gyneco", not "fertility": the key is
    // forever and the block serves every patient who menstruates, including
    // the climacteric — not only someone trying to conceive.
    key: "gyneco",
    title: "block-gyneco",
    when: "fertility",
    fields: [
      {
        key: "lmp",
        label: "field-lmp",
        hint:
          "Data da última menstruação (DUM) como foi dita: uma data, 'faz X dias/semanas' ou 'está atrasada há...'. " +
          "Nunca calcular nem inferir a data.",
      },
      {
        key: "cycle",
        label: "field-cycle",
        hint: "Ciclo menstrual: intervalo entre as menstruações, quantos dias dura o fluxo, regularidade, adiantamentos ou atrasos.",
      },
      {
        key: "flow",
        label: "field-flow",
        multiline: true,
        hint: "Fluxo menstrual: volume, cor do sangue e presença e tamanho de coágulos, nas palavras da paciente.",
      },
      {
        key: "symptoms",
        label: "field-cycle-symptoms",
        multiline: true,
        hint:
          "Cólica e sintomas do ciclo (TPM): quando dói (antes, durante, depois), tipo de dor, o que melhora (calor, " +
          "pressão), sintomas nas mamas, humor, inchaço e intestino ligados ao ciclo.",
      },
      {
        key: "discharge",
        label: "field-discharge",
        multiline: true,
        hint:
          "Corrimento e muco cervical: quantidade, cor, consistência (elástico, cremoso, aquoso), odor e em que fase do " +
          "ciclo aparece.",
      },
      {
        key: "contraception",
        label: "field-contraception",
        hint:
          "Método contraceptivo em uso ou recém-interrompido (pílula, DIU, implante, preservativo) e há quanto tempo. " +
          "O remédio também pertence a Medicamentos e suplementos — não repita a dose aqui.",
      },
      {
        key: "obstetric",
        label: "field-obstetric",
        multiline: true,
        alwaysReview: true,
        hint:
          "História obstétrica como a paciente relatou: gestações, partos (normal ou cesárea), abortos e perdas, " +
          "puerpério e amamentação. Assunto sensível: registre só o que foi dito.",
      },
      {
        key: "fertility",
        label: "field-fertility",
        multiline: true,
        hint:
          "Tentativa de engravidar: há quanto tempo, investigações e diagnósticos que ela RELATA ter recebido (ex.: SOP, " +
          "endometriose, fator masculino), tratamentos (indução, inseminação, FIV) e em que etapa está. Registre " +
          "diagnósticos como relato, nunca como conclusão.",
      },
      {
        key: "menopause",
        label: "field-menopause",
        multiline: true,
        hint:
          "Climatério e menopausa: idade da última menstruação, fogachos, suores noturnos, secura, alterações de sono e " +
          "humor ligadas ao climatério, reposição hormonal (o remédio também vai em Medicamentos e suplementos).",
      },
      {
        key: "libido",
        label: "field-libido",
        alwaysReview: true,
        hint:
          "Libido/desejo sexual como a paciente relatou (aumentado, diminuído, variação ao longo do ciclo). Só o que ela " +
          "disser; nunca inferir nem registrar detalhes além do que foi dito.",
      },
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
        // Retired in favour of the twelve positions below (her decision,
        // 2026-10-17): one line of prose could not say WHICH position was
        // fraco. It stays here so every pulse already written in it remains on
        // its consultation, and it is never offered or asked for again.
        key: "pulse",
        label: "field-pulse",
        multiline: true,
        retired: true,
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
  {
    // Optional, not conditional: it is on screen for every consultation,
    // folded, and only joins the "X de Y campos" total and the absence list
    // sent to the AI once she records something here. Otherwise every chart
    // would read twelve fields short and the hypotheses prompt would list
    // twelve absences nobody planned to palpate.
    key: "pulse",
    title: "block-pulse",
    note: "block-pulse-note",
    optional: true,
    vocabularyOnDemand: true,
    fields: PULSE_POSITIONS.map((position) => ({
      key: position.key,
      label: `field-pulse-${position.key}`,
      hint:
        `Pulso na posição do ${position.organ} (profundidade, ritmo, força, qualidade): ` +
        `só o que a PROFISSIONAL ditou DESTA posição.`,
    })),
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
export const PROFESSIONAL_OBSERVATION_FIELDS = new Set([
  "tcm.tongue",
  "tcm.pulse",
  "tcm.palpation",
  "tcm.pattern",
  ...PULSE_POSITIONS.map((position) => `pulse.${position.key}`),
]);

/** The twelve position fields, in the order she reads them. */
export const PULSE_POSITION_FIELDS: readonly string[] = PULSE_POSITIONS.map((position) => `pulse.${position.key}`);

/** The organ each position reads, in the language of the record. */
export const PULSE_POSITION_ORGANS: ReadonlyMap<string, string> = new Map(
  PULSE_POSITIONS.map((position) => [`pulse.${position.key}`, position.organ]),
);

/** "block.field" keys whose extracted values always come back for review. */
export const ALWAYS_REVIEW_FIELDS = new Set(
  ANAMNESIS_BLOCKS.flatMap((block) =>
    block.fields.filter((field) => field.alwaysReview).map((field) => `${block.key}.${field.key}`),
  ),
);

/** The facts that decide whether a conditional block applies. */
export interface AnamnesisApplicability {
  /**
   * The patient is marked for fertility care AND the practice declares the
   * area — `fertility_care_applies` (0103), delivered by the consultation
   * context. Anything else (loading, failed) must be passed as false.
   */
  fertilityCare: boolean;
}

/**
 * The blocks of THIS consultation, in catalog order.
 *
 * A conditional block is included when its condition holds — or when it
 * already holds an answer (`answeredKeys`, "block.field"), because hiding what
 * was recorded, say after the patient's mark was removed, would show a chart
 * as "não informado" about something that WAS informed.
 *
 * The extraction passes no `answeredKeys`: the model only ever writes into a
 * block that applies now.
 */
export function anamnesisBlocksFor(
  applicability: AnamnesisApplicability,
  answeredKeys: Iterable<string> = [],
): AnamnesisBlock[] {
  const answered = new Set(answeredKeys);
  return ANAMNESIS_BLOCKS.filter((block) => {
    if (!block.when) return true;
    if (block.when === "fertility" && applicability.fertilityCare) return true;
    return block.fields.some((field) => answered.has(`${block.key}.${field.key}`));
  }).map((block) => {
    // A retired field survives only where it was written. The extraction
    // passes no `answeredKeys`, so the model is never offered one — which is
    // how the general pulse stopped being filled without erasing the pulses
    // already recorded in it.
    const fields = block.fields.filter((field) => !field.retired || answered.has(`${block.key}.${field.key}`));
    return fields.length === block.fields.length ? block : { ...block, fields };
  });
}

/**
 * The blocks that count as the chart of this consultation: the "X de Y campos"
 * total and the absence list the hypotheses prompt is given.
 *
 * An optional block (the twelve pulse positions) is in it only once she has
 * recorded something there. A fold she never opened is not a chart with twelve
 * holes in it, and listing those twelve as absences would have the reasoning
 * reciting what nobody set out to palpate.
 */
export function countedAnamnesisBlocks(
  applicability: AnamnesisApplicability,
  answeredKeys: Iterable<string> = [],
): AnamnesisBlock[] {
  const answered = new Set(answeredKeys);
  return anamnesisBlocksFor(applicability, answered).filter(
    (block) => !block.optional || block.fields.some((field) => answered.has(`${block.key}.${field.key}`)),
  );
}
