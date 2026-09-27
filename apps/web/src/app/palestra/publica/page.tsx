import { Metadata } from "next";

import PublicDeck from "@/components/presentation/public-deck";
import { SLIDES_DATA } from "@/components/presentation/slides-deck";
import type { SlideData } from "@/components/presentation/types";

/**
 * The congress deck, for the public — what /china links to as "Ver a
 * apresentação" (docs/PAGINA-CHINA.md §5, section 3).
 *
 * NOT /palestra: that page is the speaker's instrument. It ships the complete
 * teleprompter (`script`, `scriptZh`), the stage directions and the production
 * notes to every visitor, and its "Modo apresentador" and PDF export are one
 * click away. An indexed press page must not point there.
 *
 * This page is a SERVER component on purpose: it reads the slide list here, on
 * the server, and hands the client only what is projected. Mapping in the
 * browser would not help — the literal would ship anyway.
 *
 * Public (covered by the `/palestra` entry in PUBLIC_PREFIXES), `noindex` and
 * out of the sitemap, like /pitch: /china is the indexed narrative, this is its
 * attachment.
 */
export const metadata: Metadata = {
  title: { absolute: "Apresentação MedChina — Congresso de MTC, Xinjiang 2026" },
  description:
    "Os slides que Debora Giovanella apresentou no Congresso de MTC em Xinjiang, na China, em português e em chinês.",
  robots: { index: false, follow: false },
};

/**
 * Slides that stay on stage and off the public domain:
 *
 * - `platform-today` shows the previous platform's totals as "números atuais".
 *   On the commercial domain, a user or subscriber number must come from the
 *   current database with a date (docs/PAGINA-CHINA.md §8.3) — so it is left out
 *   rather than republished as current.
 * - `testimony-user` is a user's recorded testimony. Publishing a person's image
 *   and words on the commercial site needs her authorization for THAT use
 *   (docs/PAGINA-CHINA.md §8.5), which is not on file.
 *
 * The annex (answers kept for the Q&A) is not part of the talk either.
 */
const LEFT_OUT = new Set(["platform-today", "testimony-user"]);

/** What the room saw, and nothing the speaker read. */
function projected(slide: SlideData): SlideData {
  return {
    key: slide.key,
    roteiroSlide: slide.roteiroSlide,
    block: slide.block,
    blockTitle: slide.blockTitle,
    timeRange: slide.timeRange,
    kicker: slide.kicker,
    title: slide.title,
    subtitle: slide.subtitle,
    // Required by the type, never rendered by the views: emptied here so the
    // teleprompter never leaves the server.
    script: "",
    stageNote: "",
    media: slide.media ? { ...slide.media, productionNote: "" } : undefined,
  };
}

export default function PublicDeckPage() {
  const slides = SLIDES_DATA.filter((slide) => !slide.annex && !LEFT_OUT.has(slide.key)).map(projected);
  return <PublicDeck slides={slides} />;
}
