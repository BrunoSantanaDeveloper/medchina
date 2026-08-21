begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ============================================================
-- Migration 0087 — the founders offer counter and gate.
--
-- The property worth pinning is not "the function returns a number": it is that
-- the number shown on the landing page and the decision that refuses a checkout
-- come from the SAME call. A counter that decorates the page while the checkout
-- keeps selling turns a 30-seat offer into whatever volume showed up; a page
-- that says "sold out" while the checkout still works is the same bug mirrored.
--
-- So the assertions walk the offer through its whole life — unopened, open,
-- filling up, sold out, expired — and check the reason at each step, because
-- "sold out" and "not opened yet" are indistinguishable from seats_left alone
-- and the page has to say something different for each.
-- ============================================================

select ok(
  to_regprocedure('public.founders_offer()') is not null,
  'the offer state is one guarded function, not a query each caller writes'
);
select ok(
  has_function_privilege('anon', 'public.founders_offer()', 'EXECUTE'),
  'an anonymous visitor can read the counter — it renders before any sign-up'
);

-- ---------- Fixtures: the offer plan and two buyers ----------

insert into public.plans (slug, name, kind, period, price_cents, is_active, is_public, limits, sort)
values ('pro-fundador-t', 'Founders (test)', 'recurring', 'yearly', 199000, true, false,
        '{"audio_minutes": 6000, "clinical_reasoning": 1}'::jsonb, 91);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'founder1@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"F1"}'::jsonb, now(), now()),
  ('b1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'founder2@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"F2"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by)
values
  ('b2000000-0000-4000-8000-000000000001', 'Founder one', 'founder-one', 'b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'Founder two', 'founder-two', 'b1000000-0000-4000-8000-000000000002');

-- ---------- Closed until an operator opens it ----------

update public.platform_settings
set value = jsonb_build_object('enabled', false, 'plan_slug', 'pro-fundador-t', 'seats', 2, 'deadline', null)
where key = 'founders';

select is(
  (public.founders_offer() ->> 'reason'),
  'disabled',
  'an offer nobody opened reports itself as disabled, not as sold out'
);
select is(
  (public.founders_offer() ->> 'closed'),
  'true',
  'and is closed, so the checkout guard refuses it'
);

-- ---------- Open, with seats ----------

update public.platform_settings
set value = jsonb_build_object('enabled', true, 'plan_slug', 'pro-fundador-t', 'seats', 2, 'deadline', null)
where key = 'founders';

select is((public.founders_offer() ->> 'seats_left'), '2', 'an untouched offer has all its seats');
select is((public.founders_offer() ->> 'reason'), 'open', 'and is open for business');

-- ---------- A seat is held by a LIVE subscription, not by an abandoned cart ----------

insert into public.subscriptions (org_id, plan_id, status, period)
values ('b2000000-0000-4000-8000-000000000001',
        (select id from public.plans where slug = 'pro-fundador-t'), 'incomplete', 'yearly');

select is(
  (public.founders_offer() ->> 'seats_taken'),
  '0',
  'a checkout that was started and never paid does not burn a seat'
);

update public.subscriptions set status = 'active'
where org_id = 'b2000000-0000-4000-8000-000000000001';

select is(
  (public.founders_offer() ->> 'seats_taken'),
  '1',
  'paying for it does'
);

-- ---------- Sold out stops the sale ----------

insert into public.subscriptions (org_id, plan_id, status, period)
values ('b2000000-0000-4000-8000-000000000002',
        (select id from public.plans where slug = 'pro-fundador-t'), 'active', 'yearly');

select is((public.founders_offer() ->> 'seats_left'), '0', 'the last seat leaves none');
select is(
  (public.founders_offer() ->> 'reason'),
  'sold_out',
  'and the offer reports sold_out — the counter and the checkout guard read this same answer'
);

-- A founder who cancels releases her seat: the offer is a headcount of live
-- founders, not a tally of everyone who ever joined.
update public.subscriptions set status = 'canceled'
where org_id = 'b2000000-0000-4000-8000-000000000002';

select is(
  (public.founders_offer() ->> 'seats_left'),
  '1',
  'a cancellation frees the seat back up'
);

-- ---------- A passed deadline closes it even with seats left ----------

update public.platform_settings
set value = jsonb_build_object(
  'enabled', true, 'plan_slug', 'pro-fundador-t', 'seats', 2,
  'deadline', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SSOF')
)
where key = 'founders';

select is(
  (public.founders_offer() ->> 'reason'),
  'expired',
  'the deadline closes the offer independently of the seat count'
);

select * from finish();
rollback;
