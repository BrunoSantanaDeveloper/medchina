import { Metadata } from "next";

import PitchDeck from "@/components/pitch/pitch-deck";

/**
 * Public so it can be opened from an application form or a link in an e-mail,
 * `noindex` because it is a document addressed to one reader — and deliberately
 * absent from `sitemap.ts`, like `/palestra`.
 */
export const metadata: Metadata = {
  title: "MedChina — Pitch deck",
  description: "Prontuário clínico e assistente de IA para Medicina Tradicional Chinesa.",
  robots: { index: false, follow: false },
};

export default function PitchPage() {
  return <PitchDeck />;
}
