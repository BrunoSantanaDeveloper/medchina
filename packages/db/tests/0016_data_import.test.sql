begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- ============================================================
-- Migration 0076 — importing a practice's records from another system.
--
-- The behaviours asserted here are the ones an import gets wrong silently:
-- an undo that cascades into real clinical work instead of refusing, a
-- provenance stamp that can be moved onto a row nobody imported, legacy text
-- leaking into a record with no batch behind it, and a paywall appearing in
-- front of data entry because the workspace stopped paying.
-- ============================================================

-- ---------- Contracts ----------

select has_table('public', 'import_batches', 'an import is a tracked batch, not a fire-and-forget script');
select has_table('public', 'import_rows', 'and the parsed rows are staged, so preview and commit read the same data');

select ok(
  not has_table_privilege('authenticated', 'public.import_batches', 'DELETE'),
  'a batch is never deleted — it is the provenance of every row it created'
);

select ok(
  to_regprocedure('public.revert_import_batch(uuid)') is not null,
  'undoing an import goes through a guarded RPC, not a raw delete'
);
select ok(
  has_function_privilege('authenticated', 'public.revert_import_batch(uuid)', 'EXECUTE'),
  'the professional can undo her own import'
);
select ok(
  not has_function_privilege('authenticated', 'public.purge_import_staging(integer)', 'EXECUTE'),
  'but retention purging is not hers to trigger'
);
select ok(
  has_function_privilege('service_role', 'public.purge_import_staging(integer)', 'EXECUTE'),
  'it belongs to the nightly job'
);

-- Committing a batch creates patients, which support may never do (0057).
-- Fencing only `patients` would leave the staging tables as the way around it.
select has_trigger(
  'public', 'import_batches', 'guard_impersonation_import_batches',
  'a support session cannot start an import'
);
select has_trigger(
  'public', 'import_rows', 'guard_impersonation_import_rows',
  'nor stage rows for one'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'import@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Acupunturista"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values (
  'f2000000-0000-4000-8000-000000000001', 'Import practice', 'import-practice',
  'f1000000-0000-4000-8000-000000000001'
);

insert into public.memberships (org_id, user_id, role)
values (
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'owner'
)
on conflict do nothing;

create temporary table import_results (name text primary key, payload jsonb);
grant select, insert on table import_results to authenticated, service_role;

-- ---------- Importing is free, and payment state does not gate it ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'allowance-free',
  public.org_import_allowance('f2000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'allowed' from import_results where name = 'allowance-free'),
  'true',
  'the free plan imports — it is what removes the cost of leaving the old system'
);
select is(
  (select payload ->> 'maxRows' from import_results where name = 'allowance-free'),
  '200',
  'with a ceiling per batch that comes from plans.limits, not from code'
);

-- A failed card stops AI work, not data entry. Administrative suspension is
-- the kill switch, and it is the only thing that stops an import.
update public.subscriptions set status = 'past_due', past_due_since = now() - interval '30 days'
where org_id = 'f2000000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'allowance-past-due',
  public.org_import_allowance('f2000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'allowed' from import_results where name = 'allowance-past-due'),
  'true',
  'a workspace deep in dunning still imports its own records'
);

update public.subscriptions set status = 'active', past_due_since = null, admin_suspended = true
where org_id = 'f2000000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'allowance-suspended',
  public.org_import_allowance('f2000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'reason' from import_results where name = 'allowance-suspended'),
  'suspended',
  'an administratively suspended workspace does not, and is told why'
);

update public.subscriptions set admin_suspended = false
where org_id = 'f2000000-0000-4000-8000-000000000001';

-- ---------- Undo of an untouched import ----------

insert into public.import_batches (id, org_id, kind, source_system, status, completed_at, created_by)
values (
  'f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  'patients', 'Planilha', 'completed', now(), 'f1000000-0000-4000-8000-000000000001'
);

