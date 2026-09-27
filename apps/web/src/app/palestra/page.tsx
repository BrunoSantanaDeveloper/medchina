import { Metadata } from "next";
import { Suspense } from "react";

import SlideDeck from "@/components/presentation/slide-deck";

/**
 * Public but NOT indexable, and deliberately absent from `sitemap.ts`.
 *
 * The route is public because the machine in the AV booth in Xinjiang opened it
 * without a session. It is `noindex` because the page carries the speaker's
 * complete teleprompter (slides-deck.ts: `script`, `scriptZh`), stage directions
 * and production notes. That is presentation material, not marketing copy, and
 * it has no business ranking on the commercial domain. (The personal health
 * account in the printed roteiro is NOT in the deck data — it lives only in
 * attachments/.)
 *
 * The public version is /palestra/publica: the same slides, stripped of every
 * speaker-only field on the server, and the page /china links to. Like this one
 * and /pitch, it is public, noindex and out of the sitemap.
 */
export const metadata: Metadata = {
  title: "Palestra MedChina — Congresso de MTC, Xinjiang 2026",
  description:
    "Do papel ao prontuário inteligente: a medicina chinesa no Brasil e a jornada do MedChina. Apresentação de Debora Giovanella.",
  robots: { index: false, follow: false },
};

export default function PalestraPage() {
  return (
    // The deck reads `?apresentador=1` to decide which window it is.
    <Suspense fallback={null}>
      <SlideDeck />
    </Suspense>
  );
}
