begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ============================================================
-- Migration 0096 — granting (and fencing) the platform role.
--
-- The assertion that matters most is the negative one: before this
-- migration, `profiles_update_own` (0000) plus the legacy column grants let
-- ANY signed-in user PATCH their own profile row with
-- {"is_superadmin": true} and become platform operator, with read access to
-- every patient record in the database. That case is pinned first, because
-- it is the one a future refactor of the profiles policies could quietly
-- reopen.
--
-- The rest pins what the console is allowed to do: only a superadmin grants,
-- never to themselves (in either direction), never from a support session,
-- and always with a trail naming who promoted whom.
-- ============================================================

select ok(
  to_regprocedure('public.set_user_superadmin(uuid,boolean,text)') is not null,
  'granting the platform role goes through a guarded RPC, not a raw table write'
);
select ok(
  has_function_privilege('authenticated', 'public.set_user_superadmin(uuid,boolean,text)', 'EXECUTE'),
  'an authenticated session can reach it (is_superadmin inside is the real gate)'
);
select ok(
  not has_function_privilege('anon', 'public.set_user_superadmin(uuid,boolean,text)', 'EXECUTE'),
  'anonymous callers cannot'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'guard_superadmin_flag'
      and not tgisinternal
  ),
  'and the column itself is fenced, so the RPC is not merely the polite way in'
);

-- ---------- Fixtures: an operator and two ordinary users ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'd1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'operator@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()
  ),
  (
    'd1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'colleague@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Colleague"}'::jsonb, now(), now()
  ),
  (
    'd1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'practitioner@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Practitioner"}'::jsonb, now(), now()
  );

-- The bootstrap path of 0001: no JWT, so the fence lets it through. This is
-- how the FIRST superadmin is made, and the way back if the set is emptied.
update public.profiles set is_superadmin = true
where id = 'd1000000-0000-4000-8000-000000000001';

create temporary table grant_results (name text primary key, payload jsonb);
grant select, insert on table grant_results to authenticated;

-- ---------- The hole this migration closes ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$update public.profiles set is_superadmin = true
    where id = 'd1000000-0000-4000-8000-000000000003'$$,
  'superadmin_not_self_assignable',
  'a signed-in user cannot promote herself by writing her own profile row'
);

-- The other reachable shape: promoting somebody else directly. RLS gives her
-- no update policy on another row, so this is a silent no-op rather than an
-- error — asserted on the target, since a passing UPDATE would prove nothing.
update public.profiles set is_superadmin = true
where id = 'd1000000-0000-4000-8000-000000000002';
reset role;

select is(
  (select is_superadmin from public.profiles where id = 'd1000000-0000-4000-8000-000000000002'),
  false,
  'and cannot promote anybody else either — RLS never exposes another profile to her writes'
);

-- ---------- A non-superadmin cannot use the RPC ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.set_user_superadmin('d1000000-0000-4000-8000-000000000002', true, null)$$,
  'not_authorized',
  'the definer function refuses a caller who is not already a superadmin'
);
reset role;

-- ---------- The operator promotes a colleague ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into grant_results values (
  'grant',
  public.set_user_superadmin(
    'd1000000-0000-4000-8000-000000000002',
    true,
    'Second operator for the launch window'
  )
);
reset role;

select is(
  (select payload ->> 'changed' from grant_results where name = 'grant'),
  'true',
  'the grant reports that it actually changed something'
);
select is(
  (select is_superadmin from public.profiles where id = 'd1000000-0000-4000-8000-000000000002'),
  true,
  'and the colleague holds the platform role'
);
select is(
  (
    select count(*)::integer from public.audit_events
    where action = 'admin.user.superadmin_granted'
      and actor_id = 'd1000000-0000-4000-8000-000000000001'
      and entity_id = 'd1000000-0000-4000-8000-000000000002'
  ),
  1,
  'the trail names who promoted whom — the line an auditor comes here to read'
);
select is(
  (
    select metadata ->> 'note' from public.audit_events
    where action = 'admin.user.superadmin_granted'
      and entity_id = 'd1000000-0000-4000-8000-000000000002'
  ),
  'Second operator for the launch window',
  'including the operator note'
);

-- ---------- Never on yourself, in either direction ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$select public.set_user_superadmin('d1000000-0000-4000-8000-000000000001', true, null)$$,
  'self_change_forbidden',
  'a superadmin cannot act on their own role through the console'
);

-- Self-DEMOTION is refused for a duller reason than escalation: the last
-- operator could otherwise lock the platform out of its own admin area, with
-- no in-product way back. It also keeps the set of superadmins non-empty by
-- construction, so the RPC never needs a "last superadmin" special case.
select throws_ok(
  $$update public.profiles set is_superadmin = false
    where id = 'd1000000-0000-4000-8000-000000000001'$$,
  'superadmin_self_change_forbidden',
  'nor by writing their own row directly'
);
reset role;

-- ---------- Not from a support session ----------

insert into public.impersonation_sessions (
  actor_id, target_user_id, reason, session_id, expires_at
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000003',
  'Ticket 4242 — recording stuck in uploading',
  'd3000000-0000-4000-8000-000000000001',
  now() + interval '30 minutes'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"d3000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.set_user_superadmin('d1000000-0000-4000-8000-000000000003', true, null)$$,
  'not_authorized',
  'a support visit cannot hand out the platform role — the trail would name the visited account'
);
reset role;

-- ---------- Revoking, and saying nothing when there is nothing to say ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into grant_results values (
  'revoke',
  public.set_user_superadmin('d1000000-0000-4000-8000-000000000002', false, 'Launch window over')
);
insert into grant_results values (
  'noop',
  public.set_user_superadmin('d1000000-0000-4000-8000-000000000002', false, null)
);
select throws_ok(
  $$select public.set_user_superadmin('d1000000-0000-4000-8000-00000000dead', true, null)$$,
  'user_not_found',
  'a target that does not exist is an error, not a silent success'
);
reset role;

select is(
  (select payload ->> 'changed' from grant_results where name = 'revoke'),
  'true',
  'revoking reports the change'
);
select is(
  (select is_superadmin from public.profiles where id = 'd1000000-0000-4000-8000-000000000002'),
  false,
  'and the colleague loses the role'
);
select is(
  (
    select count(*)::integer from public.audit_events
    where action = 'admin.user.superadmin_revoked'
      and entity_id = 'd1000000-0000-4000-8000-000000000002'
  ),
  1,
  'the revocation is audited too'
);
select is(
  (select payload ->> 'changed' from grant_results where name = 'noop'),
  'false',
  'setting the role it already has changes nothing'
);
select is(
  (
    select count(*)::integer from public.audit_events
    where entity_type = 'user'
      and entity_id = 'd1000000-0000-4000-8000-000000000002'
      and action like 'admin.user.superadmin%'
  ),
  2,
  'and writes no third audit row — the trail records acts, not clicks'
);

-- ---------- The bootstrap door stays open ----------

-- Without a JWT (service role, migration, psql) the fence steps aside: this
-- is how the first superadmin is made, and the only recovery if a direct
-- write ever empties the set.
select lives_ok(
  $$update public.profiles set is_superadmin = true
    where id = 'd1000000-0000-4000-8000-000000000003'$$,
  'a session with no JWT can still set the flag — the bootstrap path of 0001'
);
select is(
  (select is_superadmin from public.profiles where id = 'd1000000-0000-4000-8000-000000000003'),
  true,
  'and the write actually landed'
);

select * from finish();
rollback;