insert into public.patients (id, org_id, full_name, external_ref, import_batch_id, created_by)
values (
  'f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  'Paciente Importada', 'legacy-1', 'f3000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'revert-clean',
  public.revert_import_batch('f3000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'patients' from import_results where name = 'revert-clean'),
  '1',
  'an untouched import can be undone, and reports what it removed'
);
select is(
  (select count(*)::integer from public.patients where id = 'f4000000-0000-4000-8000-000000000001'),
  0,
  'the imported patient is gone'
);
select is(
  (select status from public.import_batches where id = 'f3000000-0000-4000-8000-000000000001'),
  'reverted',
  'and the batch records that it was reverted instead of disappearing'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'revert-again',
  public.revert_import_batch('f3000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'code' from import_results where name = 'revert-again'),
  'already_reverted',
  'undoing twice is idempotent, not an error the UI has to explain'
);

-- ---------- Undo REFUSES once the import became part of the practice ----------

insert into public.import_batches (id, org_id, kind, status, completed_at, created_by)
values (
  'f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
  'patients', 'completed', now(), 'f1000000-0000-4000-8000-000000000001'
);

insert into public.patients (id, org_id, full_name, import_batch_id, created_by)
values (
  'f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
  'Paciente Atendida', 'f3000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000001'
);

-- A real consultation opened after the import: deleting the patient would take
-- it with her (on delete cascade), which is exactly the destruction the refusal
-- exists to prevent.
insert into public.consultations (org_id, patient_id, status, created_by)
values (
  'f2000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002',
  'draft', 'f1000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'revert-seen',
  public.revert_import_batch('f3000000-0000-4000-8000-000000000002')
);
reset role;

select is(
  (select payload ->> 'code' from import_results where name = 'revert-seen'),
  'batch_in_use',
  'undo refuses once an imported patient has been seen'
);
select is(
  (select payload -> 'blocked' ->> 'patientsSeen' from import_results where name = 'revert-seen'),
  '1',
  'and names what blocks it, so the screen can say more than "failed"'
);
select is(
  (select count(*)::integer from public.patients where id = 'f4000000-0000-4000-8000-000000000002'),
  1,
  'nothing was deleted on the way to the refusal'
);

-- Edited by hand: created_at is backdated because a test runs in ONE
-- transaction, where now() would make updated_at equal created_at.
insert into public.import_batches (id, org_id, kind, status, completed_at, created_by)
values (
  'f3000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001',
  'patients', 'completed', now(), 'f1000000-0000-4000-8000-000000000001'
);

insert into public.patients (id, org_id, full_name, import_batch_id, created_by, created_at, updated_at)
values (
  'f4000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000001',
  'Paciente Corrigida', 'f3000000-0000-4000-8000-000000000003',
  'f1000000-0000-4000-8000-000000000001', now() - interval '1 hour', now() - interval '1 hour'
);

update public.patients set phone = '11999990000'
where id = 'f4000000-0000-4000-8000-000000000003';

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'revert-edited',
  public.revert_import_batch('f3000000-0000-4000-8000-000000000003')
);
reset role;

select is(
  (select payload -> 'blocked' ->> 'editedPatients' from import_results where name = 'revert-edited'),
  '1',
  'a patient corrected by hand is work, and undo will not throw it away'
);

-- An imported record that received an addendum: the addendum is HER clinical
-- writing, appended to a legacy record. Undo may not take it.
insert into public.import_batches (id, org_id, kind, status, completed_at, created_by)
values (
  'f3000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001',
  'history', 'completed', now(), 'f1000000-0000-4000-8000-000000000001'
);

insert into public.patients (id, org_id, full_name, import_batch_id, created_by)
values (
  'f4000000-0000-4000-8000-000000000004', 'f2000000-0000-4000-8000-000000000001',
  'Paciente Historico', 'f3000000-0000-4000-8000-000000000004',
  'f1000000-0000-4000-8000-000000000001'
);

insert into public.consultations (
  id, org_id, patient_id, status, started_at, finalized_at,
  import_batch_id, legacy_body, legacy_source, created_by
) values (
  'f5000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000004', 'finalized', now() - interval '400 days',
  now() - interval '400 days', 'f3000000-0000-4000-8000-000000000004',
  'Queixa: insonia. Conduta: pontos HT7, SP6.', 'Sistema Anterior',
  'f1000000-0000-4000-8000-000000000001'
);

insert into public.consultation_addenda (org_id, consultation_id, body, created_by)
values (
  'f2000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001',
  'Confirmado com a paciente na consulta seguinte.', 'f1000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'revert-addendum',
  public.revert_import_batch('f3000000-0000-4000-8000-000000000004')
);
reset role;

select is(
  (select payload -> 'blocked' ->> 'recordsWithAddenda' from import_results where name = 'revert-addendum'),
  '1',
  'an imported record she amended is no longer just an import'
);

-- ---------- The provenance stamp cannot be moved ----------

insert into public.patients (id, org_id, full_name, created_by)
values (
  'f4000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000001',
  'Paciente Digitada', 'f1000000-0000-4000-8000-000000000001'
);

select throws_ok(
  $$update public.patients
      set import_batch_id = 'f3000000-0000-4000-8000-000000000002'
      where id = 'f4000000-0000-4000-8000-000000000005'$$,
  '42501',
  'import_provenance_immutable: a patient cannot be relabelled as imported (or un-imported) after creation',
  'a hand-typed patient cannot be relabelled as imported — otherwise an undo could sweep her away'
);

select throws_ok(
  $$update public.consultations
      set legacy_body = 'reescrito'
      where id = 'f5000000-0000-4000-8000-000000000001'$$,
  '42501',
  'import_provenance_immutable: an imported record cannot be edited — append an addendum instead',
  'and an imported record cannot be rewritten — corrections are addenda'
);

select throws_ok(
  $$insert into public.consultations (org_id, patient_id, status, legacy_body, created_by)
    values (
      'f2000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000005',
      'draft', 'texto sem origem', 'f1000000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  'new row for relation "consultations" violates check constraint "consultations_legacy_requires_import"',
  'legacy text with no batch behind it is refused: the origin label must always resolve'
);

-- ---------- A finished batch is finished ----------

select throws_ok(
  $$update public.import_batches set status = 'parsing'
      where id = 'f3000000-0000-4000-8000-000000000002'$$,
  '42501',
  'import_batch_closed: a finished import cannot be reopened',
  'a completed import cannot be reopened under an already approved mapping'
);

select throws_ok(
  $$insert into public.import_rows (batch_id, org_id, row_number, raw)
    values (
      'f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001',
      1, '{"nome":"tardia"}'::jsonb
    )$$,
  '42501',
  'import_batch_closed: the rows of a finished import can no longer change',
  'and rows cannot be staged into it afterwards'
);

-- ---------- Undo only applies to a committed import ----------

insert into public.import_batches (id, org_id, kind, status, created_by)
values (
  'f3000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000001',
  'patients', 'preview', 'f1000000-0000-4000-8000-000000000001'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into import_results values (
  'revert-preview',
  public.revert_import_batch('f3000000-0000-4000-8000-000000000005')
);
reset role;

select is(
  (select payload ->> 'code' from import_results where name = 'revert-preview'),
  'invalid_state',
  'there is nothing to undo in a batch that was never committed'
);

select * from finish();
rollback;
