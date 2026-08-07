begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ---------- Contract ----------

select ok(
  to_regprocedure(
    'public.knowledge_search(extensions.vector,uuid[],integer,smallint,double precision,text,integer,text[])'
  ) is not null,
  'retrieval accepts the practitioner''s modalities'
);
select ok(
  to_regprocedure(
    'public.knowledge_search(extensions.vector,uuid[],integer,smallint,double precision,text,integer)'
  ) is null,
  'the 7-argument overload is gone, so no call is ambiguous'
);
select ok(
  coalesce((select position('when target_modalities is null then 0' in prosrc) > 0
            from pg_proc where proname = 'knowledge_search'), false),
  'no declared scope means the ranking is exactly what it was before'
);
select ok(
  coalesce((select position('''modality'' is null then 0' in prosrc) > 0
            from pg_proc where proname = 'knowledge_search'), false),
  'an untagged document is NEVER demoted — otherwise the 64 formulas would sink'
);
select ok(
  coalesce((select position('- 0.001' in prosrc) = 0 and position('* -' in prosrc) = 0
            from pg_proc where proname = 'knowledge_search'), false),
  'the term only ever adds: content from another modality stays reachable'
);

-- ---------- The backfill convention ----------

select ok(
  coalesce((select position('herbal_formula' in prosrc) = 0
            from pg_proc where proname = 'knowledge_search'), false),
  'retrieval knows nothing about document kinds — modality is the only axis'
);

-- Seeded points carry the modality; formulas deliberately do not.
-- (Empty on a fresh test database; asserted as "no counter-example".)
select ok(
  not exists (
    select 1 from public.knowledge_documents
    where metadata ->> 'kind' = 'herbal_formula'
      and metadata -> 'modality' is not null
  ),
  'herbal formulas stay neutral — Chinese herbal medicine is not one of the five modalities'
);
select ok(
  not exists (
    select 1 from public.knowledge_documents
    where metadata ->> 'kind' in ('acupuncture_point', 'tung_point')
      and metadata -> 'modality' is not null
      and not (metadata -> 'modality' ? 'acupuncture')
  ),
  'every tagged point is tagged as acupuncture'
);

select * from finish();
rollback;
