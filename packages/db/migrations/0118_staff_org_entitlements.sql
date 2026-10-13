-- ============================================================
-- 0118_staff_org_entitlements: our own accounts are not customers.
--
-- Granting someone the superadmin role gives them the whole platform — every
-- workspace's record, the kill switch, the ability to grant the role itself —
-- and left their OWN workspace on the free tier. The first thing that showed
-- it was an import: a brand-new account, promoted to operator, still refused
-- the 201st row because `plans.limits.import_rows` said 200 (0076).
--
-- The database already names this idea. The account dossier (0106) reports
-- `staffAccount` — "any member of this workspace is a superadmin" — with the
-- comment "keeps the conversion arithmetic honest: our own accounts are not
-- customers". This migration promotes that observation to a rule the gates
-- obey: a staff workspace is entitled to the catalog's best tier, with no
-- subscription and no checkout.
--
-- Three decisions worth knowing:
--
--   * **The ceiling is the catalog's, not infinity.** A staff org resolves to
--     the most capable active plan (`staff_plan()`), so it inherits whatever
--     the best tier offers — unlimited where that tier is unlimited (imports
--     carry no `import_rows` key), 6.000 minutes where it is metered. Nothing
--     here invents a number, and an operator account cannot quietly run an
--     unbounded provider bill. If the catalog's best tier grows, so does this.
--
--   * **The kill switch still wins.** Every branch below sits BEHIND
--     `admin_suspended`. A suspended workspace stays suspended even if a
--     superadmin is a member of it — that is the one control that must never
--     have an exception, and a superadmin can lift it from the console.
--
--   * **It is a property of the WORKSPACE, not of who is asking.** The gates
--     answer about an org, and the answer must not change with the viewer —
--     otherwise an operator reading a customer's allowance would see a
--     capability the customer does not have. `is_staff_org()` asks about
--     membership, exactly like the dossier's `staffAccount`.
-- ============================================================

-- ---------- Who is staff ----------

/**
 * A workspace with at least one superadmin member.
 *
 * Same test the dossier shows as `staffAccount` (0106), now shared so the two
 * can never disagree about which accounts are ours.
 */
