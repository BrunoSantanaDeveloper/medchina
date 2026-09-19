import { Metadata } from "next";

import PitchExport from "@/components/pitch/pitch-export";

export const metadata: Metadata = {
  title: "Exportar o pitch deck — MedChina",
  robots: { index: false, follow: false },
};

export default function ExportarPitchPage() {
  return <PitchExport />;
}
