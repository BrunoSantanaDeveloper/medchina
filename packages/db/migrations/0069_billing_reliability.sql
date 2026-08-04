-- ============================================================
-- 0069_billing_reliability
--
-- Consequences of the billing audit (docs/BILLING-AUDIT.md). Five unrelated
-- symptoms, one theme: the money layer had no way to tell a PERMANENT problem
-- from a transient one, and no way to tell a cosmetic provider event from a
-- real change of cycle.
--
--  1. Fiscal identity of the workspace. Asaas rejects `POST /customers`
--     without `cpfCnpj`, so checkout could fail before the customer ever saw a
--     payment page — and the product collected the field nowhere.
--  2. `attempts` is returned by the webhook claim, so the app can stop
--     answering 500 forever for an event that will never reconcile.
--  3. Landing back on the free plan is idempotent. Two callers already do it
--     (the webhook and the cancellation job); the partial unique index made
--     the second one raise instead of no-op.
--  4. The three `complete_*` operations validate the LEASE, not just the
--     token — a worker that lost its lease must not finish the work.
--  5. `org_audio_allowance` stops lying in two ways: a trial that ended by
--     TIME still reported its unused minutes as available, and running out of
--     audio minutes silently removed clinical reasoning, which costs no
--     minutes at all.
--
-- Plus the housekeeping the inbox never had: a reaper for leases that died
-- with their worker, and a way to retire a checkout the customer abandoned
-- (which, on Asaas, is a live recurring charge nobody is watching).
-- ============================================================

-- ---------- 1. Fiscal identity (the payment provider demands it) ----------
-- Stored as DIGITS, never as the masked string the form shows (the repo-wide
-- rule for semantic fields). Nullable because an org exists long before it
-- ever buys anything — the check runs at checkout, not at signup.

alter table public.organizations
  add column if not exists billing_cpf_cnpj text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_address_number text,
  add column if not exists billing_phone text;

alter table public.organizations
  drop constraint if exists organizations_billing_cpf_cnpj_check;
alter table public.organizations
  add constraint organizations_billing_cpf_cnpj_check
  check (billing_cpf_cnpj is null or billing_cpf_cnpj ~ '^([0-9]{11}|[0-9]{14})$');

alter table public.organizations
  drop constraint if exists organizations_billing_postal_code_check;
alter table public.organizations
  add constraint organizations_billing_postal_code_check
  check (billing_postal_code is null or billing_postal_code ~ '^[0-9]{8}$');

alter table public.organizations
  drop constraint if exists organizations_billing_phone_check;
alter table public.organizations
  add constraint organizations_billing_phone_check
  check (billing_phone is null or billing_phone ~ '^[0-9]{10,11}$');

