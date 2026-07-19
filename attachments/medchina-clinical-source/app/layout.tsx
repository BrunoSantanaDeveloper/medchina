import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedChina | Prontuário inteligente para MTC",
  description:
    "Organize pacientes, anamneses, análises e planos terapêuticos em uma plataforma feita para Medicina Tradicional Chinesa.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/brand/medchina-mark.png",
    shortcut: "/brand/medchina-mark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
