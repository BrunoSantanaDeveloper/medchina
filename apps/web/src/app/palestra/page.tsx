import { Metadata } from "next";
import { Suspense } from "react";

import SlideDeck from "@/components/presentation/slide-deck";

/**
 * Public but NOT indexable, and deliberately absent from `sitemap.ts`.
 *
 * The route is public because the machine in the AV booth in Xinjiang will open
 * it without a session. It is `noindex` because the page carries the speaker's
 * complete teleprompter — including her account of her cancer treatment — plus
 * stage directions and production notes. That is presentation material, not
 * marketing copy, and it has no business ranking on the commercial domain.
 *
 * This is the one documented exception to the rule that every public route goes
 * into both `PUBLIC_PREFIXES` and the sitemap (.claude/rules/marketing.md).
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
