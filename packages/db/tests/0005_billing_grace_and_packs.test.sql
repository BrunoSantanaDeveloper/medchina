begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- ============================================================
-- Migrations 0054 (dunning grace window) and 0055 (à-la-carte minute packs).
--
-- The behavioural half of this file matters more than the structural half:
-- `org_audio_allowance` is the single answer the DB guard and the whole UI
-- share, so a mistake in its precedence does not surface as a broken screen —
-- it surfaces as someone being allowed, or refused, for the wrong reason.
-- ============================================================

-- ---------- Structure ----------

select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'past_due_since'
  ),
  'a failed renewal records when it started, which is what the window counts from'
);
select ok(
  exists(select 1 from public.platform_settings where key = 'dunning'),
  'the dunning window is configurable data, not a constant'
);
select ok(
  to_regprocedure('public.billing_past_due_grace_ends(public.subscriptions)') is not null,
  'every gate shares one answer about the grace window'
);
select ok(
  not has_function_privilege('authenticated', 'public.billing_past_due_grace_ends(public.subscriptions)', 'EXECUTE'),
  'the window helper is reachable only through the gates that use it'
);
select ok(
  exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'audio_minute_packs'),
  'purchased minutes live in their own ledger, not in the generic credit balance'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.audio_minute_packs'::regclass),
  'the pack ledger is protected by row level security'
);
select is(
  (
    select count(*)::integer from pg_policies
    where schemaname = 'public' and tablename = 'audio_minute_packs' and cmd <> 'SELECT'
  ),
  0,
  'no client may write the pack ledger — only the service role, like audio_usage'
);
select ok(
  exists(
    select 1 from pg_constraint
    where conrelid = 'public.audio_usage'::regclass
      and conname = 'audio_usage_funding_split_check' and convalidated
  ),
  'every usage row states which pool paid for it, and the parts must sum to the whole'
);
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'audio_usage_one_transcription_per_recording_idx'
  ),
  'the anti-double-billing index survived the split (it is the fence the pack debit relies on)'
);
select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans' and column_name = 'is_addon'
  ),
  'the catalog can tell a subscription tier from a one-off add-on'
);
select is(
  (select count(*)::integer from public.plans where is_addon and coalesce((limits ->> 'audio_minutes_pack')::int, 0) > 0),
  3,
  'the à-la-carte catalog is seeded'
);
select ok(
  (select bool_and(period is null and not is_free) from public.plans where is_addon),
  'a pack has no billing period, which is what makes the provider charge once'
);
select ok(
  to_regprocedure('public.complete_pack_checkout_billing_operation(uuid,uuid,uuid,text)') is not null
  and has_function_privilege(
    'service_role', 'public.complete_pack_checkout_billing_operation(uuid,uuid,uuid,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.complete_pack_checkout_billing_operation(uuid,uuid,uuid,text)', 'EXECUTE'
  ),
  'the à-la-carte checkout completes through a service-role-only RPC'
);

-- ---------- Fixtures ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'billing-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Billing Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('b2000000-0000-4000-8000-000000000001', 'Billing practice', 'billing-practice',
        'b1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

-- The org trigger already attached the free plan; replace it with a paid one
-- that includes minutes, which is the situation all of this is about.
update public.subscriptions
set plan_id = (select id from public.plans where slug = 'assistente'),
    status = 'active',
    current_period_start = now() - interval '5 days',
    current_period_end = now() + interval '25 days'
where org_id = 'b2000000-0000-4000-8000-000000000001';

create temporary table billing_results (name text primary key, payload jsonb);
grant select, insert on table billing_results to authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into billing_results values
  ('healthy', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'reason' from billing_results where name = 'healthy'),
  'ok',
  'a healthy paid workspace reports no impediment'
);
select is(
  (select payload ->> 'pack_purchasable' from billing_results where name = 'healthy'),
  'true',
  'a paid plan with minutes may top up à la carte'
);

-- ---------- The grace window ----------

update public.subscriptions
set status = 'past_due', past_due_since = now() - interval '2 days'
where org_id = 'b2000000-0000-4000-8000-000000000001';

insert into billing_results values
  ('grace', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'can_start' from billing_results where name = 'grace'),
  'true',
  'a recused card does not stop care while the window is open'
);
select is(
  (select payload ->> 'reason' from billing_results where name = 'grace'),
  'past_due_grace',
  'and the reason says so, instead of pretending the minutes ran out'
);
select ok(
  (select (payload ->> 'grace_ends_at')::timestamptz > now() from billing_results where name = 'grace'),
  'the deadline is reported so the UI can name it'
);

