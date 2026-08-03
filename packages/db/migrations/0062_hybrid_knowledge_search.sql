-- Retrieval in this library is dominated by EXACT identifiers: point codes
-- ("VG20", "E36", "IG4"), pinyin names ("Baihui", "Zusanli"), formula names,
-- Tung point numbers ("22.01"). Those are precisely the tokens a 768-dimension
-- embedding handles worst — they are rare, carry almost no distributional
-- meaning, and a question about IG4 happily retrieves its semantic neighbours
-- instead of IG4. A pure cosine search cannot fix that with any threshold.
--
-- So the search becomes hybrid: the existing vector ranking, plus a Portuguese
-- full-text ranking over the same chunks, fused with Reciprocal Rank Fusion.
-- RRF combines rankings rather than scores, which is what makes it safe here —
-- cosine similarity and ts_rank are not on comparable scales and normalising
-- them against each other would be arbitrary.
--
-- Two more corrections travel with it:
--  * the chunk is indexed WITH its document title, so a chunk reading
--    "Indicações: cefaleia, ..." is findable by the point it belongs to. The
--    title is the context every chunk lost at ingestion time.
--  * the trust bonus survives, but as a rank-space nudge instead of a raw
--    +0.12 added to a cosine score, where it could outrank genuinely better
--    matches.

-- ---------- Lexical index ----------

alter table public.knowledge_chunks
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('portuguese', coalesce(content, ''))) stored;

comment on column public.knowledge_chunks.search_vector is
  'Portuguese full-text vector over the chunk, fused with the embedding ranking by knowledge_search (RRF).';

create index if not exists knowledge_chunks_search_idx
  on public.knowledge_chunks using gin (search_vector);

-- The title is what a point/formula card is actually called. Indexed
-- separately (and weighted above the body) so "Baihui" or "VG20" finds the
-- document even when the body never repeats the name.
create index if not exists knowledge_documents_title_search_idx
  on public.knowledge_documents using gin (to_tsvector('portuguese', coalesce(title, '')));

-- Exact codes survive tokenisation badly in any language configuration
-- ("22.01", "VG20"), so a trigram index backs a literal fallback match.
create extension if not exists pg_trgm with schema extensions;

create index if not exists knowledge_documents_title_trgm_idx
  on public.knowledge_documents using gin (title extensions.gin_trgm_ops);

-- ---------- Hybrid retrieval ----------

-- Same signature as 0003 plus two optional inputs, so every existing caller
-- keeps working unchanged and a caller that has the raw query text gets the
-- lexical half as well.
create or replace function public.knowledge_search(
  query_embedding extensions.vector(768),
  collections uuid[],
  match_count integer default 8,
  max_trust smallint default 5,
  min_similarity double precision default 0.25,
  query_text text default null,
  rrf_k integer default 60
)
returns table (
  chunk_id uuid,
  document_id uuid,
  collection_id uuid,
  title text,
  source text,
  trust_level smallint,
  content text,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  with scoped as (
    select
      ch.id as chunk_id,
      d.id as document_id,
      d.collection_id,
      d.title,
      d.source,
      d.trust_level,
      ch.content,
      ch.search_vector,
      1 - (ch.embedding operator(extensions.<=>) query_embedding) as similarity
    from public.knowledge_chunks ch
    join public.knowledge_documents d on d.id = ch.document_id
    where d.collection_id = any (collections)
      and d.status = 'ready'
      and d.trust_level <= max_trust
  ),
  -- Dense half: unchanged behaviour, including the similarity floor. A chunk
  -- below the floor may still arrive through the lexical half — which is the
  -- whole point, since an exact code match can sit at a low cosine score.
  dense as (
    select
      chunk_id,
      row_number() over (order by similarity desc) as rank
    from scoped
    where similarity >= min_similarity
    order by similarity desc
    limit greatest(match_count, 1) * 5
  ),
  -- Sparse half: the chunk's own text plus its document title, so a card is
  -- retrievable by the name of the thing it describes.
  lexical as (
    select
      s.chunk_id,
      row_number() over (
        order by
          ts_rank(
            setweight(to_tsvector('portuguese', coalesce(s.title, '')), 'A')
              || setweight(coalesce(s.search_vector, ''::tsvector), 'B'),
            websearch_to_tsquery('portuguese', query_text)
          ) desc
      ) as rank
    from scoped s
    where query_text is not null
      and btrim(query_text) <> ''
      and (
        setweight(to_tsvector('portuguese', coalesce(s.title, '')), 'A')
          || setweight(coalesce(s.search_vector, ''::tsvector), 'B')
      ) @@ websearch_to_tsquery('portuguese', query_text)
    order by rank
    limit greatest(match_count, 1) * 5
  ),
  fused as (
    select
      coalesce(dense.chunk_id, lexical.chunk_id) as chunk_id,
      coalesce(1.0 / (rrf_k + dense.rank), 0)
        + coalesce(1.0 / (rrf_k + lexical.rank), 0) as rrf_score
    from dense
    full outer join lexical on lexical.chunk_id = dense.chunk_id
  )
  select
    s.chunk_id,
    s.document_id,
    s.collection_id,
    s.title,
    s.source,
    s.trust_level,
    s.content,
    s.similarity
  from fused f
  join scoped s on s.chunk_id = f.chunk_id
  -- Authority still breaks ties, now in the fused rank space where it cannot
  -- swamp relevance: the whole trust range moves a result less than one place
  -- of the primary ranking.
  order by f.rrf_score + (5 - s.trust_level) * 0.0005 desc
  limit greatest(match_count, 1);
$$;

grant execute on function public.knowledge_search(
  extensions.vector(768), uuid[], integer, smallint, double precision, text, integer
) to authenticated, service_role;

-- The 5-argument overload from 0003 would now be ambiguous against the new
-- default-carrying one. Drop it: every caller goes through @flyee/knowledge,
-- which passes the arguments by name.
drop function if exists public.knowledge_search(
  extensions.vector(768), uuid[], integer, smallint, double precision
);
