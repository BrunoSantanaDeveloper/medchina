-- ============================================================
-- 0032_shell_activation_billing
-- Persistent start-track choice, sticky activation, explicit invite
-- confirmation and end-of-period billing cancellation.
-- ============================================================

-- The selected track is a preference, not activation itself. Activation still
-- comes from live clinical facts and, once reached, never moves backwards.
alter table public.onboarding_state
  add column if not exists selected_track text
  check (selected_track is null or selected_track in ('manual', 'demo', 'ai'));

-- A scheduled cancellation keeps the paid entitlement until the current
-- period ends. The provider lifecycle remains mirrored by status/canceled_at.
alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancellation_requested_at timestamptz;

create index if not exists subscriptions_cancellation_due_idx
  on public.subscriptions (current_period_end)
  where cancel_at_period_end = true
    and status in ('trialing', 'active', 'past_due');

-- One protected predicate is shared by the RPC and the row guard below. It
-- evaluates the target user's own workspace memberships instead of relying on
-- the caller's auth context.
create or replace function public.medchina_activation_requirements_met(target_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select target_user is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = target_user
        and nullif(btrim(p.display_name), '') is not null
    )
    and exists (
      select 1
      from public.patients p
      where p.created_by = target_user
         or exists (
           select 1 from public.memberships m
           where m.user_id = target_user and m.org_id = p.org_id
         )
    )
    and exists (
      select 1
      from public.consultations c
      where c.status = 'finalized'
        and (
          c.created_by = target_user
          or exists (
            select 1 from public.memberships m
            where m.user_id = target_user and m.org_id = c.org_id
          )
        )
        and not exists (
          select 1 from public.recordings r
          where r.consultation_id = c.id and r.mode = 'ai'
        )
    );
$$;

-- `completed_at` is a product fact, not client-owned checklist state. Direct
-- table writes may select/dismiss a track, but cannot manufacture, clear,
-- delete or move the permanent activation marker.
create or replace function public.guard_medchina_activation_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Preserve account-erasure cascades and explicitly trusted service-role
  -- maintenance; this guard protects authenticated client mutations.
  if pg_trigger_depth() > 1 or auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.flow = 'activation' then
      raise exception 'activation_state_immutable' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.flow = 'activation' then
    if new.user_id is distinct from old.user_id
       or new.org_id is distinct from old.org_id
       or new.flow is distinct from old.flow then
      raise exception 'activation_state_immutable' using errcode = 'check_violation';
    end if;
    if old.completed_at is not null then
      new.completed_at := old.completed_at;
    end if;
  end if;

  if new.flow = 'activation' then
    if new.org_id is not null then
      raise exception 'activation_scope_invalid' using errcode = 'check_violation';
    end if;
    if new.completed_at is not null
       and (tg_op = 'INSERT' or old.completed_at is null) then
      if not public.medchina_activation_requirements_met(new.user_id) then
        raise exception 'activation_requirements_not_met' using errcode = 'check_violation';
      end if;
      new.completed_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists onboarding_state_guard_medchina_activation on public.onboarding_state;
create trigger onboarding_state_guard_medchina_activation
  before insert or update or delete on public.onboarding_state
  for each row execute function public.guard_medchina_activation_state();

-- Stamp the activation moment from REAL product state. The coalesce is the
-- sticky boundary: deleting later data never erases a moment already reached.
create or replace function public.sync_medchina_activation()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  activated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if public.medchina_activation_requirements_met(auth.uid()) then
    insert into public.onboarding_state (
      user_id,
      org_id,
      flow,
      completed_steps,
      dismissed,
      completed_at
    ) values (
      auth.uid(),
      null,
      'activation',
      '[]'::jsonb,
      false,
      now()
    )
    on conflict (user_id, org_id, flow)
    do update set completed_at = coalesce(public.onboarding_state.completed_at, excluded.completed_at)
    returning completed_at into activated_at;
  else
    select s.completed_at into activated_at
    from public.onboarding_state s
    where s.user_id = auth.uid()
      and s.org_id is null
      and s.flow = 'activation';
  end if;

  return activated_at;
end;
$$;

revoke all on function public.sync_medchina_activation() from public, anon;
revoke all on function public.medchina_activation_requirements_met(uuid) from public, anon, authenticated;
revoke all on function public.guard_medchina_activation_state() from public, anon, authenticated;
grant execute on function public.sync_medchina_activation() to authenticated;

-- A token holder may preview enough context to make an informed choice. The
-- e-mail is intentionally omitted; accept_invite performs the identity check.
create or replace function public.preview_invite(invite_token uuid)
returns table (
  organization_name text,
  invited_by_name text,
  invite_role public.org_role,
  expires_at timestamptz,
  available boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.name,
    p.display_name,
    i.role,
    i.expires_at,
    i.accepted_at is null and i.expires_at > now()
  from public.invites i
  join public.organizations o on o.id = i.org_id
  left join public.profiles p on p.id = i.invited_by
  where i.token = invite_token;
$$;

revoke all on function public.preview_invite(uuid) from public, anon;
grant execute on function public.preview_invite(uuid) to authenticated;

-- Acceptance is now both deliberate in the UI and bound to the authenticated
-- e-mail. A forwarded token cannot add an unrelated account to a workspace.
create or replace function public.accept_invite(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites%rowtype;
  signed_in_email text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Two different valid invite tokens accepted concurrently by the same user
  -- must not both pass the one-workspace check before either membership exists.
  perform pg_advisory_xact_lock(hashtextextended('invite-user:' || auth.uid()::text, 0));

  signed_in_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  select * into inv
  from public.invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invite_unavailable';
  end if;

  if signed_in_email = '' or signed_in_email <> lower(inv.email) then
    raise exception 'invite_email_mismatch';
  end if;

  if exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.org_id <> inv.org_id
  ) then
    raise exception 'invite_workspace_conflict';
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do nothing;

  update public.invites set accepted_at = now() where id = inv.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    inv.org_id,
    auth.uid(),
    'org.invite.accepted',
    'invite',
    inv.id::text,
    jsonb_build_object('role', inv.role)
  );

  return inv.org_id;
end;
$$;

revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;
