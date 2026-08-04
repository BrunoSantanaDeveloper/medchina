begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ============================================================
-- Migration 0067 — assigning a plan without a checkout.
--
-- The traps this RPC exists to close are not visible in its result value, so
-- they are asserted directly: the period bounds it must leave NULL (a comped
-- plan with a fixed end date silently stops metering), the refusal to touch a
-- provider-backed subscription, the free plan as the way to remove a paid one,
-- and the audit event that has to name a self-grant as such.
-- ============================================================

select ok(
  to_regprocedure('public.set_org_plan(uuid,uuid,text)') is not null,
  'assigning a plan goes through a guarded RPC, not a raw table write'
);
select ok(
  has_function_privilege('authenticated', 'public.set_org_plan(uuid,uuid,text)', 'EXECUTE'),
  'an authenticated session can reach it (is_superadmin inside is the real gate)'
);
select ok(
  not has_function_privilege('anon', 'public.set_org_plan(uuid,uuid,text)', 'EXECUTE'),
  'anonymous callers cannot'
);

-- ---------- Fixtures: an operator, a customer and a target workspace ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'operator@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()
  ),
  (
    'e1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'customer@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Customer"}'::jsonb, now(), now()
  );

update public.profiles set is_superadmin = true where id = 'e1000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by)
values
  ('e2000000-0000-4000-8000-000000000001', 'Customer practice', 'customer-practice',
   'e1000000-0000-4000-8000-000000000002'),
  -- The operator's OWN workspace: self-assignment is allowed on purpose.
  ('e2000000-0000-4000-8000-000000000002', 'Operator practice', 'operator-practice',
   'e1000000-0000-4000-8000-000000000001');

insert into public.memberships (org_id, user_id, role)
values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'owner'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

create temporary table plan_results (name text primary key, payload jsonb);
grant select, insert on table plan_results to authenticated, service_role;

-- ---------- Only a superadmin may assign ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$select public.set_org_plan(
      'e2000000-0000-4000-8000-000000000001',
      (select id from public.plans where slug = 'assistente'),
      null
    )$$,
  'not_authorized',
  'a workspace owner cannot put themselves on a paid plan'
);
reset role;

-- ---------- The operator comps a customer ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

insert into plan_results values (
  'comp',
  public.set_org_plan(
    'e2000000-0000-4000-8000-000000000001',
    (select id from public.plans where slug = 'pro'),
    'beta partner'
  )
);
reset role;

select is(
  (select payload ->> 'toPlan' from plan_results where name = 'comp'),
  'pro',
  'the workspace lands on the requested tier'
);
select is(
  (select payload ->> 'fromPlan' from plan_results where name = 'comp'),
  'gratuito',
  'and the previous tier is reported, so the change is legible'
);
select is(
  (select payload ->> 'selfGrant' from plan_results where name = 'comp'),
  'false',
  'comping somebody else is not a self-grant'
);
select is(
  (
    select count(*)::integer from public.subscriptions
    where org_id = 'e2000000-0000-4000-8000-000000000001'
      and status in ('trialing', 'active', 'past_due')
  ),
  1,
  'the org still holds exactly one live subscription (updated, never inserted)'
);
select ok(
  (
    select current_period_start is null and current_period_end is null
    from public.subscriptions
    where org_id = 'e2000000-0000-4000-8000-000000000001' and status = 'active'
  ),
  'the period bounds are left NULL — a fixed end date nothing renews would stop metering consumption entirely'
);

-- The allowance must actually meter this comped plan. 6.000 Pro minutes, all
-- spent right now: if the window were broken the usage would not be seen.
insert into public.audio_usage (org_id, seconds, cycle_seconds, pack_seconds, kind)
values ('e2000000-0000-4000-8000-000000000001', 360000, 360000, 0, 'adjustment');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into plan_results values
  ('allowance', public.org_audio_allowance('e2000000-0000-4000-8000-000000000001'));
reset role;

