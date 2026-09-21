begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ============================================================
-- Migration 0108 — the people a console that lists ORGANIZATIONS cannot see.
--
-- The assertions that matter are about the CAUSE, not the count: each residue
-- has a different repair, and the one that must never be confused is a
-- pending invite. Creating a personal workspace for her is precisely what
-- `auth/callback/route.ts` refuses to do ("creating a second personal
-- workspace would be wrong"), so the console has to be able to tell her apart
-- from someone who abandoned /auth/complete-profile.
--
-- Every count below is scoped to this file's own fixture, or asserted as a
-- RELATIONSHIP between the payload's totals and its rows. A test that counts
-- the whole table passes or fails according to whatever else the database
-- happens to hold — it did exactly that once, and said nothing was wrong.
-- ============================================================

select ok(
  has_function_privilege('authenticated', 'public.admin_people_without_workspace()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_people_without_workspace()', 'EXECUTE'),
  'reachable by a signed-in session only (is_superadmin inside is the gate)'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at, last_sign_in_at
) values
  ('d9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operadora@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operadora"}'::jsonb, now(), now(), now(), now()),
  -- Has a workspace: must NOT appear.
  ('d9000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'comorg@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Com Org"}'::jsonb, now(), now(), now(), now()),
  -- First Google sign-in, never finished /auth/complete-profile.
  ('d9000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'oauth@medchina.invalid', '', '{"provider":"google"}'::jsonb, '{"display_name":"Dra. OAuth"}'::jsonb,
   now(), now(), now(), now()),
  -- Invited and has not accepted yet: the invite still supplies her workspace.
  ('d9000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'convidada@medchina.invalid', '', '{"provider":"email"}'::jsonb, '{"display_name":"Dra. Convidada"}'::jsonb,
   now(), now(), now(), null),
  -- E-mail sign-up (which requires a practice name), yet no membership: the
  -- workspace went away. The honest label is "unknown".
  ('d9000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'residuo@medchina.invalid', '', '{"provider":"email"}'::jsonb, '{"display_name":"Dra. Resíduo"}'::jsonb,
   now(), now(), now(), now());

update public.profiles set is_superadmin = true where id = 'd9000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by) values
  ('d9100000-0000-4000-8000-000000000001', 'Clínica Com Org', 'clinica-com-org-d9100001',
   'd9000000-0000-4000-8000-000000000002');

insert into public.memberships (org_id, user_id, role) values
  ('d9100000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000002', 'owner');

-- Mixed case on purpose: the match has to be case-insensitive, or a real
-- invite would silently fail to explain the person it belongs to.
insert into public.invites (org_id, email, role, expires_at, invited_by) values
  ('d9100000-0000-4000-8000-000000000001', 'CONVIDADA@medchina.invalid', 'member',
   now() + interval '7 days', 'd9000000-0000-4000-8000-000000000002');

set local role postgres;

-- ---------- The gate ----------

select throws_ok(
  $$ select set_config('request.jwt.claims',
       json_build_object('sub', 'd9000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
     select public.admin_people_without_workspace() $$,
  'not_authorized',
  'a professional who is not a platform operator cannot read it'
);

select set_config('request.jwt.claims',
  json_build_object('sub', 'd9000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

create temporary table snapshot as select public.admin_people_without_workspace() as payload;

create temporary table mine as
select p as person
from snapshot, jsonb_array_elements(payload -> 'people') p
where p ->> 'email' like '%@medchina.invalid';

-- ---------- Who shows up ----------

select is(
  (select count(*)::int from mine),
  4,
  'the four fixture people with no membership are listed (the operator has none either)'
);

select ok(
  not exists (select 1 from mine where person ->> 'email' = 'comorg@medchina.invalid'),
  'someone who HAS a workspace never appears'
);

-- ---------- The cause, which decides the repair ----------

select is(
  (select person ->> 'cause' from mine where person ->> 'email' = 'convidada@medchina.invalid'),
  'invite_pending',
  'a live invite is reported as such — creating a personal workspace for her would be the wrong repair'
);

select is(
  (select person -> 'invite' ->> 'orgName' from mine where person ->> 'email' = 'convidada@medchina.invalid'),
  'Clínica Com Org',
  'the invite names the workspace she is expected to join, matched case-insensitively'
);

select ok(
  (select (person -> 'invite' ->> 'valid')::boolean from mine where person ->> 'email' = 'convidada@medchina.invalid'),
  'a not-yet-expired invite is flagged valid'
);

select is(
  (select person ->> 'cause' from mine where person ->> 'email' = 'oauth@medchina.invalid'),
  'setup_abandoned',
  'a social sign-in with no invite is an abandoned setup, not an invite'
);

select is(
  (select person ->> 'authProvider' from mine where person ->> 'email' = 'oauth@medchina.invalid'),
  'google',
  'the provider is reported so the console can say how she got in'
);

select is(
  (select person ->> 'cause' from mine where person ->> 'email' = 'residuo@medchina.invalid'),
  'unknown',
  'an e-mail sign-up with no workspace is NOT guessed — sign-up requires a practice name, so it is a residue'
);

-- ---------- Facts the operator acts on ----------

select ok(
  (select (person ->> 'isSuperadmin')::boolean from mine where person ->> 'email' = 'operadora@medchina.invalid'),
  'the platform role travels with the row, so the kebab can guard on it'
);

select ok(
  (select person ->> 'lastSignInAt' is null from mine where person ->> 'email' = 'convidada@medchina.invalid'),
  'never having signed in is reported as null, for the console to spell out'
);

select is(
  (select count(*)::int from mine where person ->> 'cause' = 'setup_abandoned'),
  1,
  'exactly one abandoned setup in the fixture'
);

-- ---------- Totals: asserted against the rows they summarise ----------

select is(
  (select (payload -> 'totals' ->> 'people')::int from snapshot),
  (select jsonb_array_length(payload -> 'people') from snapshot),
  'totals.people always matches the length of the list it summarises'
);

select is(
  (select (payload -> 'totals' ->> 'invitePending')::int from snapshot),
  (select count(*)::int from snapshot, jsonb_array_elements(payload -> 'people') p
   where p ->> 'cause' = 'invite_pending'),
  'totals.invitePending matches the rows carrying that cause'
);

select is(
  (select (payload -> 'totals' ->> 'setupAbandoned')::int from snapshot),
  (select count(*)::int from snapshot, jsonb_array_elements(payload -> 'people') p
   where p ->> 'cause' = 'setup_abandoned'),
  'totals.setupAbandoned matches the rows carrying that cause'
);

select is(
  (select (payload -> 'totals' ->> 'neverSignedIn')::int from snapshot),
  (select count(*)::int from snapshot, jsonb_array_elements(payload -> 'people') p
   where p ->> 'lastSignInAt' is null),
  'totals.neverSignedIn matches the rows with no sign-in'
);

select * from finish();
rollback;
