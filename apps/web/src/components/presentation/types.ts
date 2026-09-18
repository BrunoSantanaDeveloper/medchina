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
 *    so rehearsing with the paper in hand matches the screen. Slides the
 *    printed roteiro does not number (the videos, the guarantees, the
 *    consent slide, the annex) have none, on purpose.
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
 * Media a slide carries. Drop the file at `sourceUrl` and it plays; without the
 * file the slide degrades to a composed card that still looks deliberate on
 * stage. Production instructions stay in the speaker notes — a projected slide
 * never confesses that it is a placeholder.
 *
 * Two kinds, because on stage they are two different objects:
 *
 * - a **testimony** is WATCHED. It has a speaker, a running time and controls;
 *   the room goes quiet and Debora stops talking until it ends.
 * - an **ambient** clip is not watched, it RUNS. Muted, looping, no controls,
 *   underneath her narration — the accelerated consultation on slide 13 is the
 *   scenery for what she is saying, not an item on the programme.
 */
export type SlideMediaSpec = TestimonyMedia | AmbientMedia;

/** A person speaking to the room. Played deliberately, with controls. */
export interface TestimonyMedia {
  kind: "testimony";
  label: Bi;
  duration?: string;
  /** Local file, or an absolute URL when the file is too big to ship. */
  sourceUrl: string;
  /** Shown on the fallback card when the file is not there yet. */
  speaker: Bi;
  role: Bi;
  /** Speaker notes only. Never rendered on the slide. */
  productionNote: string;
}

/** A screencast of the product, running while she talks over it. */
export interface AmbientMedia {
  kind: "ambient";
  label: Bi;
  /** Local file, e.g. `/videos/palestra/consulta-acelerada.mp4`. */
  sourceUrl: string;
  /**
   * A still from the clip, already cropped to the picture. Shown before the
   * first frame decodes on stage, and printed in its place in the PDF — a
   * `<video>` prints as an empty box.
   */
  poster?: string;
  /**
   * Aspect ratio of the PICTURE inside the file, as a CSS `aspect-ratio`.
   *
   * A screen recording usually arrives padded into a standard frame — this one
   * is a 1920x1080 file whose picture is a 1920x879 window with a black band
   * baked in above and below it. Framing the window on the picture and letting
   * `object-fit: cover` fill it crops those bands away; without this the deck
   * projects someone else's letterbox, which on a slide reads as a mistake and
   * would be the only pure black on screen.
   */
  aspect: string;
  /**
   * Projected under the frame, and NOT decoration: the clip is sped up, so a
   * consultation replayed at speed without saying so claims a pace the product
   * does not have.
   */
  caption: Bi;
  /** Shown on the fallback card when the file is not there yet. */
  standby: Bi;
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
  /** Slide number in the printed roteiro; absent for slides it does not number. */
  roteiroSlide?: number;
  block: number;
  blockTitle: Bi;
  timeRange: string;
  kicker: Bi;
  title: Bi;
  subtitle?: Bi;
  /** Teleprompter text, near-verbatim from the roteiro. Notes only. */
  script: string;
  /**
   * The same script in Chinese — for the copy handed to the organisation, not
   * for the stage: Debora speaks Portuguese and the phone teleprompter always
   * shows `script`. Only the exporter reads this, and only when the deck is set
   * to 中文 (see `deck-export.tsx`).
   */
  scriptZh?: string;
  /** The roteiro's [CORTE OPCIONAL] passage, if this block has one. Notes only. */
  optionalCut?: string;
  /** That passage in Chinese, for the same reason as `scriptZh`. */
  optionalCutZh?: string;
  /** Stage direction from the roteiro. Notes only. */
  stageNote: string;
  /**
   * Outside the forty minutes: the written answers kept after the closing for
   * the questions. They are excluded from the counter and the progress bar,
   * because a talk that reads "22 of 27" at its climax is lying about how much
   * of it is left.
   */
  annex?: boolean;
  media?: SlideMediaSpec;
}
