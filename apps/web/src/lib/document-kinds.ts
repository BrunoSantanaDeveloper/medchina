/**
 * The document kinds MedChina issues, and how to name them to a reader.
 *
 * Kept in one place because the same kind is labelled on three surfaces with
 * different audiences: the plan panel (the professional), `/documento` (the
 * patient downloading it) and `/verify` (whoever scanned the QR). They drifted
 * once already — the public pages spelled the kind with an underscore and
 * silently fell back to printing the raw slug.
 *
 * The VALUES are the strings stored in `documents.kind`; changing one would
 * orphan every document already issued under it.
 */
export const DOCUMENT_KINDS = {
  therapeuticPlan: "therapeutic-plan",
  homeGuidance: "home-guidance",
  attendance: "attendance-certificate",
} as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[keyof typeof DOCUMENT_KINDS];

const KIND_LABEL_KEYS: Record<string, string> = {
  [DOCUMENT_KINDS.therapeuticPlan]: "plan-title",
  [DOCUMENT_KINDS.homeGuidance]: "guidance-title",
  [DOCUMENT_KINDS.attendance]: "attendance-title",
};

/**
 * The i18n key naming this kind, or null for an unknown one.
 *
 * Null rather than the raw slug: printing "therapeutic-plan" to a patient is
 * worse than printing nothing, and a null lets the caller choose a neutral
 * fallback ("documento") instead.
 */
export function documentKindLabelKey(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return KIND_LABEL_KEYS[kind] ?? null;
}
