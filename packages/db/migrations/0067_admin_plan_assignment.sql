-- ============================================================
-- 0067_admin_plan_assignment: giving a workspace a plan without a checkout.
--
-- Beta accounts, partners, a support gesture after an incident, the team's own
-- workspace — all of them need a paid plan that nobody paid for. RLS already
-- allowed it (`subscriptions_all_superadmin` is `for all`), so this was always
-- doable with hand-written SQL. That is exactly the problem: doing it by hand
-- walks past five traps, one of which is silent and expensive.
--
--   1. `subscriptions_org_live_unique` allows ONE live subscription per org,
--      so the operation is an UPDATE of the existing row, never an INSERT.
--
--   2. **The period bounds must be NULL.** `org_audio_allowance` counts usage
--      INSIDE the current period; a comped plan has no provider cycle and
--      nothing ever advances `current_period_end`. Copy the shape of a real
--      subscription and, the moment that date passes, consumption stops being
--      counted at all — the workspace silently gets unmetered AI. With NULL
--      bounds the allowance falls back to the calendar month, which renews
--      itself. (Measured: 5.000 minutes consumed under an elapsed period
--      reported as 0 used and `can_start = true`.)
--
--   3. `subscriptions.period` has to follow the plan or the two disagree.
--
--   4. "Remove the plan" is NOT deleting the row. Without a live subscription
--      `org_entitlements` answers `active: false` and the library starts
--      refusing with 402. Removing a plan means assigning the free one.
--
--   5. A direct table write leaves no audit trail, and granting paid
--      capability for free is precisely the act that has to stay attributable.
--
-- A provider-backed subscription is REFUSED on purpose. Changing the plan
-- locally while Stripe/Asaas keeps charging the old one gives the customer a
-- tier they are not paying for (or bills them for one they no longer have);
-- that is a billing inconsistency no console should be able to create by
-- accident. Those go through a real checkout.
--
-- Self-assignment is deliberately allowed — a superadmin already holds every
-- privilege there is, so forbidding it would be theatre rather than control.
-- What matters is that the trail says so, so the audit event records whether
-- the operator was acting on their own workspace.
-- ============================================================

create or replace function public.set_org_plan(
  target_org uuid,
  target_plan uuid,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.plans%rowtype;
  sub public.subscriptions%rowtype;
  previous_slug text;
  self_grant boolean;
  created boolean := false;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized';
  end if;

  select * into plan_row from public.plans where id = target_plan and is_active;
  if not found then
    raise exception 'plan_not_found';
  end if;
  -- An à-la-carte minute pack is not a tier: subscribing someone to one would
  -- put them on a plan with no audio minutes and no library quota at all.
  if coalesce(plan_row.is_addon, false) or plan_row.kind <> 'recurring' or plan_row.period is null then
    raise exception 'plan_not_assignable';
  end if;

  if not exists (select 1 from public.organizations where id = target_org) then
    raise exception 'organization_not_found';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1
  for update;

  if sub.id is not null and nullif(btrim(coalesce(sub.provider_subscription_id, '')), '') is not null then
    raise exception 'provider_managed'
      using hint = 'This workspace pays through a provider. Changing the plan here would desync the charge from the entitlement.';
  end if;

  self_grant := exists (
    select 1 from public.memberships m where m.org_id = target_org and m.user_id = auth.uid()
  );

  if sub.id is null then
    -- No live subscription at all (an org left plan-less by an earlier manual
    -- edit). Create one rather than leaving it without entitlements.
    insert into public.subscriptions (org_id, plan_id, status, period)
    values (target_org, target_plan, 'active', plan_row.period)
    returning * into sub;
    created := true;
  else
    select slug into previous_slug from public.plans where id = sub.plan_id;
    update public.subscriptions
    set plan_id = target_plan,
        period = plan_row.period,
        status = 'active',
        -- See trap 2: a comped plan meters itself only with NULL bounds.
        current_period_start = null,
        current_period_end = null,
        -- Whatever lifecycle state the previous plan carried is not the new
        -- plan's: a pending cancellation or an open dunning window would
        -- otherwise keep counting against a plan that no longer exists.
        cancel_at_period_end = false,
        cancellation_requested_at = null,
        past_due_since = null,
        canceled_at = null,
        updated_at = now()
    where id = sub.id
    returning * into sub;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'admin.org.plan_assigned',
    'subscription',
    sub.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'from_plan', previous_slug,
      'to_plan', plan_row.slug,
      'created_subscription', created,
      -- The case an auditor cares about most.
      'self_grant', self_grant,
      'note', nullif(btrim(target_note), '')
    ))
  );

  return jsonb_build_object(
    'ok', true,
    'subscriptionId', sub.id,
    'fromPlan', previous_slug,
    'toPlan', plan_row.slug,
    'selfGrant', self_grant
  );
end;
$$;

revoke all on function public.set_org_plan(uuid, uuid, text) from public, anon;
-- `is_superadmin()` inside the function is the real gate; the grant only lets
-- an authenticated session reach it.
grant execute on function public.set_org_plan(uuid, uuid, text) to authenticated;
