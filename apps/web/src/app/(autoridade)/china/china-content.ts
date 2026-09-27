/**
 * The facts of /china, in ONE place (docs/PAGINA-CHINA.md §3, §6, §8).
 *
 * Every date and every piece of material the page may show lives here, so the
 * copy, the metadata and the structured data cannot drift apart — and so adding
 * the congress material later is a data edit, not a layout edit. A field that is
 * `null` or empty means the section is NOT rendered: absence never becomes an
 * empty box (the same rule the clinical record follows).
 */

export type ChinaStagePhoto = {
  /** WebP, ~1600px wide — the hero. */
  src: string;
  /** JPEG, 1200px wide — the JSON-LD `image` (Satori and the OG file convention reject WebP). */
  jpeg1200: string;
  alt: string;
  width: number;
  height: number;
};

export type ChinaSlide = { src: string; alt: string; width: number; height: number };

export type ChinaQuote = {
  text: string;
  name: string;
  role: string;
  video?: { src: string; poster: string; captions: string };
};

export type ChinaPress = {
  /** Where the high-resolution originals, the release and the bio live. */
  folderUrl: string;
};

export const CHINA = {
  /** The talk in Xinjiang (confirmed 2026-09-26). */
  eventDate: "2026-09-19",
  /** Lei 15.345 — sanctioned (published in the DOU the next day, 13/01). */
  lawSanctionedAt: "2026-01-12",
  /**
   * When THIS PAGE went live — not the talk. Set it to the real publication
   * date on deploy, and bump `modifiedAt` whenever sections 3, 4 or 8 gain
   * material (Google reads both).
   */
  publishedAt: "2026-09-26T09:00:00-03:00",
  modifiedAt: "2026-09-26T09:00:00-03:00",
  /** The stage photo. Null → the hero shows the product composite (docs/PAGINA-CHINA.md §3). */
  stagePhoto: null as ChinaStagePhoto | null,
  /** Up to four congress slides as images for section 3. Empty → text and deck link only. */
  slides: [] as ChinaSlide[],
  /** Section 4. Null → not rendered; published only with written authorization. */
  quote: null as ChinaQuote | null,
  /** Section 8. Null → not rendered. */
  press: null as ChinaPress | null,
};

const MONTH_YEAR = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });

/** "setembro de 2026" — from the one date, never typed twice. */
export const EVENT_MONTH_LABEL = MONTH_YEAR.format(new Date(`${CHINA.eventDate}T12:00:00-03:00`));

const MONTH_WORDS = [
  "",
  "Um mês",
  "Dois meses",
  "Três meses",
  "Quatro meses",
  "Cinco meses",
  "Seis meses",
  "Sete meses",
  "Oito meses",
  "Nove meses",
  "Dez meses",
  "Onze meses",
  "Doze meses",
];

/** "Oito meses" — whole months from the law to the talk, spelled out. */
export const MONTHS_LAW_TO_TALK = (() => {
  const law = new Date(`${CHINA.lawSanctionedAt}T12:00:00-03:00`);
  const talk = new Date(`${CHINA.eventDate}T12:00:00-03:00`);
  let months = (talk.getUTCFullYear() - law.getUTCFullYear()) * 12 + (talk.getUTCMonth() - law.getUTCMonth());
  if (talk.getUTCDate() < law.getUTCDate()) months -= 1;
  return MONTH_WORDS[months] ?? `${months} meses`;
})();

/** Primary source: the text of the law. Secondary: how the Câmara reported it. */
export const LAW_SOURCES = {
  text: {
    href: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/L15345.htm",
    label: "Lei nº 15.345, de 12 de janeiro de 2026 (texto da lei)",
  },
  news: {
    href: "https://www.camara.leg.br/noticias/1238052-lei-regulamenta-exercicio-profissional-da-acupuntura",
    label: "Como a Câmara dos Deputados noticiou",
  },
};
