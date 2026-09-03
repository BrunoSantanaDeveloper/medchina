-- ---------------------------------------------------------------------------
-- 0088 — Meeting the professional at her two moments of highest intent
-- ---------------------------------------------------------------------------
-- The trial lifecycle drip (lib/trial-jobs.ts) is anchored entirely to the
-- CALENDAR: welcome, T+2d, ends_at-3d, ends_at. Its own comment concedes the
-- gap — "the minutes dimension is handled in-app by the allowance" — and that
-- gap drops the best prospect there is. A professional who adopts the product
-- seriously burns 300 trial minutes (~6 consultations) in two or three days.
-- She hits the wall on day 3, hears nothing until day 11, and then receives an
-- e-mail announcing that her trial "is about to expire" — eight days after it
-- actually did. The message is not merely late, it is false for her.
--
-- So the ask moves to where the intent is, and there are exactly two such
-- moments:
--
--   first_consultation — she has just finalized her FIRST record. The product
--                        stopped being a promise: she watched an anamnesis get
--                        filled from a real consultation and reviewed it. This
--                        is the emotional peak.
--
--   usage_80           — she has used 80% of her minutes and has roughly one
--                        consultation left. This is the peak of NEED, and it
--                        deliberately fires BEFORE the wall: for a clinical
--                        tool, blocking her mid-work and then selling is the
--                        wrong trade. There is a patient in the room.
--
-- What makes this honest rather than a countdown gimmick:
--
--   * `expires_at` is stamped ONCE, at creation, from the server clock. The UI
--     renders that instant; it never recomputes a fresh window on each visit.
--   * `unique (org_id, trigger)` — each moment fires at most once per workspace,
--     ever. An offer that reappears after expiring is not an offer, it is the
--     price with a timer drawn on it (docs/FUNIL.md: "Nada de escassez falsa").
--   * A workspace already paying never sees one. Discounting to someone who
--     already bought at full price is how a launch loses the customers it has.
--   * Only one live offer at a time: if the activation offer is still running
--     when she crosses 80%, the second does not stack on top of it.
--
-- The window is hours, not minutes. The source of this idea sells impulse-priced
-- prosumer credits, where 30 minutes works; here the decision is whether to route
-- a clinical practice's documentation through the platform, and a 30-minute
-- ultimatum on that reads as pressure rather than opportunity.

create table if not exists public.conversion_offers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  trigger text not null,
  opened_at timestamptz not null default now(),
  -- Stamped once. The countdown on screen reads THIS, so it can only ever run
  -- down: a window recomputed per page view is the fake timer this design
  -- exists to avoid.
  expires_at timestamptz not null,
  -- What she gets. Resolved from platform_settings at open time and frozen on
  -- the row, so changing the campaign later never rewrites an offer already
  -- made to someone.
  coupon_code text,
  dismissed_at timestamptz,
  -- Stamped by the billing webhook when a subscription activates while the
  -- offer was live. Without it there is no way to tell "she bought eventually"
  -- from "the offer worked".
  converted_at timestamptz,
  constraint conversion_offers_trigger_check
    check (trigger in ('first_consultation', 'usage_80')),
  constraint conversion_offers_window_check check (expires_at > opened_at),
  constraint conversion_offers_one_per_trigger unique (org_id, trigger)
);

comment on table public.conversion_offers is
  'A time-boxed offer made to a workspace at a moment of high intent (first finalized consultation, or 80% of trial minutes). One per trigger per workspace for life, with a deadline stamped at creation — see the migration header for why both properties are load-bearing.';

create index if not exists conversion_offers_org_live_idx
  on public.conversion_offers (org_id, expires_at desc);

alter table public.conversion_offers enable row level security;

-- She may read (and dismiss) her own workspace's offer; nothing else is
-- exposed. Writes go through the RPCs below, which own the eligibility rules.
create policy "conversion_offers_select_member" on public.conversion_offers
  for select to authenticated
  using (public.is_org_member(org_id));

create policy "conversion_offers_all_superadmin" on public.conversion_offers
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

select public.enable_row_versioning('public.conversion_offers');

-- ---------- Configuration: the operator opens the campaign, not a deploy ----------

insert into public.platform_settings (key, value)
values (
  'conversion_offers',
  jsonb_build_object(
    -- Off until someone decides to run it, with a coupon that exists.
    'enabled', false,
    'window_hours', 48,
    'coupon_code', '',
    'first_consultation', true,
    'usage_80', true
  )
)
on conflict (key) do nothing;

-- ---------- Is this workspace still a prospect? ----------

