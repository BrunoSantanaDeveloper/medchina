begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ============================================================
-- Migration 0114 — what started the trial, said truthfully.
--
-- `started_via` is the funnel's answer to "what converts". The guided
-- onboarding's explicit start had no value of its own, and the recorder's
-- confirmation wrote 'other' because it went through the one-arg overload.
-- Each case below starts a trial the way the product does and reads back the
-- origin that was recorded.
-- ============================================================

-- ---------- Structure ----------

select ok(
  position('onboarding' in (
    select pg_get_constraintdef(oid) from pg_constraint where conname = 'pro_trials_started_via_check'
  )) > 0,
  'the guided onboarding is an origin of its own'
);
select ok(
  position('''recorder''' in (
    select prosrc from pg_proc
    where oid = 'public.begin_clinical_recording(uuid,text,uuid,boolean,text)'::regprocedure
  )) > 0,
  'the recorder''s trial start names its origin instead of delegating to the catch-all'
);

-- ---------- Fixtures: one professional per trial (one promotion each) ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'origin-guide@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"Guide"}'::jsonb, now(), now()),
  ('d1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'origin-recorder@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"Recorder"}'::jsonb, now(), now()),
  ('d1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'origin-unknown@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"Unknown"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('d2000000-0000-4000-8000-000000000001', 'Guide practice', 'origin-guide-practice',
   'd1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002', 'Recorder practice', 'origin-recorder-practice',
   'd1000000-0000-4000-8000-000000000002'),
  ('d2000000-0000-4000-8000-000000000003', 'Unknown practice', 'origin-unknown-practice',
   'd1000000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'owner'),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'owner'),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, created_by)
values ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'Paciente Origem',
        'd1000000-0000-4000-8000-000000000002');
insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002',
        'd3000000-0000-4000-8000-000000000001', 'draft', 'd1000000-0000-4000-8000-000000000002');

create temporary table origin_results (name text primary key, payload jsonb);
grant select, insert on table origin_results to authenticated, service_role;

-- ---------- The guide's "Ativar teste Pro" ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into origin_results values
  ('guide', public.start_pro_trial('d2000000-0000-4000-8000-000000000001', 'onboarding'));
reset role;

select is(
  (select (payload ->> 'trial_started')::boolean from origin_results where name = 'guide'),
  true,
  'the guide''s explicit start is a real start'
);
select is(
  (select started_via from public.pro_trials where org_id = 'd2000000-0000-4000-8000-000000000001'),
  'onboarding',
  'and it is recorded as the onboarding''s, not the catch-all'
);

-- ---------- The recorder's confirmation, through the real capture start ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
select public.set_patient_consent(
  'd3000000-0000-4000-8000-000000000001', 'audio-recording', true, '{"method":"in_person"}'::jsonb
);
select public.set_patient_consent(
  'd3000000-0000-4000-8000-000000000001', 'ai-processing', true, '{"method":"in_person"}'::jsonb
);
insert into origin_results values (
  'recorder',
  public.begin_clinical_recording(
    'd4000000-0000-4000-8000-000000000001', 'ai', 'd5000000-0000-4000-8000-000000000001', true, 'web'
  )
);
reset role;

select is(
  (select payload ->> 'code' from origin_results where name = 'recorder'),
  'created',
  'the capture starts, with the trial it started'
);
select is(
  (select started_via from public.pro_trials where org_id = 'd2000000-0000-4000-8000-000000000002'),
  'recorder',
  'a trial the recorder starts says so — the cut docs/FUNIL.md segments by'
);
select is(
  (select t.started_at from public.pro_trials t where t.org_id = 'd2000000-0000-4000-8000-000000000002'),
  (select r.created_at from public.recordings r where r.consultation_id = 'd4000000-0000-4000-8000-000000000001'),
  'trial and recording share one transaction timestamp — the trace the 0114 backfill relies on'
);

-- ---------- An origin outside the list ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;
insert into origin_results values
  ('unknown', public.start_pro_trial('d2000000-0000-4000-8000-000000000003', 'banner'));
reset role;

select is(
  (select started_via from public.pro_trials where org_id = 'd2000000-0000-4000-8000-000000000003'),
  'other',
  'an unknown origin is still the catch-all, never an error that would cost her the trial'
);

select * from finish();
rollback;