create or replace function public.is_staff_org(target_org uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select exists (
    select 1
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.org_id = target_org and p.is_superadmin
  );
$$;

comment on function public.is_staff_org(uuid) is
  'True when a member of this workspace is a platform superadmin — our own account, not a customer (0118).';

revoke all on function public.is_staff_org(uuid) from public, anon;
grant execute on function public.is_staff_org(uuid) to authenticated, service_role;

-- ---------- What staff is entitled to ----------

/**
 * The catalog's most capable subscription plan — what a staff workspace is
 * entitled to without paying for it.
 *
 * Ordered by the dimension that actually gates the product (audio minutes),
 * then by price, so a cheap promotional tier can never outrank the real top
 * one. Add-ons and the free tier are excluded: one is a top-up, the other is
 * the floor this migration exists to lift.
 *
 * Returns no row on a catalog with no paid plan, and every caller then keeps
 * its normal path — a platform with nothing to sell has nothing to grant.
 */
create or replace function public.staff_plan()
returns setof public.plans
language sql
security definer
set search_path = pg_catalog, public
stable
as $$
  select *
  from public.plans
  where is_active
    and not coalesce(is_free, false)
    and not coalesce(is_addon, false)
    and period = 'monthly'
  order by coalesce((limits ->> 'audio_minutes')::int, 0) desc, price_cents desc, sort
  limit 1;
$$;

comment on function public.staff_plan() is
  'The catalog tier a staff workspace inherits (0118): the most capable active monthly plan.';

revoke all on function public.staff_plan() from public, anon;
grant execute on function public.staff_plan() to authenticated, service_role;

-- ---------- The gates ----------

-- Recreated from 0076 with the staff branch.
create or replace function public.org_import_allowance(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  staff_tier public.plans%rowtype;
  max_rows integer;
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

  if sub.id is not null and sub.admin_suspended then
    return jsonb_build_object(
      'allowed', false, 'unlimited', false, 'maxRows', 0, 'reason', 'suspended'
    );
  end if;

  if sub.plan_id is not null then
    select * into plan from public.plans where id = sub.plan_id;
  end if;

  -- Our own workspace is not a customer: on the free tier (or on none at all)
  -- it inherits the catalog's best one, which carries no row ceiling. Never
  -- over a plan that is actually being charged, and always behind the kill
  -- switch checked above.
  if coalesce(plan.is_free, true) and public.is_staff_org(target_org) then
    select * into staff_tier from public.staff_plan();
    -- SELECT INTO nulls its target when nothing comes back, so a catalog with
    -- no paid tier must not wipe the plan already resolved.
    if staff_tier.id is not null then
      plan := staff_tier;
    end if;
  end if;
  -- A workspace with no live subscription is on the free tier, and the free
  -- tier still imports.
  if plan.id is null then
    select * into plan from public.plans where is_free and is_active order by sort limit 1;
  end if;

  max_rows := nullif(plan.limits ->> 'import_rows', '')::integer;
  if max_rows is null then
    return jsonb_build_object(
      'allowed', true, 'unlimited', true, 'maxRows', null, 'reason', 'ok'
    );
  end if;

  return jsonb_build_object(
    'allowed', true, 'unlimited', false, 'maxRows', max_rows, 'reason', 'ok'
  );
end;
$$;

-- Recreated from 0088 with the staff branch.
create or replace function public.org_message_allowance(target_org uuid, target_assistant text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  helper public.assistants%rowtype;
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  quota_key text;
  limit_messages integer;
  used_messages numeric := 0;
  window_start timestamptz := date_trunc('month', now());
  suspended boolean := false;
  grace_ends timestamptz;
  in_grace boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into helper from public.assistants where slug = target_assistant and is_active;
  if helper.id is null then
    raise exception 'assistant not found';
  end if;

  quota_key := helper.config ->> 'quota_limit_key';
  if quota_key is null then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'reason', 'ok');
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  suspended := coalesce(sub.admin_suspended, false);
  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  -- Staff: no quota, and no 'no_plan' refusal for an operator whose
  -- workspace never bought anything. Suspension is still checked below, and
  -- the reason stays 'ok' so no screen has to learn a new vocabulary.
  if public.is_staff_org(target_org) and not suspended then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'reason', 'ok');
  end if;

  if sub.id is null then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'no_plan');
  end if;
  if suspended then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'suspended');
  end if;
  if sub.status not in ('trialing', 'active') and not in_grace then
    return jsonb_build_object(
      'allowed', false, 'unlimited', false, 'used', 0, 'limit', 0, 'reason', 'past_due_blocked'
    );
  end if;

  select * into plan from public.plans where id = sub.plan_id;
  limit_messages := (plan.limits ->> quota_key)::int;
  if limit_messages is null then
    return jsonb_build_object('allowed', true, 'unlimited', true, 'reason', 'ok');
  end if;

  -- Mês calendário, ledger append-only (0063). Soma de pesos: uma consulta MCP
  -- de recuperação consome uma fração da franquia porque a parte cara — gerar
  -- a resposta — acontece no modelo do cliente, não no nosso.
  select coalesce(sum(u.weight), 0) into used_messages
  from public.library_usage u
  where u.org_id = target_org
    and u.assistant_id = helper.id
    and u.created_at >= window_start;

  return jsonb_build_object(
    'allowed', used_messages < limit_messages,
    'unlimited', false,
    'used', round(used_messages, 1),
    'limit', limit_messages,
    'window_start', window_start,
    'reason', case when used_messages < limit_messages then 'ok' else 'quota_exhausted' end
  );
end;
$$;

