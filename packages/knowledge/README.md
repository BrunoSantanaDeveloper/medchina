# @flyee/knowledge

Knowledge base with **trust levels** and **pgvector** retrieval — the template's RAG layer.

## Concept

Content lives in **collections** (global, superadmin-managed at `/admin/knowledge`; or org-scoped, managed by org owners/admins). Each **document** carries a `trust_level`:

| Level | Default label | Example in a derived project |
|---|---|---|
| 1 | Official source | Platform/vendor documentation |
| 2 | Verified first-party data | Real campaign/product data |
| 3 | Reported results | Sales/funnel outcomes |
| 4 | Internal playbook | Validated internal processes |
| 5 | Unverified / opinion | Courses, posts, opinions |

Ingestion chunks the document (`chunkText`), embeds with **Gemini `gemini-embedding-001`** (truncated to 768 dims via `outputDimensionality`) and stores chunks in `knowledge_chunks`. What gets **embedded** carries the document's title; what gets **stored** does not — a chunk reading "Indicações: …" is meaningless as a vector without knowing which point it belongs to, but repeating the title in the stored text would put it in front of the professional in every citation.

Retrieval (`knowledge_search` RPC, security invoker — RLS applies) is **hybrid** since migration `0062`: the cosine ranking and a Portuguese full-text ranking over chunk + title, fused with Reciprocal Rank Fusion. RRF combines *rankings*, not scores — cosine similarity and `ts_rank` are not on comparable scales, so normalising them against each other would be arbitrary. The trust bonus survives as a tie-break in the fused rank space, where it cannot outrank relevance.

The lexical half is not a nicety: this corpus is dominated by exact identifiers (point codes, pinyin names, formula names, Tung numbers) and those are precisely the tokens a 768-dimension embedding handles worst — rare, and almost without distributional meaning.

> **Changing the embedding model changes the vector space.** Documents embedded with a previous model become incomparable to new query embeddings — re-index every chunk after a model swap (`npm run knowledge:reindex -- --apply`). Google retired `text-embedding-004`/`embedding-001`; projects that ingested before the switch must re-index.

## Measuring retrieval

A retrieval regression throws nothing and logs nothing: the hypotheses simply come back with fewer sources and nobody notices. So retrieval is a **tested** system.

```bash
npm run eval:retrieval                    # the shipped hybrid
npm run eval:retrieval -- --compare       # hybrid vs pure cosine, side by side
npm run eval:retrieval -- --lexical-only  # the lexical half alone, no embedding calls
npm run knowledge:reindex                 # dry run: what WOULD be re-embedded
npm run knowledge:reindex -- --apply      # re-embed through the current path
```

The golden set (`eval/golden-set.json`) expects documents by `metadata.key`, never by UUID — ids differ between environments, the key does not. Two tiers, and the difference is honesty about who verified them:

- **identifier** — a code or pinyin resolves to exactly one card. Objectively checkable, no clinical judgement, and the eval **fails** if any of them misses.
- **clinical** — a practitioner's question paraphrased from what the document itself records (never copied verbatim, which would let lexical search win for free and measure nothing). Grounded in the corpus, but the expectation still needs a TCM professional to confirm: they carry `verified: false` and are reported separately.

Run it before and after touching chunking, the embedding model or dimensions, the similarity floor, the trust bonus or the RRF constant. Without it, every one of those is a guess.

## Wiring into assistants

Set `config.knowledge` on an assistant row (editable in `/admin/ai`):

```json
{ "knowledge": { "collections": ["meta-ads-docs"], "matchCount": 8, "maxTrust": 5 } }
```

The chat route then embeds the user message, retrieves matching chunks and appends a grounded-context block (`buildKnowledgeContext`) to the system prompt, instructing the assistant to cite excerpts and never invent evidence.

## Ingestion path

`/admin/knowledge` (or your own code) inserts a `knowledge_documents` row, then:

1. `sendEvent("knowledge/document.ingest", { documentId })` — processed by the Inngest job (service role).
2. If the event cannot be queued (`sent: false`), callers fall back to `processDocument(supabase, documentId)` inline with the user's client (RLS requires collection-manage rights).

## Requirements

- Migration `packages/db/migrations/0003_knowledge.sql` (enables the `vector` extension).
- `GEMINI_API_KEY` — without it, ingestion/search fail with a clear hint; the rest of the app is unaffected.
