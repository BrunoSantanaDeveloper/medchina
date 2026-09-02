begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ============================================================
-- Migration 0092 — what the clinical merge may and may not touch.
--
-- Three behaviours that can only be proven against the real triggers, because
-- all three are decided inside the RPC while the chart moves underneath it:
--
--   * the professional keeps typing while the audio is processed (the screen
--     invites her to), so consultations.clinical_revision has ALREADY moved by
--     the time the result arrives. That used to be refused outright and the
--     whole transcription was thrown away;
--   * a second recording of the same consultation may refine what the pipeline
--     itself dictated, and may never touch what she wrote or corrected;
--   * the chief complaint is completed only while it is still empty.
--
-- The fixture reproduces the real sequence: the recording snapshots the
-- revision when it is claimed, and the answers are written AFTERWARDS — which
-- is exactly what "she went on writing during Processando…" looks like.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'merge-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Merge Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('d2000000-0000-4000-8000-000000000001', 'Merge practice', 'merge-practice',
        'd1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

update public.plans set limits = limits || '{"audio_minutes": 600}'::jsonb where slug = 'assistente';
update public.subscriptions
set plan_id = (select id from public.plans where slug = 'assistente'),
    status = 'active',
    current_period_start = now() - interval '1 day',
    current_period_end = now() + interval '29 days'
where org_id = 'd2000000-0000-4000-8000-000000000001';

insert into public.patients (id, org_id, full_name, created_by)
values ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Paciente Merge',
        'd1000000-0000-4000-8000-000000000001');

-- No chief complaint yet: nothing in the product could write one.
insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001', 'in_progress', 'd1000000-0000-4000-8000-000000000001');

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select public.set_patient_consent(
  'd3000000-0000-4000-8000-000000000001', 'audio-recording', true, '{"method":"in_person"}'::jsonb
);
select public.set_patient_consent(
  'd3000000-0000-4000-8000-000000000001', 'ai-processing', true, '{"method":"in_person"}'::jsonb
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.transcriptions (id, org_id, mime, status)
values ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'audio/webm', 'ready');

-- The claim stamps the revision as it stands RIGHT NOW.
insert into public.recordings (
  id, org_id, patient_id, consultation_id, status, mode,
  transcription_id, processing_claim_id, processing_clinical_revision, created_by
)
select
  'd6000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
  'processing', 'ai',
  'd5000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001',
  c.clinical_revision, 'd1000000-0000-4000-8000-000000000001'
from public.consultations c where c.id = 'd4000000-0000-4000-8000-000000000001';

-- ...and only now she writes. Every row below bumps clinical_revision, which is
-- precisely the divergence that used to kill the result.
insert into public.anamnesis_answers (
  org_id, consultation_id, block_key, field_key, value, source, state, provenance, created_by
) values
  -- Typed by hand in an ordinary field.
  ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
   'routine', 'sleep', 'Acorda 3h da manhã, sem voltar a dormir', 'professional', 'clear',
   '{}'::jsonb, 'd1000000-0000-4000-8000-000000000001'),
  -- Tongue TYPED by hand: carries professional_voice, but no transcript stamp.
  ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
   'tcm', 'tongue', 'Língua pálida, saburra branca', 'professional_voice', 'clear',
   '{}'::jsonb, 'd1000000-0000-4000-8000-000000000001'),
  -- Pulse DICTATED and written by an earlier run of the pipeline.
  ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
   'tcm', 'pulse', 'Pulso fino', 'professional_voice', 'clear',
   '{"transcriptionId":"d5000000-0000-4000-8000-000000000001"}'::jsonb,
   'd1000000-0000-4000-8000-000000000001'),
  -- An AI draft she CORRECTED. Editing preserves the stamp, so only the state
  -- tells this apart from the row above.
  ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
   'tcm', 'palpation', 'Abdome sem dor à palpação (corrigido por ela)', 'professional_voice', 'edited',
   '{"transcriptionId":"d5000000-0000-4000-8000-000000000001"}'::jsonb,
   'd1000000-0000-4000-8000-000000000001');

select ok(
  (select r.processing_clinical_revision <> c.clinical_revision
   from public.recordings r
   join public.consultations c on c.id = r.consultation_id
   where r.id = 'd6000000-0000-4000-8000-000000000001'),
  'the chart moved while the audio was being processed'
);

create temporary table merge_results (name text primary key, payload jsonb);
grant select, insert on table merge_results to authenticated, service_role;

set local role service_role;

