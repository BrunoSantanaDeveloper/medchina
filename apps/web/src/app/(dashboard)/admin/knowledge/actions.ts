"use server";

import { createClient } from "@gogo/auth/server";
import { sendEvent } from "@gogo/jobs";
import { processDocument } from "@gogo/knowledge";

export type IngestActionResult = { ok: true; queued: boolean } | { ok: false; error: string };

/**
 * (Re)index a knowledge document. Queues the Inngest job when possible and
 * falls back to inline processing. Authorization: the RLS-scoped update
 * below only succeeds for users who can manage the parent collection, so a
 * failed update means the caller may not queue the (service-role) job either.
 */
export async function ingestDocument(documentId: string): Promise<IngestActionResult> {
  const supabase = await createClient();
  const { data: allowed } = await supabase
    .from("knowledge_documents")
    .update({ status: "pending", error: null })
    .eq("id", documentId)
    .select("id")
    .maybeSingle();
  if (!allowed) return { ok: false, error: "Not allowed to index this document." };

  const queued = await sendEvent("knowledge/document.ingest", { documentId });
  if (queued.sent) return { ok: true, queued: true };

  const result = await processDocument(supabase, documentId);
  return result.ok ? { ok: true, queued: false } : { ok: false, error: result.error };
}
