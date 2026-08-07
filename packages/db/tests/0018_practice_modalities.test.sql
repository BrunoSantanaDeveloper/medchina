begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ---------- Contract ----------

select ok(
  to_regprocedure('public.update_practice_modalities(text[])') is not null,
  'the scope can be edited outside onboarding'
);
select ok(
  has_function_privilege('authenticated', 'public.update_practice_modalities(text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_practice_modalities(text[])', 'EXECUTE'),
  'only a signed-in professional may edit her own scope'
);
select ok(
  coalesce((select position('is_impersonated' in prosrc) > 0
            from pg_proc where oid = 'public.update_practice_modalities(text[])'::regprocedure), false),
  'support impersonation is refused — profiles has no fence of its own (0057)'
);
select ok(
  coalesce((select position('timezone_confirmed_at' in prosrc) = 0
            from pg_proc where oid = 'public.update_practice_modalities(text[])'::regprocedure), false),
  'editing modalities never re-stamps the activation predicate'
);

-- ---------- Fixture ----------

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a9000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'scope-pgtap@medchina.invalid', '', now(), '{}'::jsonb,
  '{"display_name":"Scope pgTAP"}'::jsonb, now(), now()
);
delete from public.memberships where user_id = 'a9000000-0000-4000-8000-000000000001';
insert into public.organizations (id, name, slug, created_by)
values ('a9100000-0000-4000-8000-000000000001', 'Prática escopo', 'scope-pgtap', 'a9000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('a9100000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'owner');

-- A known timezone stamp, to prove it is untouched below.
update public.organizations
set timezone_confirmed_at = timestamptz '2026-01-01 10:00:00+00'
where id = 'a9100000-0000-4000-8000-000000000001';

create temporary table scope_results (name text primary key, payload jsonb);
grant select, insert on table scope_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- ---------- Behavior ----------

set local role authenticated;
insert into scope_results values (
  'save',
  public.update_practice_modalities(array['  CUPPING ', 'acupuncture', 'acupuncture']::text[])
);
reset role;

select is((select payload ->> 'code' from scope_results where name = 'save'), 'updated', 'the scope is saved');
select is(
  (select practice_modalities from public.profiles where id = 'a9000000-0000-4000-8000-000000000001'),
  array['acupuncture', 'cupping']::text[],
  'trimmed, lowercased, de-duplicated and sorted — same normalisation as 0050'
);
select ok(
  exists(select 1 from public.audit_events
         where action = 'practice.modalities.updated'
           and actor_id = 'a9000000-0000-4000-8000-000000000001'),
  'the change lands in the audit trail'
);
select ok(
  not exists(select 1 from public.audit_events
             where action = 'practice.modalities.updated'
               and metadata::text like '%acupuncture%'),
  'and records the COUNT, never the list (same privacy discipline as 0050)'
);
select is(
  (select timezone_confirmed_at from public.organizations where id = 'a9100000-0000-4000-8000-000000000001'),
  timestamptz '2026-01-01 10:00:00+00',
  'the activation stamp is untouched — this is not a timezone confirmation'
);

-- An empty declaration is legitimate: it means "no restriction".
set local role authenticated;
insert into scope_results values ('clear', public.update_practice_modalities('{}'::text[]));
reset role;
select is(
  (select practice_modalities from public.profiles where id = 'a9000000-0000-4000-8000-000000000001'),
  '{}'::text[],
  'clearing the scope is allowed and means no restriction'
);

set local role authenticated;
insert into scope_results values ('invalid', public.update_practice_modalities(array['quiropraxia']::text[]));
reset role;
select is(
  (select payload ->> 'code' from scope_results where name = 'invalid'),
  'invalid_modality',
  'a slug outside the five product modalities is refused'
);

select * from finish();
rollback;
