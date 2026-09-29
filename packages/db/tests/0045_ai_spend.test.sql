begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- ============================================================
-- Migrations 0115/0116/0117 — what the AI costs, per account.
--
-- Three accounts, three situations the operator has to tell apart: a paying
-- practice whose bill is smaller than its plan, a free account burning money
-- for nothing, and a model nobody priced. The assertions concentrate on the
-- two ways this feature could lie: arithmetic that silently rounds a
-- fractional cost to zero, and an unpriced call that reads as a cheap month.
-- ============================================================

select ok(
  has_function_privilege('authenticated', 'public.admin_ai_spend_overview(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_ai_spend_overview(integer)', 'EXECUTE'),
  'the bill is reachable by a signed-in session only (the gate inside is is_superadmin)'
);

-- ---------- Fixtures ----------

-- The local database carries its own ledger (0115 backfills transcription
-- history from recorded seconds), and several assertions below are about
-- platform-wide totals. The whole file runs in a transaction that rolls back,
-- so emptying the ledger isolates the test without costing anything.
delete from public.ai_spend;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at
) values
  ('a7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator.spend@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now(), now()),
  ('a7000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paga.spend@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Paga"}'::jsonb, now(), now(), now()),
  ('a7000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gratis.spend@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Gratis"}'::jsonb, now(), now(), now());

update public.profiles set is_superadmin = true where id = 'a7000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by) values
  ('a7100000-0000-4000-8000-000000000001', 'Consultório Pagante', 'pagante-a7', 'a7000000-0000-4000-8000-000000000002'),
  ('a7100000-0000-4000-8000-000000000002', 'Consultório Gratuito', 'gratuito-a7', 'a7000000-0000-4000-8000-000000000003');

insert into public.memberships (org_id, user_id, role) values
  ('a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'owner'),
  ('a7100000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003', 'owner')
on conflict do nothing;

-- A paid plan, so the margin and the "costs more than it pays" flag have a
-- revenue side to compare against.
insert into public.plans (id, slug, name, price_cents, currency, period, is_free, limits)
values ('a7300000-0000-4000-8000-000000000001', 'pro-a7', 'Pro A7', 29900, 'BRL', 'monthly', false,
        '{"audio_minutes": 6000}'::jsonb)
on conflict (slug) do nothing;

-- The sign-up trigger already created a live free subscription for the new
-- workspace, and only one may be live at a time: this UPDATES it, the way
-- 0067 does, instead of inserting a second.
update public.subscriptions
set plan_id = 'a7300000-0000-4000-8000-000000000001', status = 'active', provider = 'stripe',
    provider_subscription_id = 'sub_a7_live', period = 'monthly',
    current_period_start = now() - interval '10 days', current_period_end = now() + interval '20 days'
where org_id = 'a7100000-0000-4000-8000-000000000001'
  and status in ('trialing', 'active', 'past_due');

-- ---------- The price book ----------

-- Deliberately partial: 'gemini-2.5-flash' is priced and 'modelo-novo' is not,
-- which is the state every platform is in the week after it adds a model.
update public.platform_settings
set value = jsonb_build_object(
  'usdToBrl', 5.0,
  'audioTokensPerSecond', 32,
  'models', jsonb_build_object(
    'gemini-2.5-flash', jsonb_build_object('inPerMillion', 0.30, 'outPerMillion', 2.50, 'audioInPerMillion', 1.00),
    -- No audio rate on purpose: audio must fall back to the input rate rather
    -- than making a transcription read as free.
    'claude-sonnet-5', jsonb_build_object('inPerMillion', 3.00, 'outPerMillion', 15.00)
  )
)
where key = 'ai_prices';

select is(
  (select cost_usd_micros from public.ai_spend_cost('gemini-2.5-flash', 1000000, 1000000, 0)),
  2800000::bigint,
  'a million in and a million out cost exactly $2.80 — tokens x price-per-million lands on micros with no rounding'
);

select is(
  (select cost_usd_micros from public.ai_spend_cost('gemini-2.5-flash', 1000, 0, 0)),
  300::bigint,
  'a thousand input tokens cost 300 micros — the unit that keeps a small call from rounding to zero'
);

select is(
  (select cost_usd_micros from public.ai_spend_cost('claude-sonnet-5', 0, 0, 1000000)),
  3000000::bigint,
  'audio with no audio rate falls back to the input rate instead of being free'
);

select ok(
  not (select priced from public.ai_spend_cost('modelo-novo', 999999, 999999, 0)),
  'a model with no price is NOT priced — the call happened and we say we cannot cost it'
);

select is(
  (select cost_usd_micros from public.ai_spend_cost('modelo-novo', 999999, 999999, 0)),
  0::bigint,
  'and it costs zero, which is why every console reports the unpriced COUNT beside the total'
);

select is(public.ai_audio_tokens(60), 1920::bigint, 'a minute of audio is 1.920 tokens at the configured ratio');
select is(public.ai_audio_tokens(0), 0::bigint, 'no audio, no tokens');

-- ---------- Who may write, who may read ----------

select set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.record_ai_spend(
      'a7100000-0000-4000-8000-000000000001', 'hypotheses', 'gemini', 'gemini-2.5-flash', 10000, 2000)$$,
  'a member records spend for her OWN workspace — the clinical pipeline runs inside her request'
);

select throws_ok(
  $$select public.record_ai_spend(
      'a7100000-0000-4000-8000-000000000002', 'library', 'gemini', 'gemini-2.5-flash', 10, 10)$$,
  'not_authorized',
  'but never for somebody else''s workspace'
);

select throws_ok(
  $$select public.record_ai_spend(null, 'insights', 'gemini', 'gemini-2.5-flash', 10, 10)$$,
  'not_authorized',
  'and platform spend (org NULL) is not hers to write either'
);

select is(
  (select count(*)::int from public.ai_spend),
  0,
  'she cannot read the ledger back: it would expose what every other account costs'
);

reset role;

-- ---------- The rest of the ledger, written as the service role ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- Transcription: the seconds are what the recorder measured, the audio tokens
-- what the provider reported.
select public.record_ai_spend('a7100000-0000-4000-8000-000000000001', 'transcription', 'gemini',
  'gemini-2.5-flash', 500, 3000, 1800, 57600);

-- The free account burns money with no plan behind it.
select public.record_ai_spend('a7100000-0000-4000-8000-000000000002', 'transcription', 'gemini',
  'gemini-2.5-flash', 100, 500, 600, 19200);

-- A model nobody priced yet, on the paying account.
select public.record_ai_spend('a7100000-0000-4000-8000-000000000001', 'plan', 'gemini',
  'modelo-novo', 50000, 8000);

-- The operator's own questions: platform overhead, charged to nobody.
select public.record_ai_spend(null, 'insights', 'anthropic', 'claude-sonnet-5', 20000, 1000);

select is(
  (select audio_tokens from public.ai_spend
   where org_id = 'a7100000-0000-4000-8000-000000000001' and feature = 'transcription'),
  57600::bigint,
  'reported audio tokens win over the ratio — the provider knows better than our conversion'
);

select is(
  (select cost_usd_micros from public.ai_spend
   where org_id = 'a7100000-0000-4000-8000-000000000001' and feature = 'transcription'),
  (500 * 0.30 + 3000 * 2.50 + 57600 * 1.00)::bigint,
  'a transcription is priced on all three meters at once: text in, text out, audio in'
);

select ok(
  (select not priced from public.ai_spend where model = 'modelo-novo'),
  'the unpriced call is recorded as unpriced rather than dropped'
);

-- ---------- A call recorded BEFORE its price existed ----------

update public.platform_settings
set value = jsonb_set(value, '{models,modelo-novo}',
  jsonb_build_object('inPerMillion', 1.00, 'outPerMillion', 4.00))
where key = 'ai_prices';

select ok(
  (select public.reprice_ai_spend()) >= 1,
  'filling in a missing price re-prices what is already in the book — the first month is not stuck at zero'
);

select is(
  (select cost_usd_micros from public.ai_spend where model = 'modelo-novo'),
  (50000 * 1.00 + 8000 * 4.00)::bigint,
  'and the re-priced row now carries the cost it always had'
);

-- An audio row written with seconds but no tokens: the state every backfilled
-- row is in. Repricing must derive the tokens from the seconds.
insert into public.ai_spend (org_id, feature, provider, model, audio_seconds, audio_tokens, priced, estimated)
values ('a7100000-0000-4000-8000-000000000002', 'transcription', 'gemini', 'gemini-2.5-flash', 120, 0, false, true);

select ok((select public.reprice_ai_spend()) >= 1, 'the estimated row is re-priced too');

select is(
  (select audio_tokens from public.ai_spend where estimated and audio_seconds = 120),
  3840::bigint,
  'seconds become tokens through the configured ratio, so history recovered from the recorder can be priced'
);

-- ---------- The platform bill ----------

select is(
  ((public.admin_ai_spend_overview(30) -> 'totals' ->> 'platformCostUsdMicros')::bigint),
  (20000 * 3.00 + 1000 * 15.00)::bigint,
  'the operator''s own insights are platform overhead, kept apart from every account'
);

select is(
  ((public.admin_ai_spend_overview(30) -> 'totals' ->> 'accountsWithSpend')::int),
  2,
  'two accounts spent something'
);

select is(
  ((public.admin_ai_spend_overview(30) -> 'totals' ->> 'estimatedCalls')::int),
  1,
  'and one of the lines is an estimate, which the console has to be able to say'
);

select is(
  (select jsonb_array_length(public.admin_ai_spend_overview(30) -> 'byFeature')),
  4,
  'the bill splits by what the money bought: transcription, hypotheses, plan, insights'
);

select ok(
  ((public.admin_ai_spend_overview(30) -> 'topAccounts' -> 0 ->> 'costUsdMicros')::bigint)
  >= ((public.admin_ai_spend_overview(30) -> 'topAccounts' -> 1 ->> 'costUsdMicros')::bigint),
  'the accounts that make up the bill come worst first'
);

select is(
  ((public.admin_ai_spend_overview(30) ->> 'usdToBrl')::numeric),
  5.0::numeric,
  'the rate travels with the bill so the console never has to guess one'
);

-- ---------- The account list ----------

create temporary table spend_overview (payload jsonb);
insert into spend_overview values (public.admin_accounts_overview());

create function pg_temp.acct(target uuid)
returns jsonb
language sql
stable
as $$
  select a
  from spend_overview r
  cross join lateral jsonb_array_elements(r.payload -> 'accounts') a
  where a ->> 'orgId' = target::text
$$;

select is(
  ((pg_temp.acct('a7100000-0000-4000-8000-000000000001') -> 'aiCost' ->> 'usdMicros30d')::bigint),
  (select coalesce(sum(cost_usd_micros), 0)::bigint from public.ai_spend
   where org_id = 'a7100000-0000-4000-8000-000000000001'),
  'every row carries what that account cost us, from the same ledger the totals read'
);

select is(
  ((pg_temp.acct('a7100000-0000-4000-8000-000000000001') -> 'aiCost' ->> 'unpriced30d')::int),
  0,
  'and how much of it we could not price — zero here, now that the model has a price'
);

select ok(
  (pg_temp.acct('a7100000-0000-4000-8000-000000000001') -> 'aiCost' -> 'byFeature30d') ? 'transcription',
  'split by feature on the row itself, so a listing can say WHERE the money went'
);

select is(
  ((pg_temp.acct('a7100000-0000-4000-8000-000000000001') -> 'aiCost' ->> 'cents30d')::bigint),
  round((select sum(cost_usd_micros) from public.ai_spend
         where org_id = 'a7100000-0000-4000-8000-000000000001') * 5.0 / 10000.0)::bigint,
  'converted with the operator''s own rate, so cost can stand beside revenue'
);

select ok(
  (pg_temp.acct('a7100000-0000-4000-8000-000000000002') -> 'flags') ? 'ai_cost_unpaid',
  'the free account that burns money is flagged: spend with no paid subscription behind it'
);

select ok(
  not ((pg_temp.acct('a7100000-0000-4000-8000-000000000001') -> 'flags') ? 'ai_cost_unpaid'),
  'and the paying one is not'
);

select ok(
  ((pg_temp.acct('a7100000-0000-4000-8000-000000000001') -> 'aiCost' ->> 'marginCents')::bigint) < 29900,
  'the margin is the plan minus the bill, never the plan alone'
);

select is(
  ((spend_overview.payload -> 'totals' ->> 'aiCostAccounts')::int),
  2,
  'the tile counts the accounts with spend, from the same query as the rows under it'
) from spend_overview;

select is(
  ((spend_overview.payload -> 'totals' ->> 'aiPlatformCost30dUsdMicros')::bigint),
  (20000 * 3.00 + 1000 * 15.00)::bigint,
  'platform overhead is reported beside the accounts, never divided among them'
) from spend_overview;

-- ---------- The dossier ----------

select is(
  ((public.admin_account_dossier('a7100000-0000-4000-8000-000000000001') -> 'ai' -> 'spend' -> 'window'
    ->> 'costUsdMicros')::bigint),
  (select coalesce(sum(cost_usd_micros), 0)::bigint from public.ai_spend
   where org_id = 'a7100000-0000-4000-8000-000000000001'),
  'the dossier and the list agree about one account, because both read the ledger'
);

select ok(
  (select jsonb_array_length(
    public.admin_account_dossier('a7100000-0000-4000-8000-000000000001') -> 'ai' -> 'spend' -> 'byFeature')) >= 2,
  'and it breaks the account''s own bill down by what the money bought'
);

select is(
  (select jsonb_array_length(
    public.admin_account_dossier('a7100000-0000-4000-8000-000000000001') -> 'ai' -> 'spend' -> 'monthly')),
  6,
  'with six months of history, so a cost that doubled has a shape'
);

select ok(
  (select sum((line ->> 'audioSeconds')::int)
   from jsonb_array_elements(
     public.admin_account_dossier('a7100000-0000-4000-8000-000000000001') -> 'ai' -> 'spend' -> 'byFeature') line) > 0,
  'the units travel with the cost — a provider invoice can only be argued with in seconds and tokens'
);

-- ---------- Deleting the account takes its ledger ----------

delete from public.organizations where id = 'a7100000-0000-4000-8000-000000000002';

select is(
  (select count(*)::int from public.ai_spend where org_id = 'a7100000-0000-4000-8000-000000000002'),
  0,
  'the ledger cascades with the workspace: account deletion means ALL its data, cost history included'
);

select is(
  (select count(*)::int from public.ai_spend where org_id is null),
  1,
  'while platform overhead, which belonged to no workspace, survives'
);

reset role;

select * from finish();
rollback;
