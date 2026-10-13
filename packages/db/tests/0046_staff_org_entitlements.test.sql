begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ============================================================
-- Migration 0118 — our own accounts are not customers.
--
-- Two workspaces that differ in exactly one way: a superadmin is a member of
-- one of them. Everything below is about keeping that difference contained —
-- the operator's workspace stops being ceilinged, the customer's does not
-- move at all, and the kill switch keeps winning over both.
-- ============================================================

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at
) values
  ('b4000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff.gate@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operadora"}'::jsonb, now(), now(), now()),
  ('b4000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cliente.gate@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Cliente"}'::jsonb, now(), now(), now()),
  ('b4000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staffpago.gate@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operadora Pagante"}'::jsonb, now(), now(), now());

update public.profiles set is_superadmin = true
where id in ('b4000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000003');

insert into public.organizations (id, name, slug, created_by) values
  ('b4100000-0000-4000-8000-000000000001', 'Consultório da Operadora', 'operadora-b4', 'b4000000-0000-4000-8000-000000000001'),
  ('b4100000-0000-4000-8000-000000000002', 'Consultório da Cliente', 'cliente-b4', 'b4000000-0000-4000-8000-000000000002'),
  ('b4100000-0000-4000-8000-000000000003', 'Operadora que paga', 'operadora-paga-b4', 'b4000000-0000-4000-8000-000000000003');

