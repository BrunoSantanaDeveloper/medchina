begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ---------- Contract and privilege boundary ----------

select ok(to_regclass('public.patient_consent_sessions') is not null, 'QR consent sessions are persisted');
select ok(to_regclass('public.patient_consent_session_items') is not null, 'QR consent purpose snapshots are persisted');
select ok(
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'patient_consent_sessions' and column_name = 'token_hash'),
  'sessions persist only a token digest'
);
select ok(
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'public' and table_name = 'patient_consent_session_items'
     and column_name in ('term_title', 'term_body', 'term_version')),
  'each item snapshots the exact presented title, body and version'
);
select ok(
  (select count(*) = 2 from information_schema.columns
   where table_schema = 'public' and table_name = 'consent_acceptances'
     and column_name in ('consent_session_id', 'manifested_by')),
  'acceptances retain direct-patient provenance'
);
select ok(
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'patient_consent_sessions_token_hash_key'),
  'token digests are unique'
);
select ok(
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'patient_consent_sessions_one_pending_patient_idx'),
  'a patient has at most one pending QR session'
);
select ok((select relrowsecurity from pg_class where oid = 'public.patient_consent_sessions'::regclass), 'session RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.patient_consent_session_items'::regclass), 'session-item RLS is enabled');
select ok(to_regprocedure('public.create_patient_consent_session(uuid,text,uuid,uuid)') is not null, 'authenticated session creation RPC exists');
select ok(to_regprocedure('public.get_patient_consent_session_status(uuid)') is not null, 'authenticated status RPC exists');
select ok(to_regprocedure('public.cancel_patient_consent_session(uuid)') is not null, 'authenticated cancellation RPC exists');
select ok(to_regprocedure('public.resolve_patient_consent_session(text)') is not null, 'service-only resolution RPC exists');
select ok(
  to_regprocedure('public.submit_patient_consent_session(text,jsonb,uuid,text,text,text,boolean)') is not null,
  'service-only atomic submission RPC exists'
);
select ok(
  has_function_privilege('authenticated', 'public.create_patient_consent_session(uuid,text,uuid,uuid)', 'EXECUTE'),
  'authenticated professionals may create a collection session'
);
select ok(
  has_function_privilege('authenticated', 'public.get_patient_consent_session_status(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_patient_consent_session(uuid)', 'EXECUTE'),
  'authenticated professionals may poll and cancel their sessions'
);
select ok(
  not has_function_privilege('authenticated', 'public.resolve_patient_consent_session(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.submit_patient_consent_session(text,jsonb,uuid,text,text,text,boolean)', 'EXECUTE'),
  'patient-facing token RPCs are not exposed to authenticated browser clients'
);
select ok(
  has_function_privilege('service_role', 'public.resolve_patient_consent_session(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.submit_patient_consent_session(text,jsonb,uuid,text,text,text,boolean)', 'EXECUTE'),
  'the trusted service path can resolve and submit bearer links'
);
select ok(
  not has_function_privilege('anon', 'public.create_patient_consent_session(uuid,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolve_patient_consent_session(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.submit_patient_consent_session(text,jsonb,uuid,text,text,text,boolean)', 'EXECUTE'),
  'anon has no QR consent RPC access'
);
select ok(
  not has_table_privilege('authenticated', 'public.consent_acceptances', 'INSERT')
  and not has_table_privilege('authenticated', 'public.consent_acceptances', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.consent_acceptances', 'DELETE'),
  'acceptance mutations cannot bypass the audited RPCs'
);
select ok(
  not has_table_privilege('authenticated', 'public.patient_consent_sessions', 'SELECT')
  and not has_table_privilege('service_role', 'public.patient_consent_sessions', 'SELECT'),
  'session token digests cannot be selected through API roles'
);
select ok(
  coalesce((select position('safe_method not in (''verbal'', ''in_person'')' in prosrc) > 0
            from pg_proc where oid = 'public.set_patient_consent(uuid,text,boolean,jsonb)'::regprocedure), false),
  'professional consent accepts only professional manifestation methods'
);
select ok(
  coalesce((select position('auth.role()' in prosrc) > 0
            from pg_proc where oid = 'public.resolve_patient_consent_session(text)'::regprocedure), false)
  and coalesce((select position('auth.role()' in prosrc) > 0
               from pg_proc where oid = 'public.submit_patient_consent_session(text,jsonb,uuid,text,text,text,boolean)'::regprocedure), false),
  'public-link RPCs also enforce service role internally'
);

-- ---------- Isolated behavior fixture ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'qr-consent-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"QR consent pgTAP"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values (
  '92000000-0000-4000-8000-000000000001', 'QR consent practice',
  'qr-consent-pgtap', '91000000-0000-4000-8000-000000000001'
);
insert into public.memberships (org_id, user_id, role)
values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001', 'owner'
);
insert into public.patients (id, org_id, full_name, birth_date, created_by)
values (
  '93000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'Paciente QR', '1990-01-01', '91000000-0000-4000-8000-000000000001'
);

