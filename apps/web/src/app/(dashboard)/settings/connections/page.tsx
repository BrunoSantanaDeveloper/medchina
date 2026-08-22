import ConnectionsView, { type ConnectionSummary } from "./components/connections-view";
import { redirect } from "next/navigation";

import { BRAND } from "@/brand";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";

/**
 * Connected external assistants (docs/MCP-CONECTORES.md). The professional's
 * job here: see exactly which apps can reach her workspace, connect a new one
 * (copy the MCP URL, authorize in the app), and cut one off instantly. Few
 * rows, high stakes — cards with a confirm-to-revoke, never a CRUD table.
 *
 * Server component because listing needs the service role: token rows are
 * member-readable (RLS), but the client NAMES live in oauth_clients, which is
 * deliberately not readable by browsers (its redirect URIs are attack
 * surface). The org filter below is the tenancy boundary.
 */
export default async function ConnectionsPage() {
  if (!isSupabaseConfigured) {
    return <ConnectionsView configured={false} connections={[]} mcpUrl={`${BRAND.siteUrl}/api/mcp`} />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=%2Fsettings%2Fconnections");

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const orgId = (membership?.org_id as string | undefined) ?? null;

  const connections: ConnectionSummary[] = [];
  if (orgId) {
    try {
      const service = createServiceClient();
      const { data: rows } = await service
        .from("oauth_tokens")
        .select(
          "id, client_id, scope, created_at, last_used_at, revoked_at, access_expires_at, refresh_expires_at, oauth_clients(client_name)",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);

      // Rotation writes a new row per refresh: group per client so the screen
      // shows CONNECTIONS (original date, freshest use), not token churn.
      const now = Date.now();
      const byClient = new Map<string, ConnectionSummary & { live: boolean }>();
      for (const row of rows ?? []) {
        const clientRowId = row.client_id as string;
        const rel = row.oauth_clients as { client_name?: string } | { client_name?: string }[] | null;
        const clientName = (Array.isArray(rel) ? rel[0]?.client_name : rel?.client_name) ?? "Aplicativo";
        const expiry = Math.max(
          row.refresh_expires_at ? new Date(row.refresh_expires_at as string).getTime() : 0,
          row.access_expires_at ? new Date(row.access_expires_at as string).getTime() : 0,
        );
        const live = !row.revoked_at && expiry > now;
        const existing = byClient.get(clientRowId);
        if (!existing) {
          byClient.set(clientRowId, {
            clientRowId,
            clientName,
            scopes: String(row.scope ?? "")
              .split(/\s+/u)
              .filter(Boolean),
            connectedAt: row.created_at as string,
            lastUsedAt: (row.last_used_at as string | null) ?? null,
            live,
          });
        } else {
          // Rows arrive newest-first: older rows push the connect date back
          // and can only add liveness or an earlier-known name.
          existing.connectedAt = row.created_at as string;
          existing.live = existing.live || live;
          if (!existing.lastUsedAt && row.last_used_at) existing.lastUsedAt = row.last_used_at as string;
        }
      }
      for (const entry of byClient.values()) {
        if (entry.live) {
          connections.push({
            clientRowId: entry.clientRowId,
            clientName: entry.clientName,
            scopes: entry.scopes,
            connectedAt: entry.connectedAt,
            lastUsedAt: entry.lastUsedAt,
          });
        }
      }
    } catch {
      // Service role not configured: the view explains instead of blanking.
    }
  }

  return <ConnectionsView configured connections={connections} mcpUrl={`${BRAND.siteUrl}/api/mcp`} />;
}