create or replace function public.conversion_offer_eligible(target_org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- Paying workspaces are not prospects. `is_free` covers the free plan, and a
  -- workspace with no live subscription at all has nothing to discount from.
  select not exists (
    select 1
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.org_id = target_org
      and s.status in ('trialing', 'active', 'past_due')
      and not p.is_free
  );
$$;

-- ---------- Opening one ----------

create or replace function public.open_conversion_offer(target_org uuid, target_trigger text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  config jsonb;
  window_hours integer;
  coupon text;
  created public.conversion_offers%rowtype;
begin
  -- Authorized like any other write: a SECURITY DEFINER function granted to
  -- `authenticated` would otherwise let anyone stamp an offer onto a workspace
  -- that is not theirs. The service role is allowed because the 80% trigger
  -- runs from the usage pipeline, which has no session.
  if auth.role() is distinct from 'service_role' and not public.is_org_member(target_org) then
    raise exception 'not a member of this organization';
  end if;

  if target_trigger not in ('first_consultation', 'usage_80') then
    return jsonb_build_object('opened', false, 'reason', 'unknown_trigger');
  end if;

  select value into config from public.platform_settings where key = 'conversion_offers';
  if not coalesce((config ->> 'enabled')::boolean, false) then
    return jsonb_build_object('opened', false, 'reason', 'disabled');
  end if;
  if not coalesce((config ->> target_trigger)::boolean, false) then
    return jsonb_build_object('opened', false, 'reason', 'trigger_disabled');
  end if;

  if not public.conversion_offer_eligible(target_org) then
    return jsonb_build_object('opened', false, 'reason', 'already_paying');
  end if;

  -- Never stack. Two live offers would mean two deadlines for the same
  -- decision, and the second would quietly extend the first.
  if exists (
    select 1 from public.conversion_offers
    where org_id = target_org and expires_at > now() and dismissed_at is null
  ) then
    return jsonb_build_object('opened', false, 'reason', 'already_open');
  end if;

  window_hours := greatest(coalesce((config ->> 'window_hours')::integer, 48), 1);
  coupon := nullif(btrim(coalesce(config ->> 'coupon_code', '')), '');

  insert into public.conversion_offers (org_id, trigger, expires_at, coupon_code)
  values (target_org, target_trigger, now() + make_interval(hours => window_hours), coupon)
  on conflict (org_id, trigger) do nothing
  returning * into created;

  -- `do nothing` returned no row: this moment already happened for this
  -- workspace once, and it does not happen twice.
  if created.id is null then
    return jsonb_build_object('opened', false, 'reason', 'already_used');
  end if;

  return jsonb_build_object(
    'opened', true,
    'trigger', created.trigger,
    'expires_at', created.expires_at,
    'coupon_code', created.coupon_code
  );
end;
$$;

revoke all on function public.open_conversion_offer(uuid, text) from public, anon;
grant execute on function public.open_conversion_offer(uuid, text) to authenticated, service_role;

-- ---------- Reading the live one ----------

create or replace function public.current_conversion_offer(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  offer public.conversion_offers%rowtype;
begin
  if not public.is_org_member(target_org) then
    raise exception 'not a member of this organization';
  end if;

  select * into offer
  from public.conversion_offers
  where org_id = target_org
    and expires_at > now()
    and dismissed_at is null
  order by opened_at desc
  limit 1;

  if offer.id is null then
    return jsonb_build_object('active', false);
  end if;

  -- Re-checked on every read, not just at open time: she may have subscribed
  -- from another tab, and an offer still nagging a paying customer is worse
  -- than no offer at all.
  if not public.conversion_offer_eligible(target_org) then
    return jsonb_build_object('active', false);
  end if;

  return jsonb_build_object(
    'active', true,
    'trigger', offer.trigger,
    'expires_at', offer.expires_at,
    'coupon_code', offer.coupon_code
  );
end;
$$;

revoke all on function public.current_conversion_offer(uuid) from public, anon;
grant execute on function public.current_conversion_offer(uuid) to authenticated, service_role;

-- ---------- Putting it away ----------

create or replace function public.dismiss_conversion_offer(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_org) then
    raise exception 'not a member of this organization';
  end if;

  -- Dismissing closes it for good rather than hiding it until reload: a card
  -- she has already said no to, reappearing on the next page, is nagware.
  update public.conversion_offers
  set dismissed_at = now()
  where org_id = target_org and expires_at > now() and dismissed_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.dismiss_conversion_offer(uuid) from public, anon;
grant execute on function public.dismiss_conversion_offer(uuid) to authenticated, service_role;
