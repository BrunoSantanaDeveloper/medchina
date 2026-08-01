begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ============================================================
-- Migration 0057 — the support-impersonation write fence.
--
-- This has to be tested in the DATABASE rather than in the app, because that
-- is where it lives and why: clinical writes leave the browser straight for
-- PostgREST, so an app-side guard would never see them. What is hunted here:
--
--   * a support session writing clinical content, consent or patient data;
--   * the agenda being taken down with it (a scheduled appointment IS a
--     consultation row, so consultations cannot be fenced wholesale);
--   * the fence LIFTING when the visit ends or expires — which would silently
--     promote a stale support session into a full-privilege session of the
--     professional, the exact opposite of what expiring it is for.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'fence-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Fence Owner"}'::jsonb, now(), now()
), (
  'd1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'fence-operator@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Fence Operator"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('d2000000-0000-4000-8000-000000000001', 'Fence practice', 'fence-practice',
        'd1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

-- Two patients: only one active clinical consultation is allowed per patient
-- (0029), so the scheduled appointment and the clinical draft need different
-- people.
insert into public.patients (id, org_id, full_name, created_by)
values ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Paciente Agenda',
        'd1000000-0000-4000-8000-000000000001'),
       ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Paciente Prontuário',
        'd1000000-0000-4000-8000-000000000001');

-- Created OUTSIDE any support session: no session_id claim is set yet.
insert into public.consultations (id, org_id, patient_id, status, started_at, scheduled_for, created_by)
values ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001', 'scheduled',
        now() + interval '2 days', now() + interval '2 days', 'd1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('d4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002', 'draft', 'd1000000-0000-4000-8000-000000000001');

insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value, created_by)
values ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002',
        'complaint', 'onset', 'há 3 dias', 'd1000000-0000-4000-8000-000000000001');

-- The record the app writes with the service role when support enters.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('d1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001',
        'd2000000-0000-4000-8000-000000000001', 'ticket 1234 investigation',
        'd5000000-0000-4000-8000-000000000001', now() + interval '30 minutes');

-- ---------- A normal session is untouched ----------

set local request.jwt.claims = '{"role":"authenticated","session_id":"d9000000-0000-4000-8000-000000000009"}';

select ok(not public.is_impersonated(), 'a normal session is not fenced');
select lives_ok(
  $$update public.anamnesis_answers set value = 'editado pela profissional'
    where consultation_id = 'd4000000-0000-4000-8000-000000000002'$$,
  'the professional still writes her own clinical record'
);

-- ---------- Inside the visit ----------

set local request.jwt.claims = '{"role":"authenticated","session_id":"d5000000-0000-4000-8000-000000000001"}';

select ok(public.is_impersonated(), 'the registered support session is recognized');
select ok(public.impersonation_active(), 'and is inside its window');

-- Clinical content, consent and the patient registry: refused.
select throws_ok(
  $$update public.anamnesis_answers set value = 'reescrito pelo suporte'
    where consultation_id = 'd4000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'support cannot rewrite an anamnesis answer'
);
select throws_ok(
  $$insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value)
    values ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002',
            'complaint', 'duration', 'inventado')$$,
  '42501',
  null,
  'support cannot add an anamnesis answer'
);
select throws_ok(
  $$insert into public.patients (org_id, full_name)
    values ('d2000000-0000-4000-8000-000000000001', 'Paciente do suporte')$$,
  '42501',
  null,
  'support cannot create a patient'
);
select throws_ok(
  $$update public.patients set full_name = 'renomeado'
    where id = 'd3000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'support cannot edit a patient'
);
select throws_ok(
  $$update public.consultations set summary = 'resumo escrito pelo suporte'
    where id = 'd4000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'support cannot write a clinical field on a consultation'
);
select throws_ok(
  $$update public.consultations set status = 'in_progress'
    where id = 'd4000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'support cannot start a consultation'
);
select throws_ok(
  $$update public.consultations set started_at = now()
    where id = 'd4000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'support cannot touch a consultation that is already a clinical record'
);
select throws_ok(
  $$delete from public.consultations where id = 'd4000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'support cannot delete a consultation'
);

-- The agenda is the decided exception and must keep working.
select lives_ok(
  $$update public.consultations
    set scheduled_for = now() + interval '3 days', started_at = now() + interval '3 days', duration_minutes = 60
    where id = 'd4000000-0000-4000-8000-000000000001'$$,
  'support can reschedule an appointment'
);

-- Telemetry is dropped silently, never raised: trackProductEvent is
-- fire-and-forget, and a support visit must not count as product usage.
insert into public.product_events (org_id, actor_id, event_name)
values ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'library.message_sent');
select is(
  (select count(*) from public.product_events where org_id = 'd2000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a support visit writes no product telemetry'
);

-- ---------- After the visit ends ----------

update public.impersonation_sessions
set ended_at = now(), ended_reason = 'operator', expires_at = now() - interval '1 minute'
where session_id = 'd5000000-0000-4000-8000-000000000001';

select ok(not public.impersonation_active(), 'an ended visit is no longer active');
select throws_ok(
  $$update public.anamnesis_answers set value = 'reescrito depois de expirar'
    where consultation_id = 'd4000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'the fence does NOT lift when the visit expires — the session is fenced for good'
);

select * from finish();
rollback;
