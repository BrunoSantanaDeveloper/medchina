/**
 * The template's tile language for icon containers (recovered from the original
 * dashboard sections): a `-light/10` tint of the tone, never the base tone at
 * 10% — the lighter step is what gives the pastel its warmth on the Parchment
 * neutrals — and `rounded-2xl` on a 64px column or a full-width 72px box.
 *
 * `TONE` in components/marketing/tone.ts keeps the marketing pairs; this is the
 * product surface's counterpart so every tile on a screen reads as one family.
 */
export type TileTone = "primary" | "secondary" | "accent-1" | "accent-2" | "accent-3" | "accent-4";

export const TILE_TONE: Record<TileTone, { bg: string; text: string }> = {
  primary: { bg: "bg-primary-light/10", text: "text-primary" },
  secondary: { bg: "bg-secondary-light/10", text: "text-secondary" },
  "accent-1": { bg: "bg-accent-1-light/10", text: "text-accent-1" },
  "accent-2": { bg: "bg-accent-2-light/10", text: "text-accent-2" },
  "accent-3": { bg: "bg-accent-3-light/10", text: "text-accent-3" },
  "accent-4": { bg: "bg-accent-4-light/10", text: "text-accent-4" },
};
