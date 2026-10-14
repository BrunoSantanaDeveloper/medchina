-- ---------------------------------------------------------------------------
-- 0124 — Which plan is the highlighted one is a DECISION, not a position
-- ---------------------------------------------------------------------------
-- The pricing grids (the home and /planos, both fed by
-- apps/web/src/app/(marketing)/plans.ts) render one card as the anchor: bigger,
-- with the filled CTA. Until now that card was chosen by ARITHMETIC — the plan
-- at index 1, i.e. the middle of three, ordered by `sort`:
--
--     const highlightIndex = plans.length >= 3 ? 1 : -1;
--     highlighted: index === highlightIndex
--
-- Three things were wrong with that:
--
--   * The catalog console has no way to say it. Promoting Pro meant reordering
--     the whole grid through `sort` until Pro happened to land in the middle —
--     changing the READING ORDER of the page to change its emphasis, which is
--     two decisions welded into one field.
--   * "No plan highlighted" was inexpressible. With three plans there is always
--     a middle one, so the anchor could never be turned off for a campaign that
--     wants a flat comparison.
--   * Adding or retiring a plan silently moved the highlight. A fourth tier, or
--     unpublishing one (0085), re-pointed the anchor at whatever slid into
--     position 2 — a commercial decision taken by an off-by-one.
--
-- So it becomes a column the superadmin ticks in /admin/billing, next to the
-- flags that already live there (is_active, is_public, is_free).

alter table public.plans
  add column if not exists is_highlighted boolean not null default false;

comment on column public.plans.is_highlighted is
  'Whether this plan is rendered as the anchor card in the public pricing grids (the home and /planos). At most one plan in the table may carry it — the trigger plans_single_highlight clears the others, so ticking a new plan is enough and there is never a moment with two anchors. No plan highlighted is a valid state: the grids simply render flat, which is what a comparison-first campaign wants. Nothing commercial depends on this column — it is presentation only, and never affects price, entitlements or checkout.';

-- ---------------------------------------------------------------------------
-- One anchor, enforced where the data lives
-- ---------------------------------------------------------------------------
-- The console could untick the previous plan before ticking the new one, but
-- that is two writes with a window between them, and any other writer (a seed,
-- a support fix, psql) would not know the rule at all. Two highlighted cards is
-- not a cosmetic bug: both grids would render two anchors and the page would
-- stop answering "which one should I buy?".
--
-- SECURITY DEFINER because the invariant must not depend on WHO is writing: a
-- caller whose policy let it set the flag but not clear a sibling row would
-- leave exactly the double-anchor this prevents. It only ever clears a boolean,
-- and only a superadmin can set it in the first place (plans_all_superadmin).
create or replace function public.plans_single_highlight()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.plans
     set is_highlighted = false
   where id <> new.id
     and is_highlighted;

  return null;
end;
$$;

comment on function public.plans_single_highlight() is
  'Keeps public.plans.is_highlighted single-valued: setting it on one row clears every other. Fires only on rows being set to true (the WHEN clause), so the UPDATE it issues cannot re-enter it.';

drop trigger if exists plans_single_highlight on public.plans;

create trigger plans_single_highlight
  after insert or update of is_highlighted on public.plans
  for each row
  when (new.is_highlighted)
  execute function public.plans_single_highlight();

-- ---------------------------------------------------------------------------
-- The catalog keeps the face it has today
-- ---------------------------------------------------------------------------
-- The column defaults to false, so without this the next deploy would publish a
-- pricing grid with no anchor at all — a visible commercial change nobody asked
-- for. Seed it with the plan the OLD arithmetic was highlighting: the second
-- card of the public catalog, and only when there are three or more (the exact
-- condition `plans.length >= 3` expressed in SQL). After this, the choice is
-- hers and this file never decides it again.
with catalog as (
  select
    id,
    row_number() over (order by sort, slug) as position,
    count(*) over () as total
  from public.plans
  where is_active
    and is_public
    and not is_addon
)
update public.plans p
   set is_highlighted = true
  from catalog c
 where p.id = c.id
   and c.position = 2
   and c.total >= 3
   and not exists (select 1 from public.plans where is_highlighted);
