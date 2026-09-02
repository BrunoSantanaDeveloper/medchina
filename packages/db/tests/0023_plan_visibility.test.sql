begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ============================================================
-- Migration 0085 — a plan can be SELLABLE without being LISTED.
--
-- The founders offer (docs/FUNIL.md) is sold through a link, at a price that
-- must not sit next to the table price in the catalog. Before this column the
-- only switch was `is_active`, which also decides whether a plan may be charged
-- for at all — so taking the offer off the grids made it impossible to buy, and
-- leaving it buyable published the price to everybody.
--
-- These assertions pin BOTH halves of the distinction. An unlisted plan stays
-- readable, assignable and entitled exactly like any other; an inactive one
-- stops being all three. Without the second half the first would just be
-- recording that a column exists.
-- ============================================================

select has_column('public', 'plans', 'is_public', 'the catalog carries a visibility flag of its own');

-- The migration must not have quietly emptied the pricing page: the column
-- defaults to true, so every row that predates it stayed listed.
--
-- Scoped to the CATALOG TIERS on purpose. Written as "no plan anywhere is
-- unlisted" this passed forever on a fresh database and failed against every
-- real one the moment the founders offer went live — forbidding the exact
-- capability the rest of this file exercises. What must hold for good is that
-- the grid still has its tiers, not that nothing may ever be hidden from it.
select is(
  (
    select count(*)::integer from public.plans
    where slug in ('gratuito', 'assistente', 'pro') and not is_public
  ),
  0,
  'the catalog tiers stayed listed — an offer may unlist itself, the pricing grid may not empty'
);

-- ---------- The offer: Pro limits at a founder price, off the catalog ----------

insert into public.plans (slug, name, kind, period, price_cents, is_active, limits, sort)
values (
  'pro-fundador-test', 'Fundadores (test)', 'recurring', 'yearly', 199000, true,
  '{"audio_minutes": 6000, "clinical_reasoning": 1}'::jsonb, 90
);

select is(
  (select is_public from public.plans where slug = 'pro-fundador-test'),
  true,
  'a new plan is listed unless it says otherwise — hiding is the deliberate act'
);

update public.plans set is_public = false where slug = 'pro-fundador-test';

-- ---------- Fixtures: an operator and the workspace that buys the offer ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'operator.visibility@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now()
  ),
  (
    'f1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'founder.visibility@medchina.invalid', '',
    '{}'::jsonb, '{"display_name":"Founder"}'::jsonb, now(), now()
  );

update public.profiles set is_superadmin = true where id = 'f1000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by)
values ('f2000000-0000-4000-8000-000000000001', 'Founder practice', 'founder-practice',
        'f1000000-0000-4000-8000-000000000002');

insert into public.memberships (org_id, user_id, role)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'owner')
on conflict do nothing;

create temporary table visibility_results (name text primary key, payload jsonb);
grant select, insert on table visibility_results to authenticated, service_role;

-- ---------- The link has to resolve: an unlisted plan is still readable ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.plans where slug = 'pro-fundador-test'),
  1,
  'a signed-in prospect can still read the unlisted plan — the offer link resolves through her own session'
);
reset role;

-- The contrast that gives that meaning: deactivating is the harsher switch, and
-- it takes the row away from her entirely (policy plans_select, 0001).
update public.plans set is_active = false where slug = 'pro-fundador-test';

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.plans where slug = 'pro-fundador-test'),
  0,
  'an INACTIVE plan disappears for her — which is why closing an offer must unlist it, not deactivate it'
);
reset role;

-- ---------- Assigning the offer from the console ----------

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$select public.set_org_plan('f2000000-0000-4000-8000-000000000001',
      (select id from public.plans where slug = 'pro-fundador-test'), null)$$,
  'plan_not_found',
  'and an inactive plan cannot be assigned either — deactivating truly retires it'
);
reset role;

update public.plans set is_active = true where slug = 'pro-fundador-test';

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
insert into visibility_results values (
  'assigned',
  public.set_org_plan(
    'f2000000-0000-4000-8000-000000000001',
    (select id from public.plans where slug = 'pro-fundador-test'),
    'founders offer'
  )
);
reset role;

select is(
  (select payload ->> 'toPlan' from visibility_results where name = 'assigned'),
  'pro-fundador-test',
  'an unlisted plan is assignable from the console — unlisting never makes a plan unsellable'
);

-- ---------- The entitlement comes from the plan row, which is the whole design ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into visibility_results values
  ('allowance', public.org_audio_allowance('f2000000-0000-4000-8000-000000000001'));
reset role;

select is(
  (select payload ->> 'clinical_reasoning' from visibility_results where name = 'allowance'),
  'true',
  'the founder workspace gets Pro reasoning from the offer row limits — no separate grant to keep in sync'
);
select is(
  (select payload ->> 'minutes_limit' from visibility_results where name = 'allowance'),
  '6000',
  'and the Pro minute allowance, at the founder price'
);

-- ---------- The catalog listings are the only thing visibility changes ----------

select is(
  (
    select count(*)::integer from public.plans
    where is_active and not is_addon and is_public and slug = 'pro-fundador-test'
  ),
  0,
  'the offer is excluded from the public pricing query (is_active + not is_addon + is_public)'
);

select * from finish();
rollback;
