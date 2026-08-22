import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Runtime configuration of the MCP connector layer, read from
 * platform_settings 'mcp' (migration 0088) — weights and limits are pricing
 * policy, editable in the admin without a deploy, never constants.
 */

export type McpSettings = {
  enabled: boolean;
  weights: Record<string, number>;
  defaultWeight: number;
};

const FALLBACK: McpSettings = { enabled: true, weights: {}, defaultWeight: 1.0 };

export async function loadMcpSettings(service: SupabaseClient): Promise<McpSettings> {
  const { data } = await service.from("platform_settings").select("value").eq("key", "mcp").maybeSingle();
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const weights: Record<string, number> = {};
  for (const [tool, weight] of Object.entries((value.weights as Record<string, unknown>) ?? {})) {
    const parsed = Number(weight);
    if (Number.isFinite(parsed) && parsed >= 0) weights[tool] = parsed;
  }
  return {
    enabled: value.enabled !== false,
    weights,
    defaultWeight: Number.isFinite(Number(value.default_weight))
      ? Number(value.default_weight)
      : FALLBACK.defaultWeight,
  };
}

/**
 * A tool missing from the weights map pays the FULL unit — the fail-safe
 * points toward charging: a future tool that generates content with OUR model
 * never gets a discount by omission.
 */
export function resolveToolWeight(settings: McpSettings, tool: string): number {
  return settings.weights[tool] ?? settings.defaultWeight;
}

/** What the verified OAuth token says about the caller (set by /api/mcp auth). */
export type McpAuthContext = {
  orgId: string;
  userId: string;
  tokenId: string;
  scope: string;
  clientName: string;
};

/** Read our auth payload back out of the SDK's AuthInfo.extra. */
export function mcpAuthFromExtra(extra: Record<string, unknown> | undefined): McpAuthContext | null {
  if (!extra) return null;
  const { orgId, userId, tokenId, scope, clientName } = extra as Partial<McpAuthContext>;
  if (!orgId || !userId || !tokenId || typeof scope !== "string") return null;
  return { orgId, userId, tokenId, scope, clientName: clientName || "Assistente externo" };
}
