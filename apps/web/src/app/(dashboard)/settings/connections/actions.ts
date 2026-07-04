"use server";

import "@/lib/connectors";

import { createClient } from "@flyee/auth/server";
import {
  type ConnectionSecret,
  getConnector,
  listConnectors,
  runConnectionSync,
  saveConnectionSecret,
} from "@flyee/connectors";
import { sendEvent } from "@flyee/jobs";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Connectors registered by this project (template ships none). */
export async function listAvailableConnectors() {
  return listConnectors();
}

/** Test credentials, create the connection (RLS enforces org admin) and store the secret. */
export async function createConnection(input: {
  orgId: string;
  provider: string;
  name: string;
  secret: ConnectionSecret;
}): Promise<ActionResult> {
  const connector = getConnector(input.provider);
  if (!connector) return { ok: false, error: `No connector registered for "${input.provider}".` };

  const test = await connector.test(input.secret);
  if (!test.ok) return { ok: false, error: test.error ?? "Credential test failed." };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("connections")
    .insert({
      org_id: input.orgId,
      provider: input.provider,
      name: input.name.trim() || connector.name,
      metadata: test.metadata ?? {},
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Insert failed." };

  try {
    await saveConnectionSecret(created.id, input.secret);
  } catch (secretError) {
    await supabase.from("connections").delete().eq("id", created.id);
    return { ok: false, error: secretError instanceof Error ? secretError.message : "Could not store credentials." };
  }
  return { ok: true };
}

/**
 * Queue one sync cycle. Authorization: the RLS-scoped update below only
 * succeeds for org owners/admins — a failed update means no service-role
 * sync either.
 */
export async function syncConnection(connectionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: allowed } = await supabase
    .from("connections")
    .update({ sync_error: null })
    .eq("id", connectionId)
    .select("id")
    .maybeSingle();
  if (!allowed) return { ok: false, error: "Not allowed to sync this connection." };

  const queued = await sendEvent("connectors/connection.sync", { connectionId });
  if (queued.sent) return { ok: true };

  const result = await runConnectionSync(connectionId);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
