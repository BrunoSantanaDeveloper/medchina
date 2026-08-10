-- ---------------------------------------------------------------------------
-- 0085 — A plan can be purchasable without being in the catalog
-- ---------------------------------------------------------------------------
-- The commercial funnel (docs/FUNIL.md) sells a founders offer: Pro access at
-- the Assistente price, for a limited number of workspaces, reached by a link
-- the operator sends. The catalog had no way to express that. `is_active` was
-- the only switch, and it conflates two different questions:
--
--   * is_active  — may this plan be CHARGED for at all? (checkout and
--                  set_org_plan both refuse an inactive plan)
--   * is_public  — should it be OFFERED in the catalog grids?
--
-- Turning the offer off by deactivating it therefore also made it unbuyable,
-- and leaving it active published the founder price to every visitor of
-- /planos and every subscriber in /settings/billing — where somebody paying
-- full price would read it as being overcharged.
--
-- So visibility becomes its own column. A non-public plan stays a first-class
-- plan: checkout, entitlements, renewal and the admin assignment path are
-- deliberately untouched, because the offer must behave exactly like any other
-- subscription once bought. Only the two catalog listings filter on it:
--
--   * packages/billing/src/public.ts   (marketing /planos, service role)
--   * settings/billing use-billing.ts  (the customer's own grid)
--
-- The customer grid keeps showing the workspace's CURRENT plan even when it is
-- non-public — otherwise a founder would open her billing page and find her own
-- subscription missing from the tiers, with the grid inviting her to "choose a
-- plan" she already pays for.
--
-- Not a secret, by design: `plans_select` (0001) lets any signed-in session read
-- active rows, and the deep link `/settings/billing?plan=<slug>` depends on that
-- read. Hiding here is about what the product OFFERS, not about confidentiality
-- — the price is meant to be shared with prospects, just not published in the
-- catalog next to the table price.

alter table public.plans
  add column if not exists is_public boolean not null default true;

comment on column public.plans.is_public is
  'Whether the plan appears in the catalog grids (public pricing page and the customer billing page). Independent of is_active: a plan with is_active = true and is_public = false stays fully purchasable through a direct link (?plan=<slug>) and assignable by a superadmin — that is how a limited/founders offer is sold without publishing its price. Deactivating an offer instead of unpublishing it makes it unbuyable, which is the mistake this column exists to prevent.';

comment on column public.plans.is_active is
  'Whether the plan may be charged for at all — checkout (startCheckout) and set_org_plan both refuse an inactive plan. To take an offer out of the catalog while keeping it sellable, use is_public, not this column.';

-- Existing catalog is unchanged: every plan seeded so far (gratuito, assistente,
-- pro and the à-la-carte minute packs) keeps the visibility it had. Packs are
-- already excluded from both grids by is_addon, so the default is right for them
-- too — they stay reachable by the pack card, which is their own listing.
update public.plans set is_public = true where is_public is distinct from true;
