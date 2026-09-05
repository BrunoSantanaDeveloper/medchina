-- ---------------------------------------------------------------------------
-- 0087 — The founders offer: real seats, one answer
-- ---------------------------------------------------------------------------
-- The commercial plan (docs/FUNIL.md T1.4, decisions D2-D4) sells a limited
-- founders condition: Pro access at the Assistente annual price, 30 seats,
-- 30 days. Two things have to be true about that number, and both are easy to
-- get wrong in opposite directions:
--
--   1. It must be REAL. A countdown that ticks on a timer, or a "restam X" that
--      never moves, is a lie the audience of a small professional community
--      will catch — and this launch is being sold on the founder's reputation
--      inside that community (docs/FUNIL.md "Nada de escassez falsa").
--
--   2. It must actually STOP the sale. A counter that only decorates the page
--      still lets the 31st person subscribe, and the offer becomes whatever
--      volume showed up. The count and the gate therefore share ONE definition,
--      computed here, so the page and the checkout can never disagree.
--
-- Configuration lives in platform_settings ('founders'), editable by the
-- superadmin without a deploy: closing the offer, extending the deadline or
-- adding seats must never require shipping code in the middle of a campaign.
--
-- A seat is held by a LIVE subscription (trialing/active/past_due). Deliberate
-- consequences: an abandoned checkout (status incomplete) does not burn a seat,
-- and a founder who cancels releases hers. The small window this leaves — two
-- people checking out simultaneously for the last seat — is accepted rather
-- than reserved: sales here happen on scheduled calls at human pace, and the
-- alternative (holding seats at checkout start) would let abandoned carts
-- silently close an offer that still had room.

insert into public.platform_settings (key, value)
values (
  'founders',
  jsonb_build_object(
    -- Starts OFF: the offer opening is an operator decision with a date, not a
    -- side effect of running a migration.
    'enabled', false,
    'plan_slug', 'pro-fundador',
    'compare_plan_slug', '',
    'seats', 30,
    'deadline', null
  )
)
on conflict (key) do nothing;

-- ---------- The single answer: is the offer open, and how much is left? ----------

create or replace function public.founders_offer()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  config jsonb;
  offer_enabled boolean;
  plan_slug text;
  seats_total integer;
  deadline timestamptz;
  seats_taken integer := 0;
  seats_left integer;
  offer_plan public.plans%rowtype;
  reason text;
begin
  select value into config from public.platform_settings where key = 'founders';

  offer_enabled := coalesce((config ->> 'enabled')::boolean, false);
  plan_slug := nullif(btrim(coalesce(config ->> 'plan_slug', '')), '');
  seats_total := coalesce((config ->> 'seats')::integer, 0);
  begin
    deadline := nullif(btrim(coalesce(config ->> 'deadline', '')), '')::timestamptz;
  exception when others then
    -- A malformed date must not take the pricing page down; it reads as "no
    -- deadline", and the seat count still governs.
    deadline := null;
  end;

  if plan_slug is not null then
    select * into offer_plan from public.plans where slug = plan_slug;
    if found then
      select count(*) into seats_taken
      from public.subscriptions s
      where s.plan_id = offer_plan.id
        and s.status in ('trialing', 'active', 'past_due');
    end if;
  end if;

  seats_left := greatest(seats_total - seats_taken, 0);

  -- Named cause, never inferred from the numbers: "sold out" and "the operator
  -- has not opened it yet" look identical from seats_left alone, and the page
  -- has to say something different for each.
  reason := case
    when plan_slug is null or offer_plan.id is null then 'not_configured'
    when not offer_enabled then 'disabled'
    when deadline is not null and deadline <= now() then 'expired'
    when seats_left <= 0 then 'sold_out'
    else 'open'
  end;

  return jsonb_build_object(
    'enabled', offer_enabled,
    'plan_slug', plan_slug,
    -- Optional anchor: the plan whose price the offer page strikes through.
    -- Absent means no struck price is shown at all, because an anchor nobody
    -- configured would have to be invented.
    'compare_plan_slug', nullif(btrim(coalesce(config ->> 'compare_plan_slug', '')), ''),
    'plan_id', offer_plan.id,
    'seats_total', seats_total,
    'seats_taken', seats_taken,
    'seats_left', seats_left,
    'deadline', deadline,
    'closed', reason <> 'open',
    'reason', reason
  );
end;
$$;

comment on function public.founders_offer() is
  'State of the limited founders offer, computed from platform_settings (''founders'') and a live count of subscriptions on the offer plan. The SAME answer feeds the public counter and the checkout guard, so the number on the page and the number that stops a sale cannot drift apart.';

-- The counter renders on the PUBLIC landing page, before any sign-up: anon has
-- to be able to read it. Only aggregate counts leave this function — no tenant
-- row is ever exposed.
revoke all on function public.founders_offer() from public;
grant execute on function public.founders_offer() to anon, authenticated, service_role;
