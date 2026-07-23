begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'practice_modalities'
  ),
  'profiles persist professional modalities'
);
select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'timezone_confirmed_at'
  ),
  'practices persist explicit timezone confirmation'
);
select ok(
  to_regprocedure('public.complete_practice_context(uuid,text,text[])') is not null
  and has_function_privilege(
    'authenticated',
    'public.complete_practice_context(uuid,text,text[])',
    'EXECUTE'
  ),
  'authenticated professionals can complete practice context through the guarded RPC'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ux-owner@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"UX Owner"}'::jsonb, now(), now()
  ),
  (
    'a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ux-admin@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"UX Admin"}'::jsonb, now(), now()
  ),
  (
    'a1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ux-outsider@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"UX Outsider"}'::jsonb, now(), now()
  );

insert into public.organizations (id, name, slug, created_by)
values (
  'a2000000-0000-4000-8000-000000000001',
  'UX practice',
  'ux-practice',
  'a1000000-0000-4000-8000-000000000001'
);
insert into public.memberships (org_id, user_id, role)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'owner'
  ),
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'admin'
  );

create temporary table ux_context_results (name text primary key, payload jsonb);
grant select, insert, update on table ux_context_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into ux_context_results values (
  'complete',
  public.complete_practice_context(
    'a2000000-0000-4000-8000-000000000001',
    'America/Sao_Paulo',
    array[' cupping ', 'acupuncture', 'cupping']
  )
);
reset role;

select is(
  (select payload ->> 'ok' from ux_context_results where name = 'complete'),
  'true',
  'the owner completes the context'
);
select is(
  (
    select practice_modalities
    from public.profiles
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  array['acupuncture', 'cupping']::text[],
  'modalities are trimmed, deduplicated and sorted'
);
select ok(
  (
    select timezone = 'America/Sao_Paulo' and timezone_confirmed_at is not null
    from public.organizations
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'timezone and explicit confirmation are stored together'
);
select ok(
  exists(
    select 1 from public.audit_events
    where org_id = 'a2000000-0000-4000-8000-000000000001'
      and action = 'practice.context.completed'
      and metadata ->> 'modalityCount' = '2'
  ),
  'context completion emits an audit event without free text'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_like(
  $$select public.complete_practice_context(
    'a2000000-0000-4000-8000-000000000001',
    'Mars/Olympus',
    '{}'::text[]
  )$$,
  '%invalid_timezone%',
  'an invalid timezone is rejected'
);
select throws_like(
  $$select public.complete_practice_context(
    'a2000000-0000-4000-8000-000000000001',
    'America/Sao_Paulo',
    array['unsupported']
  )$$,
  '%invalid_modality%',
  'an unsupported modality is rejected'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
insert into ux_context_results values (
  'admin',
  public.complete_practice_context(
    'a2000000-0000-4000-8000-000000000001',
    'America/Sao_Paulo',
    '{}'::text[]
  )
);
reset role;
select is(
  (select payload ->> 'ok' from ux_context_results where name = 'admin'),
  'true',
  'an admin can complete the context with an empty modalities array'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_like(
  $$select public.complete_practice_context(
    'a2000000-0000-4000-8000-000000000001',
    'America/Sao_Paulo',
    '{}'::text[]
  )$$,
  '%not_authorized%',
  'a non-member cannot update another practice'
);
reset role;

update public.organizations
set timezone_confirmed_at = null
where id = 'a2000000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select public.update_practice_settings(
  'a2000000-0000-4000-8000-000000000001',
  'UX practice',
  'America/Sao_Paulo'
);
reset role;

select ok(
  (
    select timezone_confirmed_at is not null
    from public.organizations
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'the regular practice settings path also confirms the timezone'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select public.track_product_event(
  'upgrade.prompt_clicked',
  '{"origin":"consultation","feature":"clinical_reasoning","patient_id":"blocked"}'::jsonb
);
select public.track_product_event(
  'upgrade.prompt_viewed',
  '{"origin":"menu","feature":"plans"}'::jsonb
);
select public.track_product_event(
  'billing.contact_clicked',
  '{"origin":"billing","feature":"plans"}'::jsonb
);
reset role;

select is(
  (
    select count(*)::integer
    from public.product_events
    where actor_id = 'a1000000-0000-4000-8000-000000000001'
      and event_name in ('upgrade.prompt_viewed', 'upgrade.prompt_clicked', 'billing.contact_clicked')
  ),
  3,
  'all commercial telemetry events are accepted'
);
select ok(
  exists(
    select 1 from public.product_events
    where actor_id = 'a1000000-0000-4000-8000-000000000001'
      and event_name = 'upgrade.prompt_clicked'
      and properties ->> 'origin' = 'consultation'
      and properties ->> 'feature' = 'clinical_reasoning'
      and not properties ? 'patient_id'
      and not properties ? 'platform'
  ),
  'upgrade telemetry keeps allowlisted context and drops identifiers'
);

select * from finish();
rollback;
