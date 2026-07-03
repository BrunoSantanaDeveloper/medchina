import { createServiceClient } from "@gogo/auth/service";

import { getConnector } from "./registry";
import type { ConnectionRecord, ConnectionSecret, SyncResult } from "./types";

export type RunSyncResult = { ok: true; stats?: Record<string, number> } | { ok: false; error: string };

/**
 * One sync cycle for a connection. Service-role only — callers must have
 * verified the requester's rights first (RLS-scoped write on the row).
 * Persists cursor/last_synced_at on success and sync_error on failure.
 */
export async function runConnectionSync(connectionId: string): Promise<RunSyncResult> {
  const supabase = createServiceClient();

  const { data: connection } = await supabase
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle<ConnectionRecord>();
  if (!connection) return { ok: false, error: "Connection not found." };
  if (connection.status === "disabled") return { ok: false, error: "Connection is disabled." };

  const connector = getConnector(connection.provider);
  if (!connector) {
    return { ok: false, error: `No connector registered for "${connection.provider}".` };
  }

  const { data: secretRow } = await supabase
    .from("connection_secrets")
    .select("secret")
    .eq("connection_id", connectionId)
    .maybeSingle<{ secret: ConnectionSecret }>();
  if (!secretRow) return { ok: false, error: "Connection has no stored credentials." };

  try {
    const result: SyncResult = await connector.sync({ connection, secret: secretRow.secret, supabase });
    await supabase
      .from("connections")
      .update({
        ...(result.cursor ? { sync_cursor: result.cursor } : {}),
        last_synced_at: new Date().toISOString(),
        sync_error: null,
        status: "connected",
      })
      .eq("id", connectionId);
    return { ok: true, stats: result.stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("connections").update({ sync_error: message, status: "error" }).eq("id", connectionId);
    return { ok: false, error: message };
  }
}

/** Store credentials (service-role table; never expose to the browser). */
export async function saveConnectionSecret(connectionId: string, secret: ConnectionSecret) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("connection_secrets").upsert({ connection_id: connectionId, secret });
  if (error) throw new Error(error.message);
}
