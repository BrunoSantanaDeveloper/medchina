begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ---------- Contract and privilege boundary ----------

select ok(
  exists(select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'capture_link_sessions' and column_name = 'mode'),
  'a capture link carries the mode it authorizes'
);
select ok(
  to_regprocedure('public.create_capture_link(uuid,text,integer,text,boolean)') is not null,
  'link creation takes a mode and an explicit force'
);
select ok(
  to_regprocedure('public.create_capture_link(uuid,text,integer)') is null,
  'the mode-less signature is gone, so no caller silently mints audio_only'
);
select ok(
  has_function_privilege('authenticated', 'public.create_capture_link(uuid,text,integer,text,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_capture_link(uuid)', 'EXECUTE'),
  'the professional issues and revokes her own links'
);
select ok(
  not has_function_privilege('authenticated', 'public.begin_capture_via_link(text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.begin_capture_via_link(text,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.begin_capture_via_link(text,uuid)', 'EXECUTE'),
  'the token-scoped capture RPC stays on the trusted service path'
);
select ok(
  coalesce((select position('capture_in_progress' in prosrc) > 0
            from pg_proc where oid = 'public.revoke_capture_link(uuid)'::regprocedure), false),
  'revocation knows about captures in flight'
);

-- ---------- Fixture ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'qr-capture-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"QR capture pgTAP"}'::jsonb, now(), now()
);
insert into public.organizations (id, name, slug, created_by)
values ('a2000000-0000-4000-8000-000000000001', 'QR capture practice', 'qr-capture-pgtap', 'a1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner');
insert into public.patients (id, org_id, full_name, birth_date, created_by)
values ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Paciente Captura', '1990-01-01', 'a1000000-0000-4000-8000-000000000001');
insert into public.consultations (id, org_id, patient_id, status)
values ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'draft');

create temporary table capture_results (name text primary key, payload jsonb);
grant select, insert, update on table capture_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- ---------- Consent is the floor ----------

set local role authenticated;
insert into capture_results values (
  'no-consent',
  public.create_capture_link('a4000000-0000-4000-8000-000000000001', repeat('1', 64), 900, 'audio_only', false)
);
reset role;
select is(
  (select payload ->> 'code' from capture_results where name = 'no-consent'),
  'audio_consent_required',
  'no audio consent, no link'
);

set local role authenticated;
select public.set_patient_consent('a3000000-0000-4000-8000-000000000001', 'audio-recording', true, '{"method":"verbal"}'::jsonb);
insert into capture_results values (
  'ai-without-consent',
  public.create_capture_link('a4000000-0000-4000-8000-000000000001', repeat('2', 64), 900, 'ai', false)
);
reset role;
select is(
  (select payload ->> 'code' from capture_results where name = 'ai-without-consent'),
  'ai_consent_required',
  'an AI link needs the separate ai-processing consent, not just audio'
);

-- ---------- audio_only happy path ----------

set local role authenticated;
insert into capture_results values (
  'audio-link',
  public.create_capture_link('a4000000-0000-4000-8000-000000000001', repeat('3', 64), 900, 'audio_only', false)
);
reset role;
select is((select payload ->> 'code' from capture_results where name = 'audio-link'), 'created', 'an audio-only link is issued');
select is((select payload ->> 'mode' from capture_results where name = 'audio-link'), 'audio_only', 'the issued link reports its mode');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into capture_results values ('resolve-audio', public.resolve_capture_link(repeat('3', 64)));
insert into capture_results values (
  'begin-audio',
  public.begin_capture_via_link(repeat('3', 64), 'a5000000-0000-4000-8000-000000000001')
);
reset role;
select is((select payload ->> 'mode' from capture_results where name = 'resolve-audio'), 'audio_only', 'the phone learns what the link authorizes');
select is((select payload ->> 'code' from capture_results where name = 'begin-audio'), 'created', 'the phone opens its recording');
select is(
  (select mode::text from public.recordings where client_upload_id = 'a5000000-0000-4000-8000-000000000001'),
  'audio_only',
  'an audio_only link can only create an audio_only recording'
);
select ok(
  exists(select 1 from public.audit_events
         where action = 'recording.capture_link.begun'
           and actor_id = 'a1000000-0000-4000-8000-000000000001'
           and org_id = 'a2000000-0000-4000-8000-000000000001'),
  'the anonymous leg is audited under the issuing professional'
);

