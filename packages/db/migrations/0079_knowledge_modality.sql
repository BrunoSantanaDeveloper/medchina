-- ============================================================
-- 0079_knowledge_modality
--
-- Gives library documents a MODALITY axis, so retrieval can put what a
-- professional actually practises first.
--
-- Read this before assuming it changes anything today: the acervo is 393
-- systemic acupuncture points, 64 herbal formulas and 2 Tung points. There is
-- not one auriculotherapy, moxibustion, cupping or dietary card in it. The
-- bonus below is therefore INERT until such content is ingested — this
-- migration is the groundwork, deliberately laid before the content rather
-- than after, so ingestion has somewhere to put the label.
--
-- Convention: `metadata.modality` is an ARRAY of slugs (a protocol can serve
-- moxibustion AND cupping). Absent or null means NEUTRAL — applicable to
-- every practice, never penalised.
--
-- Herbal formulas get NO modality on purpose. Chinese herbal medicine is not
-- one of the product's five modalities, and `diet` is Chinese DIETARY therapy,
-- a different discipline — tagging the 64 formulas as `diet` would be a
-- clinical error. Neutral keeps them retrievable for everyone, which is the
-- correct behaviour for a shared reference.
--
-- No GIN index. At 459 documents a scan is trivial, and `metadata` never
-- enters the WHERE clause anyway: the bonus lives in the ORDER BY, over the
-- set the RRF already reduced. An index here would only add write cost to
-- ingestion. Revisit if the corpus reaches tens of thousands of documents.
-- ============================================================

-- ---------- Backfill ----------

-- Systemic points and Tung points ARE acupuncture.
update public.knowledge_documents
set metadata = metadata || jsonb_build_object('modality', jsonb_build_array('acupuncture'))
where metadata ->> 'kind' in ('acupuncture_point', 'tung_point')
  and metadata -> 'modality' is null;

-- herbal_formula and internal_protocol stay neutral (see the header).

comment on column public.knowledge_documents.metadata is
  'Free-form document annotations. Known keys: kind, code, pinyin, key, and modality (array of practice slugs; absent = applicable to every practice).';

-- ---------- Retrieval: modality as a rank-space nudge ----------

/**
 * Adds `target_modalities`: the practitioner's declared scope, used to BREAK
 * TIES toward what she practises. Everything else is 0062 verbatim.
 *
 * Three properties, each load-bearing:
 *   * a document with NO modality is never penalised — otherwise the 64
 *     formulas would sink for every professional who declared a scope;
 *   * the term only ever ADDS, so content from another modality stays
 *     reachable (this is a study library, not a filter);
 *   * the magnitude matches the trust bonus, which 0062 sized so the whole
 *     range moves a result less than one place of the primary ranking.
 */
create or replace function public.knowledge_search(
  query_embedding extensions.vector(768),
  collections uuid[],
  match_count integer default 8,
  max_trust smallint default 5,
  min_similarity double precision default 0.25,
  query_text text default null,
  rrf_k integer default 60,
  target_modalities text[] default null
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
      d.metadata,
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
  -- of the primary ranking. Modality joins it on the same scale.
  order by f.rrf_score
         + (5 - s.trust_level) * 0.0005
         + case
             when target_modalities is null then 0
             -- Neutral document: applicable to every practice, never demoted.
             when s.metadata -> 'modality' is null then 0
             when s.metadata -> 'modality' ?| target_modalities then 0.001
             else 0
           end
         desc
  limit greatest(match_count, 1);
$$;

grant execute on function public.knowledge_search(
  extensions.vector(768), uuid[], integer, smallint, double precision, text, integer, text[]
) to authenticated, service_role;

-- The 7-argument overload from 0062 would now be ambiguous against the new
-- one for callers that omit the trailing argument. Every caller goes through
-- @flyee/knowledge, which passes arguments BY NAME, so dropping it is safe.
drop function if exists public.knowledge_search(
  extensions.vector(768), uuid[], integer, smallint, double precision, text, integer
);
