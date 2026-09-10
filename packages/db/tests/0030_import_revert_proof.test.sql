begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- ============================================================
-- Migration 0097 — what an undo is allowed to take back.
--
-- The proof was wrong in both directions, first found by walking a real
-- incident (a practice that imported its attendances through the patients
-- door) and then by an adversarial review of the first draft of 0097:
--
--   * Gestures that MEAN "this should not be here" — archiving a chart,
--     requesting its deletion, cancelling an appointment — blocked the undo of
--     the whole batch. They are the first thing anyone does when an import goes
--     wrong, one row at a time.
--   * Work on an imported record went unseen: an attended appointment gains
--     children that cascade with it, and a RESCHEDULED one gains none at all
--     while having become her appointment.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'revert@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Acupunturista"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values (
  'e2000000-0000-4000-8000-000000000001', 'Revert practice', 'revert-practice',
  'e1000000-0000-4000-8000-000000000001'
);

insert into public.memberships (org_id, user_id, role)
values (
  'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner'
)
on conflict do nothing;

create temporary table revert_results (name text primary key, payload jsonb);
grant select, insert on table revert_results to authenticated, service_role;

create or replace function pg_temp.revert_as_owner(batch uuid, label text)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
  );
  execute 'set local role authenticated';
  insert into revert_results values (label, public.revert_import_batch(batch));
  execute 'reset role';
end;
$$;

create or replace function pg_temp.new_batch(batch uuid, batch_kind text)
returns void
language sql
as $$
  insert into public.import_batches (id, org_id, kind, status, completed_at, created_by)
  values (
    batch, 'e2000000-0000-4000-8000-000000000001', batch_kind, 'completed', now(),
    'e1000000-0000-4000-8000-000000000001'
  );
$$;

create or replace function pg_temp.new_patient(patient uuid, name text, batch uuid)
returns void
language sql
as $$
  insert into public.patients (id, org_id, full_name, import_batch_id, created_by)
  values (
    patient, 'e2000000-0000-4000-8000-000000000001', name, batch,
    'e1000000-0000-4000-8000-000000000001'
  );
$$;

-- An appointment as the agenda import writes it (0082): scheduled, stamped.
create or replace function pg_temp.new_appointment(consultation uuid, patient uuid, batch uuid)
returns void
language sql
as $$
  insert into public.consultations (
    id, org_id, patient_id, status, started_at, scheduled_for, import_batch_id, created_by
  ) values (
    consultation, 'e2000000-0000-4000-8000-000000000001', patient, 'scheduled',
    date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days',
    batch, 'e1000000-0000-4000-8000-000000000001'
  );
$$;

-- ---------- Archiving an imported chart does not block ----------

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000001', 'patients');
select pg_temp.new_patient(
  'e4000000-0000-4000-8000-000000000001', 'Lixo Importado', 'e3000000-0000-4000-8000-000000000001'
);

-- What she does when she sees the mess. It also bumps updated_at, which is why
-- the old timestamp check could not tell this apart from an edit.
update public.patients
set archived_at = now(), archived_by = 'e1000000-0000-4000-8000-000000000001'
where id = 'e4000000-0000-4000-8000-000000000001';

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000001', 'archived');

select is(
  (select payload ->> 'ok' from revert_results where name = 'archived'),
  'true',
  'archiving an imported chart is her saying it should not be here — it never blocks the undo'
);
select is(
  (select payload ->> 'patients' from revert_results where name = 'archived'),
  '1',
  'and the archived chart is the one the undo removes'
);
select is(
  (select count(*)::text from public.patients where id = 'e4000000-0000-4000-8000-000000000001'),
  '0',
  'the row is gone'
);

-- ---------- A chart she typed into still blocks ----------

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000002', 'patients');
select pg_temp.new_patient(
  'e4000000-0000-4000-8000-000000000002', 'Paciente Real', 'e3000000-0000-4000-8000-000000000002'
);

update public.patients set phone = '11999990000' where id = 'e4000000-0000-4000-8000-000000000002';

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000002', 'edited');

select is(
  (select payload ->> 'code' from revert_results where name = 'edited'),
  'batch_in_use',
  'a chart she completed by hand is work the undo may not take'
);
select is(
  (select payload -> 'blocked' ->> 'editedPatients' from revert_results where name = 'edited'),
  '1',
  'and the refusal names how many'
);

-- ---------- Requesting deletion does not block ----------

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000003', 'patients');
select pg_temp.new_patient(
  'e4000000-0000-4000-8000-000000000003', 'Pedido de Exclusão', 'e3000000-0000-4000-8000-000000000003'
);

-- The exact update the chart's "solicitar exclusão" button makes: three
-- deletion columns and the archive, in one statement. The first draft of 0097
-- exempted only the archive, so the strongest "this is not mine" blocked.
update public.patients
set deletion_requested_at = now(),
    deletion_requested_by = 'e1000000-0000-4000-8000-000000000001',
    deletion_request_reason = 'Importada por engano',
    archived_at = now(),
    archived_by = 'e1000000-0000-4000-8000-000000000001'
where id = 'e4000000-0000-4000-8000-000000000003';

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000003', 'deletion');

