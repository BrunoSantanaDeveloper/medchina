"use server";

import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Cut an external assistant off (docs/MCP-CONECTORES.md). Revokes EVERY live
 * token of that client for the caller's workspace — rotation keeps several
 * rows per connection, and revoking only the newest would leave a usable
 * refresh token behind. Rows are stamped, never deleted (the trail stays).
 *
 * The org comes from the SESSION's membership, so the action cannot be
 * pointed at another workspace no matter what the client sends.
 */
export async function revokeConnection(clientRowId: string): Promise<ActionResult> {
  if (!clientRowId) return { ok: false, error: "missing_client" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const orgId = (membership?.org_id as string | undefined) ?? null;
  if (!orgId) return { ok: false, error: "no_workspace" };

  let service;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, error: "not_configured" };
  }

  const { error } = await service
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("client_id", clientRowId)
    .is("revoked_at", null);
  if (error) return { ok: false, error: error.message };

  await recordAudit(supabase, "mcp.connection_revoked", {
    orgId,
    entityType: "oauth_client",
    entityId: clientRowId,
  });

  return { ok: true };
}
