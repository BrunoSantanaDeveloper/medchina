begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ---------- Contract and privilege boundary ----------

select ok(to_regclass('public.document_share_links') is not null, 'patient document links are persisted');
select ok(
  exists(select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'document_share_links' and column_name = 'token_hash'),
  'links persist only a token digest, never the bearer token'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.document_share_links'::regclass),
  'share-link RLS is enabled'
);
select ok(
  not exists(
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'document_share_links' and cmd <> 'SELECT'
  ),
  'no policy lets a client mint or alter a link outside the audited RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'public.open_document_share_link(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.open_document_share_link(text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.open_document_share_link(text)', 'EXECUTE'),
  'opening a link is a service-role act (the token is the credential)'
);
select ok(
  has_function_privilege('authenticated', 'public.create_document_share_link(uuid,text,text,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_document_share_link(uuid)', 'EXECUTE'),
  'the professional issues and revokes the links she hands out'
);

-- ---------- Fixture ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'doc-share-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"Doc share pgTAP"}'::jsonb, now(), now()
);
delete from public.memberships where user_id = 'd1000000-0000-4000-8000-000000000001';
insert into public.organizations (id, name, slug, created_by)
values ('d2000000-0000-4000-8000-000000000001', 'Prática documentos', 'doc-share-pgtap', 'd1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'owner');
insert into public.patients (id, org_id, full_name, birth_date, created_by)
values ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Paciente Documento', '1990-01-01', 'd1000000-0000-4000-8000-000000000001');

insert into public.documents (
  id, org_id, kind, title, status, version, verify_code, storage_path,
  subject_type, subject_id, issued_by, issued_at
) values (
  'd4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
  'therapeutic-plan', 'Plano terapêutico', 'issued', 1, 'DOCSHARE1234',
  'd2000000-0000-4000-8000-000000000001/plan.pdf',
  'patient', 'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001', now()
);
insert into public.documents (
  id, org_id, kind, title, status, version, verify_code, storage_path,
  subject_type, subject_id, issued_by
) values (
  'd4000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001',
  'therapeutic-plan', 'Rascunho', 'draft', 1, 'DOCSHAREDRFT',
  null, 'patient', 'd3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001'
);

create temporary table share_results (name text primary key, payload jsonb);
grant select, insert on table share_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- ---------- A draft is never shareable ----------

set local role authenticated;
insert into share_results values (
  'draft',
  public.create_document_share_link('d4000000-0000-4000-8000-000000000002', repeat('a', 64), 'link', 168)
);
reset role;
select is(
  (select payload ->> 'code' from share_results where name = 'draft'),
  'document_not_issued',
  'an unissued document cannot be handed to a patient'
);

-- ---------- Issue, open, and the patient link the professional controls ----------

set local role authenticated;
insert into share_results values (
  'created',
  public.create_document_share_link('d4000000-0000-4000-8000-000000000001', repeat('b', 64), 'whatsapp', 168)
);
reset role;
select is((select payload ->> 'code' from share_results where name = 'created'), 'created', 'an issued document gets a link');
select ok(
  (select patient_id = 'd3000000-0000-4000-8000-000000000001'
   from public.document_share_links where token_hash = repeat('b', 64)),
  'the link is bound to the patient the document is about'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into share_results values ('opened', public.open_document_share_link(repeat('b', 64)));
reset role;
select ok(
  (select payload ->> 'ok' = 'true' and payload ->> 'storagePath' is not null
          and not (payload ? 'patientName') and not (payload ? 'title')
   from share_results where name = 'opened'),
  'opening returns the file path but never the patient or the document title'
);
select ok(
  (select open_count = 1 and opened_at is not null
   from public.document_share_links where token_hash = repeat('b', 64)),
  'every open is counted, so "who saw this" is answerable'
);
select ok(
  exists(select 1 from public.audit_events
         where action = 'document.share_link.opened'
           and entity_id = 'd4000000-0000-4000-8000-000000000001'),
  'and audited'
);

-- ---------- Revoking takes it back ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into share_results values ('revoked', public.revoke_document_share_link('d4000000-0000-4000-8000-000000000001'));
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into share_results values ('after-revoke', public.open_document_share_link(repeat('b', 64)));
reset role;
select is(
  (select payload ->> 'code' from share_results where name = 'after-revoke'),
  'share_link_invalid',
  'a revoked link stops serving the document immediately'
);

-- A document revoked AFTER sharing must stop being served too: the patient
-- must not keep pulling a plan the professional has superseded.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
insert into share_results values (
  'reshared',
  public.create_document_share_link('d4000000-0000-4000-8000-000000000001', repeat('c', 64), 'link', 168)
);
reset role;
update public.documents set status = 'revoked' where id = 'd4000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into share_results values ('superseded', public.open_document_share_link(repeat('c', 64)));
reset role;
select is(
  (select payload ->> 'code' from share_results where name = 'superseded'),
  'document_revoked',
  'a superseded document is no longer served through a live link'
);

select * from finish();
rollback;
