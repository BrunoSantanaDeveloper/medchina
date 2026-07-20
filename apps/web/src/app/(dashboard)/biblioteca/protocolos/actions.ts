"use server";

import { recordAudit } from "@/lib/audit";
import { OWN_PROTOCOLS_SLUG } from "@/lib/clinical-library";
import { createClient } from "@flyee/auth/server";
import { sendEvent } from "@flyee/jobs";
import { processDocument } from "@flyee/knowledge";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProtocolResult = { ok: true; id: string; queued: boolean } | { ok: false; error: string };

/**
 * The professional's own protocols (fase 5). Everything runs under HER RLS
 * client: writing a collection needs the owner/admin role on the workspace,
 * so authorization is the database's answer, not this module's.
 *
 * Saving indexes the protocol into the same RAG the library chat, the
 * hypotheses and the therapeutic plan already query — what she writes here
 * comes back cited as "Protocolo interno".
 */

/** The org's protocol collection, created the first time she saves one. */
async function ensureCollection(supabase: SupabaseClient, orgId: string, name: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from("knowledge_collections")
    .select("id")
    .eq("org_id", orgId)
    .eq("slug", OWN_PROTOCOLS_SLUG)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created } = await supabase
    .from("knowledge_collections")
    .insert({
      org_id: orgId,
      slug: OWN_PROTOCOLS_SLUG,
      name,
      description: null,
      // Her own protocols are hers to browse — the licensing kill-switch
      // (docs/LICENSING-LIBRARY.md) governs the curated global acervo.
      browsable: true,
    })
    .select("id")
    .maybeSingle();
  return (created?.id as string | undefined) ?? null;
}

async function index(supabase: SupabaseClient, documentId: string): Promise<boolean> {
  const queued = await sendEvent("knowledge/document.ingest", { documentId });
  if (queued.sent) return true;
  // No queue configured: index inline so the protocol is searchable now.
  await processDocument(supabase, documentId);
  return false;
}

export async function saveProtocol(input: {
  orgId: string;
  id?: string;
  title: string;
  content: string;
  /** Shown as the attribution on the acervo card. */
  authorLabel: string;
  /** Localized collection name, used only when creating it. */
  collectionName: string;
}): Promise<ProtocolResult> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) return { ok: false, error: "empty" };

  const supabase = await createClient();

  if (input.id) {
    const { data: updated, error } = await supabase
      .from("knowledge_documents")
      .update({ title, content, source: input.authorLabel, status: "pending", error: null })
      .eq("id", input.id)
      .select("id")
      .maybeSingle();
    if (error || !updated) return { ok: false, error: error?.message ?? "not_allowed" };
    const queued = await index(supabase, input.id);
    await recordAudit(supabase, "protocol.updated", {
      orgId: input.orgId,
      entityType: "knowledge_document",
      entityId: input.id,
    });
    return { ok: true, id: input.id, queued };
  }

  const collectionId = await ensureCollection(supabase, input.orgId, input.collectionName);
  if (!collectionId) return { ok: false, error: "collection_failed" };

  const { data: created, error } = await supabase
    .from("knowledge_documents")
    .insert({
      collection_id: collectionId,
      title,
      content,
      source: input.authorLabel,
      // Verified first-party data: it is her own clinical protocol, second
      // only to the traditional sources the library was seeded with.
      trust_level: 2,
      metadata: { kind: "internal_protocol" },
      status: "pending",
    })
    .select("id")
    .maybeSingle();
  if (error || !created) return { ok: false, error: error?.message ?? "not_allowed" };

  const documentId = created.id as string;
  const queued = await index(supabase, documentId);
  await recordAudit(supabase, "protocol.created", {
    orgId: input.orgId,
    entityType: "knowledge_document",
    entityId: documentId,
  });
  return { ok: true, id: documentId, queued };
}

export async function deleteProtocol(orgId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  // Chunks cascade with the document, so deleting also removes it from RAG.
  const { error } = await supabase.from("knowledge_documents").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await recordAudit(supabase, "protocol.deleted", { orgId, entityType: "knowledge_document", entityId: id });
  return { ok: true };
}
