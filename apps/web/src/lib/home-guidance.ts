/**
 * "Orientações para casa" (PRD §9.8) — the sheet the PATIENT takes home.
 *
 * The therapeutic plan already captures this work: what to do after cupping,
 * how to press the auricular seeds, which foods to favour, when to come back.
 * But the plan is written FOR THE PROFESSIONAL — it carries points, meridians,
 * disharmony patterns and treatment strategy. Handing that to a patient is
 * either meaningless or alarming.
 *
 * So this selects only the fields that are instructions TO HER, and drops
 * everything that is clinical reasoning:
 *
 *  - points, meridians, strategy, thermal nature and the disharmony pattern
 *    never appear — a patient reading "dispersar Fogo do Fígado" learns
 *    nothing and may well worry;
 *  - the moxibustion contraindication checklist is the PROFESSIONAL's
 *    pre-application safety step, not homework — it stays out;
 *  - what remains is written as "what to do", grouped by when she does it.
 *
 * Pure and deterministic: no AI, no new schema. It reads the same validated
 * plan the signed PDF renders, so the two can never disagree.
 */

export type GuidanceSection = {
  /** i18n key (product namespace) for the section heading. */
  label: string;
  /** Free text, when the field is prose. */
  text?: string;
  /** Bullet items, when the field is a list. */
  items?: string[];
};

type Modality = Record<string, unknown>;

const asText = (value: unknown): string | undefined => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : undefined;
};

const asList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return items.length > 0 ? items : undefined;
};

/**
 * Which plan fields are instructions for the patient, in the order she will
 * live them: care right after the session, then daily practice, then food,
 * then when to come back.
 */
const GUIDANCE_FIELDS: { modality: string; field: string; label: string; kind: "text" | "list" }[] = [
  { modality: "cupping", field: "postSessionGuidance", label: "guidance-after-session", kind: "text" },
  { modality: "auriculotherapy", field: "stimulationGuidance", label: "guidance-stimulation", kind: "text" },
  { modality: "diet", field: "favor", label: "guidance-favor", kind: "list" },
  { modality: "diet", field: "reduce", label: "guidance-reduce", kind: "list" },
  { modality: "diet", field: "mealSuggestions", label: "guidance-meals", kind: "list" },
  { modality: "diet", field: "restrictions", label: "guidance-restrictions", kind: "text" },
  { modality: "acupuncture", field: "frequency", label: "guidance-frequency", kind: "text" },
  { modality: "auriculotherapy", field: "reassessment", label: "guidance-reassessment", kind: "text" },
];

export function buildHomeGuidance(modalities: Record<string, Modality> | null | undefined): GuidanceSection[] {
  const sections: GuidanceSection[] = [];
  if (!modalities) return sections;

  for (const descriptor of GUIDANCE_FIELDS) {
    const modality = modalities[descriptor.modality];
    if (!modality || typeof modality !== "object") continue;
    const raw = (modality as Modality)[descriptor.field];

    if (descriptor.kind === "list") {
      const items = asList(raw);
      if (items) sections.push({ label: descriptor.label, items });
    } else {
      const text = asText(raw);
      if (text) sections.push({ label: descriptor.label, text });
    }
  }

  return sections;
}

/**
 * Whether there is anything worth handing over.
 *
 * A plan can be complete for the professional and still contain no homework
 * (a single acupuncture session with no dietary advice and no home practice).
 * Issuing an empty sheet would waste the patient's attention and make the
 * document meaningless, so the UI offers this only when it has content.
 */
export function hasHomeGuidance(modalities: Record<string, Modality> | null | undefined): boolean {
  return buildHomeGuidance(modalities).length > 0;
}
