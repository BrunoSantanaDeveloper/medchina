-- ============================================================
-- 0063_library_usage_ledger
--
-- The library's monthly quota was counted by COUNTING `messages` rows with
-- role='user' (0042). Two consequences, both real:
--
--   1) The meter was reversible by the person it meters. Deleting a
--      conversation deletes its messages, so the month's usage silently drops
--      — 20 free messages become unlimited for anyone who deletes as they go.
--   2) It charged for nothing. The user message is inserted BEFORE the
--      provider streams; if generation fails immediately, the row stays and
--      counts, so a Gemini outage spends the professional's quota and gives
--      her no answer.
--
-- This moves the meter to an append-only ledger, the same shape `audio_usage`
-- already uses for minutes (0024): written by the SERVICE ROLE only, and only
-- on success. `conversation_id` is `on delete set null` on purpose — deleting
-- a conversation must remove the clinical content (LGPD, 0044 cascade) WITHOUT
-- erasing the fact that a message was spent.
--
-- Usage recorded before this migration is backfilled for the CURRENT month, so
-- nobody's counter resets to zero at deploy time.
-- ============================================================

create table if not exists public.library_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  assistant_id uuid not null references public.assistants (id) on delete cascade,
  -- Deliberately survives its conversation: the content is erasable, the meter
  -- is not (see the header).
  conversation_id uuid references public.conversations (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists library_usage_window_idx
  on public.library_usage (org_id, assistant_id, created_at desc);

alter table public.library_usage enable row level security;
revoke all on table public.library_usage from public;
grant select on table public.library_usage to authenticated;
-- RLS with no write policy is what actually stops a client write (the pattern
-- audio_usage follows). Revoking the grants Supabase hands new public tables
-- is belt and braces on top of it, so the meter cannot be touched even if a
-- policy were ever added by mistake.
revoke insert, update, delete on table public.library_usage from anon, authenticated;

-- Members read their own workspace's meter (the UI shows "N of 20 this
-- month"). Nobody writes through the API: inserts come from the service role,
-- which bypasses RLS — the same discipline that makes audio_usage trustworthy.
drop policy if exists library_usage_select_member on public.library_usage;
create policy library_usage_select_member
  on public.library_usage for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

comment on table public.library_usage is
  'Append-only meter of library assistant messages actually answered. Service-role writes only; survives conversation deletion so the quota cannot be reset by deleting chats.';

-- ---------- Backfill the current month so no counter resets ----------

insert into public.library_usage (org_id, assistant_id, conversation_id, user_id, created_at)
select c.org_id, c.assistant_id, c.id, null, m.created_at
from public.messages m
join public.conversations c on c.id = m.conversation_id
where m.role = 'user'
  and m.created_at >= date_trunc('month', now())
  and c.assistant_id is not null;

-- ---------- The allowance now reads the ledger ----------

-- Identical to 0054 except for ONE thing: where `used_messages` comes from.
-- The dunning window, the named `reason` every screen branches on, and the
-- suspension rule are preserved verbatim — this migration changes the meter,
-- not the billing policy.
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
  used_messages integer := 0;
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

  -- Calendar month on purpose: "N mensagens neste mês" must read the same for
  -- the professional regardless of her billing anchor day. Counted from the
  -- append-only ledger, so deleting a conversation no longer refunds quota and
  -- a failed generation never spent any.
  select count(*) into used_messages
  from public.library_usage u
  where u.org_id = target_org
    and u.assistant_id = helper.id
    and u.created_at >= window_start;

  return jsonb_build_object(
    'allowed', used_messages < limit_messages,
    'unlimited', false,
    'used', used_messages,
    'limit', limit_messages,
    'window_start', window_start,
    'reason', case when used_messages < limit_messages then 'ok' else 'quota_exhausted' end
  );
end;
$$;

revoke all on function public.org_message_allowance(uuid, text) from public, anon;
grant execute on function public.org_message_allowance(uuid, text) to authenticated, service_role;

/**
 * Record one answered message. Called by the chat route AFTER the provider
 * actually produced text — a failed generation must cost nothing.
 *
 * Service-role only: the meter is not writable by the browser that it meters.
 */
create or replace function public.record_library_usage(
  target_org uuid,
  target_assistant text,
  target_conversation uuid,
  target_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  helper public.assistants%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select * into helper from public.assistants where slug = target_assistant;
  if helper.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  insert into public.library_usage (org_id, assistant_id, conversation_id, user_id)
  values (target_org, helper.id, target_conversation, target_user);

  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_library_usage(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_library_usage(uuid, text, uuid, uuid) to service_role;
