begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- ============================================================
-- Migration 0099 — deleting an account and everything that belongs to it.
--
-- The fixture is deliberately the WORST case, not a tidy one: a finalized
-- consultation (frozen by guards that fire on DELETE), an issued document
-- held by RESTRICT foreign keys to its patient, consultation and plan, an
-- import whose rows are closed, the change history the versioning trigger
-- wrote, and files in storage. A deletion that only works on an empty
-- account proves nothing.
--
-- The two assertions that matter most are generic on purpose: after the
-- deletion, NO table in the database still holds a row of the workspace
-- (scanned from the catalog, so a table added next year is covered without
-- anyone remembering this test), and no foreign key still points at the
-- person. `record_versions` is inside that scan — it has `org_id` but no FK,
-- which is exactly how the "deleted" charts would have survived.
-- ============================================================

select ok(
  has_function_privilege('authenticated', 'public.admin_account_deletion_preview(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_account_deletion_preview(uuid)', 'EXECUTE'),
  'the preview is reachable by a signed-in session only (is_superadmin inside is the gate)'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_delete_account(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_delete_account(uuid,text,text)', 'EXECUTE'),
  'so is the deletion'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_orphaned_account_storage(uuid[],uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_orphaned_account_storage(uuid[],uuid)', 'EXECUTE'),
  'and the listing of leftover files'
);
select ok(
  not has_function_privilege('authenticated', 'public.account_deletion_workspaces(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.account_deletion_shared_workspaces(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.account_deletion_storage(uuid[],uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.account_deletion_counts(uuid[],uuid)', 'EXECUTE'),
  'the ungated helpers are internal: nobody calls them around the gate'
);

-- ---------- Fixtures: people ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()),
  ('b7000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'Delete-Me@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Leaving Practitioner"}'::jsonb, now(), now()),
  ('b7000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'stays@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Bystander"}'::jsonb, now(), now()),
  ('b7000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'clinic-owner@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Clinic Owner"}'::jsonb, now(), now()),
  ('b7000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'clinic-member@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Clinic Member"}'::jsonb, now(), now()),
  ('b7000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'second-operator@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Second Operator"}'::jsonb, now(), now());

update public.profiles set is_superadmin = true
where id in ('b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000006');

-- ---------- Fixtures: workspaces ----------

insert into public.organizations (id, name, slug, created_by) values
  ('b7100000-0000-4000-8000-000000000001', 'Leaving practice', 'leaving-practice-b7', 'b7000000-0000-4000-8000-000000000002'),
  ('b7100000-0000-4000-8000-000000000002', 'Bystander practice', 'bystander-practice-b7', 'b7000000-0000-4000-8000-000000000003'),
  ('b7100000-0000-4000-8000-000000000003', 'Shared clinic', 'shared-clinic-b7', 'b7000000-0000-4000-8000-000000000004');

insert into public.memberships (org_id, user_id, role) values
  ('b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'owner'),
  ('b7100000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000003', 'owner'),
  ('b7100000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-000000000004', 'owner'),
  ('b7100000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-000000000005', 'member')
on conflict do nothing;

-- ---------- Fixtures: the leaving practice, worst case ----------

insert into public.patients (id, org_id, full_name, created_by) values
  ('b7200000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'Paciente Sigilosa Exclusao',
   'b7000000-0000-4000-8000-000000000002'),
  ('b7200000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'Paciente Agenda Exclusao',
   'b7000000-0000-4000-8000-000000000002');

-- The agenda: an upcoming appointment is a consultation row (0027).
insert into public.consultations (id, org_id, patient_id, status, scheduled_for) values
  ('b7300000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001',
   'b7200000-0000-4000-8000-000000000002', 'scheduled', now() + interval '3 days');

-- A consultation filled while open, then finalized: from here on, its
-- answers, hypotheses, plan and prescription are frozen by BEFORE DELETE
-- guards (0021/0029/0074) that the cascade has to get past.
insert into public.consultations (id, org_id, patient_id, status, created_by) values
  ('b7300000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001',
   'b7200000-0000-4000-8000-000000000001', 'draft', 'b7000000-0000-4000-8000-000000000002');

insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value) values
  ('b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000002', 'queixa', 'principal',
   'Dor lombar há três semanas');
insert into public.consultation_hypotheses (id, org_id, consultation_id, pattern, correspondence) values
  ('b7400000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001',
   'b7300000-0000-4000-8000-000000000002', 'Estagnação de Qi do Fígado', 'moderate');
insert into public.consultation_plans (id, org_id, consultation_id) values
  ('b7400000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001',
   'b7300000-0000-4000-8000-000000000002');
insert into public.consultation_prescriptions (id, org_id, consultation_id, kind) values
  ('b7400000-0000-4000-8000-000000000003', 'b7100000-0000-4000-8000-000000000001',
   'b7300000-0000-4000-8000-000000000002', 'generic');

update public.consultations
set status = 'finalized',
    started_at = now() - interval '2 hours',
    finalized_at = now() - interval '1 hour',
    finalized_by = 'b7000000-0000-4000-8000-000000000002',
    duration_minutes = 60
where id = 'b7300000-0000-4000-8000-000000000002';

insert into public.consultation_addenda (org_id, consultation_id, body) values
  ('b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000002', 'Adendo pós-consulta');

-- An ISSUED document: held by RESTRICT foreign keys to its patient,
-- consultation and plan, and "never deleted" in the product (revoke only).
insert into public.documents (
  id, org_id, kind, title, status, version, verify_code, storage_path,
  subject_type, subject_id, issued_by, issued_at, patient_id, consultation_id, plan_id
) values (
  'b7400000-0000-4000-8000-000000000004', 'b7100000-0000-4000-8000-000000000001',
  'therapeutic-plan', 'Plano terapêutico', 'issued', 1, 'DELETEME0001',
  'b7100000-0000-4000-8000-000000000001/plan.pdf',
  'patient', 'b7200000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000002', now(),
  'b7200000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000002',
  'b7400000-0000-4000-8000-000000000002'
);

insert into public.consent_terms (id, slug, title, body) values
  ('b7400000-0000-4000-8000-000000000005', 'test-term-b7', 'Termo de teste', 'Corpo do termo');
insert into public.consent_acceptances (term_id, org_id, subject_type, subject_id) values
  ('b7400000-0000-4000-8000-000000000005', 'b7100000-0000-4000-8000-000000000001',
   'patient', 'b7200000-0000-4000-8000-000000000001');

-- A recording row. Its INSERT guards (allowance, consent) belong to the
-- capture flow, not to what is being tested here: off for the fixture only,
-- back on before anything is deleted.
alter table public.recordings disable trigger recordings_allowance_guard;
alter table public.recordings disable trigger recordings_guard_consent;
insert into public.recordings (id, org_id, patient_id) values
  ('b7400000-0000-4000-8000-000000000006', 'b7100000-0000-4000-8000-000000000001',
   'b7200000-0000-4000-8000-000000000001');
alter table public.recordings enable trigger recordings_allowance_guard;
alter table public.recordings enable trigger recordings_guard_consent;

insert into public.transcriptions (org_id, mime, status) values
  ('b7100000-0000-4000-8000-000000000001', 'audio/webm', 'ready');

insert into public.consultation_attachments (org_id, consultation_id, patient_id, kind, mime, status) values
  ('b7100000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000002',
   'b7200000-0000-4000-8000-000000000001', 'document', 'application/pdf', 'ready');

-- An import whose rows are CLOSED (their guard refuses writes once the batch
-- finished) — the cascade still has to take them.
insert into public.import_batches (id, org_id, kind, status, created_by) values
  ('b7400000-0000-4000-8000-000000000007', 'b7100000-0000-4000-8000-000000000001', 'patients', 'preview',
   'b7000000-0000-4000-8000-000000000002');
insert into public.import_rows (batch_id, org_id, row_number) values
  ('b7400000-0000-4000-8000-000000000007', 'b7100000-0000-4000-8000-000000000001', 1);
update public.import_batches set status = 'completed' where id = 'b7400000-0000-4000-8000-000000000007';

insert into public.account_exports (org_id, requested_by, status, file_path, completed_at, expires_at) values
  ('b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'ready',
   'b7100000-0000-4000-8000-000000000001/export.zip', now(), now() + interval '7 days');

-- Library chat (case review over her patients) and her own protocols.
insert into public.assistants (id, slug, name, model, system_prompt) values
  ('b7400000-0000-4000-8000-000000000008', 'test-assistant-b7', 'Assistente', 'test-model', 'prompt');
insert into public.conversations (id, org_id, assistant_id, created_by) values
  ('b7400000-0000-4000-8000-000000000009', 'b7100000-0000-4000-8000-000000000001',
   'b7400000-0000-4000-8000-000000000008', 'b7000000-0000-4000-8000-000000000002');
insert into public.messages (conversation_id, role, content) values
  ('b7400000-0000-4000-8000-000000000009', 'user', 'Revise o caso da Paciente Sigilosa');
insert into public.knowledge_collections (id, org_id, slug, name) values
  ('b7400000-0000-4000-8000-00000000000a', 'b7100000-0000-4000-8000-000000000001', 'protocolos-b7', 'Protocolos próprios');
insert into public.knowledge_documents (id, collection_id, title, content) values
  ('b7400000-0000-4000-8000-00000000000b', 'b7400000-0000-4000-8000-00000000000a', 'Meu protocolo', 'Conteúdo');

-- Person-scoped rows.
insert into public.notifications (user_id, title) values
  ('b7000000-0000-4000-8000-000000000002', 'Bem-vinda');
insert into public.onboarding_state (user_id, flow) values
  ('b7000000-0000-4000-8000-000000000002', 'activation');

-- Metering, telemetry and the workspace's own audit trail.
insert into public.audio_usage (org_id, seconds, cycle_seconds, pack_seconds, kind) values
  ('b7100000-0000-4000-8000-000000000001', 60, 60, 0, 'adjustment');
insert into public.product_events (id, org_id, actor_id, event_name) overriding system value values
  (987654321, 'b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'patient.created_inline');
insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id) values
  ('b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'patient.viewed', 'patient',
   'b7200000-0000-4000-8000-000000000001');

-- Files. storage.objects accepts rows written by SQL; it is only DELETE that
-- it refuses, which is the whole reason files go through the Storage API.
insert into storage.objects (bucket_id, name) values
  ('transcriptions', 'b7100000-0000-4000-8000-000000000001/recording.webm'),
  ('documents', 'b7100000-0000-4000-8000-000000000001/plan.pdf'),
  ('avatars', 'b7000000-0000-4000-8000-000000000002/avatar.png'),
  ('transcriptions', 'b7100000-0000-4000-8000-000000000002/keep.webm');

-- Still charging at the provider.
update public.subscriptions
set provider = 'stripe', provider_subscription_id = 'sub_delete_me_b7'
where org_id = 'b7100000-0000-4000-8000-000000000001' and status in ('trialing', 'active', 'past_due');

-- ---------- Fixtures: a practice that must not be touched ----------

insert into public.patients (id, org_id, full_name) values
  ('b7200000-0000-4000-8000-000000000003', 'b7100000-0000-4000-8000-000000000002', 'Paciente Que Fica');

-- And a clinic where the member (not the owner) wrote a chart.
insert into public.patients (id, org_id, full_name, created_by) values
  ('b7200000-0000-4000-8000-000000000004', 'b7100000-0000-4000-8000-000000000003', 'Paciente Da Clinica',
   'b7000000-0000-4000-8000-000000000005');

create temporary table deletion_results (name text primary key, payload jsonb);
grant select, insert on table deletion_results to authenticated;

-- ---------- Only a superadmin sees the preview ----------

select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_account_deletion_preview('b7000000-0000-4000-8000-000000000002')$$,
  'not_authorized',
  'a professional cannot even look at what deleting another account would remove'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into deletion_results values
  ('preview', public.admin_account_deletion_preview('b7000000-0000-4000-8000-000000000002')),
  ('preview-shared-owner', public.admin_account_deletion_preview('b7000000-0000-4000-8000-000000000004')),
  ('preview-superadmin', public.admin_account_deletion_preview('b7000000-0000-4000-8000-000000000006')),
  ('preview-self', public.admin_account_deletion_preview('b7000000-0000-4000-8000-000000000001'));
reset role;

select is(
  (select payload -> 'workspaces' -> 0 ->> 'id' from deletion_results where name = 'preview'),
  'b7100000-0000-4000-8000-000000000001',
  'the preview names the workspace that goes with the account'
);
select is(
  (select (payload -> 'counts' ->> 'patients')::int from deletion_results where name = 'preview'),
  2,
  'and counts what is in it'
);
select is(
  (select (payload -> 'counts' ->> 'storageObjects')::int from deletion_results where name = 'preview'),
  3,
  'including her files — the workspace ones and her avatar, never another practice''s'
);
select is(
  (select jsonb_array_length(payload -> 'providerSubscriptions') from deletion_results where name = 'preview'),
  1,
  'and the subscription that is still charging'
);
select is(
  (select payload -> 'blockers' from deletion_results where name = 'preview'),
  '[]'::jsonb,
  'nothing blocks an ordinary single-practice account'
);
select ok(
  (select payload -> 'blockers' ? 'shared_workspace' from deletion_results where name = 'preview-shared-owner'),
  'the owner of a clinic other people belong to is blocked'
);
select ok(
  (select payload -> 'blockers' ? 'superadmin' from deletion_results where name = 'preview-superadmin'),
  'a platform superadmin is blocked'
);
select ok(
  (select payload -> 'blockers' ? 'self' from deletion_results where name = 'preview-self'),
  'and so is the operator''s own account'
);

-- ---------- Every refusal, before anything is deleted ----------

select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000002', 'delete-me@medchina.invalid', 'Pedido da titular')$$,
  'not_authorized',
  'a professional cannot delete another account'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000001', 'operator@medchina.invalid', 'Pedido da titular')$$,
  'self_delete_forbidden',
  'a superadmin cannot delete their own account'
);
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000006', 'second-operator@medchina.invalid', 'Pedido da titular')$$,
  'target_is_superadmin',
  'nor another superadmin''s — the role has to be removed first'
);
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000002', 'someone-else@medchina.invalid', 'Pedido da titular')$$,
  'confirmation_mismatch',
  'the typed e-mail is checked in the database, not only in the dialog'
);
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000002', 'delete-me@medchina.invalid', 'sim')$$,
  'reason_required',
  'and so is the reason'
);
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000004', 'clinic-owner@medchina.invalid', 'Pedido da titular')$$,
  'shared_workspace',
  'a clinic is not its owner''s alone to erase'
);
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000002', 'delete-me@medchina.invalid', 'Pedido da titular por e-mail')$$,
  'provider_subscription_live',
  'an account whose card is still being charged is refused until the provider subscription is canceled'
);
select throws_ok(
  $$select * from public.admin_orphaned_account_storage(array['b7100000-0000-4000-8000-000000000001']::uuid[], null)$$,
  'workspace_still_exists',
  'the file listing refuses a workspace that still exists — it feeds a service-role delete'
);
reset role;

