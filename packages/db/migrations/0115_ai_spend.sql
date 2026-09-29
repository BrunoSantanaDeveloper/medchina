-- ============================================================
-- 0115_ai_spend: what the AI costs us, per account.
--
-- Until now the platform could say how MUCH AI each workspace used — audio
-- seconds in `audio_usage`, library units in `library_usage`, counts of
-- hypotheses and plans — and nothing at all about what any of it cost. The
-- provider bills arrive as one number a month with no way to split them by
-- account, so "is this account worth what it costs?" had no answer, and a
-- workspace transcribing eight hours a day looked exactly like one
-- transcribing eight minutes.
--
-- The ledger below is the missing half: one row per billable AI operation,
-- with the units the provider actually charges for and the account that
-- caused it. `apps/web/src/lib/ai-spend.ts` writes a row from every call site
-- that spends money; nothing computes cost in the browser.
--
-- Three decisions worth knowing before reading the SQL:
--
--   * **Prices are configuration, never code.** They live in
--     `platform_settings` under 'ai_prices', are edited in /admin/ai, and
--     ship EMPTY. A model with no price produces a row with `priced = false`
--     and zero cost, and the consoles report how many calls are unpriced
--     rather than quietly showing a small bill. Provider list prices change;
--     a number hardcoded here would be wrong within a quarter and nobody
--     would notice.
--
--   * **Cost is stored in USD micros** (millionths of a dollar), the unit the
--     price lists are written in and the one that survives a 1,000-token call
--     without rounding to zero. Display converts with the `usdToBrl` rate the
--     operator sets; with no rate the consoles show USD instead of inventing
--     an exchange rate.
--
--   * **`org_id` is nullable on purpose.** The platform spends AI money that
--     belongs to no account: the superadmin's own /admin/insights questions
--     and ingestion of the shared clinical library. Those rows carry NULL and
--     read as platform overhead, never charged to a workspace.
--
-- The backfill at the end is the one place this migration looks backwards.
-- `audio_usage` has recorded real seconds per org since the recorder shipped,
-- and transcription is the biggest line of the bill, so it gets a history.
-- Those rows are marked `estimated`: the seconds are real, the model
-- attribution is not.
-- ============================================================

-- ---------- The ledger ----------

create table if not exists public.ai_spend (
  id uuid primary key default gen_random_uuid(),
  -- NULL = the platform's own spend (admin insights, shared-library ingestion).
  org_id uuid references public.organizations(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  -- What the money bought. Checked text rather than an enum so adding a
  -- feature is one migration instead of an enum rewrite behind every
  -- dependent function.
  feature text not null check (feature in (
    'transcription',   -- audio -> diarized transcript (packages/transcribe)
    'anamnesis',       -- structured anamnesis filled from the transcript
    'hypotheses',      -- disharmony-pattern hypotheses (Pro)
    'plan',            -- therapeutic-plan draft
    'attachment',      -- exam/photo analysis
    'library',         -- clinical-library study chat
    'case_review',     -- Pro case review over one patient's record
    'embedding',       -- vector embeddings (ingestion + query)
    'insights',        -- the superadmin's own plain-language DB questions
    'other'
  )),
  provider text not null,
  model text not null,
  tokens_in bigint not null default 0 check (tokens_in >= 0),
  tokens_out bigint not null default 0 check (tokens_out >= 0),
  -- Audio is billed as tokens by the providers we use, but the recorder
  -- measures seconds — keep both so a bill can be reconciled either way.
  audio_seconds integer not null default 0 check (audio_seconds >= 0),
  audio_tokens bigint not null default 0 check (audio_tokens >= 0),
  cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  -- false when no price is configured for this model: the call happened and
  -- cost something, we just cannot say how much yet.
  priced boolean not null default false,
  -- true for rows derived from recorded units instead of reported usage.
  estimated boolean not null default false,
  -- The recording / consultation / conversation it belongs to, when there is
  -- one. Deliberately untyped: the ledger must never block a delete.
  ref_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.ai_spend is
  'Append-only ledger of AI provider spend, one row per billable operation. org_id NULL = platform overhead.';

create index if not exists ai_spend_org_at_idx on public.ai_spend (org_id, occurred_at desc);
create index if not exists ai_spend_at_idx on public.ai_spend (occurred_at desc);
create index if not exists ai_spend_feature_idx on public.ai_spend (feature, occurred_at desc);

alter table public.ai_spend enable row level security;

-- Reading the ledger is a platform question, not a tenant one: it exposes
-- what every OTHER account costs the moment it can be filtered. Writes never
-- come from a policy — they come through record_ai_spend() below.
drop policy if exists ai_spend_select_superadmin on public.ai_spend;
create policy ai_spend_select_superadmin on public.ai_spend
  for select using (public.is_superadmin());

-- ---------- The price book ----------

/**
 * The configured price list, always a well-formed object so callers never
 * have to null-check their way through it.
 *
 * Shape (money in USD per MILLION tokens, the unit provider price lists use):
 *   {
 *     "usdToBrl": 5.4 | null,
 *     "audioTokensPerSecond": 32 | null,
 *     "models": {
 *       "gemini-2.5-flash": {
 *         "inPerMillion": 0.30, "outPerMillion": 2.50, "audioInPerMillion": 1.00
 *       }
 *     }
 *   }
 */
create or replace function public.ai_price_book()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select case
        when ps.value -> 'models' is null then ps.value || jsonb_build_object('models', '{}'::jsonb)
        else ps.value
      end
      from public.platform_settings ps where ps.key = 'ai_prices'
    ),
    jsonb_build_object('models', '{}'::jsonb)
  );
