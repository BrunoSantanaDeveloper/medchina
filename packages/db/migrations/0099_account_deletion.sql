-- ============================================================
-- 0099_account_deletion: deleting a professional's account and every
-- piece of data that belongs to it, from the superadmin console.
--
-- "Delete the user" is the obvious implementation and it is wrong three
-- times over, which is why this is a guarded RPC and not a button that calls
-- the auth admin API:
--
--   1. **The user is not where the data is.** Deleting `auth.users` cascades
--      to her profile and memberships, but `organizations.created_by` is
--      SET NULL (0000) — so the workspace, with every patient, consultation,
--      recording and document in it, would SURVIVE with no member able to
--      see it. The unit of deletion is the account AND every workspace she
--      is the only member of.
--
--   2. **The org cascade is not erasure.** `record_versions` (0005) keeps a
--      full row snapshot of every write to the clinical tables, carries
--      `org_id` but has NO foreign key — and the versioning trigger writes a
--      fresh snapshot of every row the cascade deletes. Without an explicit
--      purge, the "deleted" charts would stay in the database, verbatim.
--
--   3. **Files are outside the transaction.** `storage.objects` refuses SQL
--      deletes (`protect_objects_delete`), so audio, PDFs, attachments,
--      imports and exports go through the Storage API after the commit. This
--      migration only LISTS them (`admin_orphaned_account_storage`), and only
--      for accounts that no longer exist: that list feeds a service-role
--      delete, so it must be structurally unable to point at a live practice.
--
-- Refused, in the database and not only in the dialog:
--
--   * yourself, and any platform superadmin (demote first — 0096; it also
--     keeps `impersonation_sessions.actor_id`, which is RESTRICT, out of the
--     way);
--   * the OWNER of a workspace other people still belong to — a clinic's
--     records are not hers alone to take (post-MVP, but the tables allow it);
--   * a subscription still charging at Stripe/Asaas: deleting the account
--     would leave the card being billed with no customer to answer to. The
--     console cancels it at the provider first;
--   * a support session (0057), whose actions would be attributed to the
--     professional being visited.
--
-- The friction is deliberate and enforced here: the operator states a reason
-- and types the account's e-mail. There is no undo anywhere in the product.
--
-- What survives, on purpose:
--   * the platform-level audit event (org_id NULL, so the cascade cannot take
--     it): who deleted which account, when, why, and HOW MUCH — counts only,
--     never clinical content. It is the proof the erasure happened;
--   * `product_events` telemetry, anonymized by its own FKs (org_id and
--     actor_id are SET NULL) and patient-free by construction (0034);
--   * automatic backups, until their retention window prunes them.
-- ============================================================

-- ---------- What goes, what blocks (internal helpers) ----------

-- Every workspace that disappears with the account: the ones she is the ONLY
-- member of, plus any she created that has no members left at all (dead data
-- only she ever wrote).
create or replace function public.account_deletion_workspaces(target_user uuid)
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(array_agg(o.id order by o.created_at), '{}'::uuid[])
  from public.organizations o
  where (
      exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id = target_user)
      and not exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id <> target_user)
    )
    or (
      o.created_by = target_user
      and not exists (select 1 from public.memberships m where m.org_id = o.id)
    );
$$;

-- Workspaces she OWNS that other people still belong to: a blocker.
-- (Where she is a plain member of someone else's practice, she simply leaves:
-- her membership goes with her profile and the practice keeps its records.)
create or replace function public.account_deletion_shared_workspaces(target_user uuid)
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(array_agg(m.org_id order by m.org_id), '{}'::uuid[])
  from public.memberships m
  where m.user_id = target_user
    and m.role = 'owner'
    and exists (
      select 1 from public.memberships other
      where other.org_id = m.org_id and other.user_id <> target_user
    );
$$;

