begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ============================================================
-- Migration 0105 — a practice cannot be erased by a REST call.
--
-- Two layers, tested apart, because they fail differently: RLS (no DELETE
-- policy) makes the request a silent no-op, and the trigger makes it an
-- error. The second exists precisely for the day somebody adds a policy
-- back, so the test adds one on purpose and checks the fence still holds —
-- an assertion that would pass for the wrong reason if it only ever ran
-- against the missing policy.
-- ============================================================

select is_empty(
  $$select policyname::text from pg_policies
    where schemaname = 'public' and tablename = 'organizations' and cmd = 'DELETE'$$,
  'no policy lets a workspace delete itself through PostgREST'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.organizations'::regclass
      and tgname = 'guard_organization_delete'
      and not tgisinternal
  ),
  'and a trigger stands behind the missing policy, for the day one comes back'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()),
  ('e9000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Dona"}'::jsonb, now(), now());

update public.profiles set is_superadmin = true where id = 'e9000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by) values
  ('e9100000-0000-4000-8000-000000000001', 'Consultório da Dona', 'consultorio-dona-e9',
   'e9000000-0000-4000-8000-000000000002'),
  -- A throwaway workspace for the operational path (service role).
  ('e9100000-0000-4000-8000-000000000002', 'Workspace de ops', 'ops-e9',
   'e9000000-0000-4000-8000-000000000002');

insert into public.memberships (org_id, user_id, role) values
  ('e9100000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000002', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name) values
  ('e9200000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 'Paciente Da Dona');

select ok(
  (select count(*) from public.record_versions where org_id = 'e9100000-0000-4000-8000-000000000001') > 0,
  'the workspace has change history — the part a raw cascade used to leave behind'
);

-- ---------- The owner cannot erase her own practice ----------

select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
delete from public.organizations where id = 'e9100000-0000-4000-8000-000000000001';
reset role;

select ok(
  exists (select 1 from public.organizations where id = 'e9100000-0000-4000-8000-000000000001'),
  'her DELETE reaches no row: RLS simply does not expose the workspace to it'
);

-- ---------- And the fence holds if a policy ever comes back ----------

create policy "tmp_organizations_delete_owner" on public.organizations
  for delete to authenticated
  using (public.has_org_role(id, array['owner']::public.org_role[]));

select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$delete from public.organizations where id = 'e9100000-0000-4000-8000-000000000001'$$,
  'workspace_delete_not_self_service',
  'with a permissive policy back in place the trigger still refuses — the fence is not the policy'
);
reset role;

drop policy "tmp_organizations_delete_owner" on public.organizations;

select ok(
  exists (select 1 from public.organizations where id = 'e9100000-0000-4000-8000-000000000001')
  and exists (select 1 from public.patients where id = 'e9200000-0000-4000-8000-000000000001'),
  'nothing was half-deleted by the attempt'
);

-- ---------- The operational path is untouched ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok(
  $$delete from public.organizations where id = 'e9100000-0000-4000-8000-000000000002'$$,
  'a session with no user (service role, migration, psql) still deletes — the way back from a bad write'
);
reset role;

-- ---------- The audited path still erases everything ----------

select set_config('request.jwt.claims',
  '{"sub":"e9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.admin_delete_account('e9000000-0000-4000-8000-000000000002', 'owner@medchina.invalid',
      'Pedido da titular por e-mail')$$,
  'the console path (0099/0101) goes through the guard untouched'
);
reset role;

select ok(
  not exists (select 1 from public.organizations where id = 'e9100000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.patients where id = 'e9200000-0000-4000-8000-000000000001')
  and (select count(*) from public.record_versions where org_id = 'e9100000-0000-4000-8000-000000000001') = 0,
  'and it takes the charts AND their change history — which is the whole difference'
);

select * from finish();
rollback;
