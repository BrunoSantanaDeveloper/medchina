-- ============================================================
-- 0001_billing: per-organization subscriptions with two billing
-- models (recurring / credits), add-on modules, coupons, invoices
-- mirror, credit ledger, and a superadmin role.
--
-- Provider-agnostic: Stripe/Asaas specifics live in provider_refs
-- jsonb columns and in packages/billing.
-- ============================================================

-- ---------- Superadmin ----------

alter table public.profiles add column is_superadmin boolean not null default false;

-- Bootstrap (run manually once):
--   update public.profiles set is_superadmin = true where id = '<user uuid>';

create or replace function public.is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false);
$$;

-- ---------- Enums ----------

create type public.plan_kind as enum ('recurring', 'credits');
create type public.billing_period as enum ('weekly', 'monthly', 'yearly');
create type public.module_kind as enum ('recurring', 'one_time');
create type public.discount_type as enum ('percent', 'fixed');
create type public.subscription_status as enum ('incomplete', 'trialing', 'active', 'past_due', 'canceled');
create type public.invoice_status as enum ('open', 'paid', 'failed', 'refunded', 'void');
create type public.billing_provider as enum ('stripe', 'asaas');
create type public.credit_kind as enum ('purchase', 'grant', 'consumption', 'expiry', 'adjustment');

-- ---------- Catalog: plans and modules (superadmin-managed) ----------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  kind public.plan_kind not null default 'recurring',
  -- Null period on a credits plan means a one-time purchase of
  -- non-expiring credits; recurring plans always have a period.
  period public.billing_period,
  price_cents integer not null default 0,
  currency text not null default 'BRL',
  -- credits granted per cycle (kind = credits)
  credit_amount integer,
  -- whether granted credits expire at the end of the cycle
  credits_expire boolean not null default false,
  trial_days integer not null default 0,
  is_free boolean not null default false,
  is_active boolean not null default true,
  -- superadmin-adjustable feature limits, e.g. {"members": 3, "projects": 1}
  limits jsonb not null default '{}'::jsonb,
  -- provider-specific references, e.g. {"stripe": {"price_id": "..."}}
  provider_refs jsonb not null default '{}'::jsonb,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_recurring_period check (kind <> 'recurring' or period is not null),
  constraint plans_credits_amount check (kind <> 'credits' or credit_amount > 0)
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  kind public.module_kind not null default 'recurring',
  price_cents integer not null default 0,
  currency text not null default 'BRL',
  -- what the module unlocks, merged over plan limits
  limits jsonb not null default '{}'::jsonb,
  provider_refs jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type public.discount_type not null,
  -- percent: 1-100; fixed: amount in cents
  discount_value integer not null,
  max_redemptions integer,
  redeemed_count integer not null default 0,
  valid_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Subscriptions ----------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status public.subscription_status not null default 'incomplete',
  -- Superadmin kill-switch, independent of the provider lifecycle.
  admin_suspended boolean not null default false,
  provider public.billing_provider,
  provider_customer_id text,
  provider_subscription_id text,
  period public.billing_period,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  coupon_id uuid references public.coupons (id) on delete set null,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live subscription per organization (history rows keep status canceled).
create unique index subscriptions_org_live_unique on public.subscriptions (org_id)
  where status in ('trialing', 'active', 'past_due');

create index subscriptions_provider_sub_idx on public.subscriptions (provider_subscription_id);

create table public.subscription_modules (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  module_id uuid not null references public.modules (id),
  status text not null default 'active' check (status in ('active', 'canceled')),
  provider_item_id text,
  added_at timestamptz not null default now(),
  canceled_at timestamptz,
  unique (subscription_id, module_id)
);

-- ---------- Credit ledger ----------

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- positive = grant/purchase, negative = consumption
  amount integer not null,
  kind public.credit_kind not null,
  description text,
  -- null = never expires
  expires_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index credit_transactions_org_idx on public.credit_transactions (org_id);

-- ---------- Invoices (mirror of provider charges) ----------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  provider public.billing_provider not null,
  provider_invoice_id text not null,
  amount_cents integer not null,
  currency text not null default 'BRL',
  status public.invoice_status not null default 'open',
  description text,
  invoice_url text,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_invoice_id)
);

create index invoices_org_idx on public.invoices (org_id);

-- ---------- RLS ----------

alter table public.plans enable row level security;
alter table public.modules enable row level security;
alter table public.coupons enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_modules enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.invoices enable row level security;

-- Catalog: anyone signed in can read active entries (pricing UI);
-- superadmin has full control.
create policy "plans_select" on public.plans for select to authenticated
  using (is_active or public.is_superadmin());