-- ---------- A capture in flight is never destroyed ----------

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into capture_results values ('revoke-while-recording', public.revoke_capture_link('a4000000-0000-4000-8000-000000000001'));
reset role;
select is(
  (select payload ->> 'code' from capture_results where name = 'revoke-while-recording'),
  'capture_in_progress',
  'closing the dialog reports the live capture instead of revoking it'
);
select ok(
  (select revoked_at is null from public.capture_link_sessions where token_hash = repeat('3', 64)),
  'the session survives — the phone keeps recording and can still deliver'
);

set local role authenticated;
insert into capture_results values (
  'supersede-while-recording',
  public.create_capture_link('a4000000-0000-4000-8000-000000000001', repeat('4', 64), 900, 'audio_only', false)
);
reset role;
select is(
  (select payload ->> 'code' from capture_results where name = 'supersede-while-recording'),
  'capture_in_progress',
  'reopening the dialog surfaces the phone status instead of minting a new credential'
);
select ok(
  (select recording_status = 'recording' from (
     select payload ->> 'recordingStatus' as recording_status from capture_results where name = 'supersede-while-recording'
   ) t),
  'and it reports what the phone is doing'
);

-- ---------- Delivery keeps the session usable ----------

insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'transcriptions',
  'a2000000-0000-4000-8000-000000000001/' ||
    (select id::text from public.recordings where client_upload_id = 'a5000000-0000-4000-8000-000000000001') || '.webm',
  null,
  jsonb_build_object('size', 2048)
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into capture_results values (
  'state-local',
  public.set_capture_link_recording_state(repeat('3', 64), 'local', 1800, 2048, 'audio/webm')
);
insert into capture_results values (
  'state-uploading',
  public.set_capture_link_recording_state(repeat('3', 64), 'uploading')
);
insert into capture_results values (
  'state-uploaded',
  public.set_capture_link_recording_state(
    repeat('3', 64), 'uploaded', null, null, null,
    'a2000000-0000-4000-8000-000000000001/' ||
      (select id::text from public.recordings where client_upload_id = 'a5000000-0000-4000-8000-000000000001') || '.webm'
  )
);
reset role;
select is((select payload ->> 'code' from capture_results where name = 'state-local'), 'local', 'the phone reports its local take');
select is(
  (select duration_seconds from public.recordings where client_upload_id = 'a5000000-0000-4000-8000-000000000001'),
  1800,
  'the reported duration is stored as given, not collapsed to a second'
);
select is((select payload ->> 'code' from capture_results where name = 'state-uploaded'), 'ready', 'an audio_only delivery terminates at ready');
select ok(
  (select revoked_at is null from public.capture_link_sessions where token_hash = repeat('3', 64)),
  'delivery no longer revokes the link, so another segment can follow'
);

-- ---------- Once nothing is in flight, revocation works again ----------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
insert into capture_results values ('revoke-idle', public.revoke_capture_link('a4000000-0000-4000-8000-000000000001'));
reset role;
select is(
  (select payload ->> 'code' from capture_results where name = 'revoke-idle'),
  'revoked',
  'with nothing recording, the link is revoked as before'
);
select ok(
  (select revoked_at is not null from public.capture_link_sessions where token_hash = repeat('3', 64)),
  'the delivered link is closed for good'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into capture_results values ('resolve-revoked', public.resolve_capture_link(repeat('3', 64)));
reset role;
select is(
  (select payload ->> 'code' from capture_results where name = 'resolve-revoked'),
  'capture_link_invalid',
  'a revoked token is dead on arrival'
);

select * from finish();
rollback;