-- Check digits are validated in the app (`@flyee/fields`), which is where the
-- customer can be told WHICH digit is wrong. This function is the boundary
-- that keeps a well-formed value from being replaced by a malformed one.
create or replace function public.update_billing_profile(
  target_org uuid,
  target_cpf_cnpj text,
  target_postal_code text,
  target_address_number text,
  target_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  digits_document text := nullif(regexp_replace(coalesce(target_cpf_cnpj, ''), '[^0-9]', '', 'g'), '');
  digits_postal text := nullif(regexp_replace(coalesce(target_postal_code, ''), '[^0-9]', '', 'g'), '');
  digits_phone text := nullif(regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g'), '');
  normalized_number text := nullif(btrim(coalesce(target_address_number, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if digits_document is null or digits_document !~ '^([0-9]{11}|[0-9]{14})$' then
    raise exception using errcode = '22023', message = 'invalid_document';
  end if;
  if digits_postal is not null and digits_postal !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'invalid_postal_code';
  end if;
  if digits_phone is not null and digits_phone !~ '^[0-9]{10,11}$' then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;
  if normalized_number is not null and char_length(normalized_number) > 20 then
    raise exception using errcode = '22023', message = 'invalid_address_number';
  end if;

  update public.organizations
     set billing_cpf_cnpj = digits_document,
         billing_postal_code = digits_postal,
         billing_address_number = normalized_number,
         billing_phone = digits_phone,
         updated_at = now()
   where id = target_org;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.update_billing_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_billing_profile(uuid, text, text, text, text) to authenticated;

-- ---------- 2. The webhook inbox reports how many times it has tried ----------
-- Without this the route cannot distinguish "the provider raced us, retry" from
-- "this will never reconcile" — so it answered 500 forever and the provider
-- suspended the queue, taking real activations down with it.

create or replace function public.claim_billing_webhook_event(
  target_provider text,
  target_provider_event_id text,
  target_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.billing_webhook_events%rowtype;
  inserted_count integer := 0;
  claimed_token uuid;
  claimed_attempts integer := 1;
begin
  if auth.role() is distinct from 'service_role'
     or target_provider is null
     or target_provider not in ('stripe', 'asaas')
     or nullif(btrim(target_provider_event_id), '') is null
     or nullif(btrim(target_event_type), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  insert into public.billing_webhook_events (
    provider, provider_event_id, event_type, claim_token, lease_expires_at
  ) values (
    target_provider, left(target_provider_event_id, 255), left(target_event_type, 80),
    gen_random_uuid(), now() + interval '5 minutes'
  ) on conflict (provider, provider_event_id, event_type) do nothing;
  get diagnostics inserted_count = row_count;

  select e.* into event_row from public.billing_webhook_events e
  where e.provider = target_provider
    and e.provider_event_id = left(target_provider_event_id, 255)
    and e.event_type = left(target_event_type, 80)
  for update;
  if event_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_processed');
  end if;
  -- A permanently failed event is not reclaimed. The route stops asking the
  -- provider to resend something that has already proven unreconcilable; the
  -- replay from here on is ours (an operator, from /admin/billing).
  if event_row.error_code = 'handler_failed_permanent' then
    return jsonb_build_object('ok', true, 'code', 'already_processed');
  end if;
  if inserted_count = 0
     and event_row.status = 'processing'
     and event_row.lease_expires_at is not null
     and event_row.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'event_in_progress');
  end if;
  update public.billing_webhook_events
  set status = 'processing',
      attempts = case when inserted_count = 0 then attempts + 1 else attempts end,
      claim_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes',
      error_code = null,
      completed_at = null,
      updated_at = now()
  where id = event_row.id
  returning claim_token, attempts into claimed_token, claimed_attempts;
  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'eventId', event_row.id,
    'claimToken', claimed_token,
    'attempts', claimed_attempts
  );
end;
$$;

revoke all on function public.claim_billing_webhook_event(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_billing_webhook_event(text, text, text) to service_role;

-- ---------- 3. Landing on the free plan, idempotently ----------
-- `subscriptions_org_live_unique` is a partial unique index, so the previous
-- read-then-insert raised whenever two callers settled the same cancellation
-- at once (the webhook and settleDueBillingCancellations do exactly that).
-- A raised error propagated as a 500 and made the provider resend the event.

create or replace function public.ensure_free_subscription(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan public.plans%rowtype;
  inserted_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_org is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into free_plan
  from public.plans
  where is_free and is_active
  order by created_at
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'no_free_plan');
  end if;

  insert into public.subscriptions (org_id, plan_id, status, period)
  values (target_org, free_plan.id, 'active', free_plan.period)
  on conflict do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return jsonb_build_object('ok', true, 'code', 'already_live');
  end if;
  return jsonb_build_object('ok', true, 'code', 'created', 'subscriptionId', inserted_id);
end;
$$;

revoke all on function public.ensure_free_subscription(uuid) from public, anon, authenticated;
grant execute on function public.ensure_free_subscription(uuid) to service_role;

-- ---------- 4. A lost lease may not complete the work ----------
-- All three completions checked only the claim token, so a worker whose lease
-- had already expired (and whose operation another invocation may have
-- re-claimed) still wrote the result. `commit_billing_subscription_change`
-- already validated the lease; these three now agree with it.

create or replace function public.complete_billing_operation(
  target_operation uuid,
  target_claim_token uuid,
  target_success boolean,
  target_result jsonb default '{}'::jsonb,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     or target_operation is null
     or target_claim_token is null
     or target_success is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  update public.billing_operations
  set status = case when target_success then 'completed' else 'failed' end,
      result = case when target_success then coalesce(target_result, '{}'::jsonb) else result end,
      error_code = case when target_success then null else coalesce(nullif(btrim(target_error_code), ''), 'provider_unavailable') end,
      completed_at = case when target_success then now() else null end,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = target_operation
    and status = 'processing'
    and claim_token = target_claim_token
    and lease_expires_at is not null
    and lease_expires_at > clock_timestamp();
  if not found then
    if exists (select 1 from public.billing_operations where id = target_operation) then
      return jsonb_build_object('ok', false, 'code', 'claim_lost');
    end if;
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', target_success, 'code', case when target_success then 'completed' else 'failed' end);
end;
$$;

create or replace function public.complete_checkout_billing_operation(
  target_operation uuid,
  target_claim_token uuid,
  target_plan uuid,
  target_period text,
  target_provider_customer text,
  target_provider_subscription text,
  target_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
  subscription_row public.subscriptions%rowtype;
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
     or operation_row.claim_token is distinct from target_claim_token
     or operation_row.lease_expires_at is null
     or operation_row.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'claim_lost');
  end if;
  if target_plan is null
     or target_period is null
     or target_period not in ('weekly', 'monthly', 'yearly')
     or nullif(btrim(target_checkout_url), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;

  if nullif(btrim(target_provider_subscription), '') is not null then
    insert into public.subscriptions (
      org_id, plan_id, status, provider, provider_subscription_id,
      provider_customer_id, period, coupon_id, billing_operation_id
    ) values (
      operation_row.org_id, target_plan, 'incomplete', operation_row.provider::public.billing_provider,
      target_provider_subscription, target_provider_customer, target_period::public.billing_period, null, operation_row.id
    )
    on conflict (provider, provider_subscription_id)
      where provider is not null and provider_subscription_id is not null
    do update set
      provider_customer_id = coalesce(excluded.provider_customer_id, public.subscriptions.provider_customer_id),
      updated_at = now()
    where public.subscriptions.org_id = excluded.org_id
      and public.subscriptions.plan_id = excluded.plan_id
    returning * into subscription_row;
  else
    insert into public.subscriptions (
      org_id, plan_id, status, provider, provider_subscription_id,
      provider_customer_id, period, coupon_id, billing_operation_id
    ) values (
      operation_row.org_id, target_plan, 'incomplete', operation_row.provider::public.billing_provider,
      null, target_provider_customer, target_period::public.billing_period, null, operation_row.id
    )
    on conflict (billing_operation_id) where billing_operation_id is not null do update
      set provider_customer_id = coalesce(excluded.provider_customer_id, public.subscriptions.provider_customer_id),
          updated_at = now()
    returning * into subscription_row;
  end if;

  if subscription_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  update public.billing_operations
  set status = 'completed',
      subscription_id = subscription_row.id,
      result = jsonb_build_object('url', target_checkout_url, 'subscriptionId', subscription_row.id),
      completed_at = now(), claim_token = null, lease_expires_at = null, error_code = null, updated_at = now()
  where id = operation_row.id;
  return jsonb_build_object('ok', true, 'code', 'completed', 'result', jsonb_build_object('url', target_checkout_url));
end;
$$;

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
     or operation_row.claim_token is distinct from target_claim_token
     or operation_row.lease_expires_at is null
     or operation_row.lease_expires_at <= clock_timestamp() then
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

-- ---------- 5. The allowance stops lying ----------
-- Two separate untruths, both discovered by walking the journeys:
--
--  (a) A trial that ended by TIME kept reporting its unused minutes. The card
--      that exists to answer "can I still record?" answered YES while the
--      recorder was blocked. `cycle_expired` makes the distinction explicit
--      and the remaining balance honest.
--
--  (b) `can_reason` was `can_start AND clinical_reasoning`, so exhausting the
--      AUDIO minutes also removed clinical reasoning — which consumes no
--      minutes. A paying Pro customer was then shown "Conhecer o Pro". The
--      entitlement now follows the PLAN, and only the plan's usability
--      (suspension and the dunning window still apply, through plan_usable).
--
-- `dunning` is also reported separately from `reason`: a workspace can be
-- past_due AND able to record (its purchased pack survives), and the screens
-- need both facts. Deriving "is she late?" from `reason` is what hid the
-- recovery link from the people who most needed it.

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
  cycle_expired boolean := false;
  cycle_remaining integer := 0;
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

  -- The trial has two independent ends (days OR minutes). When TIME is what
  -- ran out, the leftover minutes are gone with it: reporting them as
  -- remaining is what made the usage card contradict the recorder.
  if src = 'trial' and now() >= trial.ends_at then
    cycle_can_start := false;
    cycle_expired := true;
  end if;

  cycle_remaining := case when cycle_expired then 0 else greatest(limit_minutes - used_minutes, 0) end;
  if cycle_expired then
    percent := greatest(percent, 100);
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
    -- The trial IS Pro, and it ends with the trial — there is no payment
    -- behind it to keep the entitlement alive.
    can_reason := can_start;
  elsif src = 'plan' then
    -- Reasoning is a PLAN entitlement, not a minute. Tying it to `can_start`
    -- charged a paying Pro customer twice for the same exhaustion: no audio
    -- AND no reasoning, then sold the plan she already had.
    can_reason := plan_usable and coalesce((plan.limits ->> 'clinical_reasoning')::int, 0) > 0;
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
    'cycle_minutes_remaining', cycle_remaining,
    'cycle_expired', cycle_expired,
    'pack_minutes_remaining', pack_minutes_left,
    -- What she can actually still record, which is the sum.
    'minutes_remaining', cycle_remaining + pack_minutes_left,
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
    -- Separate from `reason` on purpose: a past_due workspace with a purchased
    -- pack still records, so `reason` says 'pack_only' and the dunning surface
    -- would disappear exactly for the person who has an unpaid invoice.
    'dunning', sub.status = 'past_due' and not coalesce(plan.is_free, true),
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'pack_purchasable', pack_purchasable
  );
end;
$$;

grant execute on function public.org_audio_allowance(uuid) to authenticated;

-- ---------- 6. Housekeeping the inbox never had ----------
-- Leases die with their worker (a serverless timeout, a deploy mid-flight).
-- Nothing ever cleared them, so `billing_operations` accumulated rows stuck in
-- `processing` forever and `billing_webhook_events` answered `event_in_progress`
-- for five minutes after every crash — which the route then turned into a 500.

create or replace function public.expire_stale_billing_leases(target_grace interval default interval '1 hour')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_operations integer := 0;
  expired_events integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  update public.billing_operations
  set status = 'failed',
      error_code = coalesce(error_code, 'lease_expired'),
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'processing'
    and lease_expires_at is not null
    and lease_expires_at < now() - greatest(target_grace, interval '0');
  get diagnostics expired_operations = row_count;

  update public.billing_webhook_events
  set status = 'failed',
      error_code = coalesce(error_code, 'lease_expired'),
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'processing'
    and lease_expires_at is not null
    and lease_expires_at < now() - greatest(target_grace, interval '0');
  get diagnostics expired_events = row_count;

  return jsonb_build_object('ok', true, 'operations', expired_operations, 'events', expired_events);
end;
$$;

revoke all on function public.expire_stale_billing_leases(interval) from public, anon, authenticated;
grant execute on function public.expire_stale_billing_leases(interval) to service_role;

-- ---------- 7. Retiring a checkout the customer walked away from ----------
-- On Asaas the subscription is created at the START of checkout, before any
-- payment. Abandoning the tab therefore leaves a live recurring charge that
-- nobody in the product can see or stop — the customer gets billed for
-- something she never contracted, and the local row sits `incomplete` forever.
--
-- Returns the provider ids so the caller can stop the charge at the provider
-- too; marking it canceled here only changes what MedChina believes.

create or replace function public.abandon_incomplete_subscription(
  target_org uuid,
  target_subscription uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.subscriptions%rowtype;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if auth.role() is distinct from 'service_role'
     and not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select * into sub
  from public.subscriptions
  where id = target_subscription and org_id = target_org and status = 'incomplete'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.subscriptions
  set status = 'canceled', canceled_at = now(), cancel_at_period_end = false, updated_at = now()
  where id = sub.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'canceled',
    'provider', sub.provider,
    'providerSubscriptionId', sub.provider_subscription_id
  );
end;
$$;

revoke all on function public.abandon_incomplete_subscription(uuid, uuid) from public, anon;
grant execute on function public.abandon_incomplete_subscription(uuid, uuid) to authenticated, service_role;

-- ---------- 8. Reverting money that went back ----------
-- A refund or a chargeback used to leave the invoice `paid` forever, the
-- granted minute pack spendable and the credits in the ledger. The pack is the
-- one that matters commercially: it does not expire, so an un-reverted refund
-- is an unlimited free balance.

-- `invoice_status` already carries 'refunded' (migration 0001) — only the
-- reversal itself was missing.

create or replace function public.revert_paid_invoice(
  target_provider text,
  target_provider_invoice_id text,
  target_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_row public.invoices%rowtype;
  reverted_key text;
  reverted_packs integer := 0;
begin
  if auth.role() is distinct from 'service_role'
     or target_provider not in ('stripe', 'asaas')
     or nullif(btrim(target_provider_invoice_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  reverted_key := target_provider || ':' || target_provider_invoice_id;

  select * into invoice_row
  from public.invoices
  where provider = target_provider::public.billing_provider
    and provider_invoice_id = target_provider_invoice_id
  for update;
  if not found then
    -- Not ours (a charge created outside MedChina). Nothing to revert, and
    -- nothing worth retrying — the caller must treat this as success.
    return jsonb_build_object('ok', true, 'code', 'unknown_invoice');
  end if;
  if invoice_row.status = 'refunded' then
    return jsonb_build_object('ok', true, 'code', 'already_reverted');
  end if;

  update public.invoices
  set status = 'refunded'
  where id = invoice_row.id;

  -- Consume what is LEFT of the pack rather than deleting the row: minutes
  -- already spent were really delivered, and the ledger must keep saying so.
  update public.audio_minute_packs p
  set seconds_consumed = p.seconds_total
  where p.invoice_key = reverted_key and p.seconds_consumed < p.seconds_total;
  get diagnostics reverted_packs = row_count;

  -- Generic credits are reversed by an offsetting entry, because the ledger is
  -- append-only by design.
  insert into public.credit_transactions (org_id, amount, kind, description, source_invoice_key)
  select ct.org_id, -ct.amount, 'adjustment',
         coalesce(nullif(btrim(target_kind), ''), 'refund') || ' — ' || reverted_key,
         reverted_key || ':reverted'
  from public.credit_transactions ct
  where ct.source_invoice_key = reverted_key and ct.amount > 0
  on conflict (source_invoice_key) do nothing;

  return jsonb_build_object('ok', true, 'code', 'reverted', 'packsReverted', reverted_packs);
end;
$$;

revoke all on function public.revert_paid_invoice(text, text, text) from public, anon, authenticated;
grant execute on function public.revert_paid_invoice(text, text, text) to service_role;