select is(
  (select payload ->> 'minutes_limit' from plan_results where name = 'allowance'),
  '6000',
  'the comped plan grants its real minute allowance'
);
select is(
  (select payload ->> 'minutes_used' from plan_results where name = 'allowance'),
  '6000',
  'and consumption against it is counted — the comped plan is metered, not unlimited'
);
-- 0069 deliberately untied reasoning from the audio meter: it consumes no
-- minutes, so exhausting them was charging a Pro customer twice for the same
-- exhaustion (no audio AND no reasoning, then a prompt to buy the plan she
-- already had). The entitlement now follows the PLAN — and a comped plan is a
-- real plan. What still removes it is the plan becoming unusable, asserted next.
select is(
  (select payload ->> 'clinical_reasoning' from plan_results where name = 'allowance'),
  'true',
  'an exhausted comped Pro keeps the reasoning layer — it costs no minutes (0069)'
);

-- The property that DID survive the change: reasoning follows the plan's
-- USABILITY, and suspension is the sharpest form of unusable. Without this the
-- assertion above would just be recording that a gate was removed.
update public.subscriptions set admin_suspended = true
where org_id = 'e2000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into plan_results values
  ('allowance-suspended', public.org_audio_allowance('e2000000-0000-4000-8000-000000000001'));
reset role;

select is(
  (select payload ->> 'clinical_reasoning' from plan_results where name = 'allowance-suspended'),
  'false',
  'but a SUSPENDED comped plan loses it — the entitlement follows plan usability'
);

-- Restore: this workspace is asserted against again further down.
update public.subscriptions set admin_suspended = false
where org_id = 'e2000000-0000-4000-8000-000000000001';

-- ---------- Self-assignment is allowed, and named in the trail ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into plan_results values (
  'self',
  public.set_org_plan(
    'e2000000-0000-4000-8000-000000000002',
    (select id from public.plans where slug = 'pro'),
    'own workspace'
  )
);
reset role;

select is(
  (select payload ->> 'selfGrant' from plan_results where name = 'self'),
  'true',
  'an operator may put their own workspace on a plan'
);
select ok(
  exists(
    select 1 from public.audit_events
    where org_id = 'e2000000-0000-4000-8000-000000000002'
      and action = 'admin.org.plan_assigned'
      and actor_id = 'e1000000-0000-4000-8000-000000000001'
      and metadata ->> 'self_grant' = 'true'
      and metadata ->> 'to_plan' = 'pro'
  ),
  'and the audit trail records that it WAS a self-grant — the case an auditor looks for'
);

-- ---------- Removing a paid plan means assigning the free one ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into plan_results values (
  'downgrade',
  public.set_org_plan(
    'e2000000-0000-4000-8000-000000000001',
    (select id from public.plans where is_free and is_active order by created_at limit 1),
    'beta ended'
  )
);

select is(
  (select payload ->> 'toPlan' from plan_results where name = 'downgrade'),
  'gratuito',
  'a downgrade is the same operation, so the org is never left without a subscription'
);

-- ---------- What it refuses ----------

select throws_ok(
  format(
    $$select public.set_org_plan('e2000000-0000-4000-8000-000000000001', %L, null)$$,
    (select id from public.plans where is_addon limit 1)
  ),
  'plan_not_assignable',
  'an à-la-carte minute pack is not a tier and cannot be subscribed to'
);
select throws_ok(
  $$select public.set_org_plan('e2000000-0000-4000-8000-000000000099',
      (select id from public.plans where slug = 'pro'), null)$$,
  'organization_not_found',
  'an unknown workspace is refused'
);
reset role;

-- A provider-backed subscription is off limits: changing the plan locally
-- while the provider keeps charging the old one is a billing inconsistency.
update public.subscriptions
set provider = 'stripe', provider_subscription_id = 'sub_test_123'
where org_id = 'e2000000-0000-4000-8000-000000000001' and status = 'active';

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.set_org_plan('e2000000-0000-4000-8000-000000000001',
      (select id from public.plans where slug = 'pro'), null)$$,
  'provider_managed',
  'a workspace that pays through a provider cannot be re-planned from the console'
);
reset role;

select * from finish();
rollback;
