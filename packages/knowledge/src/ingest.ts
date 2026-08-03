import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkText } from "./chunking";
import { embedDocuments } from "./embeddings";

export type IngestResult = { ok: true; chunks: number } | { ok: false; error: string };

/**
 * Chunk + embed + store one knowledge document. Idempotent: previous chunks
 * are replaced. Runs under whatever client it is given — the Inngest job
 * passes the service client; the inline fallback passes the user's client
 * (RLS then requires collection-manage rights).
 */
export async function processDocument(supabase: SupabaseClient, documentId: string): Promise<IngestResult> {
  const { data: document, error: loadError } = await supabase
    .from("knowledge_documents")
    .select("id, title, source, content")
    .eq("id", documentId)
    .maybeSingle();
  if (loadError || !document) return { ok: false, error: loadError?.message ?? "Document not found." };

  await supabase.from("knowledge_documents").update({ status: "processing", error: null }).eq("id", documentId);

  try {
    const chunks = chunkText(document.content);
    if (chunks.length === 0) throw new Error("Document has no content to index.");

    // What gets EMBEDDED carries the document's title; what gets STORED does
    // not. A chunk reading "Indicações: cefaleia, tontura…" is meaningless as a
    // vector without knowing which point it belongs to — every chunk after the
    // first lost that context at the paragraph split — but repeating the title
    // inside the stored text would put it in front of the professional in every
    // citation and inside every prompt.
    const heading = [document.title, document.source].filter(Boolean).join(" — ");
    const embeddings = await embedDocuments(chunks.map((content) => (heading ? `${heading}\n\n${content}` : content)));

    await supabase.from("knowledge_chunks").delete().eq("document_id", documentId);
    const { error: insertError } = await supabase.from("knowledge_chunks").insert(
      chunks.map((content, idx) => ({
        document_id: documentId,
        idx,
        content,
        // pgvector accepts the '[1,2,3]' text representation.
        embedding: JSON.stringify(embeddings[idx]),
      })),
    );
    if (insertError) throw new Error(insertError.message);

    await supabase.from("knowledge_documents").update({ status: "ready" }).eq("id", documentId);
    return { ok: true, chunks: chunks.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("knowledge_documents").update({ status: "error", error: message }).eq("id", documentId);
    return { ok: false, error: message };
  }
}
