begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ============================================================
-- Migration 0081 — exporting the whole practice.
--
-- The archive is every chart of a practice in plain text. What is asserted
-- here is the containment around it: only one build at a time, the outcome is
-- not hers to write, support cannot request one from inside her account, and
-- the file expires while the record that it happened does not.
-- ============================================================

select ok(
  to_regprocedure('public.request_account_export()') is not null,
  'requesting an export goes through a guarded RPC'
);
select ok(
  not has_function_privilege('anon', 'public.request_account_export()', 'EXECUTE'),
  'anonymous callers cannot reach it'
);
select ok(
  not has_function_privilege('authenticated', 'public.purge_expired_account_exports()', 'EXECUTE'),
  'and retention is the job''s, not hers'
);
select ok(
  not has_table_privilege('authenticated', 'public.account_exports', 'UPDATE'),
  'she asks; the job answers — a client cannot mark a failed export ready'
);
select has_trigger(
  'public', 'account_exports', 'guard_impersonation_account_exports',
  'a support session cannot export a professional''s entire practice'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'export@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Acupunturista"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('c2000000-0000-4000-8000-000000000001', 'Export practice', 'export-practice',
        'c1000000-0000-4000-8000-000000000001');

insert into public.memberships (org_id, user_id, role)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

create temporary table export_results (name text primary key, payload jsonb);
grant select, insert on table export_results to authenticated, service_role;

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into export_results values ('first', public.request_account_export());
insert into export_results values ('second', public.request_account_export());
reset role;

select is(
  (select payload ->> 'code' from export_results where name = 'first'),
  'requested',
  'the first request queues a build'
);
select is(
  (select payload ->> 'code' from export_results where name = 'second'),
  'already_running',
  'a second click joins the one in flight instead of queueing a second full pass'
);
select is(
  (select payload ->> 'exportId' from export_results where name = 'second'),
  (select payload ->> 'exportId' from export_results where name = 'first'),
  'and points at the same request'
);
select is(
  (select count(*)::integer from public.account_exports
    where org_id = 'c2000000-0000-4000-8000-000000000001'),
  1,
  'exactly one row exists'
);

-- ---------- Retention deletes the archive, not the record ----------

update public.account_exports
set status = 'ready',
    file_path = 'c2000000-0000-4000-8000-000000000001/archive.zip',
    completed_at = now() - interval '5 days',
    expires_at = now() - interval '1 hour'
where org_id = 'c2000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into export_results values ('purge', public.purge_expired_account_exports());
reset role;

select is(
  (select payload ->> 'expired' from export_results where name = 'purge'),
  '1',
  'an expired archive is retired'
);
select is(
  (select payload -> 'paths' ->> 0 from export_results where name = 'purge'),
  'c2000000-0000-4000-8000-000000000001/archive.zip',
  'and its storage path comes back so the job can delete the object'
);
select ok(
  (
    select status = 'expired' and file_path is null
    from public.account_exports where org_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  'the file is gone but the row remains — that an export happened is what an audit asks about'
);

-- With nothing in flight, asking again starts a new build.
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into export_results values ('third', public.request_account_export());
reset role;

select is(
  (select payload ->> 'code' from export_results where name = 'third'),
  'requested',
  'once the previous one is finished she can ask for another'
);

select * from finish();
rollback;
