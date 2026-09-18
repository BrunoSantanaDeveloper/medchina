begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- ============================================================
-- Migration 0104 — the account management view.
--
-- Three workspaces, three situations an operator actually has to tell apart:
-- a trial about to end, a paying practice with a renewal date, and an account
-- that worked once and went quiet. The assertions are mostly about the
-- numbers a decision hangs on — days left, days to renewal, days idle — plus
-- the one the console existed without: WHO the workspace is, when its name
-- ("Consultório") says nothing.
-- ============================================================

select ok(
  has_function_privilege('authenticated', 'public.admin_accounts_overview()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_accounts_overview()', 'EXECUTE'),
  'the overview is reachable by a signed-in session only (is_superadmin inside is the gate)'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at
) values
  ('c8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now(), now()),
  -- Signed up, never confirmed the e-mail: a funnel leak the console has to show.
  ('c8000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'trial@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Trial"}'::jsonb, now(), now(), null),
  ('c8000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paga@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Paga"}'::jsonb, now(), now(), now()),
  ('c8000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'parada@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Parada"}'::jsonb, now(), now(), now());

update public.profiles set is_superadmin = true where id = 'c8000000-0000-4000-8000-000000000001';
update public.profiles
set professional_title = 'Acupunturista', professional_registration = 'CRM 12345'
where id = 'c8000000-0000-4000-8000-000000000002';

insert into public.organizations (id, name, slug, created_by, created_at) values
  -- The workspace name that says nothing: the row has to be identifiable anyway.
  ('c8100000-0000-4000-8000-000000000001', 'Consultório', 'consultorio-c8000001',
   'c8000000-0000-4000-8000-000000000002', now()),
  ('c8100000-0000-4000-8000-000000000002', 'Clínica Paga', 'clinica-paga-c8000002',
   'c8000000-0000-4000-8000-000000000003', now()),
  ('c8100000-0000-4000-8000-000000000003', 'Consultório Parado', 'consultorio-parado-c8000003',
   'c8000000-0000-4000-8000-000000000004', now() - interval '60 days');

insert into public.memberships (org_id, user_id, role) values
  ('c8100000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002', 'owner'),
  ('c8100000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000003', 'owner'),
  ('c8100000-0000-4000-8000-000000000003', 'c8000000-0000-4000-8000-000000000004', 'owner')
on conflict do nothing;

-- ---------- A trial with two days left ----------

insert into public.pro_trials (org_id, started_at, ends_at, minutes_limit, started_via) values
  ('c8100000-0000-4000-8000-000000000001', now() - interval '12 days', now() + interval '2 days', 300, 'recorder');

insert into public.patients (id, org_id, full_name) values
  ('c8200000-0000-4000-8000-000000000001', 'c8100000-0000-4000-8000-000000000001', 'Paciente Um'),
  ('c8200000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-000000000001', 'Paciente Dois');

insert into public.consultations (id, org_id, patient_id, status, started_at, finalized_at, finalized_by, duration_minutes)
values ('c8300000-0000-4000-8000-000000000001', 'c8100000-0000-4000-8000-000000000001',
        'c8200000-0000-4000-8000-000000000001', 'finalized', now() - interval '2 hours', now() - interval '1 hour',
        'c8000000-0000-4000-8000-000000000002', 60);
insert into public.consultations (id, org_id, patient_id, status, scheduled_for)
values ('c8300000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-000000000001',
        'c8200000-0000-4000-8000-000000000002', 'scheduled', now() + interval '2 days');

insert into public.audio_usage (org_id, seconds, cycle_seconds, pack_seconds, kind) values
  ('c8100000-0000-4000-8000-000000000001', 1800, 1800, 0, 'adjustment');

-- ---------- A paying practice, twelve days to renewal ----------

update public.subscriptions
set plan_id = (select id from public.plans where slug = 'pro'),
    period = (select period from public.plans where slug = 'pro'),
    status = 'active',
    provider = 'stripe',
    provider_subscription_id = 'sub_overview_c8',
    current_period_start = now() - interval '18 days',
    current_period_end = now() + interval '12 days'
where org_id = 'c8100000-0000-4000-8000-000000000002'
  and status in ('trialing', 'active', 'past_due');

-- ---------- A practice that worked once and went quiet ----------

insert into public.patients (id, org_id, full_name, created_at, updated_at) values
  ('c8200000-0000-4000-8000-000000000003', 'c8100000-0000-4000-8000-000000000003', 'Paciente Antigo',
   now() - interval '30 days', now() - interval '30 days');

-- ---------- A Pro plan the console gave away (0067): no provider ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at
) values
  ('c8000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'parceira@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Parceira"}'::jsonb, now(), now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('c8100000-0000-4000-8000-000000000004', 'Parceira Beta', 'parceira-beta-c8000004',
   'c8000000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role) values
  ('c8100000-0000-4000-8000-000000000004', 'c8000000-0000-4000-8000-000000000005', 'owner')
on conflict do nothing;

-- Comped exactly as set_org_plan leaves it: paid tier, no provider ids, and
-- NULL period bounds so the allowance keeps metering by calendar month.
update public.subscriptions
set plan_id = (select id from public.plans where slug = 'pro'),
    period = (select period from public.plans where slug = 'pro'),
    status = 'active',
    current_period_start = null,
    current_period_end = null
where org_id = 'c8100000-0000-4000-8000-000000000004'
  and status in ('trialing', 'active', 'past_due');

create temporary table overview_result (payload jsonb);
grant select, insert on table overview_result to authenticated;

-- ---------- Only a superadmin may read it ----------

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_accounts_overview()$$,
  'not_authorized',
  'a professional cannot read the platform''s account list'
);
reset role;

-- The nightly operator watch is a cron: no session, only the service key.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok(
  $$select public.admin_accounts_overview()$$,
  'the service role reads the same view, so the digest cannot describe a state the screen would contradict'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into overview_result values (public.admin_accounts_overview());
reset role;

create function pg_temp.acct(target uuid)
returns jsonb
language sql
stable
as $$
  select a
  from overview_result r
  cross join lateral jsonb_array_elements(r.payload -> 'accounts') a
  where a ->> 'orgId' = target::text
$$;

-- ---------- Who the account is ----------

select is(
  pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'owner' ->> 'name',
  'Dra. Trial',
  'a workspace called "Consultório" is still identifiable: the row carries the professional'
);
select is(
  pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'owner' ->> 'email',
  'trial@medchina.invalid',
  'with the address support would write to'
);
select is(
  pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'owner' ->> 'registration',
  'CRM 12345',
  'and the professional registration behind the signature'
);
select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'owner' ->> 'confirmed')::boolean,
  false,
  'an account that never confirmed its e-mail says so'
);
select ok(
  pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'flags' ? 'unconfirmed',
  'and is flagged for it'
);

-- ---------- The trial ----------

select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'trial' ->> 'daysLeft')::int,
  2,
  'the trial reports the days left, which is the whole reason to call today'
);
select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'trial' ->> 'minutesLimit')::int,
  300,
  'with the minute ceiling it also ends on'
);
select ok(
  pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'flags' ? 'trial_active'
  and pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'flags' ? 'trial_ending',
  'a trial inside its last three days is flagged as ending'
);
select is(
  pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'minutes' ->> 'source',
  'trial',
  'the minutes come from the trial pool, read from org_audio_allowance and not recalculated here'
);
select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'minutes' ->> 'used')::int,
  30,
  'and the consumption is the real one'
);