-- A support visit cannot do it either.
insert into public.impersonation_sessions (actor_id, target_user_id, reason, session_id, expires_at) values
  ('b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003',
   'Ticket 4242 — recording stuck in uploading', 'b7500000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"b7500000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_delete_account('b7000000-0000-4000-8000-000000000002', 'delete-me@medchina.invalid', 'Pedido da titular por e-mail')$$,
  'not_authorized',
  'a support session cannot delete an account'
);
reset role;

select ok(
  exists (select 1 from public.organizations where id = 'b7100000-0000-4000-8000-000000000001')
  and exists (select 1 from auth.users where id = 'b7000000-0000-4000-8000-000000000002'),
  'every refusal left the account exactly as it was'
);
select ok(
  (select count(*) from public.record_versions where org_id = 'b7100000-0000-4000-8000-000000000001') > 0,
  'and the workspace has change history for the deletion to purge'
);

-- ---------- The deletion ----------

-- The console cancels at the provider first; locally that is this.
update public.subscriptions set status = 'canceled', canceled_at = now()
where org_id = 'b7100000-0000-4000-8000-000000000001' and provider_subscription_id = 'sub_delete_me_b7';

select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into deletion_results values (
  'delete',
  -- Case and whitespace in the typed e-mail are not a reason to refuse.
  public.admin_delete_account('b7000000-0000-4000-8000-000000000002', '  delete-me@MEDCHINA.invalid ', 'Pedido da titular por e-mail — ticket 77')
);
reset role;

