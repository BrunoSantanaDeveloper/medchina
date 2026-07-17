-- ============================================================
-- 0035_billing_idempotency
-- Durable operation claims for checkout/cancellation and a provider webhook
-- inbox. External calls stay outside transactions; retries reuse one key.
-- ============================================================

create table if not exists public.billing_operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('checkout', 'cancel', 'resume')),
  idempotency_key uuid not null,
  plan_id uuid references public.plans(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text check (provider is null or provider in ('stripe', 'asaas')),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  claim_token uuid,
  result jsonb not null default '{}'::jsonb,
  error_code text,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_operations_processing_claim_check
    check (status <> 'processing' or (claim_token is not null and lease_expires_at is not null)),
  unique (org_id, kind, idempotency_key)
);

alter table public.billing_operations enable row level security;
create policy billing_operations_select_manager on public.billing_operations for select to authenticated
  using (actor_id = auth.uid() and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
revoke insert, update, delete on table public.billing_operations from authenticated;

alter table public.subscriptions
  add column if not exists billing_operation_id uuid references public.billing_operations(id) on delete set null;
create unique index if not exists subscriptions_billing_operation_unique_idx
  on public.subscriptions (billing_operation_id) where billing_operation_id is not null;
-- A provider subscription is one external object. Reconciliation retries may
-- reference it again, but must never create a second local owner for it.
create unique index if not exists subscriptions_provider_subscription_unique_idx
  on public.subscriptions (provider, provider_subscription_id)
  where provider is not null and provider_subscription_id is not null;

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'asaas')),
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_webhooks_processing_claim_check
    check (status <> 'processing' or (claim_token is not null and lease_expires_at is not null)),
  unique (provider, provider_event_id, event_type)
);
alter table public.billing_webhook_events enable row level security;
revoke all on table public.billing_webhook_events from public;

alter table public.credit_transactions add column if not exists source_invoice_key text;
create unique index if not exists credit_transactions_source_invoice_unique_idx
  on public.credit_transactions (source_invoice_key);

create or replace function public.claim_billing_operation(
  target_org uuid,
  target_actor uuid,
  target_kind text,
  target_idempotency_key uuid,
  target_provider text default null,
  target_plan uuid default null,
  target_subscription uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
  inserted_count integer := 0;
  claimed_token uuid;
begin
  if auth.role() is distinct from 'service_role'
     or target_org is null
     or target_actor is null
     or target_kind is null
     or target_kind not in ('checkout', 'cancel', 'resume')
     or target_idempotency_key is null
     or target_provider is null
     or target_provider not in ('stripe', 'asaas') then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_actor and m.role in ('owner', 'admin')
  ) then return jsonb_build_object('ok', false, 'code', 'not_authorized'); end if;

  insert into public.billing_operations (
    org_id, actor_id, kind, idempotency_key, provider, plan_id,
    subscription_id, status, claim_token, lease_expires_at
  ) values (
    target_org, target_actor, target_kind, target_idempotency_key, target_provider,
    target_plan, target_subscription, 'processing', gen_random_uuid(), now() + interval '2 minutes'
  )
  on conflict (org_id, kind, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;

  select o.* into operation_row from public.billing_operations o
  where o.org_id = target_org and o.kind = target_kind and o.idempotency_key = target_idempotency_key
  for update;

  if operation_row.actor_id <> target_actor
     or operation_row.provider is distinct from target_provider
     or operation_row.plan_id is distinct from target_plan
     or operation_row.subscription_id is distinct from target_subscription then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if operation_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'completed', 'operationId', operation_row.id, 'result', operation_row.result);
  end if;
  if inserted_count = 0
     and operation_row.status = 'processing'
     and operation_row.lease_expires_at is not null
     and operation_row.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'operation_in_progress');
  end if;

  update public.billing_operations
  set status = 'processing',
      attempts = case when inserted_count = 0 then attempts + 1 else attempts end,
      claim_token = gen_random_uuid(),
      lease_expires_at = now() + interval '2 minutes',
      error_code = null,
      completed_at = null,
      updated_at = now()
  where id = operation_row.id
  returning claim_token into claimed_token;
  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'operationId', operation_row.id,
    'claimToken', claimed_token
  );
end;
$$;

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
    and claim_token = target_claim_token;
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
     or operation_row.claim_token is distinct from target_claim_token then
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
  returning claim_token into claimed_token;
  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'eventId', event_row.id,
    'claimToken', claimed_token
  );
end;
$$;

create or replace function public.complete_billing_webhook_event(
  target_event uuid,
  target_claim_token uuid,
  target_success boolean,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     or target_event is null
     or target_claim_token is null
     or target_success is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  update public.billing_webhook_events
  set status = case when target_success then 'completed' else 'failed' end,
      completed_at = case when target_success then now() else null end,
      claim_token = null,
      lease_expires_at = null,
      error_code = case when target_success then null else coalesce(nullif(btrim(target_error_code), ''), 'handler_failed') end,
      updated_at = now()
  where id = target_event
    and status = 'processing'
    and claim_token = target_claim_token;
  if not found then
    if exists (select 1 from public.billing_webhook_events where id = target_event) then
      return jsonb_build_object('ok', false, 'code', 'claim_lost');
    end if;
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', case when target_success then 'completed' else 'failed' end
  );
end;
$$;

revoke all on function public.claim_billing_operation(uuid, uuid, text, uuid, text, uuid, uuid) from public;
revoke all on function public.complete_billing_operation(uuid, uuid, boolean, jsonb, text) from public;
revoke all on function public.complete_checkout_billing_operation(uuid, uuid, uuid, text, text, text, text) from public;
revoke all on function public.claim_billing_webhook_event(text, text, text) from public;
revoke all on function public.complete_billing_webhook_event(uuid, uuid, boolean, text) from public;
grant execute on function public.claim_billing_operation(uuid, uuid, text, uuid, text, uuid, uuid) to service_role;
grant execute on function public.complete_billing_operation(uuid, uuid, boolean, jsonb, text) to service_role;
grant execute on function public.complete_checkout_billing_operation(uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.claim_billing_webhook_event(text, text, text) to service_role;
grant execute on function public.complete_billing_webhook_event(uuid, uuid, boolean, text) to service_role;
