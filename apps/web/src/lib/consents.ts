/**
 * What the patient decides about her data (PRD §9.5): three AUTHORIZATIONS,
 * each a separately-granted purpose, plus one CIÊNCIA — informed, not
 * authorized (migration 0102).
 * Slugs MUST match the seeded consent_terms (migration 0022). The label/hint
 * are i18n keys in the `product` namespace; the authoritative legal text lives
 * in consent_terms.body (superadmin-managed, versioned).
 */
export interface ConsentKind {
  slug: string;
  label: string;
  hint: string;
  /** Recording is gated on this one by a DB trigger. */
  gatesRecording?: boolean;
  /**
   * Not an authorization: proof she was TOLD. Nothing is blocked when it is
   * missing — the AI still reads a record she typed — so it is never asked for
   * with an alert, only offered where the other decisions are recorded.
   */
  notice?: boolean;
}

export const CONSENT_KINDS: ConsentKind[] = [
  { slug: "audio-recording", label: "consent-audio-label", hint: "consent-audio-hint", gatesRecording: true },
  { slug: "ai-processing", label: "consent-ai-label", hint: "consent-ai-hint" },
  { slug: "clinical-images", label: "consent-images-label", hint: "consent-images-hint" },
  { slug: "ai-record-notice", label: "consent-notice-label", hint: "consent-notice-hint", notice: true },
];

export const RECORDING_CONSENT_SLUG = "audio-recording";
