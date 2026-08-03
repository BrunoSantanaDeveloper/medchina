begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ---------- Contract ----------

select ok(
  exists(select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'consultations' and column_name = 'reminder_marked_at'),
  'the reminder mark is persisted on the appointment'
);
select ok(
  to_regprocedure('public.mark_appointment_reminder(uuid,boolean)') is not null
  and has_function_privilege('authenticated', 'public.mark_appointment_reminder(uuid,boolean)', 'EXECUTE'),
  'the professional can mark her own reminder run'
);
select ok(
  not has_function_privilege('anon', 'public.mark_appointment_reminder(uuid,boolean)', 'EXECUTE'),
  'anon cannot touch it'
);
-- The name is the contract: this records a CLICK, never a delivery.
select ok(
  not exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'consultations' and column_name = 'reminder_sent_at'),
  'nothing here claims the reminder was delivered'
);

-- ---------- Fixture ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'reminders-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"Reminders pgTAP"}'::jsonb, now(), now()
);
delete from public.memberships where user_id = 'f1000000-0000-4000-8000-000000000001';
insert into public.organizations (id, name, slug, created_by)
values ('f2000000-0000-4000-8000-000000000001', 'Prática lembretes', 'reminders-pgtap', 'f1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'owner');
insert into public.patients (id, org_id, full_name, birth_date, created_by)
values ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Paciente Lembrete', '1990-01-01', 'f1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, scheduled_for)
values ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'scheduled', now() + interval '1 day');
insert into public.consultations (id, org_id, patient_id, status, started_at, finalized_at, finalized_by)
values ('f4000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'finalized', now() - interval '2 hours', now() - interval '1 hour', 'f1000000-0000-4000-8000-000000000001');

create temporary table reminder_results (name text primary key, payload jsonb);
grant select, insert on table reminder_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- ---------- Behavior ----------

set local role authenticated;
insert into reminder_results values (
  'mark',
  public.mark_appointment_reminder('f4000000-0000-4000-8000-000000000001', true)
);
reset role;
select is((select payload ->> 'code' from reminder_results where name = 'mark'), 'marked', 'a scheduled appointment can be marked');
select ok(
  (select reminder_marked_at is not null and reminder_marked_by = 'f1000000-0000-4000-8000-000000000001'
   from public.consultations where id = 'f4000000-0000-4000-8000-000000000001'),
  'the mark records who did it, for her own run'
);
select ok(
  exists(select 1 from public.audit_events
         where action = 'appointment.reminder.marked'
           and entity_id = 'f4000000-0000-4000-8000-000000000001'),
  'and lands in the audit trail in the same transaction'
);

-- She can take it back: the only source of truth is her memory of sending.
set local role authenticated;
insert into reminder_results values (
  'unmark',
  public.mark_appointment_reminder('f4000000-0000-4000-8000-000000000001', false)
);
reset role;
select ok(
  (select reminder_marked_at is null from public.consultations where id = 'f4000000-0000-4000-8000-000000000001'),
  'unmarking clears it, because a click is not proof she sent anything'
);

-- Reminding about a consultation that already happened is noise.
set local role authenticated;
insert into reminder_results values (
  'finalized',
  public.mark_appointment_reminder('f4000000-0000-4000-8000-000000000002', true)
);
reset role;
select is(
  (select payload ->> 'code' from reminder_results where name = 'finalized'),
  'not_an_appointment',
  'only a still-scheduled appointment carries a reminder'
);

select * from finish();
rollback;
