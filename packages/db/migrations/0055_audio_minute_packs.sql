-- ============================================================
-- 0055_audio_minute_packs: minutes sold à la carte (PRD §5.8).
--
-- The gap this closes: when a cycle ran out, the ONLY move was to change plan
-- — and someone already on Pro had nowhere to go. She would finish the
-- recording that was in flight (that guarantee is older than this migration
-- and untouched here) and then simply stop being able to start new ones until
-- the cycle renewed. A pack is the missing answer, and it is an ACTIVE
-- purchase: PRD §5.8's promise that nothing is ever billed as an overage
-- without prior authorization stays literally true.
--
-- Three decisions worth stating, because the code alone does not explain them:
--
--  1. Packs are a SECOND pool, consumed only after the cycle pool. If the
--     cycle spent them first, buying one would produce no visible change.
--
--  2. Consumption is attributed WHEN IT IS WRITTEN, not derived later. The
--     tempting shortcut — "pack used = total overflow past the cycle limit" —
--     silently refunds the pack at every cycle turnover, because the overflow
--     resets with the window while the purchase does not.
--
--  3. Paid minutes outlive the subscription that was active when they were
--     bought: `past_due`, a cancellation and a downgrade to Gratuito all leave
--     them usable, because the money is already ours. The one thing they do
--     NOT survive is `admin_suspended` — the superadmin kill-switch answers to
--     abuse, and an escape hatch would defeat it.
-- ============================================================

-- ---------- The catalog knows what is not a subscription tier ----------
-- `plans` is also what the pricing grids render. Without an explicit marker a
-- minute pack would appear on the public /planos page as if it were a fourth
-- tier, next to Gratuito/Assistente/Pro.

alter table public.plans
  add column if not exists is_addon boolean not null default false;

-- Volumes come from the PRD (§5.8: "pacotes adicionais … em volumes como 600,
-- 1.500 e 3.000 minutos, após validação de custo"). Prices are launch
-- hypotheses like every other price here — superadmin-editable rows in
-- /admin/billing, never constants in code — and they are deliberately dearer
-- per minute than the plans that include minutes (Assistente ≈ R$0,066/min,
-- Pro ≈ R$0,050/min). A pack is convenience for someone who ran out, never a
-- cheaper way to buy the same thing: at these prices 3.000 à-la-carte minutes
-- cost MORE than the Assistente plan that bundles 3.000, which is exactly the
-- signal we want anyone doing the arithmetic to find.
insert into public.plans (
  slug, name, description, kind, period, price_cents, currency,
  is_free, is_addon, credit_amount, credits_expire, limits, sort
)
values
  (
    'pacote-600-min',
    'Pacote 600 minutos',
    '600 minutos extras de gravação com IA. Compra única, sem validade — consumidos só depois que os minutos do seu plano acabarem.',
    'credits', null, 5990, 'BRL', false, true, 600, false,
    '{"audio_minutes_pack": 600}'::jsonb, 10
  ),
  (
    'pacote-1500-min',
    'Pacote 1.500 minutos',
    '1.500 minutos extras de gravação com IA. Compra única, sem validade — consumidos só depois que os minutos do seu plano acabarem.',
    'credits', null, 13990, 'BRL', false, true, 1500, false,
    '{"audio_minutes_pack": 1500}'::jsonb, 11
  ),
  (
    'pacote-3000-min',
    'Pacote 3.000 minutos',
    '3.000 minutos extras de gravação com IA. Compra única, sem validade — consumidos só depois que os minutos do seu plano acabarem.',
    'credits', null, 24990, 'BRL', false, true, 3000, false,
    '{"audio_minutes_pack": 3000}'::jsonb, 12
  )
on conflict (slug) do nothing;

-- ---------- The purchased pool ----------
-- Everything in seconds, because that is the unit consumption is measured in
-- (`audio_usage.seconds`); minutes are a display concern. `minutes_purchased`
-- is kept for the receipt — what she believes she bought must survive a later
-- edit to the catalog row.

create table public.audio_minute_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The catalog row this came from; null for a support grant.
  plan_id uuid references public.plans (id) on delete set null,
  source text not null default 'purchase' check (source in ('purchase', 'grant')),
  minutes_purchased integer not null check (minutes_purchased > 0),
  seconds_total integer not null check (seconds_total > 0),
  seconds_consumed integer not null default 0 check (seconds_consumed >= 0),
  price_cents integer,
  currency text,
  -- Idempotency for the webhook: one grant per paid invoice, however many
  -- times the provider delivers it. Null for support grants.
  invoice_key text unique,
  -- Null = never expires, which is what the catalog above sells today. The
  -- column exists so expiry becomes a data decision, and FIFO consumption
  -- below already orders by it.
  expires_at timestamptz,
  granted_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint audio_minute_packs_not_overconsumed check (seconds_consumed <= seconds_total)
);

