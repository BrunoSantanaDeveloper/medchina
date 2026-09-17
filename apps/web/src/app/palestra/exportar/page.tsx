import { Metadata } from "next";
import { Suspense } from "react";

import DeckExport from "@/components/presentation/deck-export";

/**
 * The deck as a PDF, in the language chosen on the page.
 *
 * Public for the same reason the deck is (it is opened on machines without a
 * session), and `noindex` for the same reason too. Covered by the `/palestra`
 * entry in `PUBLIC_PREFIXES`; absent from the sitemap on purpose.
 */
export const metadata: Metadata = {
  title: "Exportar palestra — MedChina",
  robots: { index: false, follow: false },
};

export default function ExportarPalestraPage() {
  return (
    // `?idioma=zh` and `?anexo=0` preselect the options.
    <Suspense fallback={null}>
      <DeckExport />
    </Suspense>
  );
}
