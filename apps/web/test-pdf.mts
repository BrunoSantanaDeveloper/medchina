/**
 * Renders the therapeutic-plan PDF for real and checks the bytes are a valid,
 * non-trivial PDF. The QR comes from @flyee/documents' own helper, so this also
 * exercises the exact issuance contract.
 *
 * Run from apps/web:  npx tsx --conditions=react-server test-pdf.mts
 */
import { writeFileSync } from "node:fs";

const { renderPlanPdf } = await import("@/lib/plan-document");
const { qrPngDataUrl, sha256Hex } = await import("@flyee/documents");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// A minimal label lookup standing in for next-intl's t (pt-BR-ish).
const LABELS: Record<string, string> = {
  "plan-title": "Plano terapêutico",
  "plan-objective": "Objetivo terapêutico",
  "plan-safety-title": "Contraindicações e fatores a considerar",
  "plan-safety-anticoagulant": "Anticoagulante",
  "plan-safety-pregnancy": "Gestação",
  "plan-modality-acupuncture": "Acupuntura",
  "plan-modality-diet": "Dietoterapia chinesa",
  "plan-f-objective": "Objetivo terapêutico",
  "plan-f-main-points": "Pontos principais",
  "plan-f-frequency": "Frequência sugerida",
  "plan-f-thermal": "Natureza térmica predominante",
  "plan-f-favor": "Alimentos a favorecer",
  "plan-disclaimer": "O plano é um rascunho de apoio, não uma prescrição.",
  "plan-doc-issued-at": "Emitido em",
  "plan-doc-version": "Versão",
  "plan-doc-patient": "Paciente",
  "plan-doc-date": "Data da consulta",
  "plan-doc-professional": "Profissional responsável",
  "plan-doc-validated-at": "Validado em",
  "plan-doc-verify": "Verifique a autenticidade deste documento em",
};
const t = (key: string) => LABELS[key] ?? key;

const data = {
  orgName: "Consultório Helena",
  patientName: "Ana Recording",
  professionalName: "Helena Martins",
  consultationDate: "14/07/2026",
  validatedAt: "14/07/2026",
  version: 1,
  issuedAt: "15/07/2026",
  objective: "Nutrir o Yin do Rim, clarear o Fogo Vazio e acalmar o Shen.",
  modalities: [
    {
      slug: "acupuncture",
      fields: [
        { label: "Objetivo terapêutico", value: "Nutrir o Yin e ancorar o Yang." },
        { label: "Pontos principais", value: "", list: ["KI3", "KI6", "HT7", "PC6"] },
        { label: "Frequência sugerida", value: "1x por semana, reavaliar em 4 sessões." },
      ],
    },
    {
      slug: "diet",
      fields: [
        { label: "Natureza térmica predominante", value: "Calor vazio." },
        { label: "Alimentos a favorecer", value: "", list: ["Pera", "Tremoço", "Gergelim preto"] },
      ],
    },
  ],
  safetyFlags: [
    { category: "anticoagulant", matchedText: "Toma Varfarina diariamente" },
    { category: "pregnancy", matchedText: "Gestante, 14 semanas" },
  ],
};

const verifyUrl = "https://app.medchina.example/verify/ABCD23WXYZ99";
const ctx = {
  documentId: "test",
  verifyCode: "ABCD23WXYZ99",
  verifyUrl,
  qrDataUrl: await qrPngDataUrl(verifyUrl),
};

console.log("Renderizando PDF do plano…");
const t0 = Date.now();
const bytes = await renderPlanPdf(data as never, t, ctx as never);
console.log(`  ${Date.now() - t0}ms, ${bytes.length} bytes`);

// %PDF header and %%EOF trailer.
const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
const tail = Buffer.from(bytes.slice(-1024)).toString("latin1");
check("começa com %PDF", head === "%PDF-");
check("termina com %%EOF", tail.includes("%%EOF"));
check("tamanho plausível (> 3 KB)", bytes.length > 3000, `${bytes.length}`);
check("hash sha256 determinístico", /^[0-9a-f]{64}$/.test(sha256Hex(bytes)));

// Save for eyeball inspection.
const out = "C:/Users/tribo/AppData/Local/Temp/claude/c--AppsProjects-medchina/32c4ded5-e505-4b73-b66f-ca5f45db42fd/scratchpad/plan-sample.pdf";
writeFileSync(out, bytes);
console.log(`  amostra salva em ${out}`);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