create index audio_minute_packs_org_idx on public.audio_minute_packs (org_id, created_at);

-- The balance query only ever wants packs with something left in them.
create index audio_minute_packs_available_idx on public.audio_minute_packs (org_id)
  where seconds_consumed < seconds_total;

alter table public.audio_minute_packs enable row level security;

-- Members see what they bought; nobody but the service role writes it — the
-- same rule as `audio_usage`, and for the same reason: a browser must not be
-- able to tell the platform how many minutes it owns.
create policy "audio_minute_packs_select_member" on public.audio_minute_packs for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

-- ---------- Which pool paid for each recording ----------
-- One row per recording still (the unique index from 0030 is what prevents
-- double billing and stays intact) — the split lives in two columns on that
-- row, so `sum(pack_seconds)` and `sum(packs.seconds_consumed)` are the same
-- number by construction.

alter table public.audio_usage
  add column if not exists cycle_seconds integer,
  add column if not exists pack_seconds integer not null default 0;

update public.audio_usage set cycle_seconds = seconds where cycle_seconds is null;

alter table public.audio_usage
  alter column cycle_seconds set not null,
  alter column cycle_seconds set default 0;

alter table public.audio_usage
  add constraint audio_usage_funding_split_check
    check (cycle_seconds >= 0 and pack_seconds >= 0 and cycle_seconds + pack_seconds = seconds);

-- ---------- Allowance: two pools, one answer ----------
-- Still the single source of truth the DB guard and the app share. The pack
-- pool joins it rather than becoming a second opinion the UI has to add up.

