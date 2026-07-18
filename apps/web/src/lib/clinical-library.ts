/**
 * The clinical library collections (PRD §9.9), kept separate by KIND —
 * traditional sources, internal protocols and scientific evidence are
 * different kinds of source, not a ranking.
 *
 * Pure constants, no imports: client components (the /biblioteca screen)
 * import this file directly, while the server-only reasoning/plan libs
 * build their retrieval on the same values.
 */

export const LIBRARY_COLLECTIONS = [
  "mtc-fontes-tradicionais",
  "mtc-protocolos-internos",
  "mtc-evidencia-cientifica",
] as const;

export type LibraryKind = "traditional" | "protocol" | "evidence";

export const COLLECTION_KIND: Record<string, LibraryKind> = {
  "mtc-fontes-tradicionais": "traditional",
  "mtc-protocolos-internos": "protocol",
  "mtc-evidencia-cientifica": "evidence",
};

/** The seeded study assistant the /biblioteca screen talks to (migration 0042). */
export const LIBRARY_ASSISTANT_SLUG = "biblioteca-mtc";

/**
 * What grounded an answer — sent to the client by the chat route (when
 * `includeSources` is requested) and persisted in messages.metadata as
 * {"knowledge_sources": KnowledgeSourceRef[]}.
 */
export type KnowledgeSourceRef = {
  index: number;
  title: string;
  source: string | null;
  kind: LibraryKind | "unknown";
  trustLevel: number;
};

/**
 * ASCII record separator framing the sources JSON prelude ahead of the text
 * stream: `{"sources":[...]}<text deltas…>`.
 */
export const SOURCES_SENTINEL = "\u001e";
