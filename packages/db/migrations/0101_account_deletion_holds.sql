-- ============================================================
-- 0101_account_deletion_holds: delete what HOLDS workspace data first.
--
-- The first real account deletion through 0099 failed with
--
--   update or delete on table "consent_acceptances" violates foreign key
--   constraint "patient_consent_session_items_acceptance_id_fkey"
--
-- and — being one transaction — deleted nothing. 0099 assumed that within a
-- single cascade Postgres checks NO ACTION / RESTRICT references only after
-- every sibling cascade has run. It does not: each referential check fires in
-- its turn, interleaved with the cascades themselves. Deleting the workspace
-- reached its consent acceptances (org FK from 0005) before the QR consent
-- session items that point at them (reached later, through
-- patient_consent_sessions, 0040), and the check found them still alive.
-- The issued-document RESTRICT references only passed 0099's test because
-- documents' org FK happens to be older than patients' and consultations' —
-- an accident of creation order no database is obliged to share.
--
-- So the order stops being left to Postgres. Before the workspace goes, the
-- RPC deletes every row that holds workspace data through a NO ACTION /
-- RESTRICT reference, holder before held:
--
--   patient_consent_session_items --acceptance_id----------> consent_acceptances
--   mobile_capture_authorizations --ai/audio_acceptance_id-> consent_acceptances
--   consent_acceptances           --consent_session_id-----> patient_consent_sessions
--   documents                     --patient/consultation/plan (RESTRICT), parent (NO ACTION)
--
-- None of these foreign keys is relaxed: in normal operation they guard
-- consent evidence and issued documents, and this definer RPC is the one path
-- entitled to erase them. Deleting the acceptances nulls the consent columns
-- of recordings and attachments on the way (SET NULL); the recording guard
-- lets that through because it runs nested, and both rows go with the
-- workspace one statement later.
--
-- The list is pinned by a catalog tripwire in
-- packages/db/tests/0032_account_deletion.test.sql: a new NO ACTION/RESTRICT
-- reference into deletable data fails there until it is added here.
-- ============================================================

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

  -- 1. What HOLDS workspace data through NO ACTION / RESTRICT references,
  --    holder before held (see header). Left to the cascade, these are
  --    checked mid-way and abort the whole deletion.
  delete from public.patient_consent_session_items i
  where i.session_id in (select s.id from public.patient_consent_sessions s where s.org_id = any(doomed))
     or i.acceptance_id in (select a.id from public.consent_acceptances a where a.org_id = any(doomed));
  delete from public.mobile_capture_authorizations where org_id = any(doomed);
  delete from public.consent_acceptances where org_id = any(doomed);
  delete from public.documents where org_id = any(doomed);

  -- 2. The workspaces: every other clinical table cascades from organizations.
  delete from public.organizations where id = any(doomed);

  -- 3. Their history — including the snapshots step 2 just wrote.
  delete from public.record_versions where org_id = any(doomed);

  -- 4. The person: profile, memberships elsewhere, notifications, sign-in
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

-- Unchanged from 0099 (create or replace keeps them); restated so the file
-- reads whole.
revoke all on function public.admin_delete_account(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_account(uuid, text, text) to authenticated;
