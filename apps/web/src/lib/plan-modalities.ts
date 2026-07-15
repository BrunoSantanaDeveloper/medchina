/**
 * The therapeutic-plan modalities (PRD §10.9) as render descriptors, shared by
 * the panel (view/edit), the route (assembling the document) and the PDF
 * renderer — one definition, so the three never drift.
 *
 * The `key`s match the modality shapes in lib/therapeutic-plan.ts; the `label`s
 * are `product` i18n keys; `kind` drives how a value is shown and edited.
 */

export type FieldKind = "text" | "textarea" | "list" | "strategy";
export type FieldDescriptor = { key: string; label: string; kind: FieldKind };

export const PLAN_MODALITIES: { slug: string; fields: FieldDescriptor[] }[] = [
  {
    slug: "acupuncture",
    fields: [
      { key: "objective", label: "plan-f-objective", kind: "textarea" },
      { key: "mainPoints", label: "plan-f-main-points", kind: "list" },
      { key: "complementaryPoints", label: "plan-f-complementary-points", kind: "list" },
      { key: "meridians", label: "plan-f-meridians", kind: "list" },
      { key: "strategy", label: "plan-f-strategy", kind: "strategy" },
      { key: "frequency", label: "plan-f-frequency", kind: "text" },
    ],
  },
  {
    slug: "diet",
    fields: [
      { key: "thermalNature", label: "plan-f-thermal", kind: "text" },
      { key: "favor", label: "plan-f-favor", kind: "list" },
      { key: "reduce", label: "plan-f-reduce", kind: "list" },
      { key: "mealSuggestions", label: "plan-f-meals", kind: "list" },
      { key: "restrictions", label: "plan-f-restrictions", kind: "textarea" },
    ],
  },
  {
    slug: "moxibustion",
    fields: [
      { key: "technique", label: "plan-f-technique", kind: "text" },
      { key: "pointsOrRegion", label: "plan-f-points-region", kind: "text" },
      { key: "objective", label: "plan-f-objective", kind: "textarea" },
      { key: "contraindicationChecklist", label: "plan-f-checklist", kind: "list" },
    ],
  },
  {
    slug: "auriculotherapy",
    fields: [
      { key: "points", label: "plan-f-points", kind: "list" },
      { key: "material", label: "plan-f-material", kind: "text" },
      { key: "side", label: "plan-f-side", kind: "text" },
      { key: "stimulationGuidance", label: "plan-f-stimulation", kind: "textarea" },
      { key: "reassessment", label: "plan-f-reassessment", kind: "text" },
    ],
  },
  {
    slug: "cupping",
    fields: [
      { key: "technique", label: "plan-f-technique", kind: "text" },
      { key: "region", label: "plan-f-region", kind: "text" },
      { key: "intensity", label: "plan-f-intensity", kind: "text" },
      { key: "duration", label: "plan-f-duration", kind: "text" },
      { key: "postSessionGuidance", label: "plan-f-post-session", kind: "textarea" },
    ],
  },
];

export const PLAN_STRATEGIES = ["tonify", "disperse", "harmonize", "warm", "regulate"] as const;