-- ---------- Usage ----------

select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'usage' ->> 'patients')::int,
  2,
  'the row says how much practice is actually inside the workspace'
);
select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'usage' ->> 'finalized')::int,
  1,
  'including finalized records'
);
select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'usage' ->> 'upcoming')::int,
  1,
  'and the appointments still ahead'
);

-- ---------- The paying practice ----------

select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000002') -> 'billing' ->> 'renewalDays')::int,
  12,
  'a paid subscription reports the days to its renewal'
);
select is(
  pg_temp.acct('c8100000-0000-4000-8000-000000000002') -> 'billing' ->> 'planSlug',
  'pro',
  'on the plan it actually pays for'
);
select ok(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000002') -> 'billing' ->> 'providerManaged')::boolean
  and pg_temp.acct('c8100000-0000-4000-8000-000000000002') -> 'flags' ? 'paid',
  'and is told apart from a plan the console gave away'
);

-- ---------- The money ----------

select is(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000002') -> 'billing' ->> 'monthlyCents')::int,
  29900,
  'the row carries the price normalized to a month (a yearly plan would read as a twelfth)'
);
select is(
  (select (payload -> 'totals' ->> 'mrrCents')::int from overview_result),
  29900,
  'MRR is exactly what the providers charge — the comped Pro below is not in it'
);
select ok(
  (select (payload -> 'totals' ->> 'compedMrrCents')::int from overview_result) = 29900
  and pg_temp.acct('c8100000-0000-4000-8000-000000000004') -> 'flags' ? 'paid'
  and not (pg_temp.acct('c8100000-0000-4000-8000-000000000004') -> 'billing' ->> 'providerManaged')::boolean,
  'a plan the console gave away is counted apart: capability granted, nobody charged'
);

-- ---------- The quiet one ----------

select ok(
  pg_temp.acct('c8100000-0000-4000-8000-000000000003') -> 'flags' ? 'never_activated'
  and pg_temp.acct('c8100000-0000-4000-8000-000000000003') -> 'flags' ? 'idle',
  'a practice that stopped is flagged idle, and one that never finalized a record is flagged apart'
);
select ok(
  (pg_temp.acct('c8100000-0000-4000-8000-000000000003') -> 'usage' ->> 'idleDays')::int >= 29,
  'with how long it has been quiet'
);
select ok(
  not (pg_temp.acct('c8100000-0000-4000-8000-000000000003') -> 'flags' ? 'new')
  and pg_temp.acct('c8100000-0000-4000-8000-000000000001') -> 'flags' ? 'new',
  'and "new" means new: the sixty-day-old workspace is not'
);

-- ---------- The tiles cannot disagree with the rows ----------

select ok(
  (select (payload -> 'totals' ->> 'accounts')::int from overview_result)
    = (select jsonb_array_length(payload -> 'accounts') from overview_result)
  and (select (payload -> 'totals' ->> 'trialEnding')::int from overview_result) >= 1
  and (select (payload -> 'totals' ->> 'paid')::int from overview_result) >= 1,
  'the summary totals are counted from the same rows the table shows'
);

select * from finish();
rollback;
