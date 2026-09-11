-- ============================================================
-- 0101_import_placeholder_cleanup
--
-- Charts imported before `lib/import/placeholders.ts` existed kept the words
-- the old system writes for "there is nothing here" — a patient's Observações
-- reading NULL, a document cell reading N/A. Stored, they are not absence: the
-- chart ASSERTS "NULL" where it should say "não informado" (PRD §10.5).
--
-- `external_ref` is the one that did silent damage. It is unique per workspace
-- (0076), so a whole export carrying "NULL" in the old system's id column gave
-- that identity to the FIRST patient and every other line was skipped as a
-- duplicate of her. Clearing it costs nothing — a placeholder never identified
-- anybody — and lets a re-import match on the document or the name instead.
--
-- Scoped to rows an import created (`import_batch_id is not null`) and to an
-- exact, whole-value list mirroring the TypeScript one. Anything typed by the
-- professional herself is untouched, and row versioning keeps the old value.
--
-- `legacy_body` is deliberately NOT touched: a consultation whose entire text
-- is "NULL" is a visible record she can delete, and dropping clinical rows in a
-- migration is not this file's business.
-- ============================================================

create or replace function public.import_placeholder_cell(value text)
returns boolean
language sql
immutable
parallel safe
as $$
  select value is not null
     and btrim(value) <> ''
     and (
       btrim(value) ~ '^[-–—_.?]+$'
       or lower(btrim(regexp_replace(value, '\s+', ' ', 'g'))) in (
         'null', '(null)', 'nulo', 'nula', 'nil', 'none', 'nan', 'undefined',
         'n/a', 'n.a.', 'n/d', '#n/a', '#n/d', '#valor!', '#value!', '#ref!',
         '#div/0!', '#nome?', '#name?', '#null!',
         'vazio', 'em branco',
         'sem informacao', 'sem informação', 'sem informacoes', 'sem informações',
         'sem dados', 'sem registro',
         'nao informado', 'não informado', 'nao informada', 'não informada',
         'nao informou', 'não informou', 'nao consta', 'não consta'
       )
     );
$$;

comment on function public.import_placeholder_cell(text) is
  'True when a cell holds a written-down absence ("NULL", "N/A", "não informado"); mirrors apps/web/src/lib/import/placeholders.ts.';

update public.patients
set notes = null
where import_batch_id is not null and public.import_placeholder_cell(notes);

update public.patients
set document = null
where import_batch_id is not null and public.import_placeholder_cell(document);

update public.patients
set external_ref = null
where import_batch_id is not null and public.import_placeholder_cell(external_ref);

update public.patients
set phone = null
where import_batch_id is not null and public.import_placeholder_cell(phone);

update public.patients
set email = null
where import_batch_id is not null and public.import_placeholder_cell(email);

update public.consultations
set external_ref = null
where import_batch_id is not null and public.import_placeholder_cell(external_ref);
