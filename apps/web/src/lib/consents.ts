/**
 * The three patient consents (PRD §9.5), each a separately-granted purpose.
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
}

export const CONSENT_KINDS: ConsentKind[] = [
  { slug: "audio-recording", label: "consent-audio-label", hint: "consent-audio-hint", gatesRecording: true },
  { slug: "ai-processing", label: "consent-ai-label", hint: "consent-ai-hint" },
  { slug: "clinical-images", label: "consent-images-label", hint: "consent-images-hint" },
];

export const RECORDING_CONSENT_SLUG = "audio-recording";