$$;

/**
 * What one operation costs, in USD micros, and whether we could price it.
 *
 * A token count multiplied by a per-million price lands exactly on micros
 * (tokens / 1e6 * price * 1e6), which is why the ledger stores micros: no
 * rounding happens until the console formats it.
 */
create or replace function public.ai_spend_cost(
  target_model text,
  target_tokens_in bigint,
  target_tokens_out bigint,
  target_audio_tokens bigint
)
returns table (cost_usd_micros bigint, priced boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  price jsonb;
  in_rate numeric;
  out_rate numeric;
  audio_rate numeric;
begin
  price := public.ai_price_book() -> 'models' -> target_model;
  if price is null then
    return query select 0::bigint, false;
    return;
  end if;

  in_rate := nullif(price ->> 'inPerMillion', '')::numeric;
  out_rate := nullif(price ->> 'outPerMillion', '')::numeric;
  -- Audio falls back to the plain input rate: most providers bill audio as
  -- ordinary input tokens, and a missing audio rate must not make a
  -- transcription read as free.
  audio_rate := coalesce(nullif(price ->> 'audioInPerMillion', '')::numeric, in_rate);

  if in_rate is null and out_rate is null and audio_rate is null then
    return query select 0::bigint, false;
    return;
  end if;

  return query select
    round(
      coalesce(target_tokens_in, 0) * coalesce(in_rate, 0)
      + coalesce(target_tokens_out, 0) * coalesce(out_rate, 0)
      + coalesce(target_audio_tokens, 0) * coalesce(audio_rate, 0)
    )::bigint,
    true;
end;
$$;

/** Seconds of audio in tokens, when the operator has told us the ratio. */
create or replace function public.ai_audio_tokens(target_seconds integer)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select case
    when coalesce(target_seconds, 0) <= 0 then 0
    else coalesce(
      round(target_seconds * nullif(public.ai_price_book() ->> 'audioTokensPerSecond', '')::numeric)::bigint,
      0
    )
  end;
$$;

-- ---------- Writing to the ledger ----------

/**
 * Records one AI operation. Callers pass what the provider reported; the price
 * is applied here so cost can never disagree between call sites.
 *
 * The gate is deliberately loose about WHO writes: the clinical pipeline runs
 * inside the professional's own request, so a member may record spend for her
 * own workspace. She can never read the ledger back (RLS above), and the worst
 * she can do is make her own account look more expensive than it is. Platform
 * rows (org NULL) are service-role or superadmin only.
 */
create or replace function public.record_ai_spend(
  target_org uuid,
  target_feature text,
  target_provider text,
  target_model text,
  target_tokens_in bigint default 0,
  target_tokens_out bigint default 0,
  target_audio_seconds integer default 0,
  target_audio_tokens bigint default 0,
  target_ref uuid default null,
  target_estimated boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
  priced_cost record;
  new_id uuid;
  billable_audio bigint;
begin
  if target_org is null then
    if not (is_service or public.is_superadmin()) then
      raise exception 'not_authorized';
    end if;
  elsif not (
    is_service
    or public.is_superadmin()
    or exists (
      select 1 from public.memberships m
      where m.org_id = target_org and m.user_id = auth.uid()
    )
  ) then
    raise exception 'not_authorized';
  end if;

  -- A caller that measured seconds but not tokens (any provider that does not
  -- report audio usage) still gets priced, as long as the operator configured
  -- how many tokens a second of audio costs.
  billable_audio := coalesce(target_audio_tokens, 0);
  if billable_audio = 0 then
    billable_audio := public.ai_audio_tokens(coalesce(target_audio_seconds, 0));
  end if;

  select c.cost_usd_micros, c.priced into priced_cost
  from public.ai_spend_cost(
    target_model,
    coalesce(target_tokens_in, 0),
    coalesce(target_tokens_out, 0),
    billable_audio
  ) c;

  insert into public.ai_spend (
    org_id, feature, provider, model,
    tokens_in, tokens_out, audio_seconds, audio_tokens,
    cost_usd_micros, priced, estimated, ref_id, created_by
  ) values (
    target_org, target_feature, target_provider, target_model,
    coalesce(target_tokens_in, 0), coalesce(target_tokens_out, 0),
    coalesce(target_audio_seconds, 0), billable_audio,
    priced_cost.cost_usd_micros, priced_cost.priced,
    coalesce(target_estimated, false), target_ref, auth.uid()
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- Supabase grants EXECUTE to anon through default privileges, so revoking
-- from PUBLIC alone leaves the anonymous role able to call it.
revoke all on function public.ai_price_book() from public, anon;
revoke all on function public.ai_spend_cost(text, bigint, bigint, bigint) from public, anon;
revoke all on function public.ai_audio_tokens(integer) from public, anon;
revoke all on function public.record_ai_spend(uuid, text, text, text, bigint, bigint, integer, bigint, uuid, boolean) from public, anon;
grant execute on function public.record_ai_spend(uuid, text, text, text, bigint, bigint, integer, bigint, uuid, boolean) to authenticated, service_role;

/**
 * Re-prices rows the price book could not price when they were written — the
 * normal case the first time prices are entered, and after every edit. Audio
 * rows recorded before `audioTokensPerSecond` existed get their tokens
 * derived here too, from the seconds that were always real.
 *
 * Returns how many rows changed.
 */
create or replace function public.reprice_ai_spend(since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  with recomputed as (
    select
      s.id,
      case
        when s.audio_tokens > 0 then s.audio_tokens
        else public.ai_audio_tokens(s.audio_seconds)
      end as audio_tokens,
      s.tokens_in,
      s.tokens_out,
      s.model
    from public.ai_spend s
    where since is null or s.occurred_at >= since
  ),
  priced as (
    select r.id, r.audio_tokens, c.cost_usd_micros, c.priced
    from recomputed r
    cross join lateral public.ai_spend_cost(r.model, r.tokens_in, r.tokens_out, r.audio_tokens) c
  )
  update public.ai_spend s
  set cost_usd_micros = p.cost_usd_micros,
      priced = p.priced,
      audio_tokens = p.audio_tokens
  from priced p
  where p.id = s.id
    and (
      s.cost_usd_micros is distinct from p.cost_usd_micros
      or s.priced is distinct from p.priced
      or s.audio_tokens is distinct from p.audio_tokens
    );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.reprice_ai_spend(timestamptz) from public, anon;
grant execute on function public.reprice_ai_spend(timestamptz) to authenticated, service_role;

-- ---------- What the platform spends ----------

/**
 * The AI bill as the operator needs to read it: one window, split by what the
 * money bought, by model, and by which accounts caused it.
 *
 * `unpricedCalls` sits next to every total on purpose. A zero beside 400
 * unpriced calls is a missing price list, not a cheap month, and the console
 * has to be able to tell those apart.
 */
create or replace function public.admin_ai_spend_overview(window_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
  window_since timestamptz;
  span integer := greatest(coalesce(window_days, 30), 1);
begin
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  window_since := now() - (span || ' days')::interval;

  with windowed as (
    select * from public.ai_spend where occurred_at >= window_since
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'windowDays', span,
    'since', window_since,
    -- When real measurement started, so a small number reads as "we only just
    -- began counting" instead of "the AI is nearly free".
    'measuringSince', (select min(occurred_at) from public.ai_spend where not estimated),
    'usdToBrl', nullif(public.ai_price_book() ->> 'usdToBrl', '')::numeric,
    'pricedModels', (select count(*) from jsonb_object_keys(public.ai_price_book() -> 'models')),
    'totals', (
      select jsonb_build_object(
        'costUsdMicros', coalesce(sum(cost_usd_micros), 0),
        'calls', count(*),
        'unpricedCalls', count(*) filter (where not priced),
        'estimatedCalls', count(*) filter (where estimated),
        'tokensIn', coalesce(sum(tokens_in), 0),
        'tokensOut', coalesce(sum(tokens_out), 0),
        'audioSeconds', coalesce(sum(audio_seconds), 0),
        'accountCostUsdMicros', coalesce(sum(cost_usd_micros) filter (where org_id is not null), 0),
        'platformCostUsdMicros', coalesce(sum(cost_usd_micros) filter (where org_id is null), 0),
        'accountsWithSpend', count(distinct org_id) filter (where org_id is not null)
      )
      from windowed
    ),
    'byFeature', coalesce((
      select jsonb_agg(x.f order by x.cost desc)
      from (
        select
          coalesce(sum(cost_usd_micros), 0) as cost,
          jsonb_build_object(
            'feature', feature,
            'costUsdMicros', coalesce(sum(cost_usd_micros), 0),
            'calls', count(*),
            'unpricedCalls', count(*) filter (where not priced)
          ) as f
        from windowed group by feature
      ) x
    ), '[]'::jsonb),
    'byModel', coalesce((
      select jsonb_agg(x.m order by x.cost desc)
      from (
        select
          coalesce(sum(cost_usd_micros), 0) as cost,
          jsonb_build_object(
            'provider', provider,
            'model', model,
            'costUsdMicros', coalesce(sum(cost_usd_micros), 0),
            'calls', count(*),
            'priced', bool_or(priced)
          ) as m
        from windowed group by provider, model
      ) x
    ), '[]'::jsonb),
    -- The accounts the bill is actually made of, worst first.
    'topAccounts', coalesce((
      select jsonb_agg(x.a order by x.cost desc)
      from (
        select
          coalesce(sum(w.cost_usd_micros), 0) as cost,
          jsonb_build_object(
            'orgId', w.org_id,
            'name', o.name,
            'costUsdMicros', coalesce(sum(w.cost_usd_micros), 0),
            'calls', count(*)
          ) as a
        from windowed w
        join public.organizations o on o.id = w.org_id
        where w.org_id is not null
        group by w.org_id, o.name
        order by coalesce(sum(w.cost_usd_micros), 0) desc
        limit 10
      ) x
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_ai_spend_overview(integer) from public, anon;
grant execute on function public.admin_ai_spend_overview(integer) to authenticated, service_role;

-- ---------- Seed the (empty) price book ----------

-- Deliberately empty: prices are the operator's to enter, and a number
-- invented here would silently become "what the AI costs" everywhere.
insert into public.platform_settings (key, value)
values ('ai_prices', jsonb_build_object('usdToBrl', null, 'audioTokensPerSecond', null, 'models', '{}'::jsonb))
on conflict (key) do nothing;

-- ---------- Backfill: transcription history from recorded seconds ----------

-- `audio_usage` has counted real seconds per workspace since the recorder
-- shipped, and transcription is the biggest line of the AI bill, so the
-- ledger starts with that history instead of pretending the past was free.
-- The model is the recorder's current default rather than whatever ran at the
-- time — hence `estimated`, and hence no token counts: only what we measured.
-- Cost stays 0 until `reprice_ai_spend()` runs against a filled price book.
insert into public.ai_spend (
  org_id, occurred_at, feature, provider, model,
  audio_seconds, audio_tokens, cost_usd_micros, priced, estimated, ref_id, created_by, created_at
)
select
  au.org_id,
  au.created_at,
  'transcription',
  'gemini',
  'gemini-2.5-flash',
  au.seconds,
  public.ai_audio_tokens(au.seconds),
  0,
  false,
  true,
  au.recording_id,
  au.created_by,
  au.created_at
from public.audio_usage au
where au.seconds > 0
  and not exists (
    select 1 from public.ai_spend s
    where s.estimated
      and s.feature = 'transcription'
      and s.org_id is not distinct from au.org_id
      and s.occurred_at = au.created_at
  );

