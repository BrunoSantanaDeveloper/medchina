begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ============================================================
-- Migration 0059 — the AI feedback signal, and the moxibustion checklist.
--
-- Tested in the DATABASE because that is where the guarantees live. What is
-- hunted here:
--
--   * the professional's correction of an AI draft being LOST, which is what
--     happened before: the value was overwritten in place, the provenance was
--     blanked, and `original_value` (a column that has existed since 0020) was
--     never written by anything;
--   * a REJECTED field coming back from the dead on the next reprocessing,
--     because deleting the row erased the evidence that she had decided;
--   * the chart being polluted in the name of keeping that evidence — a field
--     she cleared must still have NO row (PRD §10.5);
--   * a hand-typed field being mistaken for an AI draft and vice versa;
--   * moxibustion validating (and therefore becoming a signed PDF) with an
--     empty contraindication checklist, which the generation path prevented
--     and the validation path did not.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'feedback-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Feedback Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('e2000000-0000-4000-8000-000000000001', 'Feedback practice', 'feedback-practice',
        'e1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

-- One active clinical consultation per patient (0029), so each scenario gets
-- its own person.
insert into public.patients (id, org_id, full_name, created_by)
values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Paciente Extração',
        'e1000000-0000-4000-8000-000000000001'),
       ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Paciente Plano',
        'e1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
        'e3000000-0000-4000-8000-000000000001', 'awaiting_review', 'e1000000-0000-4000-8000-000000000001');

-- An AI-drafted answer, shaped exactly as apply_recording_result writes one:
-- the transcription id in the provenance is what marks it as the model's.
insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value, source, state, provenance, created_by)
values (
  'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
  'routine', 'sleep', 'dorme mal, acorda 3h', 'patient_report', 'clear',
  jsonb_build_object('quote', 'durmo mal', 'start', '01:20', 'speaker', 'Speaker 2',
                     'transcriptionId', 'e5000000-0000-4000-8000-000000000001'),
  'e1000000-0000-4000-8000-000000000001'
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}';

-- ---------- Editing an AI draft ----------

select is(
  (select public.save_consultation_answer(
     'e4000000-0000-4000-8000-000000000001',
     (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
     'routine', 'sleep', 'insônia de manutenção, desperta às 3h', 'professional', 'clear'
   ) ->> 'state'),
  'edited',
  'the database decides the state: touching an AI draft is always an edit, whatever the client sent'
);

select is(
  (select original_value from public.anamnesis_answers
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  'dorme mal, acorda 3h',
  'the model''s own wording is preserved in original_value'
);

select isnt(
  (select provenance ->> 'quote' from public.anamnesis_answers
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  null,
  'the transcript excerpt survives the correction — a correction is a second reading of the same moment'
);

select is(
  (select decision from public.ai_answer_decisions
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  'edited',
  'the decision is recorded'
);

-- A second edit must not rewrite history: the correction is still OF THE MODEL.
select ok(
  (public.save_consultation_answer(
     'e4000000-0000-4000-8000-000000000001',
     (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
     'routine', 'sleep', 'insônia intermediária', 'professional', 'clear'
   ) ->> 'ok')::boolean,
  'a second correction of the same field saves'
);

select is(
  (select original_value from public.anamnesis_answers
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  'dorme mal, acorda 3h',
  'a second correction does not clobber the original draft'
);

select is(
  (select ai_value from public.ai_answer_decisions
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  'dorme mal, acorda 3h',
  'nor does it clobber the draft recorded on the decision'
);

-- ---------- Rejecting an AI draft ----------

select ok(
  (public.save_consultation_answer(
     'e4000000-0000-4000-8000-000000000001',
     (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
     'routine', 'sleep', '', 'professional', 'clear'
   ) ->> 'ok')::boolean,
  'clearing an AI-drafted field succeeds'
);

select is(
  (select count(*)::int from public.anamnesis_answers
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  0,
  'a cleared field keeps NO row — absence is never stored as an answer (PRD §10.5)'
);

select is(
  (select decision from public.ai_answer_decisions
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  'rejected',
  'the rejection outlives the row it deleted'
);

select is(
  (select final_value from public.ai_answer_decisions
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'sleep'),
  null,
  'a rejection has no replacement value'
);

-- ---------- A hand-typed field is not an AI draft ----------

select is(
  (select public.save_consultation_answer(
     'e4000000-0000-4000-8000-000000000001',
     (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
     'routine', 'thirst', 'sede normal', 'professional', 'clear'
   ) ->> 'state'),
  'clear',
  'a field she typed herself stays clear — it corrected nothing'
);

select is(
  (select count(*)::int from public.ai_answer_decisions
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'thirst'),
  0,
  'and produces no AI decision'
);

select is(
  (select provenance from public.anamnesis_answers
    where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'thirst'),
  '{}'::jsonb,
  'and never inherits a provenance it does not have'
);

-- ---------- Reprocessing never resurrects a rejected field ----------
-- Reaching apply_recording_result_without_usage needs a claimed recording, so
-- the fence is asserted directly against the decision it consults: the row is
-- what the RPC checks, and it is still there after the delete.

select is(
  (select count(*)::int from public.ai_answer_decisions
    where consultation_id = 'e4000000-0000-4000-8000-000000000001'
      and block_key = 'routine' and field_key = 'sleep' and decision = 'rejected'),
  1,
  'the fence reprocessing consults survives the deletion of the answer'
);

reset role;

-- ---------- Moxibustion validates only with its checklist ----------

insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('e4000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
        'e3000000-0000-4000-8000-000000000002', 'awaiting_review', 'e1000000-0000-4000-8000-000000000001');

insert into public.consultation_plans (
  id, org_id, consultation_id, objective, modalities, safety_flags, sources, status, origin, input_revision
) values (
  'e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000002', 'Reduzir dor lombar',
  jsonb_build_object('moxibustion', jsonb_build_object(
    'enabled', true, 'technique', 'bastão', 'contraindicationChecklist', '[]'::jsonb)),
  '[]'::jsonb, '[]'::jsonb, 'draft', 'manual',
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000002')
);

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}';

select is(
  (select public.validate_consultation_plan(
     'e6000000-0000-4000-8000-000000000001',
     (select updated_at from public.consultation_plans where id = 'e6000000-0000-4000-8000-000000000001'),
     true, '{}'::jsonb
   ) ->> 'code'),
  'moxibustion_checklist_required',
  'moxibustion cannot be validated with an empty contraindication checklist (PRD §10.9)'
);

select is(
  (select status::text from public.consultation_plans where id = 'e6000000-0000-4000-8000-000000000001'),
  'draft',
  'and the refused plan stays a draft, so no document can be issued from it'
);

reset role;

update public.consultation_plans
set modalities = jsonb_build_object('moxibustion', jsonb_build_object(
      'enabled', true, 'technique', 'bastão',
      'contraindicationChecklist', jsonb_build_array('Verificar gestação', 'Verificar sensibilidade local')))
where id = 'e6000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}';

select is(
  (select (public.validate_consultation_plan(
     'e6000000-0000-4000-8000-000000000001',
     (select updated_at from public.consultation_plans where id = 'e6000000-0000-4000-8000-000000000001'),
     true, '{}'::jsonb
   ) ->> 'ok')::boolean),
  true,
  'and validates normally once the checklist exists'
);

select is(
  (select status::text from public.consultation_plans where id = 'e6000000-0000-4000-8000-000000000001'),
  'validated',
  'the plan is validated'
);

reset role;

select * from finish();
rollback;
