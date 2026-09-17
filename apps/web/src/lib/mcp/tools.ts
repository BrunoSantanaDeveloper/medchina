import "server-only";

import { z } from "zod";

import { complaintTitle } from "@/lib/chief-complaint";
import { COLLECTION_KIND, LIBRARY_COLLECTIONS } from "@/lib/clinical-library";
import { mcpAuthFromExtra } from "@/lib/mcp/context";
import { runMcpTool, type ToolOutcome, type ToolResult } from "@/lib/mcp/gates";
import { describePatientCase, loadPatientCase } from "@/lib/patient-case";
import { hasActiveConsent } from "@flyee/audit";
import { isEmbeddingConfigured, searchKnowledge } from "@flyee/knowledge";
import type { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The MCP tools (docs/MCP-CONECTORES.md), all read-only in v1. Descriptions
 * are written FOR the client model (when to use, what comes back, what it
 * must not do); the guarantees live in code — runMcpTool walks
 * entitlement → scope → rate → quota, meters the weighted usage and audits.
 *
 * Everything data-touching queries through ONE explicitly org-scoped path:
 * the service client bypasses RLS, so every query in this file filters by
 * the token's org_id — this file is the security review surface.
 */

const KIND_LABEL: Record<string, string> = {
  traditional: "fonte tradicional",
  protocol: "protocolo interno",
  evidence: "evidência científica",
};

/** ilike pattern injection guard: the term is a term, never wildcards. */
const sanitizeLike = (value: string) => value.replace(/[%_]/gu, " ").trim();

function unauthenticated(): ToolResult {
  return { content: [{ type: "text", text: "Conexão não autenticada. Reconecte o MedChina." }], isError: true };
}

async function searchLibrary(
  service: SupabaseClient,
  orgId: string,
  pergunta: string,
  colecoes: string[] | undefined,
): Promise<ToolOutcome> {
  if (!isEmbeddingConfigured()) {
    return { ok: false, status: "error", message: "A busca na biblioteca não está configurada neste ambiente." };
  }

  const known = new Set<string>(LIBRARY_COLLECTIONS);
  const slugs = (colecoes ?? []).filter((slug) => known.has(slug));
  const targetSlugs = slugs.length > 0 ? slugs : [...LIBRARY_COLLECTIONS];

  // Org-scoped resolution BY HAND: under the service role, resolving
  // "meus-protocolos" by slug alone would reach every workspace's private
  // collection — the .or() filter is the tenancy boundary here.
  const { data: collections } = await service
    .from("knowledge_collections")
    .select("id, slug")
    .in("slug", targetSlugs)
    .or(`org_id.is.null,org_id.eq.${orgId}`);
  const collectionIds = (collections ?? []).map((row) => row.id as string);
  const slugById = new Map((collections ?? []).map((row) => [row.id as string, row.slug as string]));
  if (collectionIds.length === 0) {
    return {
      ok: true,
      text: "Nenhuma coleção disponível para esta busca.",
      audit: { action: "mcp.library_query", metadata: { results: 0 } },
    };
  }

  const results = await searchKnowledge(service, pergunta, { collectionIds });
  if (results.length === 0) {
    return {
      ok: true,
      text:
        "Nada encontrado nas coleções da biblioteca para essa pergunta. " +
        "Diga à profissional que a biblioteca não cobre o tema — não invente conteúdo de MTC.",
      audit: { action: "mcp.library_query", metadata: { results: 0 } },
    };
  }

  const excerpts = results
    .map((result, index) => {
      const kind = KIND_LABEL[COLLECTION_KIND[slugById.get(result.collection_id) ?? ""] ?? ""] ?? "fonte";
      const source = result.source ? ` — ${result.source}` : "";
      return `[${index + 1}] ${result.title}${source} (${kind}, confiabilidade ${result.trust_level}/5)\n${result.content}`;
    })
    .join("\n\n---\n\n");

  return {
    ok: true,
    text: [
      "Trechos recuperados da biblioteca de MTC do MedChina.",
      "Fundamente a resposta EXCLUSIVAMENTE nestes trechos, citando-os como [n]. " +
        "Se não cobrirem a pergunta, diga isso — nunca invente evidência.",
      "",
      excerpts,
    ].join("\n"),
    audit: { action: "mcp.library_query", metadata: { results: results.length } },
  };
}

async function activeAiConsent(service: SupabaseClient, orgId: string, patientId: string): Promise<boolean> {
  return hasActiveConsent(service, { orgId, slug: "ai-processing", subjectType: "patient", subjectId: patientId });
}

export function registerMcpTools(server: McpServer): void {
  server.registerTool(
    "consultar_biblioteca_mtc",
    {
      title: "Consultar biblioteca de MTC",
      description:
        "Busca nas coleções de Medicina Tradicional Chinesa do MedChina (fontes tradicionais, protocolos internos, " +
        "evidência científica e os protocolos da própria profissional) e devolve trechos numerados com fonte e nível " +
        "de confiabilidade. Use para perguntas sobre pontos, fórmulas, padrões de desarmonia, técnicas e protocolos. " +
        "Fundamente a resposta nos trechos devolvidos, citando [n]; se nada cobrir a pergunta, diga isso. " +
        "Consome uma fração da franquia mensal da biblioteca do workspace.",
      inputSchema: z.object({
        pergunta: z
          .string()
          .min(3)
          .max(2000)
          .describe("Pergunta ou tema, em português (ex.: 'pontos para insônia por deficiência de Yin')"),
        colecoes: z
          .array(z.string())
          .optional()
          .describe(
            "Opcional: limitar a coleções específicas — mtc-fontes-tradicionais, mtc-protocolos-internos, mtc-evidencia-cientifica, meus-protocolos",
          ),
      }),
    },
    async ({ pergunta, colecoes }, ctx): Promise<ToolResult> => {
      const auth = mcpAuthFromExtra(ctx.http?.authInfo?.extra);
      if (!auth) return unauthenticated();
      return runMcpTool(auth, "consultar_biblioteca_mtc", { requiredScope: "library:read" }, (service) =>
        searchLibrary(service, auth.orgId, pergunta, colecoes),
      );
    },
  );

  server.registerTool(
    "buscar_paciente",
    {
      title: "Buscar paciente",
      description:
        "Procura pacientes do workspace pelo nome e devolve id, nome e se o consentimento de processamento por IA " +
        "está ativo. Use o id devolvido com a tool resumo_prontuario. Nunca chame para listar todos os pacientes.",
      inputSchema: z.object({
        termo: z.string().min(2).max(120).describe("Parte do nome do paciente"),
      }),
    },
    async ({ termo }, ctx): Promise<ToolResult> => {
      const auth = mcpAuthFromExtra(ctx.http?.authInfo?.extra);
      if (!auth) return unauthenticated();
      return runMcpTool(auth, "buscar_paciente", { requiredScope: "patients:read" }, async (service) => {
        const cleaned = sanitizeLike(termo);
        if (cleaned.length < 2) {
          return { ok: false, status: "error", message: "Informe pelo menos 2 caracteres do nome." };
        }
        const { data: patients } = await service
          .from("patients")
          .select("id, full_name")
          .eq("org_id", auth.orgId)
          .ilike("full_name", `%${cleaned}%`)
          .order("full_name")
          .limit(10);
        if (!patients || patients.length === 0) {
          return {
            ok: true,
            text: `Nenhum paciente encontrado para "${cleaned}".`,
            audit: { action: "mcp.patient_search", metadata: { results: 0 } },
          };
        }

        // One batched consent lookup instead of N — tells the model upfront
        // whose record it may summarize.
        const ids = patients.map((row) => row.id as string);
        const { data: consents } = await service
          .from("consent_acceptances")
          .select("subject_id, consent_terms!inner(slug)")
          .eq("org_id", auth.orgId)
          .eq("subject_type", "patient")
          .in("subject_id", ids)
          .eq("consent_terms.slug", "ai-processing")
          .is("revoked_at", null);
        const consented = new Set((consents ?? []).map((row) => row.subject_id as string));

        const lines = patients.map((row) => {
          const id = row.id as string;
          const consent = consented.has(id) ? "consentimento IA ativo" : "sem consentimento IA";
          return `- ${row.full_name} — id: ${id} (${consent})`;
        });
        return {
          ok: true,
          text: [
            `Pacientes encontrados para "${cleaned}":`,
            ...lines,
            "",
            "Use resumo_prontuario com o id para ver o registro. Pacientes sem consentimento IA ativo não podem ter o prontuário consultado por aqui — a profissional registra o consentimento na ficha do paciente, no MedChina.",
          ].join("\n"),
          audit: { action: "mcp.patient_search", metadata: { results: patients.length } },
        };
      });
    },
  );

  server.registerTool(
    "resumo_prontuario",
    {
      title: "Resumo do prontuário",
      description:
        "Devolve o resumo estruturado do prontuário de UM paciente (alertas clínicos, anamnese registrada, últimas " +
        "consultas), montado deterministicamente a partir do que a profissional registrou. Exige o consentimento de " +
        "processamento por IA ativo do paciente. Campo ausente significa 'não informado' — NUNCA trate ausência como " +
        "negação. Não conclua diagnóstico nem prescreva: prepare leituras e pontos de atenção para a profissional.",
      inputSchema: z.object({
        paciente_id: z.uuid().describe("Id do paciente (obtido com buscar_paciente)"),
      }),
    },
    async ({ paciente_id: patientId }, ctx): Promise<ToolResult> => {
      const auth = mcpAuthFromExtra(ctx.http?.authInfo?.extra);
      if (!auth) return unauthenticated();
      return runMcpTool(auth, "resumo_prontuario", { requiredScope: "patients:read" }, async (service) => {
        // Tenancy first: the service client sees every org, so the org check
        // is what keeps a guessed uuid from crossing workspaces.
        const { data: patient } = await service.from("patients").select("id, org_id").eq("id", patientId).maybeSingle();
        if (!patient || (patient.org_id as string) !== auth.orgId) {
          return { ok: false, status: "error", message: "Paciente não encontrado neste workspace." };
        }

        if (!(await activeAiConsent(service, auth.orgId, patientId))) {
          return {
            ok: false,
            status: "denied_consent",
            message:
              "Este paciente não tem consentimento ativo de processamento por IA. " +
              "A profissional pode registrá-lo na ficha do paciente (Consentimentos) no MedChina; sem ele, o prontuário não é consultável por aqui.",
          };
        }

        const patientCase = await loadPatientCase(service, patientId);
        if (!patientCase) {
          return { ok: false, status: "error", message: "Não foi possível montar o resumo agora." };
        }

        return {
          ok: true,
          text: [
            "Resumo do prontuário (montado do registro; campo ausente = não informado, nunca negação):",
            "",
            describePatientCase(patientCase),
          ].join("\n"),
          audit: { action: "mcp.patient_summary", entityType: "patient", entityId: patientId },
        };
      });
    },
  );

  server.registerTool(
    "proximas_consultas",
    {
      title: "Próximas consultas",
      description:
        "Lista as consultas agendadas do workspace no período pedido (padrão: próximos 7 dias), com paciente, " +
        "horário e motivo. Use para perguntas sobre a agenda.",
      inputSchema: z.object({
        dias: z.number().int().min(1).max(90).optional().describe("Janela em dias a partir de agora (padrão 7)"),
      }),
    },
    async ({ dias }, ctx): Promise<ToolResult> => {
      const auth = mcpAuthFromExtra(ctx.http?.authInfo?.extra);
      if (!auth) return unauthenticated();
      return runMcpTool(auth, "proximas_consultas", { requiredScope: "agenda:read" }, async (service) => {
        const windowDays = dias ?? 7;
        const now = new Date();
        const end = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

        const { data: org } = await service.from("organizations").select("timezone").eq("id", auth.orgId).maybeSingle();
        const timeZone = (org?.timezone as string | undefined) || "America/Sao_Paulo";
        const format = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeStyle: "short", timeZone });

        const { data: rows } = await service
          .from("consultations")
          .select("id, started_at, duration_minutes, chief_complaint, patients(full_name)")
          .eq("org_id", auth.orgId)
          .eq("status", "scheduled")
          .gte("started_at", now.toISOString())
          .lte("started_at", end.toISOString())
          .order("started_at", { ascending: true })
          .limit(30);

        if (!rows || rows.length === 0) {
          return {
            ok: true,
            text: `Nenhuma consulta agendada nos próximos ${windowDays} dias.`,
            audit: { action: "mcp.agenda_viewed", metadata: { results: 0, window_days: windowDays } },
          };
        }

        const lines = rows.map((row) => {
          const rel = row.patients as { full_name?: string } | { full_name?: string }[] | null;
          const name = (Array.isArray(rel) ? rel[0]?.full_name : rel?.full_name) ?? "Paciente";
          const when = format.format(new Date(row.started_at as string));
          // One line per appointment: only the complaint's title fits here.
          const complaint = row.chief_complaint
            ? ` — motivo registrado: ${complaintTitle(row.chief_complaint as string, 160)}`
            : "";
          return `- ${when} (${row.duration_minutes ?? 50} min): ${name}${complaint}`;
        });
        return {
          ok: true,
          text: [`Consultas agendadas nos próximos ${windowDays} dias (fuso ${timeZone}):`, ...lines].join("\n"),
          audit: { action: "mcp.agenda_viewed", metadata: { results: rows.length, window_days: windowDays } },
        };
      });
    },
  );
}
