begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into public.organizations (id, name, slug)
values ('10000000-0000-4000-8000-000000000001', 'Workflow test practice', 'workflow-test-practice');

update public.organizations
set audio_retention = 'thirty_days'
where id = '10000000-0000-4000-8000-000000000001';

insert into public.transcriptions (id, org_id, audio_path, mime, status)
values ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'retention-test.webm', 'audio/webm', 'pending');

select is(
  (select retention_policy from public.transcriptions where id = '11000000-0000-4000-8000-000000000001'),
  'thirty_days',
  'a transcription snapshots the practice retention policy'
);
select ok(
  (select retain_until between now() + interval '29 days' and now() + interval '31 days' from public.transcriptions where id = '11000000-0000-4000-8000-000000000001'),
  'thirty-day retention records a concrete due date'
);

update public.organizations
set audio_retention = 'manual'
where id = '10000000-0000-4000-8000-000000000001';

insert into public.transcriptions (id, org_id, audio_path, mime, status)
values ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'manual-test.webm', 'audio/webm', 'pending');

select is(
  (select retention_policy from public.transcriptions where id = '11000000-0000-4000-8000-000000000002'),
  'manual',
  'a later transcription snapshots a changed practice policy'
);
select ok(
  (select retain_until is null and not delete_audio_after from public.transcriptions where id = '11000000-0000-4000-8000-000000000002'),
  'manual retention has no automatic deletion deadline'
);

insert into public.patients (id, org_id, full_name)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Scheduled patient'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Finalized patient'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Restored appointment'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Cancelled draft'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Move source'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'Move destination');

set local role authenticated;
select is(
  (select count(*) from public.patients where org_id = '10000000-0000-4000-8000-000000000001'),
  0::bigint,
  'an authenticated principal without membership cannot read another practice'
);
select throws_like(
  $$insert into public.patients (org_id, full_name)
    values ('10000000-0000-4000-8000-000000000001', 'Unauthorized patient')$$,
  '%row-level security%',
  'an authenticated principal without membership cannot create clinical data'
);
reset role;

select lives_ok(
  $$insert into public.consultations (id, org_id, patient_id, status, scheduled_for)
    values
      ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'scheduled', '2030-01-10T12:00:00Z'),
      ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'scheduled', '2030-01-17T12:00:00Z')$$,
  'a patient may have multiple future appointments'
);

select throws_like(
  $$update public.consultations set status = 'finalized' where id = '30000000-0000-4000-8000-000000000001'$$,
  '%invalid_consultation_transition%',
  'a scheduled appointment cannot skip directly to finalized'
);

select lives_ok(
  $$update public.consultations set status = 'in_progress' where id = '30000000-0000-4000-8000-000000000001'$$,
  'a scheduled appointment can start'
);

select throws_like(
  $$insert into public.consultations (org_id, patient_id, status)
    values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'draft')$$,
  '%consultations_one_active_clinical_per_patient_idx%',
  'a patient cannot receive a second active clinical consultation'
);

insert into public.consultations (id, org_id, patient_id, status)
values ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'draft');

update public.consultations
set summary = 'Professionally reviewed summary'
where id = '30000000-0000-4000-8000-000000000003';

select is(
  (select clinical_revision from public.consultations where id = '30000000-0000-4000-8000-000000000003'),
  1::bigint,
  'editing clinical content advances its optimistic revision'
);

select lives_ok(
  $$insert into public.anamnesis_answers (id, org_id, consultation_id, block_key, field_key, value)
    values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'complaint', 'onset', 'Three weeks')$$,
  'an answer can be recorded before finalization'
);

select lives_ok(
  $$update public.consultations set status = 'finalized' where id = '30000000-0000-4000-8000-000000000003'$$,
  'an active consultation without pending recordings can finalize'
);

select throws_like(
  $$update public.anamnesis_answers set value = 'Rewritten' where id = '40000000-0000-4000-8000-000000000001'$$,
  '%finalized%',
  'an answer cannot be rewritten after finalization'
);

select throws_like(
  $$insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value)
    values ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'complaint', 'duration', 'New value')$$,
  '%finalized%',
  'a new answer cannot be appended to a finalized clinical payload'
);

select throws_like(
  $$update public.consultations set status = 'in_progress' where id = '30000000-0000-4000-8000-000000000003'$$,
  '%finalized%',
  'a finalized consultation cannot be reopened'
);

insert into public.consultations (id, org_id, patient_id, status, scheduled_for)
values ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'scheduled', '2030-02-01T12:00:00Z');

select lives_ok(
  $$update public.consultations set status = 'cancelled' where id = '30000000-0000-4000-8000-000000000004'$$,
  'a future appointment can be cancelled'
);

select lives_ok(
  $$update public.consultations set status = 'scheduled' where id = '30000000-0000-4000-8000-000000000004'$$,
  'a cancelled appointment with scheduling context can be restored'
);

insert into public.consultations (id, org_id, patient_id, status)
values ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'draft');

select lives_ok(
  $$update public.consultations set status = 'cancelled' where id = '30000000-0000-4000-8000-000000000005'$$,
  'an unneeded draft can be cancelled'
);

select throws_like(
  $$update public.consultations set status = 'scheduled' where id = '30000000-0000-4000-8000-000000000005'$$,
  '%invalid_consultation_transition%',
  'a cancelled clinical draft cannot masquerade as a restored appointment'
);

select throws_like(
  $$insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value)
    values ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'complaint', 'quality', '   ')$$,
  '%anamnesis_answers_value_nonempty_check%',
  'blank anamnesis text is represented by no row'
);

insert into public.consultations (id, org_id, patient_id, status)
values
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', 'draft'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000006', 'draft');

insert into public.anamnesis_answers (id, org_id, consultation_id, block_key, field_key, value)
values ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'complaint', 'location', 'Shoulder');

update public.anamnesis_answers
set consultation_id = '30000000-0000-4000-8000-000000000007'
where id = '40000000-0000-4000-8000-000000000002';

select is(
  (select clinical_revision from public.consultations where id = '30000000-0000-4000-8000-000000000006'),
  2::bigint,
  'moving an answer advances the source consultation revision'
);
select is(
  (select clinical_revision from public.consultations where id = '30000000-0000-4000-8000-000000000007'),
  1::bigint,
  'moving an answer advances the destination consultation revision'
);

select * from finish();
rollback;
