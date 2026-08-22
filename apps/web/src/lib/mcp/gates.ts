import "server-only";

import { LIBRARY_ASSISTANT_SLUG } from "@/lib/clinical-library";
import { loadMcpSettings, type McpAuthContext, resolveToolWeight } from "@/lib/mcp/context";
import { hasScope, type OauthScope } from "@/lib/oauth/scopes";
import { alertAfterLibraryMessage } from "@/lib/usage";
import { logAuditEvent } from "@flyee/audit";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The gate pipeline every MCP tool call walks, in order: entitlement →
 * scope → rate → quota → execute → meter + audit (docs/MCP-CONECTORES.md).
 * Enforced HERE in code, never only in tool descriptions — the client model
 * is untrusted input.
 *
 * Every denial answers with WORDS (the model relays them to the
 * professional), and every call — served or denied — lands as one
 * mcp_requests row. Clinical events additionally go to audit_events.
 */

/** Fixed footer on every successful tool answer (PRD §10 safety language). */
export const MCP_DISCLAIMER =
  "Conteúdo de apoio à revisão profissional. Não é diagnóstico nem prescrição; " +
  "hipóteses e sugestões exigem validação da profissional no MedChina.";

type DenialStatus = "denied_entitlement" | "denied_scope" | "denied_quota" | "denied_rate" | "denied_consent" | "error";

export type ToolOutcome =
  | {
      ok: true;
      text: string;
      audit?: { action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> };
    }
  | { ok: false; status: DenialStatus; message: string };

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function recordRequest(service: SupabaseClient, auth: McpAuthContext, tool: string, status: string) {
  try {
    await service.from("mcp_requests").insert({ org_id: auth.orgId, token_id: auth.tokenId, tool, status });
  } catch (error) {
    console.error("[mcp] request trail failed", error);
  }
}

type MessageAllowance = {
  allowed?: boolean;
  unlimited?: boolean;
  used?: number;
  limit?: number;
  window_start?: string;
  reason?: string;
};

export async function runMcpTool(
  auth: McpAuthContext,
  tool: string,
  options: { requiredScope?: OauthScope },
  execute: (service: SupabaseClient) => Promise<ToolOutcome>,
): Promise<ToolResult> {
  let service: SupabaseClient;
  try {
    service = createServiceClient();
  } catch {
    return textResult("O servidor MedChina não está configurado neste ambiente.", true);
  }

  const settings = await loadMcpSettings(service);
  if (!settings.enabled) {
    await recordRequest(service, auth, tool, "denied_entitlement");
    return textResult("As conexões com assistentes externos estão temporariamente desativadas no MedChina.", true);
  }

  if (options.requiredScope && !hasScope(auth.scope, options.requiredScope)) {
    await recordRequest(service, auth, tool, "denied_scope");
    return textResult(
      "Esta conexão não tem permissão para essa ação. Reconecte o MedChina autorizando a permissão necessária.",
      true,
    );
  }

  // Entitlement: active subscription with the connector on the plan (0088).
  const { data: entitlements, error: entitlementsError } = await service.rpc("org_entitlements", {
    target_org: auth.orgId,
  });
  if (entitlementsError) {
    await recordRequest(service, auth, tool, "error");
    return textResult("Não foi possível verificar a assinatura agora. Tente novamente em instantes.", true);
  }
  const limits = (entitlements?.limits ?? {}) as Record<string, unknown>;
  if (!entitlements?.active || Number(limits.mcp_access ?? 0) < 1) {
    await recordRequest(service, auth, tool, "denied_entitlement");
    return textResult(
      entitlements?.suspended
        ? "O workspace está suspenso. A profissional deve falar com o suporte do MedChina."
        : "O plano atual do workspace não inclui conexões com assistentes externos. A profissional pode ver os planos em Configurações → Assinatura no MedChina.",
      true,
    );
  }

  // Rate: sliding window over mcp_requests (agents chain calls; a runaway
  // loop must hit this wall, not the professional's monthly quota).
  const { data: rate } = await service.rpc("mcp_rate_allowance", { target_org: auth.orgId });
  if (rate && rate.allowed === false) {
    await recordRequest(service, auth, tool, "denied_rate");
    return textResult(
      "Muitas consultas em sequência. Aguarde um minuto e tente novamente — o limite protege a franquia do workspace.",
      true,
    );
  }

  // Quota: retrieval tools carry a discounted weight on the SAME monthly
  // library quota the in-app chat uses; deterministic reads weigh zero.
  const weight = resolveToolWeight(settings, tool);
  let allowance: MessageAllowance | null = null;
  let metered = false;
  if (weight > 0) {
    const { data } = await service.rpc("org_message_allowance", {
      target_org: auth.orgId,
      target_assistant: LIBRARY_ASSISTANT_SLUG,
    });
    allowance = (data as MessageAllowance | null) ?? null;
    metered = allowance?.unlimited === false;
    if (allowance && allowance.allowed === false) {
      await recordRequest(service, auth, tool, "denied_quota");
      return textResult(
        `A franquia mensal da biblioteca deste workspace acabou (${allowance.used ?? 0} de ${allowance.limit ?? 0}). ` +
          "Ela renova no próximo mês; para ampliar, a profissional pode ajustar o plano em Configurações → Assinatura no MedChina.",
        true,
      );
    }
  }

  let outcome: ToolOutcome;
  try {
    outcome = await execute(service);
  } catch (error) {
    console.error(`[mcp] tool ${tool} failed`, error);
    outcome = { ok: false, status: "error", message: "A consulta falhou no MedChina. Tente novamente em instantes." };
  }

  if (!outcome.ok) {
    await recordRequest(service, auth, tool, outcome.status);
    return textResult(outcome.message, true);
  }

  // Meter AFTER success only — a failed lookup costs nothing (0063 discipline).
  if (weight > 0 && metered) {
    try {
      await service.rpc("record_library_usage", {
        target_org: auth.orgId,
        target_assistant: LIBRARY_ASSISTANT_SLUG,
        target_conversation: null,
        target_user: auth.userId,
        target_channel: "mcp",
        target_tool: tool,
        target_weight: weight,
      });
      await alertAfterLibraryMessage(auth.orgId, {
        used: (allowance?.used ?? 0) + weight,
        limit: allowance?.limit ?? 0,
        windowStart: allowance?.window_start as string,
      });
    } catch (error) {
      console.error("[mcp] metering failed", error);
    }
  }

  await recordRequest(service, auth, tool, "ok");

  if (outcome.audit) {
    await logAuditEvent(service, {
      orgId: auth.orgId,
      actorId: auth.userId,
      action: outcome.audit.action,
      entityType: outcome.audit.entityType,
      entityId: outcome.audit.entityId,
      metadata: { ...outcome.audit.metadata, tool, client_name: auth.clientName, channel: "mcp" },
    });
  }

  return textResult(`${outcome.text}\n\n---\n${MCP_DISCLAIMER}`);
}