create or replace function public.org_audio_allowance(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  trial public.pro_trials%rowtype;
  window_start timestamptz;
  window_end timestamptz;
  limit_minutes integer := 0;
  used_seconds bigint := 0;
  used_minutes integer := 0;
  percent integer := 0;
  src text := 'none';
  plan_minutes integer := 0;
  trial_available boolean := false;
  cycle_can_start boolean := false;
  can_start boolean := false;
  can_reason boolean := false;
  suspended boolean := false;
  grace_ends timestamptz;
  in_grace boolean := false;
  plan_usable boolean := false;
  pack_seconds_left bigint := 0;
  pack_minutes_left integer := 0;
  pack_purchasable boolean := false;
  reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if sub.id is not null then
    select * into plan from public.plans where id = sub.plan_id;
    plan_minutes := coalesce((plan.limits ->> 'audio_minutes')::int, 0);
  end if;

  suspended := coalesce(sub.admin_suspended, false);
  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  plan_usable := sub.id is not null
    and not suspended
    and (sub.status in ('trialing', 'active') or in_grace);

  select * into trial from public.pro_trials where org_id = target_org;

  if plan_minutes > 0 then
    if plan_usable then
      src := 'plan';
      limit_minutes := plan_minutes;
      window_start := coalesce(sub.current_period_start, date_trunc('month', now()));
      window_end := coalesce(sub.current_period_end, window_start + interval '1 month');
    end if;
  elsif trial.org_id is not null and not suspended then
    src := 'trial';
    limit_minutes := trial.minutes_limit;
    window_start := trial.started_at;
    window_end := trial.ends_at;
  end if;

  trial_available := trial.org_id is null and plan_minutes = 0 and not suspended;

  -- Cycle consumption counts only what the CYCLE funded. Summing `seconds`
  -- here would charge pack-funded minutes to the cycle as well, so a pack
  -- would burn both pools at once.
  if src <> 'none' then
    select coalesce(sum(cycle_seconds), 0) into used_seconds
    from public.audio_usage
    where org_id = target_org
      and created_at >= window_start
      and (window_end is null or created_at < window_end);
  end if;

  used_minutes := ceil(used_seconds / 60.0);

  if limit_minutes > 0 then
    percent := least(floor(used_minutes * 100.0 / limit_minutes)::int, 999);
    cycle_can_start := used_minutes < limit_minutes;
  end if;

  if src = 'trial' and now() >= trial.ends_at then
    cycle_can_start := false;
  end if;

  -- Already paid for, so it survives everything except the kill-switch.
  if not suspended then
    select coalesce(sum(seconds_total - seconds_consumed), 0) into pack_seconds_left
    from public.audio_minute_packs
    where org_id = target_org
      and seconds_consumed < seconds_total
      and (expires_at is null or expires_at > now());
  end if;

  -- Floor, never ceil: a remaining balance must not promise a minute that is
  -- not there. The cost is that the last sub-minute reads as 0 while still
  -- being usable, which errs in the customer's favour.
  pack_minutes_left := floor(pack_seconds_left / 60.0);
  can_start := cycle_can_start or pack_seconds_left > 0;

  if src = 'trial' then
    can_reason := can_start;
  elsif src = 'plan' then
    can_reason := can_start and coalesce((plan.limits ->> 'clinical_reasoning')::int, 0) > 0;
  end if;

  -- Who may buy a pack (a commercial rule, enforced again server-side in
  -- startPackCheckout): only a paid plan that already includes minutes. Open
  -- to Gratuito it would become a cheaper substitute for the subscription
  -- rather than a top-up for someone who ran out.
  pack_purchasable := plan_usable and plan_minutes > 0 and not coalesce(plan.is_free, true);

  if suspended then
    reason := 'suspended';
  elsif sub.status = 'past_due' and not in_grace and not can_start then
    reason := 'past_due_blocked';
  elsif can_start then
    reason := case
      when in_grace then 'past_due_grace'
      -- Working on minutes she bought separately: worth saying, because it is
      -- a balance that does not come back at the next renewal.
      when not cycle_can_start then 'pack_only'
      else 'ok'
    end;
  elsif trial_available then
    reason := 'trial_not_started';
  elsif src = 'trial' then
    reason := 'trial_over';
  elsif src = 'plan' then
    reason := 'cycle_exhausted';
  else
    reason := 'no_plan';
  end if;

  return jsonb_build_object(
    'source', src,
    'plan_slug', plan.slug,
    'plan_name', plan.name,
    'suspended', suspended,
    -- `minutes_limit` / `minutes_used` / `percent` stay the CYCLE's, which is
    -- what the 80/95/100% alerts are about; the pack pool is reported beside
    -- them, never folded into them.
    'minutes_limit', limit_minutes,
    'minutes_used', used_minutes,
    'cycle_minutes_remaining', greatest(limit_minutes - used_minutes, 0),
    'pack_minutes_remaining', pack_minutes_left,
    -- What she can actually still record, which is the sum.
    'minutes_remaining', greatest(limit_minutes - used_minutes, 0) + pack_minutes_left,
    'percent', percent,
    'window_start', window_start,
    'window_end', window_end,
    'trial_active', src = 'trial' and cycle_can_start,
    'trial_ends_at', trial.ends_at,
    'trial_available', trial_available,
    'can_start', can_start,
    'clinical_reasoning', can_reason,
    'reason', reason,
    'past_due', sub.status = 'past_due',
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'pack_purchasable', pack_purchasable
  );
end;
$$;

grant execute on function public.org_audio_allowance(uuid) to authenticated;

-- ---------- Consumption, attributed at write time ----------
-- The cycle is charged first and the pack takes only the remainder it can
-- actually cover. Anything left over after both pools is an overrun — which
-- the product allows on purpose (a recording that legitimately started always
-- finishes, PRD §5.8) and which lands on the cycle, exactly as it did before
-- packs existed.

create or replace function public.apply_recording_result(
  target_recording uuid,
  target_transcription uuid,
  target_claim_id uuid,
  target_answers jsonb,
  target_gaps jsonb,
  target_billable_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  apply_result jsonb;
  recording_org uuid;
  recording_author uuid;
  allowance jsonb;
  window_start timestamptz;
  window_end timestamptz;
  cycle_limit_seconds bigint := 0;
  cycle_used_seconds bigint := 0;
  cycle_available bigint := 0;
  pack_part integer := 0;
  remaining integer;
  taken integer;
  usage_id uuid;
  pack_row public.audio_minute_packs%rowtype;
begin
  if target_billable_seconds is null or target_billable_seconds <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  apply_result := public.apply_recording_result_without_usage(
    target_recording,
    target_transcription,
    target_claim_id,
    target_answers,
    target_gaps
  );

  if not coalesce((apply_result ->> 'ok')::boolean, false) then
    return apply_result;
  end if;

  select r.org_id, r.created_by into recording_org, recording_author
  from public.recordings r
  where r.id = target_recording;

  if recording_org is null then
    raise exception 'usage_record_failed' using errcode = 'check_violation';
  end if;

  allowance := public.org_audio_allowance(recording_org);
  window_start := nullif(allowance ->> 'window_start', '')::timestamptz;
  window_end := nullif(allowance ->> 'window_end', '')::timestamptz;
  cycle_limit_seconds := coalesce((allowance ->> 'minutes_limit')::bigint, 0) * 60;

  if cycle_limit_seconds > 0 and window_start is not null then
    select coalesce(sum(u.cycle_seconds), 0) into cycle_used_seconds
    from public.audio_usage u
    where u.org_id = recording_org
      and u.created_at >= window_start
      and (window_end is null or u.created_at < window_end);
    cycle_available := greatest(cycle_limit_seconds - cycle_used_seconds, 0);
  end if;

  -- The ledger row is claimed BEFORE any pack is debited, and the unique index
  -- from 0030 is the fence. Debiting first and inserting with `on conflict do
  -- nothing` would silently spend the pack twice whenever a retry lost the
  -- race: the second run's insert would be swallowed while its debit stood.
  -- The split is provisional here and corrected below, once we know how far
  -- the packs actually reached.
  insert into public.audio_usage (
    org_id, recording_id, transcription_id, seconds, cycle_seconds, pack_seconds, kind, created_by
  )
  values (
    recording_org, target_recording, target_transcription, target_billable_seconds,
    target_billable_seconds, 0, 'transcription', recording_author
  )
  on conflict do nothing
  returning id into usage_id;

  if usage_id is null then
    -- Someone else already billed this recording. Idempotent, and crucially
    -- no pack was touched on this path.
    if not exists (
      select 1 from public.audio_usage u
      where u.recording_id = target_recording and u.kind = 'transcription'
    ) then
      raise exception 'usage_record_failed' using errcode = 'check_violation';
    end if;
    return apply_result || jsonb_build_object('billableSeconds', target_billable_seconds);
  end if;

  -- Cycle first, then the pack for what is left and only as far as it reaches.
  remaining := greatest(target_billable_seconds - least(target_billable_seconds::bigint, cycle_available), 0)::integer;

  for pack_row in
    select * from public.audio_minute_packs
    where org_id = recording_org
      and seconds_consumed < seconds_total
      and (expires_at is null or expires_at > now())
    -- Soonest to expire first, then oldest purchase: the order that wastes
    -- the least of what she paid for.
    order by expires_at nulls last, created_at
    for update
  loop
    exit when remaining <= 0;
    taken := least(remaining, pack_row.seconds_total - pack_row.seconds_consumed);
    update public.audio_minute_packs
    set seconds_consumed = seconds_consumed + taken
    where id = pack_row.id;
    pack_part := pack_part + taken;
    remaining := remaining - taken;
  end loop;

  -- Whatever no pack covered stays on the cycle, overrun included.
  if pack_part > 0 then
    update public.audio_usage
    set cycle_seconds = target_billable_seconds - pack_part,
        pack_seconds = pack_part
    where id = usage_id;
  end if;

  return apply_result || jsonb_build_object('billableSeconds', target_billable_seconds);
end;
$$;

revoke all on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer)
  to service_role;

-- ---------- Checkout for something that is not a subscription ----------
-- `complete_checkout_billing_operation` insists on a billing period and always
-- writes a `subscriptions` row; both are correct for a plan and wrong for a
-- one-off. Relaxing it would weaken the subscription path, so the à-la-carte
-- flow gets its own completion that records the checkout URL and nothing else
-- — the pack itself is granted by the webhook, when the money actually
-- arrives.

create or replace function public.complete_pack_checkout_billing_operation(
  target_operation uuid,
  target_claim_token uuid,
  target_plan uuid,
  target_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role'
     or target_operation is null
     or target_claim_token is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select o.* into operation_row from public.billing_operations o
  where o.id = target_operation for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if operation_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'completed', 'result', operation_row.result);
  end if;
  if operation_row.kind <> 'checkout'
     or operation_row.plan_id is distinct from target_plan then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if operation_row.status <> 'processing'
     or operation_row.claim_token is distinct from target_claim_token then
    return jsonb_build_object('ok', false, 'code', 'claim_lost');
  end if;
  if target_plan is null or nullif(btrim(target_checkout_url), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;
  if not exists (
    select 1 from public.plans
    where id = target_plan and is_addon and is_active
      and coalesce((limits ->> 'audio_minutes_pack')::int, 0) > 0
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;

  update public.billing_operations
  set status = 'completed',
      result = jsonb_build_object('url', target_checkout_url),
      completed_at = now(), claim_token = null, lease_expires_at = null, error_code = null, updated_at = now()
  where id = operation_row.id;

  return jsonb_build_object('ok', true, 'code', 'completed', 'result', jsonb_build_object('url', target_checkout_url));
end;
$$;

revoke all on function public.complete_pack_checkout_billing_operation(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_pack_checkout_billing_operation(uuid, uuid, uuid, text) to service_role;

-- ---------- Granting minutes by hand ----------
-- Support needs a way to make someone whole after an incident, and today there
-- is none: `audio_usage.seconds` is checked `> 0`, so consumption cannot be
-- credited back through the ledger. A grant is a pack with no invoice.
--
-- Deliberately an RPC and not an INSERT policy: the pack ledger has no client
-- write path at all (that is what stops a browser from declaring how many
-- minutes it owns), and adding one for superadmins would open the table to
-- every authenticated request the RLS predicate happens to accept.

create or replace function public.grant_audio_minute_pack(
  target_org uuid,
  target_minutes integer,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_pack uuid;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized';
  end if;
  if target_minutes is null or target_minutes <= 0 or target_minutes > 100000 then
    raise exception 'invalid_minutes';
  end if;
  if not exists (select 1 from public.organizations where id = target_org) then
    raise exception 'organization_not_found';
  end if;

  insert into public.audio_minute_packs (
    org_id, source, minutes_purchased, seconds_total, granted_by, note
  ) values (
    target_org, 'grant', target_minutes, target_minutes * 60, auth.uid(), nullif(btrim(target_note), '')
  )
  returning id into new_pack;

  -- A gift of paid capability is exactly the kind of act the audit trail
  -- exists for.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, auth.uid(), 'admin.audio_pack.granted', 'audio_minute_pack', new_pack::text,
    jsonb_build_object('minutes', target_minutes, 'note', nullif(btrim(target_note), ''))
  );

  return new_pack;
end;
$$;

revoke all on function public.grant_audio_minute_pack(uuid, integer, text) from public, anon;
grant execute on function public.grant_audio_minute_pack(uuid, integer, text) to authenticated;
