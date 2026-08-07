begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ============================================================
-- Migration 0080 — importing the previous system's records.
--
-- What is asserted here is mostly what the importer REFUSES, because those are
-- the cases that corrupt a chart quietly: a line filed under today's date
-- because it had none, a record attached to the wrong person, and the same
-- file imported twice.
-- ============================================================

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'history@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Acupunturista"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values
  ('b2000000-0000-4000-8000-000000000001', 'History practice', 'history-practice',
   'b1000000-0000-4000-8000-000000000001'),
  -- A second workspace, to prove a record cannot cross into it.
  ('b2000000-0000-4000-8000-000000000002', 'Other practice', 'other-practice',
   'b1000000-0000-4000-8000-000000000001');

insert into public.memberships (org_id, user_id, role)
values ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, external_ref, created_by)
values
  ('b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
   'Márcia da Silva', 'A-10', 'b1000000-0000-4000-8000-000000000001'),
  ('b4000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002',
   'Paciente de Outro Consultório', null, 'b1000000-0000-4000-8000-000000000001');

insert into public.import_batches (id, org_id, kind, source_system, status, created_by)
values (
  'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
  'history', 'Sistema Anterior', 'preview', 'b1000000-0000-4000-8000-000000000001'
);

insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values
  -- Good line.
  (
    'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 2, '{}'::jsonb,
    '{"patient_id":"b4000000-0000-4000-8000-000000000001","date":"2019-06-14","body":"Queixa: lombalgia. Conduta: BL23, BL40.","external_ref":"H-1"}'::jsonb,
    'create'
  ),
  -- No date: would be filed as today.
  (
    'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 3, '{}'::jsonb,
    '{"patient_id":"b4000000-0000-4000-8000-000000000001","body":"Sem data"}'::jsonb,
    'create'
  ),
  -- No text: there is no record to keep.
  (
    'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 4, '{}'::jsonb,
    '{"patient_id":"b4000000-0000-4000-8000-000000000001","date":"2019-07-01"}'::jsonb,
    'create'
  ),
  -- A patient of ANOTHER workspace.
  (
    'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 5, '{}'::jsonb,
    '{"patient_id":"b4000000-0000-4000-8000-000000000002","date":"2019-08-01","body":"Registro alheio"}'::jsonb,
    'create'
  ),
  -- Garbage where a uuid should be: must fail this line, not the import.
  (
    'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 6, '{}'::jsonb,
    '{"patient_id":"nao-e-uuid","date":"2019-09-01","body":"Referência quebrada"}'::jsonb,
    'create'
  );

create temporary table history_results (name text primary key, payload jsonb);
grant select, insert on table history_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into history_results values (
  'first', public.commit_import_batch('b3000000-0000-4000-8000-000000000001')
);
reset role;

-- ---------- One record in, four refused by name ----------

select is(
  (select payload ->> 'created' from history_results where name = 'first'),
  '1',
  'only the line that could become a record became one'
);
select is(
  (select payload ->> 'failed' from history_results where name = 'first'),
  '4',
  'and the other four are reported as failed, each with its own reason'
);

select is(
  (select error_code from public.import_rows
    where batch_id = 'b3000000-0000-4000-8000-000000000001' and row_number = 3),
  'record_date_required',
  'an undated line is refused — it would be filed as today and nothing would flag it'
);
select is(
  (select error_code from public.import_rows
    where batch_id = 'b3000000-0000-4000-8000-000000000001' and row_number = 4),
  'legacy_body_required',
  'a line with no text carries no record'
);
select is(
  (select error_code from public.import_rows
    where batch_id = 'b3000000-0000-4000-8000-000000000001' and row_number = 5),
  'patient_not_found',
  'a patient of another workspace is not reachable, even by explicit id'
);
select is(
  (select error_code from public.import_rows
    where batch_id = 'b3000000-0000-4000-8000-000000000001' and row_number = 6),
  'patient_not_found',
  'and a broken reference fails its own line instead of aborting the import'
);

-- ---------- What the surviving record looks like ----------

select is(
  (select count(*)::integer from public.consultations
    where import_batch_id = 'b3000000-0000-4000-8000-000000000001'),
  1,
  'exactly one consultation was created'
);
select is(
  (select status::text from public.consultations
    where import_batch_id = 'b3000000-0000-4000-8000-000000000001'),
  'finalized',
  'history arrives finalized — it is history, not a draft to continue'
);
select is(
  (select started_at::date::text from public.consultations
    where import_batch_id = 'b3000000-0000-4000-8000-000000000001'),
  '2019-06-14',
  'and keeps the date it actually happened'
);
select is(
  (select legacy_source from public.consultations
    where import_batch_id = 'b3000000-0000-4000-8000-000000000001'),
  'Sistema Anterior',
  'the origin is stamped on the record, so it can be labelled wherever it is read'
);
select ok(
  (
    select summary is null and chief_complaint is null
    from public.consultations where import_batch_id = 'b3000000-0000-4000-8000-000000000001'
  ),
  'the legacy text never leaks into the fields SHE writes'
);
select is(
  (
    select count(*)::integer from public.anamnesis_answers a
    join public.consultations c on c.id = a.consultation_id
    where c.import_batch_id = 'b3000000-0000-4000-8000-000000000001'
  ),
  0,
  'and never becomes anamnesis: a record from another system has no per-field provenance'
);

-- ---------- Re-importing the same file changes nothing ----------

insert into public.import_batches (id, org_id, kind, source_system, status, created_by)
values (
  'b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001',
  'history', 'Sistema Anterior', 'preview', 'b1000000-0000-4000-8000-000000000001'
);
insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values (
  'b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 2, '{}'::jsonb,
  '{"patient_id":"b4000000-0000-4000-8000-000000000001","date":"2019-06-14","body":"Queixa: lombalgia. Conduta: BL23, BL40.","external_ref":"H-1"}'::jsonb,
  'create'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into history_results values (
  'again', public.commit_import_batch('b3000000-0000-4000-8000-000000000002')
);
reset role;

select is(
  (select error_code from public.import_rows
    where batch_id = 'b3000000-0000-4000-8000-000000000002' and row_number = 2),
  'already_imported',
  'the same record sent twice is skipped by name, not duplicated'
);
select is(
  (select count(*)::integer from public.consultations
    where patient_id = 'b4000000-0000-4000-8000-000000000001'),
  1,
  'and the chart still holds exactly one copy of it'
);

select * from finish();
rollback;
