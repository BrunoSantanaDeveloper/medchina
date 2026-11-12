import { Metadata } from "next";

import DemoExport from "@/components/product-demo/demo-export";

export const metadata: Metadata = {
  title: { absolute: "Exportar a demonstração — MedChina" },
  robots: { index: false, follow: false },
};

export default function ExportarDemonstracaoPage() {
  return <DemoExport />;
}