insert into merge_results values (
  'first',
  public.apply_recording_result(
    'd6000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    jsonb_build_array(
      -- Tries to overwrite everything she has on the chart...
      jsonb_build_object('blockKey', 'routine', 'fieldKey', 'sleep',
                         'value', 'Dorme bem', 'source', 'patient_report', 'state', 'clear'),
      jsonb_build_object('blockKey', 'tcm', 'fieldKey', 'tongue',
                         'value', 'Língua vermelha', 'source', 'professional_voice', 'state', 'clear'),
      jsonb_build_object('blockKey', 'tcm', 'fieldKey', 'palpation',
                         'value', 'Dor à palpação epigástrica', 'source', 'professional_voice', 'state', 'clear'),
      -- ...refines what the pipeline itself dictated...
      jsonb_build_object('blockKey', 'tcm', 'fieldKey', 'pulse',
                         'value', 'Pulso fino e profundo, mais fraco à esquerda',
                         'source', 'professional_voice', 'state', 'clear'),
      -- ...and adds a field nobody had filled.
      jsonb_build_object('blockKey', 'routine', 'fieldKey', 'thirst',
                         'value', 'Sede de bebidas quentes', 'source', 'patient_report', 'state', 'clear')
    ),
    '["Investigar sudorese noturna?"]'::jsonb,
    600,
    'Insônia há três meses'
  )
);

reset role;

select ok(
  coalesce(((select payload from merge_results where name = 'first') ->> 'ok')::boolean, false),
  'a chart edited during processing no longer discards the transcription'
);

select is(
  (select payload ->> 'code' from merge_results where name = 'first'),
  'ready',
  'the merge completes instead of failing on a stale revision'
);

select isnt(
  (select payload ->> 'claimRevision' from merge_results where name = 'first'),
  (select payload ->> 'revisionAtApply' from merge_results where name = 'first'),
  'the revision drift is reported for diagnosis instead of being fatal'
);

select is(
  (select status from public.recordings where id = 'd6000000-0000-4000-8000-000000000001'),
  'ready',
  'the recording finishes ready'
);

-- ---------- What she owns is untouched ----------

select is(
  (select value from public.anamnesis_answers
   where consultation_id = 'd4000000-0000-4000-8000-000000000001'
     and block_key = 'routine' and field_key = 'sleep'),
  'Acorda 3h da manhã, sem voltar a dormir',
  'what she typed is never overwritten'
);

select is(
  (select value from public.anamnesis_answers
   where consultation_id = 'd4000000-0000-4000-8000-000000000001'
     and block_key = 'tcm' and field_key = 'tongue'),
  'Língua pálida, saburra branca',
  'an observation she typed by hand is never overwritten'
);

select is(
  (select value from public.anamnesis_answers
   where consultation_id = 'd4000000-0000-4000-8000-000000000001'
     and block_key = 'tcm' and field_key = 'palpation'),
  'Abdome sem dor à palpação (corrigido por ela)',
  'a draft she corrected stays corrected, even though the edit kept the transcript stamp'
);

-- ---------- What the pipeline dictated, it may refine ----------

select is(
  (select value from public.anamnesis_answers
   where consultation_id = 'd4000000-0000-4000-8000-000000000001'
     and block_key = 'tcm' and field_key = 'pulse'),
  'Pulso fino e profundo, mais fraco à esquerda',
  'a later recording refines the finding an earlier one dictated'
);

select is(
  (select provenance ->> 'transcriptionId' from public.anamnesis_answers
   where consultation_id = 'd4000000-0000-4000-8000-000000000001'
     and block_key = 'routine' and field_key = 'thirst'),
  'd5000000-0000-4000-8000-000000000001',
  'a newly drafted field carries the transcript it came from'
);

-- ---------- The chief complaint is completed, never rewritten ----------

select is(
  (select chief_complaint from public.consultations where id = 'd4000000-0000-4000-8000-000000000001'),
  'Insônia há três meses',
  'the chief complaint is filled while it is still empty'
);

insert into public.transcriptions (id, org_id, mime, status)
values ('d5000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'audio/webm', 'ready');

insert into public.recordings (
  id, org_id, patient_id, consultation_id, status, mode,
  transcription_id, processing_claim_id, processing_clinical_revision, created_by
)
select
  'd6000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
  'processing', 'ai',
  'd5000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000002',
  c.clinical_revision, 'd1000000-0000-4000-8000-000000000001'
from public.consultations c where c.id = 'd4000000-0000-4000-8000-000000000001';

set local role service_role;

insert into merge_results values (
  'second',
  public.apply_recording_result(
    'd6000000-0000-4000-8000-000000000002',
    'd5000000-0000-4000-8000-000000000002',
    'd7000000-0000-4000-8000-000000000002',
    '[]'::jsonb,
    '[]'::jsonb,
    300,
    'Dor lombar'
  )
);

reset role;

select is(
  (select chief_complaint from public.consultations where id = 'd4000000-0000-4000-8000-000000000001'),
  'Insônia há três meses',
  'a later recording never rewrites a chief complaint that already exists'
);

select * from finish();
rollback;