-- Every stored object of the account. Workspace buckets are keyed by the org
-- id as the first path segment (their storage policies read
-- `storage.foldername(name)[1]` as the org); avatars by the user id.
-- `backups` is platform-wide and expires on its own retention.
create or replace function public.account_deletion_storage(target_orgs uuid[], target_user uuid)
returns table (bucket text, path text)
language sql
security definer
set search_path = public
stable
as $$
  select o.bucket_id::text, o.name::text
  from storage.objects o
  where (
      o.bucket_id in ('ai-attachments', 'clinical-attachments', 'documents', 'exports', 'imports', 'transcriptions')
      and split_part(o.name, '/', 1) = any(coalesce(target_orgs, '{}'::uuid[])::text[])
    )
    or (
      o.bucket_id = 'avatars'
      and target_user is not null
      and split_part(o.name, '/', 1) = target_user::text
    )
  order by 1, 2;
$$;

-- How much goes. Counts only: this lands in the audit trail, which outlives
-- the data, so it must never carry a name or a word of clinical content.
create or replace function public.account_deletion_counts(target_orgs uuid[], target_user uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'patients', (select count(*) from public.patients where org_id = any(target_orgs)),
    'consultations', (select count(*) from public.consultations where org_id = any(target_orgs)),
    'upcomingAppointments', (
      select count(*) from public.consultations
      where org_id = any(target_orgs) and status = 'scheduled' and scheduled_for >= now()
    ),
    'documents', (select count(*) from public.documents where org_id = any(target_orgs)),
    'recordings', (select count(*) from public.recordings where org_id = any(target_orgs)),
    'attachments', (select count(*) from public.consultation_attachments where org_id = any(target_orgs)),
    'historyVersions', (select count(*) from public.record_versions where org_id = any(target_orgs)),
    'storageObjects', (select count(*) from public.account_deletion_storage(target_orgs, target_user))
  );
$$;

revoke all on function public.account_deletion_workspaces(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_shared_workspaces(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_storage(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_counts(uuid[], uuid) from public, anon, authenticated;

-- ---------- Preview: what the operator is about to do ----------

create or replace function public.admin_account_deletion_preview(target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  target_profile public.profiles%rowtype;
  doomed uuid[];
  shared uuid[];
  blockers text[] := '{}';
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized';
  end if;

  select * into target_profile from public.profiles where id = target_user;
  if not found then
    raise exception 'user_not_found';
  end if;

  doomed := public.account_deletion_workspaces(target_user);
  shared := public.account_deletion_shared_workspaces(target_user);

  if target_user = auth.uid() then
    blockers := array_append(blockers, 'self');
  end if;
  if target_profile.is_superadmin then
    blockers := array_append(blockers, 'superadmin');
  end if;
  if cardinality(shared) > 0 then
    blockers := array_append(blockers, 'shared_workspace');
  end if;

  return jsonb_build_object(
    'userId', target_user,
    'email', (select u.email from auth.users u where u.id = target_user),
    'displayName', target_profile.display_name,
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.created_at)
      from public.organizations o where o.id = any(doomed)
    ), '[]'::jsonb),
    'sharedWorkspaces', coalesce((
      select jsonb_agg(o.name order by o.name)
      from public.organizations o where o.id = any(shared)
    ), '[]'::jsonb),
    'counts', public.account_deletion_counts(doomed, target_user),
    'providerSubscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'provider', s.provider,
        'providerSubscriptionId', s.provider_subscription_id,
        'status', s.status
      ))
      from public.subscriptions s
      where s.org_id = any(doomed)
        and s.status <> 'canceled'
        and nullif(btrim(coalesce(s.provider_subscription_id, '')), '') is not null
    ), '[]'::jsonb),
    -- The professional may owe a legal retention of her records; the console
    -- shows whether she ever took her copy (0081) before it goes.
    'lastExport', (
      select jsonb_build_object('status', e.status, 'completedAt', e.completed_at, 'expiresAt', e.expires_at)
      from public.account_exports e
      where e.org_id = any(doomed)
      order by e.requested_at desc
      limit 1
    ),
    'blockers', to_jsonb(blockers)
  );
end;
$$;

-- ---------- The deletion ----------