-- Recreated from 0089 with the staff branch.
create or replace function public.org_entitlements(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  merged jsonb;
  grace_ends timestamptz;
  in_grace boolean := false;
  staff_plan_id uuid;
  has_sub boolean := false;
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

  -- FOUND is about the subscription select above, and the staff lookup
  -- below would retarget it. Capture it before anything else runs.
  has_sub := found;

  -- Staff: entitled to the catalog's best tier with or without a subscription
  -- row, unless the workspace already holds a paid plan of its own. Suspension
  -- still decides `active` further down, which is why this supplies only the
  -- plan and never the verdict.
  if public.is_staff_org(target_org) and not coalesce(sub.admin_suspended, false) then
    if not has_sub or coalesce((select p.is_free from public.plans p where p.id = sub.plan_id), true) then
      select p.id into staff_plan_id from public.staff_plan() p;
    end if;
  end if;

  if not has_sub and staff_plan_id is null then
    return jsonb_build_object('active', false, 'reason', 'no_subscription');
  end if;

  grace_ends := public.billing_past_due_grace_ends(sub);
  in_grace := grace_ends is not null and grace_ends > now();

  select p.limits into merged from public.plans p where p.id = coalesce(staff_plan_id, sub.plan_id);

  select coalesce(merged || jsonb_object_agg_merged.limits, merged) into merged
  from (
    select public.jsonb_merge_agg(m.limits) as limits
    from public.subscription_modules sm
    join public.modules m on m.id = sm.module_id
    where sm.subscription_id = sub.id and sm.status = 'active'
  ) as jsonb_object_agg_merged
  where jsonb_object_agg_merged.limits is not null;

  return jsonb_build_object(
    'active', (not coalesce(sub.admin_suspended, false))
      and (staff_plan_id is not null or sub.status in ('trialing', 'active') or in_grace),
    'suspended', sub.admin_suspended,
    'status', sub.status,
    'past_due_grace', in_grace,
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'plan_id', coalesce(staff_plan_id, sub.plan_id),
    'limits', coalesce(merged, '{}'::jsonb),
    'credit_balance', public.org_credit_balance(target_org)
  );
end;
$$;

-- Recreated from 0111 with the staff branch.
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
  staff boolean := false;
  staff_tier public.plans%rowtype;
  -- 0111
  pix_sub public.subscriptions%rowtype;
  pix_pending boolean := false;
  provisional boolean := false;
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

  -- 0118: our own workspace inherits the catalog's best tier instead of the
  -- free one — an operator testing the product is not a customer and must not
  -- be stopped by a customer's ceiling. It overrides a free or absent plan
  -- only: a staff workspace that somehow holds a real paid subscription keeps
  -- it, because that one is being charged.
  staff := public.is_staff_org(target_org) and not suspended;
  if staff and plan_minutes = 0 then
    select * into staff_tier from public.staff_plan();
    -- Only when there IS one: SELECT INTO nulls its target on no rows, and a
    -- catalog with nothing to sell must leave this workspace as it found it.
    if staff_tier.id is not null then
      plan := staff_tier;
      plan_minutes := coalesce((plan.limits ->> 'audio_minutes')::int, 0);
    end if;
  end if;

  plan_usable := (sub.id is not null or (staff and plan.id is not null))
    and not suspended
    and (staff or sub.status in ('trialing', 'active') or in_grace);

  -- 0111: a PIX charge she started and the provider has not confirmed.
  select * into pix_sub
  from public.subscriptions
  where org_id = target_org and status = 'incomplete' and payment_method = 'pix'
  order by created_at desc
  limit 1;
  pix_pending := pix_sub.id is not null;

  -- 0111: the pending plan stands in for the live one while the window is
  -- open — but never over a plan she already holds with minutes, never over
  -- the kill-switch, and never once the charge itself has gone overdue.
  if pix_pending
     and not suspended
     and not (plan_usable and plan_minutes > 0)
     and pix_sub.provisional_until is not null
     and pix_sub.provisional_until > now()
     and not exists (
       select 1 from public.invoices i
       where i.subscription_id = pix_sub.id and i.status = 'failed'
     ) then
    provisional := true;
    sub := pix_sub;
    select * into plan from public.plans where id = pix_sub.plan_id;
    plan_minutes := coalesce((plan.limits ->> 'audio_minutes')::int, 0);
    grace_ends := null;
    in_grace := false;
    plan_usable := true;
  end if;

  select * into trial from public.pro_trials where org_id = target_org;

  if plan_minutes > 0 then
    if plan_usable then
      src := 'plan';
      limit_minutes := plan_minutes;
      if provisional then
        -- 0111: the provisional window is its own usage window; the real
        -- cycle starts when the webhook confirms the charge.
        window_start := pix_sub.created_at;
        window_end := pix_sub.provisional_until;
      else
        window_start := coalesce(sub.current_period_start, date_trunc('month', now()));
        window_end := coalesce(sub.current_period_end, window_start + interval '1 month');
      end if;
    end if;
  elsif trial.org_id is not null and not suspended then
    src := 'trial';
    limit_minutes := trial.minutes_limit;
    window_start := trial.started_at;
    window_end := trial.ends_at;
  end if;

  -- 0111: someone who came through a payment path is not offered the trial,
  -- and — because start_pro_trial reads exactly this — does not get one started
  -- automatically either. Otherwise the trial would quietly keep Pro alive
  -- after the provisional window, and "desabilitado" would never happen.
  trial_available := trial.org_id is null and plan_minutes = 0 and not suspended and not pix_pending;

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
  -- 0111: not during the provisional window — nothing has been paid yet.
  pack_purchasable := plan_usable and plan_minutes > 0 and not coalesce(plan.is_free, true) and not provisional;

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
  -- 0111: the window closed and the PIX was never confirmed. What resolves it
  -- is finishing the payment — never a trial.
  elsif pix_pending and not provisional then
    reason := 'payment_unconfirmed';
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
    'pack_purchasable', pack_purchasable,
    -- 0111
    'provisional', provisional,
    'provisional_until', case when provisional then pix_sub.provisional_until else null end,
    'payment_pending', pix_pending,
    'pending_plan_slug', case when pix_pending then (select p.slug from public.plans p where p.id = pix_sub.plan_id) else null end
  );
end;
$$;