create temporary table qr_test_results (name text primary key, payload jsonb);
grant select, insert, update on table qr_test_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into qr_test_results values (
  'create-a',
  public.create_patient_consent_session(
    '93000000-0000-4000-8000-000000000001', repeat('a', 64),
    '94000000-0000-4000-8000-000000000001', null
  )
);
reset role;

select is((select payload ->> 'code' from qr_test_results where name = 'create-a'), 'created', 'a member creates a QR session');
select ok(
  (select count(*) = 1 and bool_and(expires_at between created_at + interval '14 minutes 50 seconds' and created_at + interval '15 minutes 10 seconds')
   from public.patient_consent_sessions where client_request_id = '94000000-0000-4000-8000-000000000001'),
  'the QR link receives a fifteen-minute validity window'
);
select ok(
  (select count(*) = 3 and bool_and(term_title <> '' and term_body <> '' and term_version > 0)
   from public.patient_consent_session_items i
   join public.patient_consent_sessions s on s.id = i.session_id
   where s.client_request_id = '94000000-0000-4000-8000-000000000001'),
  'creation atomically snapshots all three purposes'
);

set local role authenticated;
insert into qr_test_results values (
  'rotate-a',
  public.create_patient_consent_session(
    '93000000-0000-4000-8000-000000000001', repeat('b', 64),
    '94000000-0000-4000-8000-000000000001', null
  )
);
reset role;
select is((select payload ->> 'code' from qr_test_results where name = 'rotate-a'), 'rotated', 'a response-lost retry rotates the token');
select ok(
  (select count(*) = 1 and bool_and(token_hash = repeat('b', 64))
   from public.patient_consent_sessions where client_request_id = '94000000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.patient_consent_sessions where token_hash = repeat('a', 64)),
  'rotation preserves the session and immediately invalidates the old digest'
);

set local role authenticated;
insert into qr_test_results values (
  'create-c',
  public.create_patient_consent_session(
    '93000000-0000-4000-8000-000000000001', repeat('c', 64),
    '94000000-0000-4000-8000-000000000002', null
  )
);
reset role;
select ok(
  (select status = 'cancelled' and close_reason = 'superseded'
   from public.patient_consent_sessions where token_hash = repeat('b', 64))
  and (select status = 'pending' from public.patient_consent_sessions where token_hash = repeat('c', 64)),
  'a new collection link supersedes the prior pending link'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into qr_test_results values ('resolve-c', public.resolve_patient_consent_session(repeat('c', 64)));
insert into qr_test_results values (
  'invalid-submit-c',
  public.submit_patient_consent_session(
    repeat('c', 64), '{"audio-recording":true}'::jsonb,
    '95000000-0000-4000-8000-000000000001', 'patient', 'Paciente QR', null, true
  )
);
reset role;
select ok(
  (select payload ->> 'code' = 'pending'
          and payload ->> 'organizationName' = 'QR consent practice'
          and not (payload ? 'patientName')
          and jsonb_array_length(payload -> 'terms') = 3
   from qr_test_results where name = 'resolve-c'),
  'resolution returns three snapshots and minimized organization context'
);
select is((select payload ->> 'code' from qr_test_results where name = 'invalid-submit-c'), 'invalid_request', 'partial decisions are rejected');
select ok(
  not exists(
    select 1 from public.patient_consent_session_items i
    join public.patient_consent_sessions s on s.id = i.session_id
    where s.token_hash = repeat('c', 64) and i.decision is not null
  ),
  'a malformed submission leaves all three decisions untouched'
);

set local role service_role;
insert into qr_test_results values (
  'submit-c',
  public.submit_patient_consent_session(
    repeat('c', 64),
    '{"audio-recording":true,"ai-processing":true,"clinical-images":false}'::jsonb,
    '95000000-0000-4000-8000-000000000002', 'patient', 'Paciente QR', null, true
  )
);
reset role;
select is((select payload ->> 'code' from qr_test_results where name = 'submit-c'), 'completed', 'one submission completes all purposes');
select ok(
  (select status = 'completed'
          and signer_role = 'patient'
          and signer_name = 'Paciente QR'
          and identity_declared_at is not null
          and completion_idempotency_key = '95000000-0000-4000-8000-000000000002'
   from public.patient_consent_sessions where token_hash = repeat('c', 64)),
  'completion persists the declared signer and idempotency boundary'
);
select ok(
  (select count(*) = 3
          and count(*) filter (where decision is true) = 2
          and count(*) filter (where decision is false) = 1
   from public.patient_consent_session_items i
   join public.patient_consent_sessions s on s.id = i.session_id
   where s.token_hash = repeat('c', 64)),
  'the three decisions remain independently queryable'
);
select ok(
  (select count(*) = 2
          and bool_and(recorded_by is null)
          and bool_and(manifested_by = 'patient')
          and bool_and(metadata ->> 'method' = 'patient_qr')
   from public.consent_acceptances a
   join public.patient_consent_sessions s on s.id = a.consent_session_id
   where s.token_hash = repeat('c', 64) and a.revoked_at is null),
  'grants create separate patient-owned acceptances without professional authorship'
);
select ok(
  not exists(
    select 1 from public.consent_acceptances a
    join public.consent_terms t on t.id = a.term_id
    where a.subject_id = '93000000-0000-4000-8000-000000000001'
      and t.slug = 'clinical-images' and a.revoked_at is null
  ),
  'a refusal never fabricates an active acceptance'
);
select ok(
  (select count(*) = 4 from public.audit_events e
   where (e.entity_id = '93000000-0000-4000-8000-000000000001'
          and e.action in ('consent.granted', 'consent.refused'))
      or (e.entity_id = (select id::text from public.patient_consent_sessions where token_hash = repeat('c', 64))
          and e.action = 'consent.collection.completed')),
  'submission records three purpose events and one collection completion event'
);
select ok(
  not exists(
    select 1 from public.audit_events e
    where e.metadata ? 'token_hash'
       or e.metadata ? 'tokenHash'
       or e.metadata::text like '%' || repeat('c', 64) || '%'
  ),
  'audit metadata never contains a bearer token digest'
);

set local role service_role;
insert into qr_test_results values (
  'replay-c',
  public.submit_patient_consent_session(
    repeat('c', 64),
    '{"clinical-images":false,"ai-processing":true,"audio-recording":true}'::jsonb,
    '95000000-0000-4000-8000-000000000002', 'patient', 'Paciente QR', null, true
  )
);
insert into qr_test_results values (
  'conflict-c',
  public.submit_patient_consent_session(
    repeat('c', 64),
    '{"audio-recording":true,"ai-processing":true,"clinical-images":true}'::jsonb,
    '95000000-0000-4000-8000-000000000002', 'patient', 'Paciente QR', null, true
  )
);
reset role;
select ok(
  (select payload ->> 'code' = 'completed' and (payload ->> 'replayed')::boolean
   from qr_test_results where name = 'replay-c'),
  'an identical retry replays the completed result'
);
select is((select payload ->> 'code' from qr_test_results where name = 'conflict-c'), 'idempotency_conflict', 'a changed retry cannot rewrite consent');
select is(
  (select count(*) from public.consent_acceptances a
   join public.patient_consent_sessions s on s.id = a.consent_session_id
   where s.token_hash = repeat('c', 64))::bigint,
  2::bigint,
  'submission retries do not duplicate acceptances'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into qr_test_results values (
  'forged-professional',
  public.set_patient_consent(
    '93000000-0000-4000-8000-000000000001', 'clinical-images', true,
    '{"method":"patient_qr"}'::jsonb
  )
);
with created as (
  select public.create_patient_consent_session(
    '93000000-0000-4000-8000-000000000001', repeat('d', 64),
    '94000000-0000-4000-8000-000000000003', null
  ) as payload
), stored as (
  insert into qr_test_results select 'cancel-create', payload from created returning payload
)
insert into qr_test_results
select 'cancel-d', public.cancel_patient_consent_session((payload ->> 'sessionId')::uuid) from stored;
reset role;
select is((select payload ->> 'code' from qr_test_results where name = 'forged-professional'), 'invalid_request', 'the professional RPC cannot forge patient_qr provenance');
select ok(
  (select payload ->> 'code' = 'cancelled' from qr_test_results where name = 'cancel-d')
  and (select status = 'cancelled' from public.patient_consent_sessions where token_hash = repeat('d', 64)),
  'a professional can explicitly cancel a pending link'
);

set local role authenticated;
insert into qr_test_results values (
  'create-e',
  public.create_patient_consent_session(
    '93000000-0000-4000-8000-000000000001', repeat('e', 64),
    '94000000-0000-4000-8000-000000000004', null
  )
);
reset role;
update public.patient_consent_sessions
set created_at = clock_timestamp() - interval '20 minutes',
    expires_at = clock_timestamp() - interval '5 minutes'
where token_hash = repeat('e', 64);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into qr_test_results values ('resolve-expired-e', public.resolve_patient_consent_session(repeat('e', 64)));
reset role;
select is((select payload ->> 'code' from qr_test_results where name = 'resolve-expired-e'), 'consent_link_invalid', 'expired and unknown links share a generic error');
select is((select status from public.patient_consent_sessions where token_hash = repeat('e', 64)), 'expired', 'an expired link is closed durably');

select * from finish();
rollback;