create or replace function public.admin_delete_account(
  target_user uuid,
  confirm_email text,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles%rowtype;
  target_email text;
  doomed uuid[];
  workspaces jsonb;
  counts jsonb;
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized';
  end if;

  if target_user = auth.uid() then
    raise exception 'self_delete_forbidden'
      using hint = 'Another superadmin has to do it.';
  end if;

  select * into target_profile from public.profiles where id = target_user for update;
  if not found then
    raise exception 'user_not_found';
  end if;

  if target_profile.is_superadmin then
    raise exception 'target_is_superadmin'
      using hint = 'Remove the platform role first (set_user_superadmin), then delete the account.';
  end if;

  -- The typed confirmation is checked HERE: a dialog-only check is a check a
  -- direct RPC call skips.
  select u.email into target_email from auth.users u where u.id = target_user;
  if lower(btrim(coalesce(confirm_email, ''))) <> lower(coalesce(target_email, target_user::text)) then
    raise exception 'confirmation_mismatch';
  end if;

  if length(btrim(coalesce(reason, ''))) < 8 then
    raise exception 'reason_required';
  end if;

  if cardinality(public.account_deletion_shared_workspaces(target_user)) > 0 then
    raise exception 'shared_workspace'
      using hint = 'She owns a workspace other people still belong to. Transfer ownership or remove the other members first.';
  end if;

  doomed := public.account_deletion_workspaces(target_user);

  -- Lock the workspaces before counting: a write racing the deletion either
  -- lands before it (and is deleted with it) or fails its FK after it.
  perform 1 from public.organizations where id = any(doomed) for update;

  if exists (
    select 1 from public.subscriptions s
    where s.org_id = any(doomed)
      and s.status <> 'canceled'
      and nullif(btrim(coalesce(s.provider_subscription_id, '')), '') is not null
  ) then
    raise exception 'provider_subscription_live'
      using hint = 'Cancel it at the provider first: deleting the account would leave the card being charged.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.created_at), '[]'::jsonb)
    into workspaces
  from public.organizations o
  where o.id = any(doomed);

  counts := public.account_deletion_counts(doomed, target_user);

  -- 1. The workspaces: every clinical table cascades from organizations.
  delete from public.organizations where id = any(doomed);

  -- 2. Their history — including the snapshots step 1 just wrote.
  delete from public.record_versions where org_id = any(doomed);

  -- 3. The person: profile, memberships elsewhere, notifications, sign-in
  --    trail, sessions and MFA factors all cascade from auth.users.
  delete from auth.users where id = target_user;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    auth.uid(),
    'admin.account.deleted',
    'user',
    target_user::text,
    jsonb_build_object(
      'email', target_email,
      'display_name', target_profile.display_name,
      'reason', btrim(reason),
      'workspaces', workspaces,
      'counts', counts
    )
  );

  return jsonb_build_object(
    'ok', true,
    'deletedWorkspaces', to_jsonb(doomed),
    'counts', counts
  );
end;
$$;

-- ---------- Files of an account that is gone ----------

-- Lists what the service role must remove from Storage. Refuses any workspace
-- or user that still exists, so a typo, a stale id or a malicious call can
-- only ever reach leftovers that belong to nobody.
create or replace function public.admin_orphaned_account_storage(target_orgs uuid[], target_user uuid default null)
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized';
  end if;

  if exists (select 1 from public.organizations o where o.id = any(coalesce(target_orgs, '{}'::uuid[]))) then
    raise exception 'workspace_still_exists';
  end if;

  if target_user is not null and exists (select 1 from auth.users u where u.id = target_user) then
    raise exception 'user_still_exists';
  end if;

  return query
    select s.bucket, s.path
    from public.account_deletion_storage(target_orgs, target_user) s;
end;
$$;

revoke all on function public.admin_account_deletion_preview(uuid) from public, anon;
revoke all on function public.admin_delete_account(uuid, text, text) from public, anon;
revoke all on function public.admin_orphaned_account_storage(uuid[], uuid) from public, anon;
-- `is_superadmin()` inside each function is the real gate; the grant only
-- lets an authenticated session reach it.
grant execute on function public.admin_account_deletion_preview(uuid) to authenticated;
grant execute on function public.admin_delete_account(uuid, text, text) to authenticated;
grant execute on function public.admin_orphaned_account_storage(uuid[], uuid) to authenticated;