update public.subscriptions
set past_due_since = now() - interval '90 days'
where org_id = 'b2000000-0000-4000-8000-000000000001';

insert into billing_results values
  ('expired', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'can_start' from billing_results where name = 'expired'),
  'false',
  'once the window closes the previous behaviour returns'
);
select is(
  (select payload ->> 'reason' from billing_results where name = 'expired'),
  'past_due_blocked',
  'blocked for payment is never reported as an exhausted allowance'
);

-- ---------- Purchased minutes outlive the subscription ----------

insert into public.audio_minute_packs (org_id, source, minutes_purchased, seconds_total, invoice_key)
values ('b2000000-0000-4000-8000-000000000001', 'purchase', 100, 6000, 'test:invoice-1');

insert into billing_results values
  ('pack-past-due', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'can_start' from billing_results where name = 'pack-past-due'),
  'true',
  'minutes already paid for survive a failed renewal — that money is not refunded by blocking her'
);
select is(
  (select payload ->> 'pack_minutes_remaining' from billing_results where name = 'pack-past-due'),
  '100',
  'the purchased balance is reported apart from the cycle'
);

-- ---------- The kill-switch is absolute ----------

update public.subscriptions
set admin_suspended = true
where org_id = 'b2000000-0000-4000-8000-000000000001';

insert into billing_results values
  ('suspended', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'can_start' from billing_results where name = 'suspended'),
  'false',
  'a suspended workspace cannot escape through a pack'
);
select is(
  (select payload ->> 'reason' from billing_results where name = 'suspended'),
  'suspended',
  'suspension outranks every other cause'
);
select is(
  (select payload ->> 'pack_purchasable' from billing_results where name = 'suspended'),
  'false',
  'and it cannot buy its way out either'
);

-- ---------- Cycle first, pack second ----------

update public.subscriptions
set admin_suspended = false, status = 'active', past_due_since = null
where org_id = 'b2000000-0000-4000-8000-000000000001';

insert into billing_results values
  ('with-cycle', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'reason' from billing_results where name = 'with-cycle'),
  'ok',
  'while the cycle still has minutes the pack is not what is being spent'
);

-- Burn the whole Assistente cycle (3000 minutes), charged to the cycle pool.
insert into public.audio_usage (org_id, seconds, cycle_seconds, pack_seconds, kind, created_at)
values ('b2000000-0000-4000-8000-000000000001', 180000, 180000, 0, 'adjustment', now());

insert into billing_results values
  ('pack-only', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'can_start' from billing_results where name = 'pack-only'),
  'true',
  'an exhausted cycle no longer stops someone who bought minutes'
);
select is(
  (select payload ->> 'reason' from billing_results where name = 'pack-only'),
  'pack_only',
  'and she is told she is now spending the balance that does not come back at renewal'
);
select is(
  (select payload ->> 'cycle_minutes_remaining' from billing_results where name = 'pack-only'),
  '0',
  'the cycle is reported as spent'
);
select is(
  (select payload ->> 'minutes_remaining' from billing_results where name = 'pack-only'),
  '100',
  'what she can still record is the sum of both pools'
);

-- Pack-funded consumption must NOT count against the cycle as well.
insert into public.audio_usage (org_id, seconds, cycle_seconds, pack_seconds, kind, created_at)
values ('b2000000-0000-4000-8000-000000000001', 600, 0, 600, 'adjustment', now());

insert into billing_results values
  ('after-pack-use', public.org_audio_allowance('b2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'minutes_used' from billing_results where name = 'after-pack-use'),
  '3000',
  'pack-funded minutes are not charged to the cycle a second time'
);

reset role;

-- ---------- Constraints ----------

select throws_ok(
  $$insert into public.audio_usage (org_id, seconds, cycle_seconds, pack_seconds, kind)
    values ('b2000000-0000-4000-8000-000000000001', 100, 30, 30, 'adjustment')$$,
  '23514',
  null,
  'a usage row whose funding parts do not sum to the whole is rejected'
);
select throws_ok(
  $$update public.audio_minute_packs set seconds_consumed = seconds_total + 1
    where invoice_key = 'test:invoice-1'$$,
  '23514',
  null,
  'a pack cannot be consumed past what was bought'
);
select throws_ok(
  $$insert into public.audio_minute_packs (org_id, source, minutes_purchased, seconds_total, invoice_key)
    values ('b2000000-0000-4000-8000-000000000001', 'purchase', 100, 6000, 'test:invoice-1')$$,
  '23505',
  null,
  'one paid invoice grants one pack, however many times the provider delivers it'
);

select * from finish();
rollback;
