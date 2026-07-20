import "./clinical-source-home.css";

import type { Metadata } from "next";

import ClinicalSourceHome from "@/components/marketing/clinical-source-home";

export const metadata: Metadata = {
  title: { absolute: "MedChina | Prontuário inteligente para MTC" },
  description:
    "Organize pacientes, anamneses, análises e planos terapêuticos em uma plataforma feita para Medicina Tradicional Chinesa.",
};

export default function Home() {
  return <ClinicalSourceHome />;
}
