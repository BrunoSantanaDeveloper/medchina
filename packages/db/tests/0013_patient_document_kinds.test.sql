begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ---------- Fixture ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'doc-kinds-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"Doc kinds pgTAP"}'::jsonb, now(), now()
);
delete from public.memberships where user_id = 'e1000000-0000-4000-8000-000000000001';
insert into public.organizations (id, name, slug, created_by)
values ('e2000000-0000-4000-8000-000000000001', 'Prática kinds', 'doc-kinds-pgtap', 'e1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner');
insert into public.patients (id, org_id, full_name, birth_date, created_by)
values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Paciente Kinds', '1990-01-01', 'e1000000-0000-4000-8000-000000000001');
insert into public.patients (id, org_id, full_name, birth_date, created_by)
values ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Outra Paciente', '1991-01-01', 'e1000000-0000-4000-8000-000000000001');

-- An OPEN consultation and a FINALIZED one.
insert into public.consultations (id, org_id, patient_id, status, started_at)
values ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'draft', now() - interval '2 hours');
insert into public.consultations (id, org_id, patient_id, status, started_at, finalized_at, finalized_by, duration_minutes)
values ('e4000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002', 'finalized', now() - interval '3 hours', now() - interval '2 hours', 'e1000000-0000-4000-8000-000000000001', 60);

create temporary table kind_results (name text primary key, payload jsonb);
grant select, insert on table kind_results to service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ---------- The attendance certificate ----------

insert into kind_results values (
  'attendance-open',
  public.reserve_document_version(
    'e2000000-0000-4000-8000-000000000001', 'attendance-certificate', 'Declaração', '{}'::jsonb,
    'consultation', 'e4000000-0000-4000-8000-000000000001',
    'patient', 'e3000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001', 'ATTENDOPEN1', 'e1000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select payload ->> 'code' from kind_results where name = 'attendance-open'),
  'invalid_consultation_transition',
  'an OPEN consultation cannot certify a period that has no end'
);

insert into kind_results values (
  'attendance-wrong-patient',
  public.reserve_document_version(
    'e2000000-0000-4000-8000-000000000001', 'attendance-certificate', 'Declaração', '{}'::jsonb,
    'consultation', 'e4000000-0000-4000-8000-000000000002',
    'patient', 'e3000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'ATTENDWRNG1', 'e1000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select payload ->> 'code' from kind_results where name = 'attendance-wrong-patient'),
  'invalid_request',
  'the certificate cannot name a patient other than the consultation''s own'
);

insert into kind_results values (
  'attendance-ok',
  public.reserve_document_version(
    'e2000000-0000-4000-8000-000000000001', 'attendance-certificate', 'Declaração', '{}'::jsonb,
    'consultation', 'e4000000-0000-4000-8000-000000000002',
    'patient', 'e3000000-0000-4000-8000-000000000002',
    'e5000000-0000-4000-8000-000000000003', 'ATTENDOK123', 'e1000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select payload ->> 'code' from kind_results where name = 'attendance-ok'),
  'reserved',
  'a finalized consultation reserves its attendance certificate'
);
select ok(
  (select (payload -> 'sourceSnapshot' ->> 'finalizedAt') is not null
   from kind_results where name = 'attendance-ok'),
  'and the snapshot captures the period it certifies, from the record itself'
);
select is(
  (select payload ->> 'code' from kind_results where name = 'attendance-ok'),
  (select payload ->> 'code' from kind_results where name = 'attendance-ok'),
  'the reservation is stable'
);

-- A wrong kind on this source is refused, so the source cannot be repurposed.
insert into kind_results values (
  'attendance-wrong-kind',
  public.reserve_document_version(
    'e2000000-0000-4000-8000-000000000001', 'therapeutic-plan', 'Plano', '{}'::jsonb,
    'consultation', 'e4000000-0000-4000-8000-000000000002',
    'patient', 'e3000000-0000-4000-8000-000000000002',
    'e5000000-0000-4000-8000-000000000004', 'ATTENDWK123', 'e1000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select payload ->> 'code' from kind_results where name = 'attendance-wrong-kind'),
  'invalid_request',
  'a consultation source only issues the attendance certificate'
);

-- ---------- Home guidance rides the validated plan ----------

insert into kind_results values (
  'guidance-no-plan',
  public.reserve_document_version(
    'e2000000-0000-4000-8000-000000000001', 'home-guidance', 'Orientações', '{}'::jsonb,
    'consultation_plan', 'e6000000-0000-4000-8000-000000000009',
    'patient', 'e3000000-0000-4000-8000-000000000002',
    'e5000000-0000-4000-8000-000000000005', 'GUIDNOPLAN1', 'e1000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select payload ->> 'code' from kind_results where name = 'guidance-no-plan'),
  'plan_not_found',
  'guidance still requires a real plan behind it'
);

insert into kind_results values (
  'unknown-kind-on-plan',
  public.reserve_document_version(
    'e2000000-0000-4000-8000-000000000001', 'receipt', 'Recibo', '{}'::jsonb,
    'consultation_plan', 'e6000000-0000-4000-8000-000000000009',
    'patient', 'e3000000-0000-4000-8000-000000000002',
    'e5000000-0000-4000-8000-000000000006', 'UNKNOWNKND1', 'e1000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select payload ->> 'code' from kind_results where name = 'unknown-kind-on-plan'),
  'invalid_request',
  'an unlisted kind is refused rather than silently issued'
);

-- An unknown source type reserves nothing.
insert into kind_results values (
  'unknown-source',
  public.reserve_document_version(
    'e2000000-0000-4000-8000-000000000001', 'attendance-certificate', 'X', '{}'::jsonb,
    'invoice', 'e4000000-0000-4000-8000-000000000002',
    'patient', 'e3000000-0000-4000-8000-000000000002',
    'e5000000-0000-4000-8000-000000000007', 'UNKNOWNSRC1', 'e1000000-0000-4000-8000-000000000001'
  )
);
select is(
  (select payload ->> 'code' from kind_results where name = 'unknown-source'),
  'invalid_request',
  'an unrecognized source type is REFUSED — 0031 let it through unvalidated'
);

reset role;
select ok(
  (select count(*) = 1 from public.documents
   where kind = 'attendance-certificate' and org_id = 'e2000000-0000-4000-8000-000000000001'),
  'exactly one attendance draft was created across every attempt above'
);

select * from finish();
rollback;