select is(
  (select payload -> 'deletedWorkspaces' from deletion_results where name = 'delete'),
  '["b7100000-0000-4000-8000-000000000001"]'::jsonb,
  'the deletion reports the workspace it removed'
);
select ok(
  not exists (select 1 from auth.users where id = 'b7000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.profiles where id = 'b7000000-0000-4000-8000-000000000002'),
  'the person is gone: login and profile'
);

-- The generic scans. Every base table with an org_id, every foreign key
-- that points at a person — straight from the catalog.
create function pg_temp.rows_left_for_org(target uuid)
returns setof text
language plpgsql
as $$
declare
  t record;
  n bigint;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'org_id'
  loop
    execute format('select count(*) from public.%I where org_id = $1', t.table_name) into n using target;
    if n > 0 then
      return next t.table_name || ' (' || n || ')';
    end if;
  end loop;
end;
$$;

create function pg_temp.rows_left_for_user(target uuid)
returns setof text
language plpgsql
as $$
declare
  fk record;
  n bigint;
begin
  for fk in
    select k.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.contype = 'f'
      and cardinality(k.conkey) = 1
      and k.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into n using target;
    if n > 0 then
      return next fk.tbl || '.' || fk.col || ' (' || n || ')';
    end if;
  end loop;
end;
$$;

select is_empty(
  $$select * from pg_temp.rows_left_for_org('b7100000-0000-4000-8000-000000000001')$$,
  'no table in the database still holds a row of the deleted workspace — change history included'
);
select is_empty(
  $$select * from pg_temp.rows_left_for_user('b7000000-0000-4000-8000-000000000002')$$,
  'and no foreign key anywhere (public or auth) still points at the deleted person'
);
select ok(
  not exists (select 1 from public.knowledge_documents where id = 'b7400000-0000-4000-8000-00000000000b')
  and not exists (select 1 from public.messages where conversation_id = 'b7400000-0000-4000-8000-000000000009'),
  'rows without an org_id of their own went with their parents: her protocols and her case-review chat'
);
select is(
  (select count(*)::int from public.record_versions where data::text like '%Paciente Sigilosa%'),
  0,
  'not one snapshot of the deleted charts survives in the change history'
);

-- ---------- What deliberately survives ----------

select ok(
  (
    select org_id is null and actor_id is null
    from public.product_events where id = 987654321
  ),
  'telemetry survives only anonymized: no workspace, no person (0034 keeps it patient-free)'
);
select is(
  (
    select count(*)::int from public.audit_events
    where action = 'admin.account.deleted'
      and org_id is null
      and actor_id = 'b7000000-0000-4000-8000-000000000001'
      and entity_id = 'b7000000-0000-4000-8000-000000000002'
  ),
  1,
  'the deletion is recorded at platform level, where the cascade cannot take it'
);
select is(
  (
    select (metadata -> 'counts' ->> 'patients')::int from public.audit_events
    where action = 'admin.account.deleted' and entity_id = 'b7000000-0000-4000-8000-000000000002'
  ),
  2,
  'with how much was deleted'
);
select ok(
  (
    select metadata::text not like '%Paciente%' and metadata::text not like '%Dor lombar%'
    from public.audit_events
    where action = 'admin.account.deleted' and entity_id = 'b7000000-0000-4000-8000-000000000002'
  ),
  'and never with what: no patient name, no clinical text in the record that outlives the data'
);

-- ---------- Nobody else was touched ----------

select ok(
  exists (select 1 from public.patients where id = 'b7200000-0000-4000-8000-000000000003')
  and (select count(*) from public.record_versions where org_id = 'b7100000-0000-4000-8000-000000000002') > 0,
  'the other practice keeps its patient and its history'
);

-- ---------- The files of an account that is gone ----------

select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select bucket, path from public.admin_orphaned_account_storage(
      array['b7100000-0000-4000-8000-000000000001']::uuid[], 'b7000000-0000-4000-8000-000000000002')$$,
  $$values
      ('avatars'::text, 'b7000000-0000-4000-8000-000000000002/avatar.png'::text),
      ('documents'::text, 'b7100000-0000-4000-8000-000000000001/plan.pdf'::text),
      ('transcriptions'::text, 'b7100000-0000-4000-8000-000000000001/recording.webm'::text)$$,
  'once the account is gone, the listing hands over exactly its files for the Storage API — not the other practice''s'
);
select throws_ok(
  $$select * from public.admin_orphaned_account_storage(array['b7100000-0000-4000-8000-000000000002']::uuid[], null)$$,
  'workspace_still_exists',
  'and still refuses to list a practice that exists'
);
select throws_ok(
  $$select * from public.admin_orphaned_account_storage('{}'::uuid[], 'b7000000-0000-4000-8000-000000000003')$$,
  'user_still_exists',
  'or the avatar of a person who exists'
);
reset role;

-- ---------- A clinic member leaves; the clinic keeps its records ----------

select set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into deletion_results values (
  'delete-member',
  public.admin_delete_account('b7000000-0000-4000-8000-000000000005', 'clinic-member@medchina.invalid', 'Saiu da clínica — pedido formal')
);
reset role;

select is(
  (select payload -> 'deletedWorkspaces' from deletion_results where name = 'delete-member'),
  '[]'::jsonb,
  'deleting a member of someone else''s clinic removes no workspace'
);
select ok(
  exists (select 1 from public.organizations where id = 'b7100000-0000-4000-8000-000000000003')
  and (select created_by is null from public.patients where id = 'b7200000-0000-4000-8000-000000000004'),
  'the clinic keeps the chart she wrote; only her authorship is detached'
);
select ok(
  not exists (select 1 from auth.users where id = 'b7000000-0000-4000-8000-000000000005')
  and not exists (select 1 from public.memberships where user_id = 'b7000000-0000-4000-8000-000000000005'),
  'while she herself is gone, membership included'
);

select * from finish();
rollback;
