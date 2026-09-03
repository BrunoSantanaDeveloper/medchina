begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ============================================================
-- Migration 0088 — the two high-intent offers.
--
-- What separates this from a countdown gimmick is a small set of properties
-- that are invisible in the UI and easy to lose in a refactor, so they are
-- pinned here rather than trusted to review:
--
--   * the deadline is stamped once and never extended;
--   * each moment fires at most once per workspace, for life;
--   * two offers never run at the same time;
--   * a paying workspace never sees one;
--   * a dismissal is final.
--
-- Take any one of those away and the "48 hours" on screen stops being true.
-- ============================================================

select ok(
  to_regprocedure('public.open_conversion_offer(uuid,text)') is not null,
  'offers are opened through a guarded RPC that owns the eligibility rules'
);
select ok(
  not has_function_privilege('anon', 'public.open_conversion_offer(uuid,text)', 'EXECUTE'),
  'an anonymous caller cannot open one'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'trial.offer@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"Trial"}'::jsonb, now(), now()),
  ('c1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'payer.offer@medchina.invalid', '',
   '{}'::jsonb, '{"display_name":"Payer"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by)
values
  ('c2000000-0000-4000-8000-000000000001', 'Trial practice', 'trial-practice-offer',
   'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002', 'Paying practice', 'paying-practice-offer',
   'c1000000-0000-4000-8000-000000000002');

insert into public.memberships (org_id, user_id, role)
values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'owner')
on conflict do nothing;

create temporary table offer_results (name text primary key, payload jsonb);
grant select, insert on table offer_results to authenticated, service_role;

-- ---------- Nothing happens until the operator turns it on ----------

update public.platform_settings
set value = jsonb_build_object('enabled', false, 'window_hours', 48, 'coupon_code', 'PRIMEIRA',
                               'first_consultation', true, 'usage_80', true)
where key = 'conversion_offers';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into offer_results values
  ('disabled', public.open_conversion_offer('c2000000-0000-4000-8000-000000000001', 'first_consultation'));
reset role;

select is(
  (select payload ->> 'reason' from offer_results where name = 'disabled'),
  'disabled',
  'a campaign that was never turned on opens nothing'
);

update public.platform_settings
set value = jsonb_build_object('enabled', true, 'window_hours', 48, 'coupon_code', 'PRIMEIRA',
                               'first_consultation', true, 'usage_80', true)
where key = 'conversion_offers';

-- ---------- The first moment ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into offer_results values
  ('first', public.open_conversion_offer('c2000000-0000-4000-8000-000000000001', 'first_consultation'));
reset role;

select is(
  (select payload ->> 'opened' from offer_results where name = 'first'),
  'true',
  'finalizing the first record opens the offer'
);
select is(
  (select payload ->> 'coupon_code' from offer_results where name = 'first'),
  'PRIMEIRA',
  'and freezes the benefit onto the row, so changing the campaign later cannot rewrite a promise already made'
);

-- ---------- Two offers never run at once ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into offer_results values
  ('stacked', public.open_conversion_offer('c2000000-0000-4000-8000-000000000001', 'usage_80'));
reset role;

select is(
  (select payload ->> 'reason' from offer_results where name = 'stacked'),
  'already_open',
  'crossing 80% while the activation offer is live does not stack a second deadline on the same decision'
);

-- ---------- A moment fires once per workspace, for life ----------

-- The window closes on its own; the trigger still must not fire again.
update public.conversion_offers
set opened_at = now() - interval '10 days', expires_at = now() - interval '8 days'
where org_id = 'c2000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into offer_results values
  ('repeat', public.open_conversion_offer('c2000000-0000-4000-8000-000000000001', 'first_consultation'));
reset role;

select is(
  (select payload ->> 'reason' from offer_results where name = 'repeat'),
  'already_used',
  'an expired offer never comes back — a deadline that renews is just the price with a timer on it'
);

-- With the first window expired, the OTHER moment may still have its turn.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into offer_results values
  ('second-moment', public.open_conversion_offer('c2000000-0000-4000-8000-000000000001', 'usage_80'));
reset role;

select is(
  (select payload ->> 'opened' from offer_results where name = 'second-moment'),
  'true',
  'the 80% moment is a different offer and gets its own single turn'
);

-- ---------- She sees it, and only hers ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into offer_results values
  ('visible', public.current_conversion_offer('c2000000-0000-4000-8000-000000000001'));
select is(
  (select payload ->> 'active' from offer_results where name = 'visible'),
  'true',
  'the workspace it was opened for can read it'
);
select throws_ok(
  $$select public.current_conversion_offer('c2000000-0000-4000-8000-000000000002')$$,
  'not a member of this organization',
  'and cannot read another workspace''s'
);
reset role;

-- ---------- Dismissing is final ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
perform public.dismiss_conversion_offer('c2000000-0000-4000-8000-000000000001');
insert into offer_results values
  ('dismissed', public.current_conversion_offer('c2000000-0000-4000-8000-000000000001'));
reset role;

select is(
  (select payload ->> 'active' from offer_results where name = 'dismissed'),
  'false',
  'a card she said no to does not come back on the next page load'
);

-- ---------- A paying workspace is not a prospect ----------

update public.subscriptions
set plan_id = (select id from public.plans where slug = 'pro'), status = 'active', period = 'monthly'
where org_id = 'c2000000-0000-4000-8000-000000000002';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into offer_results values
  ('payer', public.open_conversion_offer('c2000000-0000-4000-8000-000000000002', 'first_consultation'));
reset role;

select is(
  (select payload ->> 'reason' from offer_results where name = 'payer'),
  'already_paying',
  'discounting to someone who already bought at full price is how a launch loses the customers it has'
);

select * from finish();
rollback;
