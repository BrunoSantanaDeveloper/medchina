import { Metadata } from "next";

import DemoDeck from "@/components/product-demo/demo-deck";

/**
 * Three slides that show the product to anyone — no event, audience or date.
 *
 * Public, so it opens from a link sent to someone with no account; `noindex`
 * and absent from `sitemap.ts`, like `/palestra` and `/pitch`: it is material
 * that gets shown or forwarded, and the indexed story of the product is the
 * home and `/como-funciona`.
 */
export const metadata: Metadata = {
  title: { absolute: "MedChina — Demonstração do produto" },
  description:
    "Prontuário inteligente para Medicina Tradicional Chinesa: grave a consulta, receba a anamnese organizada e decida com a IA como apoio — em três slides.",
  robots: { index: false, follow: false },
};

export default function DemonstracaoPage() {
  return <DemoDeck />;
}
