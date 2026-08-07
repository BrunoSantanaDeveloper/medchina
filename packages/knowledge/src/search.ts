import type { SupabaseClient } from "@supabase/supabase-js";

import { embedQuery } from "./embeddings";
import { TRUST_LEVEL_LABELS, type KnowledgeSearchOptions, type KnowledgeSearchResult } from "./types";

/** Map collection slugs to ids (global collections plus the caller's orgs, per RLS). */
export async function resolveCollectionIds(supabase: SupabaseClient, slugs: string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const { data } = await supabase.from("knowledge_collections").select("id").in("slug", slugs);
  return (data ?? []).map((row) => row.id as string);
}

/**
 * Embed the query and run the HYBRID search (RLS applies).
 *
 * The raw query text travels alongside the embedding: the SQL side fuses a
 * Portuguese full-text ranking with the vector ranking (RRF, migration 0060),
 * which is what makes an exact identifier — a point code, a pinyin name, a
 * formula — retrievable at all. A 768-dimension embedding treats those as noise.
 */
export async function searchKnowledge(
  supabase: SupabaseClient,
  query: string,
  options: KnowledgeSearchOptions,
): Promise<KnowledgeSearchResult[]> {
  if (options.collectionIds.length === 0) return [];
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc("knowledge_search", {
    query_embedding: JSON.stringify(embedding),
    collections: options.collectionIds,
    match_count: options.matchCount ?? 8,
    max_trust: options.maxTrust ?? 5,
    min_similarity: options.minSimilarity ?? 0.25,
    query_text: query,
    // Null (not an empty array) means "no preference": the RPC skips the
    // bonus entirely and ranks exactly as it did before 0079.
    target_modalities: options.modalities?.length ? [...options.modalities] : null,
  });
  if (error) throw new Error(`knowledge_search failed: ${error.message}`);
  return (data ?? []) as KnowledgeSearchResult[];
}

/**
 * Format retrieved chunks as a context block to append to a system prompt.
 * Each excerpt is labeled with its trust level so the assistant can weigh
 * (and cite) evidence instead of answering generically.
 */
export function buildKnowledgeContext(results: KnowledgeSearchResult[]): string {
  if (results.length === 0) return "";
  const excerpts = results
    .map((result, index) => {
      const label = TRUST_LEVEL_LABELS[result.trust_level] ?? `level ${result.trust_level}`;
      const source = result.source ? ` — ${result.source}` : "";
      return `[${index + 1}] (trust ${result.trust_level}: ${label}) ${result.title}${source}\n${result.content}`;
    })
    .join("\n\n---\n\n");
  return [
    "\n\n## Retrieved knowledge",
    "Ground your answer in the excerpts below. Prefer lower trust-level numbers (1 is most authoritative).",
    "Cite excerpts as [n] and say when the excerpts do not cover the question — never invent evidence.",
    "",
    excerpts,
  ].join("\n");
}
