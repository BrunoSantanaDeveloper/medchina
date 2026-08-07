begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ============================================================
-- Migration 0077 — writing an approved patient import.
--
-- The rules asserted here are the ones a spreadsheet breaks silently: an
-- empty cell that clears a field, a re-import that reverts corrections she
-- typed, a partial write nobody can tell apart from a complete one, and a
-- ceiling that is documented but not enforced.
-- ============================================================

select ok(
  to_regprocedure('public.commit_import_batch(uuid)') is not null,
  'committing an import goes through one transactional RPC'
);
select ok(
  not has_function_privilege('anon', 'public.commit_import_batch(uuid)', 'EXECUTE'),
  'anonymous callers cannot reach it'
);
select has_column('public', 'import_rows', 'warnings', 'a staged row records what it could not bring in');

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'commit@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Acupunturista"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values (
  'a2000000-0000-4000-8000-000000000001', 'Commit practice', 'commit-practice',
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.memberships (org_id, user_id, role)
values (
  'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner'
)
on conflict do nothing;

create temporary table commit_results (name text primary key, payload jsonb);
grant select, insert on table commit_results to authenticated, service_role;

-- ---------- A prepared batch: one good row, one nameless, one skipped ----------

insert into public.import_batches (id, org_id, kind, status, source_system, created_by)
values (
  'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
  'patients', 'preview', 'Planilha', 'a1000000-0000-4000-8000-000000000001'
);

insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values
  (
    'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 2,
    '{"Nome":"Márcia"}'::jsonb,
    '{"full_name":"Márcia da Silva","birth_date":"1985-04-03","phone":"11999990000","external_ref":"A-10"}'::jsonb,
    'create'
  ),
  (
    'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 3,
    '{"Nome":""}'::jsonb, '{"phone":"11888887777"}'::jsonb, 'create'
  ),
  (
    'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 4,
    '{"Nome":"Márcia"}'::jsonb, '{"full_name":"Márcia da Silva"}'::jsonb, 'skip'
  );

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into commit_results values (
  'first', public.commit_import_batch('a3000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'created' from commit_results where name = 'first'),
  '1',
  'the row with a name became a patient'
);
select is(
  (select payload ->> 'failed' from commit_results where name = 'first'),
  '1',
  'the nameless row is reported as failed, not quietly dropped'
);
select is(
  (select payload ->> 'skipped' from commit_results where name = 'first'),
  '1',
  'and a row the preview skipped stays skipped'
);

select is(
  (select count(*)::integer from public.patients
    where org_id = 'a2000000-0000-4000-8000-000000000001'),
  1,
  'exactly one patient exists — a nameless line never becomes a chart'
);
select is(
  (select external_ref from public.patients where org_id = 'a2000000-0000-4000-8000-000000000001'),
  'A-10',
  'the old system id came across as the idempotency key'
);
select is(
  (select import_batch_id from public.patients where external_ref = 'A-10'),
  'a3000000-0000-4000-8000-000000000001'::uuid,
  'and the row is stamped with the batch that created it'
);
select is(
  (select action from public.import_rows
    where batch_id = 'a3000000-0000-4000-8000-000000000001' and row_number = 3),
  'error',
  'the staged row records why it did not import'
);
select is(
  (select status from public.import_batches where id = 'a3000000-0000-4000-8000-000000000001'),
  'completed',
  'the batch closes'
);

-- A retry whose first response was lost must not import everything twice.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into commit_results values (
  'again', public.commit_import_batch('a3000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'code' from commit_results where name = 'again'),
  'already_committed',
  'committing twice is idempotent'
);
select is(
  (select count(*)::integer from public.patients
    where org_id = 'a2000000-0000-4000-8000-000000000001'),
  1,
  'and creates nothing the second time'
);

-- ---------- An update FILLS; it never overwrites ----------

insert into public.patients (id, org_id, full_name, phone, external_ref, created_by)
values (
  'a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
  'Ana Prado', '11777776666', 'B-20', 'a1000000-0000-4000-8000-000000000001'
);

insert into public.import_batches (id, org_id, kind, status, created_by)
values (
  'a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001',
  'patients', 'preview', 'a1000000-0000-4000-8000-000000000001'
);

insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values (
  'a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 2,
  '{"Nome":"Ana"}'::jsonb,
  '{"full_name":"Ana Prado","phone":"11000000000","email":"ana@exemplo.com","external_ref":"B-20"}'::jsonb,
  'update'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into commit_results values (
  'update', public.commit_import_batch('a3000000-0000-4000-8000-000000000002')
);
reset role;

select is(
  (select payload ->> 'updated' from commit_results where name = 'update'),
  '1',
  'a matched patient is updated rather than duplicated'
);
select is(
  (select phone from public.patients where id = 'a4000000-0000-4000-8000-000000000001'),
  '11777776666',
  'the phone already in the chart survives — re-importing last month export must not revert her corrections'
);
select is(
  (select email from public.patients where id = 'a4000000-0000-4000-8000-000000000001'),
  'ana@exemplo.com',
  'but an empty field is filled, which is the point of updating'
);
select is(
  (select count(*)::integer from public.patients
    where org_id = 'a2000000-0000-4000-8000-000000000001'),
  2,
  'and no second Ana was created'
);

-- ---------- The ceiling is enforced, not documented ----------

update public.plans set limits = limits || '{"import_rows": 1}'::jsonb where slug = 'gratuito';

insert into public.import_batches (id, org_id, kind, status, created_by)
values (
  'a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001',
  'patients', 'preview', 'a1000000-0000-4000-8000-000000000001'
);
insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 2,
   '{}'::jsonb, '{"full_name":"Paciente Um"}'::jsonb, 'create'),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 3,
   '{}'::jsonb, '{"full_name":"Paciente Dois"}'::jsonb, 'create');

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into commit_results values (
  'limit', public.commit_import_batch('a3000000-0000-4000-8000-000000000003')
);
reset role;

select is(
  (select payload ->> 'code' from commit_results where name = 'limit'),
  'row_limit_exceeded',
  'a batch over the plan ceiling is refused'
);
select is(
  (select count(*)::integer from public.patients
    where org_id = 'a2000000-0000-4000-8000-000000000001'),
  2,
  'and refusing writes nothing at all — there is no half import'
);

update public.plans set limits = limits || '{"import_rows": 200}'::jsonb where slug = 'gratuito';

-- ---------- A kind the writer does not know cannot even be created ----------
-- All three kinds now have writers (patients 0077, history 0080, schedule
-- 0082), so the protection that used to live in `commit_import_batch` — never
-- fall through to the patients branch and create people out of appointment
-- rows — is asserted where it now sits: the batch itself refuses a kind
-- nothing can write.

select throws_ok(
  $$insert into public.import_batches (org_id, kind, status, created_by)
    values (
      'a2000000-0000-4000-8000-000000000001', 'agenda', 'preview',
      'a1000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  'new row for relation "import_batches" violates check constraint "import_batches_kind_check"',
  'a batch of a kind no writer understands is refused at creation'
);

-- ---------- Suspension is the one thing that stops an import ----------

update public.subscriptions set admin_suspended = true
where org_id = 'a2000000-0000-4000-8000-000000000001';

insert into public.import_batches (id, org_id, kind, status, created_by)
values (
  'a3000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001',
  'patients', 'preview', 'a1000000-0000-4000-8000-000000000001'
);
insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values ('a3000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 2,
        '{}'::jsonb, '{"full_name":"Suspensa"}'::jsonb, 'create');

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into commit_results values (
  'suspended', public.commit_import_batch('a3000000-0000-4000-8000-000000000005')
);
reset role;

select is(
  (select payload ->> 'reason' from commit_results where name = 'suspended'),
  'suspended',
  'an administratively suspended workspace cannot commit, and is told why'
);

select * from finish();
rollback;
