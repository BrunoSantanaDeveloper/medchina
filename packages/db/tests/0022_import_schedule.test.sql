begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ============================================================
-- Migration 0082 — importing the appointments already booked.
--
-- The assertions are almost all refusals, because an agenda import fails in
-- ways nobody notices until someone is standing at the door: a slot booked
-- twice, an appointment three hours off because a spreadsheet said "14:30",
-- and yesterday's slots filling next week's calendar.
-- ============================================================

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'schedule@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Acupunturista"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by, timezone)
values ('d2000000-0000-4000-8000-000000000001', 'Schedule practice', 'schedule-practice',
        'd1000000-0000-4000-8000-000000000001', 'America/Sao_Paulo');

insert into public.memberships (org_id, user_id, role)
values ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, created_by)
values
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
   'Márcia da Silva', 'd1000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
   'Paciente Arquivada', 'd1000000-0000-4000-8000-000000000001');

update public.patients set archived_at = now() where id = 'd4000000-0000-4000-8000-000000000002';

insert into public.import_batches (id, org_id, kind, source_system, status, created_by)
values (
  'd3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
  'schedule', 'Sistema Anterior', 'preview', 'd1000000-0000-4000-8000-000000000001'
);

insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values
  -- Good appointment.
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 2, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000001","local_datetime":"2030-03-10T14:30","duration":"60","note":"Retorno","external_ref":"S-1"}'::jsonb,
   'create'),
  -- Same slot again: must not double-book, even inside one file.
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 3, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000001","local_datetime":"2030-03-10T15:00","duration":"50","external_ref":"S-2"}'::jsonb,
   'create'),
  -- Yesterday.
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 4, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000001","local_datetime":"2019-03-10T09:00"}'::jsonb,
   'create'),
  -- Archived patient: refused by name, and the import survives it.
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 5, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000002","local_datetime":"2030-04-01T10:00"}'::jsonb,
   'create'),
  -- No time at all.
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 6, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000001"}'::jsonb,
   'create'),
  -- A second, non-conflicting slot: proves the batch keeps going.
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 7, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000001","local_datetime":"2030-03-11T08:00","external_ref":"S-3"}'::jsonb,
   'create');

create temporary table schedule_results (name text primary key, payload jsonb);
grant select, insert on table schedule_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into schedule_results values (
  'first', public.commit_import_batch('d3000000-0000-4000-8000-000000000001')
);
reset role;

select is(
  (select payload ->> 'created' from schedule_results where name = 'first'),
  '2',
  'the two appointments that could be booked were booked'
);
select is(
  (select payload ->> 'failed' from schedule_results where name = 'first'),
  '4',
  'and the other four are reported, each with its own reason'
);

-- ---------- The wall clock belongs to the practice ----------

select is(
  (
    select (scheduled_for at time zone 'America/Sao_Paulo')::text
    from public.consultations where external_ref = 'S-1'
  ),
  '2030-03-10 14:30:00',
  'half past two in the spreadsheet is half past two in her practice — not three hours off'
);
select is(
  (select duration_minutes from public.consultations where external_ref = 'S-1'),
  60,
  'the duration comes from the file'
);
select is(
  (select appointment_note from public.consultations where external_ref = 'S-1'),
  'Retorno',
  'and so does the note'
);
select is(
  (select status::text from public.consultations where external_ref = 'S-1'),
  'scheduled',
  'an imported appointment is an appointment, not a record'
);

-- ---------- Refusals ----------

select is(
  (select error_code from public.import_rows
    where batch_id = 'd3000000-0000-4000-8000-000000000001' and row_number = 3),
  'schedule_conflict',
  'a slot already taken inside the same file is refused, not double-booked'
);
select is(
  (select error_code from public.import_rows
    where batch_id = 'd3000000-0000-4000-8000-000000000001' and row_number = 4),
  'schedule_in_past',
  'yesterday is not an agenda'
);
select is(
  (select error_code from public.import_rows
    where batch_id = 'd3000000-0000-4000-8000-000000000001' and row_number = 5),
  'patient_unavailable',
  'an archived patient is refused by name instead of aborting the whole import'
);
select is(
  (select error_code from public.import_rows
    where batch_id = 'd3000000-0000-4000-8000-000000000001' and row_number = 6),
  'record_date_required',
  'an appointment with no time is not an appointment'
);
select is(
  (select count(*)::integer from public.consultations
    where import_batch_id = 'd3000000-0000-4000-8000-000000000001'),
  2,
  'exactly the two valid rows exist — the refusals wrote nothing'
);

-- ---------- Conflict with what was ALREADY on the calendar ----------

insert into public.import_batches (id, org_id, kind, status, created_by)
values (
  'd3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
  'schedule', 'preview', 'd1000000-0000-4000-8000-000000000001'
);
insert into public.import_rows (batch_id, org_id, row_number, raw, normalized, action)
values
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 2, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000001","local_datetime":"2030-03-10T15:00"}'::jsonb,
   'create'),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 3, '{}'::jsonb,
   '{"patient_id":"d4000000-0000-4000-8000-000000000001","local_datetime":"2030-03-11T08:00","external_ref":"S-3"}'::jsonb,
   'create');

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into schedule_results values (
  'second', public.commit_import_batch('d3000000-0000-4000-8000-000000000002')
);
reset role;

select is(
  (select error_code from public.import_rows
    where batch_id = 'd3000000-0000-4000-8000-000000000002' and row_number = 2),
  'schedule_conflict',
  'and a slot taken by an appointment already on the calendar is refused too'
);
select is(
  (select error_code from public.import_rows
    where batch_id = 'd3000000-0000-4000-8000-000000000002' and row_number = 3),
  'already_imported',
  'while an appointment sent twice is skipped rather than duplicated'
);

select * from finish();
rollback;