select is(
  (select payload ->> 'ok' from revert_results where name = 'deletion'),
  'true',
  'asking for a chart to be deleted is the strongest version of the same gesture'
);

-- ---------- An imported appointment she attended blocks ----------

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000004', 'schedule');
select pg_temp.new_patient('e4000000-0000-4000-8000-000000000004', 'Paciente Atendida', null);
select pg_temp.new_appointment(
  'e5000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-000000000004',
  'e3000000-0000-4000-8000-000000000004'
);

update public.consultations set status = 'in_progress' where id = 'e5000000-0000-4000-8000-000000000004';

-- anamnesis_answers is NOT one of the named blockers: it is found in the
-- catalog, which is what this assertion proves.
insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value)
values (
  'e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000004',
  'complaint', 'onset', 'Há três semanas'
);

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000004', 'attended');

select is(
  (select payload ->> 'code' from revert_results where name = 'attended'),
  'batch_in_use',
  'an imported appointment she has since attended is a real consultation'
);
select is(
  (select payload -> 'blocked' ->> 'recordsChanged' from revert_results where name = 'attended'),
  '1',
  'the record no longer is what the import wrote'
);
select is(
  (select payload -> 'blocked' ->> 'recordsWithClinicalWork' from revert_results where name = 'attended'),
  '1',
  'and the catalog finds the anamnesis that would cascade with it'
);
select is(
  (select count(*)::text from public.anamnesis_answers where consultation_id = 'e5000000-0000-4000-8000-000000000004'),
  '1',
  'nothing was deleted'
);

-- ---------- An imported appointment she rescheduled blocks ----------

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000005', 'schedule');
select pg_temp.new_patient('e4000000-0000-4000-8000-000000000005', 'Paciente Remarcada', null);
select pg_temp.new_appointment(
  'e5000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-000000000005',
  'e3000000-0000-4000-8000-000000000005'
);

-- What save_scheduled_consultation does (0028): still `scheduled`, no child
-- row anywhere — and it is now her appointment, at the time she agreed.
update public.consultations
set scheduled_for = scheduled_for + interval '3 hours',
    started_at = started_at + interval '3 hours'
where id = 'e5000000-0000-4000-8000-000000000005';

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000005', 'rescheduled');

select is(
  (select payload ->> 'code' from revert_results where name = 'rescheduled'),
  'batch_in_use',
  'a rescheduled appointment has no children, and is still hers'
);
select is(
  (select payload -> 'blocked' ->> 'recordsChanged' from revert_results where name = 'rescheduled'),
  '1',
  'found by comparing it with what the import wrote'
);

-- ---------- Cancelling an imported appointment does not block ----------

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000006', 'schedule');
select pg_temp.new_patient('e4000000-0000-4000-8000-000000000006', 'Paciente Cancelada', null);
select pg_temp.new_appointment(
  'e5000000-0000-4000-8000-000000000006', 'e4000000-0000-4000-8000-000000000006',
  'e3000000-0000-4000-8000-000000000006'
);

-- The agenda's only cleanup gesture (cancel_scheduled_consultation, 0041).
-- Cancelling requires `scheduled`, so nothing clinical can exist on the row.
update public.consultations
set status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = 'e1000000-0000-4000-8000-000000000001',
    cancellation_reason = 'Importada por engano',
    cancellation_category = 'other'
where id = 'e5000000-0000-4000-8000-000000000006';

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000006', 'cancelled');

select is(
  (select payload ->> 'ok' from revert_results where name = 'cancelled'),
  'true',
  'a cancelled appointment is the agenda saying "this should not be here"'
);

-- ---------- Untouched records come back out the way they went in ----------

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000007', 'schedule');
select pg_temp.new_patient('e4000000-0000-4000-8000-000000000007', 'Paciente Intocada', null);
select pg_temp.new_appointment(
  'e5000000-0000-4000-8000-000000000007', 'e4000000-0000-4000-8000-000000000007',
  'e3000000-0000-4000-8000-000000000007'
);

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000007', 'untouched-schedule');

-- If any trigger rewrote a consultation right after its insert, EVERY imported
-- record would read as changed and no import could ever be undone.
select is(
  (select payload ->> 'ok' from revert_results where name = 'untouched-schedule'),
  'true',
  'an appointment nobody touched reverts'
);

select pg_temp.new_batch('e3000000-0000-4000-8000-000000000008', 'history');

-- A history row is BORN finalized; that must not read as worked on.
insert into public.consultations (
  id, org_id, patient_id, status, started_at, finalized_at,
  legacy_body, legacy_source, import_batch_id, created_by
) values (
  'e5000000-0000-4000-8000-000000000008', 'e2000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000007', 'finalized', now() - interval '400 days',
  now() - interval '400 days', 'Lombalgia crônica, 1a sessão.', 'Sistema antigo',
  'e3000000-0000-4000-8000-000000000008', 'e1000000-0000-4000-8000-000000000001'
);

select pg_temp.revert_as_owner('e3000000-0000-4000-8000-000000000008', 'history');

select is(
  (select payload ->> 'ok' from revert_results where name = 'history'),
  'true',
  'a legacy record nobody touched reverts'
);

select * from finish();
rollback;