insert into public.memberships (org_id, user_id, role) values
  ('b4100000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'owner'),
  ('b4100000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'owner'),
  ('b4100000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-000000000003', 'owner')
on conflict do nothing;

-- ---------- Who is staff ----------

select ok(
  public.is_staff_org('b4100000-0000-4000-8000-000000000001'),
  'a workspace with a superadmin member is ours'
);

select ok(
  not public.is_staff_org('b4100000-0000-4000-8000-000000000002'),
  'a customer workspace is not, and nothing below may touch it'
);

select ok(
  (select count(*) from public.staff_plan()) = 1,
  'the catalog resolves to exactly one tier for staff'
);

select ok(
  (select not coalesce(is_free, false) and not coalesce(is_addon, false) and is_active from public.staff_plan()),
  'and it is a real, active subscription tier — never the free floor, never a top-up'
);

select is(
  (select coalesce((limits ->> 'audio_minutes')::int, 0) from public.staff_plan()),
  (select max(coalesce((limits ->> 'audio_minutes')::int, 0)) from public.plans
   where is_active and not coalesce(is_free, false) and not coalesce(is_addon, false) and period = 'monthly'),
  'the most capable one in the dimension that actually gates the product'
);

-- ---------- Imports: the bug that started this ----------

select is(
  (public.org_import_allowance('b4100000-0000-4000-8000-000000000002') ->> 'maxRows')::int,
  200,
  'a customer on the free tier still gets the free tier ceiling'
);

select ok(
  (public.org_import_allowance('b4100000-0000-4000-8000-000000000001') ->> 'unlimited')::boolean,
  'our own workspace does not: the import ceiling is gone'
);

select ok(
  public.org_import_allowance('b4100000-0000-4000-8000-000000000001') ->> 'maxRows' is null,
  'no number at all, which is how the commit RPCs and the screen read "unlimited"'
);

select ok(
  (public.org_import_allowance('b4100000-0000-4000-8000-000000000001') ->> 'allowed')::boolean,
  'and it may import'
);

-- ---------- Audio: the ceiling an operator hits next ----------

select is(
  (public.org_audio_allowance('b4100000-0000-4000-8000-000000000001') ->> 'minutes_limit')::int,
  (select coalesce((limits ->> 'audio_minutes')::int, 0) from public.staff_plan()),
  'the operator records on the catalog tier''s minutes, not on a 300-minute trial'
);

select ok(
  (public.org_audio_allowance('b4100000-0000-4000-8000-000000000001') ->> 'can_start')::boolean,
  'she may start a recording without starting a trial first'
);

select ok(
  (public.org_audio_allowance('b4100000-0000-4000-8000-000000000001') ->> 'clinical_reasoning')::boolean,
  'with the Pro reasoning the tier carries'
);

select is(
  public.org_audio_allowance('b4100000-0000-4000-8000-000000000001') ->> 'source',
  'plan',
  'and the source is the plan, so nothing in the product offers her a trial'
);

select ok(
  (public.org_audio_allowance('b4100000-0000-4000-8000-000000000002') ->> 'minutes_limit')::int
  <> (select coalesce((limits ->> 'audio_minutes')::int, 0) from public.staff_plan()),
  'the customer beside her is untouched'
);

-- ---------- Library and entitlements ----------

select ok(
  (public.org_message_allowance('b4100000-0000-4000-8000-000000000001', 'biblioteca-mtc') ->> 'unlimited')::boolean,
  'the library quota does not apply to our own workspace'
);

select ok(
  (public.org_entitlements('b4100000-0000-4000-8000-000000000001') ->> 'active')::boolean,
  'the workspace is entitled even with no paid subscription of its own'
);

select is(
  (public.org_entitlements('b4100000-0000-4000-8000-000000000001') ->> 'plan_id')::uuid,
  (select id from public.staff_plan()),
  'on the catalog tier'
);

select is(
  public.org_entitlements('b4100000-0000-4000-8000-000000000001') -> 'limits',
  (select limits from public.staff_plan()),
  'with that tier''s limits, so every feature keyed off them turns on'
);

-- ---------- A staff workspace that really pays keeps its own plan ----------

-- The sign-up trigger already left a live free subscription; this makes it a
-- provider-backed paid one, which must win over the grant.
insert into public.plans (id, slug, name, price_cents, currency, period, is_free, limits)
values ('b4300000-0000-4000-8000-000000000001', 'assistente-b4', 'Assistente B4', 19900, 'BRL', 'monthly', false,
        '{"audio_minutes": 3000}'::jsonb)
on conflict (slug) do nothing;

update public.subscriptions
set plan_id = 'b4300000-0000-4000-8000-000000000001', status = 'active', provider = 'stripe',
    provider_subscription_id = 'sub_b4_paid', period = 'monthly',
    current_period_start = now() - interval '5 days', current_period_end = now() + interval '25 days'
where org_id = 'b4100000-0000-4000-8000-000000000003'
  and status in ('trialing', 'active', 'past_due');

select is(
  (public.org_entitlements('b4100000-0000-4000-8000-000000000003') ->> 'plan_id')::uuid,
  'b4300000-0000-4000-8000-000000000001'::uuid,
  'a staff workspace that is actually being charged keeps the plan it pays for'
);

select is(
  (public.org_audio_allowance('b4100000-0000-4000-8000-000000000003') ->> 'minutes_limit')::int,
  3000,
  'and its minutes, because overriding them would bill one tier and meter another'
);

-- ---------- The kill switch wins over all of it ----------

update public.subscriptions set admin_suspended = true
where org_id = 'b4100000-0000-4000-8000-000000000001'
  and status in ('trialing', 'active', 'past_due');

select is(
  public.org_import_allowance('b4100000-0000-4000-8000-000000000001') ->> 'reason',
  'suspended',
  'a suspended workspace stays suspended even when a superadmin is a member'
);

select ok(
  not (public.org_audio_allowance('b4100000-0000-4000-8000-000000000001') ->> 'can_start')::boolean,
  'the recorder stays shut too'
);

select ok(
  not (public.org_message_allowance('b4100000-0000-4000-8000-000000000001', 'biblioteca-mtc') ->> 'allowed')::boolean,
  'and the library with it — the one control that may never have an exception'
);

-- ---------- Losing the role loses the grant ----------

update public.subscriptions set admin_suspended = false
where org_id = 'b4100000-0000-4000-8000-000000000001'
  and status in ('trialing', 'active', 'past_due');

update public.profiles set is_superadmin = false where id = 'b4000000-0000-4000-8000-000000000001';

select is(
  (public.org_import_allowance('b4100000-0000-4000-8000-000000000001') ->> 'maxRows')::int,
  200,
  'revoking the role puts the workspace back under the plan it actually has'
);

select * from finish();
rollback;
