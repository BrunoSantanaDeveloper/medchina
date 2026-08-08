begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ---------- The public verification page is PHI-thin (0059) ----------

select ok(
  not exists(
    select 1
    from pg_proc p, unnest(p.proargnames) as arg_name
    where p.oid = 'public.verify_document(text)'::regprocedure
      and arg_name = 'title'
  ),
  'the public verification RPC no longer returns a free-text title'
);
select ok(
  (select count(*) = 1
   from pg_proc p, unnest(p.proargnames) as arg_name
   where p.oid = 'public.verify_document(text)'::regprocedure
     and arg_name = 'superseded'),
  'it reports whether a newer version replaced this document'
);
select ok(
  not exists(
    select 1
    from pg_proc p, unnest(p.proargnames) as arg_name
    where p.oid = 'public.verify_document(text)'::regprocedure
      and arg_name in ('patient_id', 'patient_name', 'subject_id', 'payload')
  ),
  'and never exposes the patient or the document payload'
);
select ok(
  has_function_privilege('anon', 'public.verify_document(text)', 'EXECUTE'),
  'the QR target stays reachable without a login'
);

-- ---------- One workspace per professional (0060) ----------

select ok(
  coalesce((select position('workspace_limit_reached' in prosrc) > 0
            from pg_proc where oid = 'public.create_organization(text,text)'::regprocedure), false),
  'creating a workspace knows about the MVP single-workspace rule'
);
select ok(
  coalesce((select position('is_superadmin' in prosrc) > 0
            from pg_proc where oid = 'public.create_organization(text,text)'::regprocedure), false),
  'platform operators stay exempt so tenants can still be created'
);
-- Since 0084 the guards live in the two-arg form (any operational action may
-- start the trial, and each names its origin); the one-arg signature delegates.
select ok(
  coalesce((select position('started_by = auth.uid()' in prosrc) > 0
            from pg_proc where oid = 'public.start_pro_trial(uuid,text)'::regprocedure), false),
  'the Pro trial is claimed per professional, not only per workspace'
);
select ok(
  coalesce((select position('for update' in prosrc) > 0
            from pg_proc where oid = 'public.start_pro_trial(uuid,text)'::regprocedure), false),
  'and the 0033 row lock against a web/mobile race is preserved'
);

-- ---------- Behavior ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'workspace-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"Workspace pgTAP"}'::jsonb, now(), now()
);

create temporary table workspace_results (name text primary key, payload text);
grant select, insert on table workspace_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- The signup trigger may already have created this user's first workspace;
-- normalize by ensuring exactly one membership exists before the assertions.
delete from public.memberships where user_id = 'b1000000-0000-4000-8000-000000000001';

set local role authenticated;
insert into workspace_results
values ('first', public.create_organization('Primeira prática', 'workspace-pgtap-1')::text);
reset role;
select ok(
  (select payload is not null from workspace_results where name = 'first'),
  'the first workspace is created normally'
);

set local role authenticated;
select throws_like(
  $$select public.create_organization('Segunda prática', 'workspace-pgtap-2')$$,
  '%workspace_limit_reached%',
  'a second workspace is refused — it would reset the trial and split the record'
);
reset role;
select ok(
  (select count(*) = 1 from public.memberships where user_id = 'b1000000-0000-4000-8000-000000000001'),
  'and the professional still belongs to exactly one workspace'
);

-- A trial already claimed by this professional is not handed out again in
-- another workspace (the invite path, which stays open by design).
insert into public.organizations (id, name, slug, created_by)
values ('b2000000-0000-4000-8000-000000000002', 'Prática convidada', 'workspace-pgtap-invited', 'b1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'member');
insert into public.pro_trials (org_id, started_at, ends_at, minutes_limit, started_by)
values (
  (select org_id from public.memberships
   where user_id = 'b1000000-0000-4000-8000-000000000001'
     and org_id <> 'b2000000-0000-4000-8000-000000000002' limit 1),
  now(), now() + interval '14 days', 300, 'b1000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
insert into workspace_results
values ('second-trial', public.start_pro_trial('b2000000-0000-4000-8000-000000000002')::text);
reset role;
select ok(
  not exists(select 1 from public.pro_trials where org_id = 'b2000000-0000-4000-8000-000000000002'),
  'the same professional cannot claim a second Pro trial in another workspace'
);

select * from finish();
rollback;