create policy "plans_all_superadmin" on public.plans for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create policy "modules_select" on public.modules for select to authenticated
  using (is_active or public.is_superadmin());
create policy "modules_all_superadmin" on public.modules for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- Coupons are NOT listable by users (enumeration); validation goes
-- through the validate_coupon() RPC.
create policy "coupons_all_superadmin" on public.coupons for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- Org members read their billing data; superadmin reads/manages all.
-- Regular users never write these tables directly: mutations happen in
-- server code (service role) driven by provider webhooks and actions.
create policy "subscriptions_select_member" on public.subscriptions for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());
create policy "subscriptions_all_superadmin" on public.subscriptions for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create policy "subscription_modules_select_member" on public.subscription_modules for select to authenticated
  using (
    exists (
      select 1 from public.subscriptions s
      where s.id = subscription_id and (public.is_org_member(s.org_id) or public.is_superadmin())
    )
  );
create policy "subscription_modules_all_superadmin" on public.subscription_modules for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create policy "credit_transactions_select_member" on public.credit_transactions for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());
create policy "credit_transactions_all_superadmin" on public.credit_transactions for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create policy "invoices_select_member" on public.invoices for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());
create policy "invoices_all_superadmin" on public.invoices for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- Default free plan ----------

insert into public.plans (slug, name, description, kind, period, price_cents, is_free, limits, sort)
values (
  'free',
  'Free',
  'Default plan assigned to every new organization.',
  'recurring',
  'monthly',
  0,
  true,
  '{"members": 3}'::jsonb,
  0
);

-- Every new organization starts on the free plan.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan public.plans%rowtype;
begin
  select * into free_plan
  from public.plans
  where is_free and is_active
  order by created_at
  limit 1;

  if found then
    insert into public.subscriptions (org_id, plan_id, status, period)
    values (new.id, free_plan.id, 'active', free_plan.period);
  end if;

  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- ---------- RPCs ----------

-- Current usable credit balance for an organization.
create or replace function public.org_credit_balance(target_org uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(ct.amount), 0)::integer
  from public.credit_transactions ct
  where ct.org_id = target_org
    and (ct.expires_at is null or ct.expires_at > now())
    and public.is_org_member(target_org);
$$;

-- Consumes credits for a feature; fails when the balance is insufficient.
create or replace function public.consume_credits(target_org uuid, amount integer, reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  balance integer;
begin
  if amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not a member of this organization';
  end if;

  select public.org_credit_balance(target_org) into balance;
  if balance < amount then
    raise exception 'insufficient credits (balance: %, required: %)', balance, amount;
  end if;

  insert into public.credit_transactions (org_id, amount, kind, description, created_by)
  values (target_org, -amount, 'consumption', reason, auth.uid());

  return balance - amount;
end;
$$;

-- Validates a coupon for checkout without exposing the coupons table.
create or replace function public.validate_coupon(coupon_code text)
returns table (id uuid, code text, discount_type public.discount_type, discount_value integer)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.code, c.discount_type, c.discount_value
  from public.coupons c
  where c.code = coupon_code
    and c.is_active
    and (c.valid_until is null or c.valid_until > now())
    and (c.max_redemptions is null or c.redeemed_count < c.max_redemptions);
$$;

-- Shallow-merge aggregate for jsonb objects (used by org_entitlements).
create or replace function public.jsonb_merge(a jsonb, b jsonb)
returns jsonb language sql immutable as $$ select coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb); $$;

create aggregate public.jsonb_merge_agg (jsonb) (
  sfunc = public.jsonb_merge,
  stype = jsonb,
  initcond = '{}'
);

-- Effective entitlements for an org: plan limits merged with active
-- module limits, plus the suspension flag. App features gate on this.
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
begin
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('active', false, 'reason', 'no_subscription');
  end if;

  select p.limits into merged from public.plans p where p.id = sub.plan_id;

  select coalesce(merged || jsonb_object_agg_merged.limits, merged) into merged
  from (
    select jsonb_merge_agg(m.limits) as limits
    from public.subscription_modules sm
    join public.modules m on m.id = sm.module_id
    where sm.subscription_id = sub.id and sm.status = 'active'
  ) as jsonb_object_agg_merged
  where jsonb_object_agg_merged.limits is not null;

  return jsonb_build_object(
    'active', (not sub.admin_suspended) and sub.status in ('trialing', 'active'),
    'suspended', sub.admin_suspended,
    'status', sub.status,
    'plan_id', sub.plan_id,
    'limits', coalesce(merged, '{}'::jsonb),
    'credit_balance', public.org_credit_balance(target_org)
  );
end;
$$;

-- ---------- updated_at maintenance ----------

create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

create trigger modules_updated_at
  before update on public.modules
  for each row execute function public.set_updated_at();

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
