import "./clinical-source-home.css";

import type { Metadata } from "next";

import ClinicalSourceHome from "@/components/marketing/clinical-source-home";

export const metadata: Metadata = {
  title: { absolute: "MedChina | Prontuário inteligente para MTC" },
  description:
    "Organize pacientes, anamneses, análises e planos terapêuticos em uma plataforma feita para Medicina Tradicional Chinesa.",
  // Canonical (resolved against metadataBase = NEXT_PUBLIC_SITE_URL) so search
  // engines pick the subdomain as the preferred URL, avoiding duplicate content.
  alternates: { canonical: "/" },
};

export default function Home() {
  return <ClinicalSourceHome />;
}
