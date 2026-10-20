"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Chip, Skeleton, Typography } from "@mui/material";

import NiRefresh from "@/icons/nexture/ni-refresh";
import type { ClinicalAiFeature, ClinicalAiRoutingRow } from "@/lib/ai-routing";

/**
 * Which model each clinical feature runs on in THIS deployment — resolved on
 * the server from its environment (`/api/admin/ai/providers`), never chosen
 * here.
 *
 * Moving a feature to another provider is an environment variable on the host
 * (EXTRACTION_PROVIDER=anthropic, …), and the only way to know it took used to
 * be processing a consultation and reading the logs. This answers before the
 * first consultation does: the route, whether its provider has a key, and —
 * for the extraction — where it falls when that provider fails.
 */

const FEATURE: Record<ClinicalAiFeature, { title: string; hint: string }> = {
  extraction: {
    title: "Preenchimento da anamnese",
    hint: "Transcrição → anamnese rascunho, a cada gravação · EXTRACTION_*",
  },
  hypotheses: { title: "Hipóteses de padrão", hint: "Raciocínio clínico (Pro) · HYPOTHESES_* ou REASONING_*" },
  plan: { title: "Plano terapêutico", hint: "Rascunho do plano (Pro) · PLAN_* ou REASONING_*" },
  summary: { title: "Resumo clínico", hint: "Sugerido ao finalizar a consulta · SUMMARY_*" },
  attachment: { title: "Leitura de anexos", hint: "Fotos e documentos do paciente · ATTACHMENT_*" },
};

const PROVIDER: Record<string, string> = {
  gemini: "Gemini",
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const PROVIDER_KEY: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const EFFORT: Record<string, string> = {
  low: "esforço baixo",
  medium: "esforço médio",
  high: "esforço alto",
  xhigh: "esforço muito alto",
  max: "esforço máximo",
};

/** "Claude (Anthropic) · claude-sonnet-5-5 · esforço baixo" — effort only where the provider takes one. */
const describeRoute = (route: NonNullable<ClinicalAiRoutingRow["route"]>) =>
  [
    PROVIDER[route.provider] ?? route.provider,
    route.model,
    route.provider === "anthropic" && route.effort ? EFFORT[route.effort] : null,
  ]
    .filter(Boolean)
    .join(" · ");

export default function ClinicalRoutingAdmin() {
  const [rows, setRows] = useState<ClinicalAiRoutingRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    setRows(null);
    try {
      const response = await fetch("/api/admin/ai/providers", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { routing?: ClinicalAiRoutingRow[] };
      if (!Array.isArray(body.routing)) throw new Error("routing missing");
      setRows(body.routing);
    } catch {
      // A failed read is an error with a retry — never an empty-looking list.
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadFailed) {
    return (
      <Alert
        severity="error"
        className="neutral bg-background-paper/60!"
        action={<Button onClick={load}>Tentar de novo</Button>}
      >
        Não foi possível ler o roteamento deste ambiente.
      </Alert>
    );
  }

  return (
    <Box className="flex flex-col gap-4">
      <Typography variant="body1" className="text-text-secondary">
        Em que modelo cada recurso clínico roda neste ambiente. Mudar é uma variável de ambiente na hospedagem — veja{" "}
        <code>apps/web/.env.example</code> e <code>docs/DEPLOY.md</code> — e vale a partir do próximo deploy.
      </Typography>

      <Box className="flex flex-col gap-3">
        {rows === null
          ? Array.from({ length: 5 }, (_, index) => <Skeleton key={index} variant="rounded" className="h-16 w-full" />)
          : rows.map((row) => (
              <Box
                key={row.feature}
                className="border-grey-100 flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b pb-3 last:border-b-0"
              >
                <Box className="flex min-w-60 flex-1 flex-col">
                  <Typography variant="subtitle2" component="h3" className="mb-0">
                    {FEATURE[row.feature].title}
                  </Typography>
                  <Typography variant="caption" className="text-text-secondary">
                    {FEATURE[row.feature].hint}
                  </Typography>
                </Box>

                <Box className="flex min-w-64 flex-[2] flex-col gap-0.5">
                  {row.route ? (
                    <Typography variant="body2">{describeRoute(row.route)}</Typography>
                  ) : (
                    <Typography variant="body2" className="text-text-secondary">
                      Não roda como está configurado.
                    </Typography>
                  )}
                  {row.error && (
                    <Typography variant="caption" className="text-text-secondary">
                      {row.error}
                    </Typography>
                  )}
                  {row.route && row.keyConfigured === false && (
                    <Typography variant="caption" className="text-text-secondary">
                      {PROVIDER_KEY[row.route.provider] ?? "A chave do provedor"} não está definida neste ambiente
                      {row.floor ? " — toda extração cai no Gemini até ela existir." : " — as chamadas vão falhar."}
                    </Typography>
                  )}
                  {row.floor && (
                    <Typography variant="caption" className="text-text-secondary">
                      {row.error ? "Enquanto isso, a anamnese é feita em " : "Se falhar: "}
                      {describeRoute(row.floor)} — o processador da transcrição, então nenhum dado vai a um terceiro
                      fornecedor.
                    </Typography>
                  )}
                </Box>

                {row.error ? (
                  <Chip size="small" color="error" variant="outlined" label="Configuração inválida" />
                ) : row.keyConfigured === false ? (
                  <Chip size="small" color="warning" variant="outlined" label="Sem chave" />
                ) : (
                  <Chip size="small" color="success" variant="outlined" label="Pronto" />
                )}
              </Box>
            ))}
      </Box>

      <Box>
        <Button variant="text" color="grey" startIcon={<NiRefresh size="medium" />} onClick={load} disabled={!rows}>
          Recarregar
        </Button>
      </Box>
    </Box>
  );
}
