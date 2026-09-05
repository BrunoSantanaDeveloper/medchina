/**
 * Data model for the Xinjiang congress deck (/palestra).
 *
 * Two rules shape everything here:
 *
 * 1. **The room is Chinese.** Every string that reaches the screen is a `Bi`
 *    pair, so the audience reads the slide instead of watching a Portuguese
 *    one. Only the teleprompter fields (`script`, `stageNote`, `optionalCut`,
 *    `productionNote`) are Portuguese-only — those are for the speaker and are
 *    never projected.
 * 2. **The roteiro is the source of truth.** `roteiroSlide` is the number
 *    printed in `attachments/Palestra-MedChina-Congresso-MTC-Xinjiang.docx.md`,
 *    so rehearsing with the paper in hand matches the screen. The Bloco 6 pause
 *    has no number on purpose — the roteiro says "sem slide".
 */

/**
 * The language the slides are PROJECTED in. One at a time, never both: a slide
 * carrying every sentence twice is a wall of text, and the audience stops
 * reading either half. The teleprompter is always Portuguese regardless.
 */
export type DeckLang = "pt" | "zh";

/** A bilingual string. `pt` is what Debora says; `zh` is what the room reads. */
export interface Bi {
  pt: string;
  zh: string;
}

/**
 * Media the deck expects but does not ship. Drop the file at `sourceUrl` and it
 * plays / renders; without the file the slide degrades to a composed card that
 * still looks deliberate on stage. Production instructions stay in the speaker
 * notes — a projected slide never confesses that it is a placeholder.
 */
export interface SlideMediaSpec {
  kind: "video";
  label: Bi;
  duration?: string;
  /** Local file, e.g. `/videos/palestra/depoimento-1.mp4`. */
  sourceUrl: string;
  /** Shown on the fallback card when the file is not there yet. */
  speaker: Bi;
  role: Bi;
  /** Speaker notes only. Never rendered on the slide. */
  productionNote: string;
}

/** One screenshot of the 2021 version (roteiro: "[TELAS · primeira versão]"). */
export interface GalleryFrame {
  src: string;
  /** The CSS-drawn skeleton shown inside the window until `src` exists. */
  sketch: "cadastro" | "agenda" | "anamnese" | "financeiro";
  caption: Bi;
}

export interface SlideData {
  /** Stable identifier — selects the view in `slide-views.tsx`. */
  key: string;
  /** Slide number in the printed roteiro; absent for the Bloco 6 pause. */
  roteiroSlide?: number;
  block: number;
  blockTitle: Bi;
  timeRange: string;
  kicker: Bi;
  title: Bi;
  subtitle?: Bi;
  /** Teleprompter text, near-verbatim from the roteiro. Notes only. */
  script: string;
  /** The roteiro's [CORTE OPCIONAL] passage, if this block has one. Notes only. */
  optionalCut?: string;
  /** Stage direction from the roteiro. Notes only. */
  stageNote: string;
  /**
   * `solemn` strips the slide to bare type on a deep ground — the roteiro's
   * "sem slide, tela escura ou neutra, falar devagar" for the illness passage.
   */
  tone?: "solemn";
  media?: SlideMediaSpec;
}
