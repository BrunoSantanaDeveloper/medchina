-- ============================================================
-- 0045_browsable_library: the clinical library becomes BROWSABLE
-- (fase 4), under the safeguards recorded in docs/LICENSING-LIBRARY.md.
--
--  * `browsable` — which collections the acervo screens list. A product
--    control and operational kill-switch (flip to false to unlist a
--    collection instantly without touching the RAG), NOT a security
--    boundary: authenticated read of global collections already exists
--    in RLS (0003) and is unchanged.
--  * `source` rename — safeguard 2 of the review: the imported label
--    leaked an internal database name into the chat citations; the
--    acervo shows attribution prominently, so it must be a human title.
-- ============================================================

alter table public.knowledge_collections
  add column browsable boolean not null default false;

comment on column public.knowledge_collections.browsable is
  'Listed in the member-facing acervo (/biblioteca/acervo). Kill-switch per docs/LICENSING-LIBRARY.md — flipping it off unlists instantly without affecting RAG.';

update public.knowledge_collections
set browsable = true
where slug = 'mtc-fontes-tradicionais';

update public.knowledge_documents
set source = 'Acervo clínico MedChina'
where source like 'Acervo clínico migrado do app anterior%';
