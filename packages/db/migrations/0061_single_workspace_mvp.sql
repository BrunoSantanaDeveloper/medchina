-- ============================================================
-- 0060_single_workspace_mvp
--
-- The MVP account model is ONE workspace per professional (root CLAUDE.md;
-- multi-professional clinics are post-MVP). The template's multi-tenancy came
-- with an unrestricted `create_organization`, and nothing in the product ever
-- caught up with the consequences:
--
--   * `pro_trials` is keyed by org_id and `start_pro_trial` only checks that
--     no trial exists FOR THAT ORG — so creating a second organization hands
--     out a brand-new 14-day / 300-minute Pro trial. Same for the library's
--     monthly message quota, which is also per org. The invariant the billing
--     layer documents ("one per workspace, never reset") was enforced nowhere.
--   * There is no concept of an ACTIVE workspace in the app: the patient list
--     reads every patient RLS allows, and creating a patient resolves the org
--     with `memberships … limit(1)` and no ordering. With two memberships,
--     records from different workspaces mix in one list and a new patient
--     lands in an arbitrary one. For a clinical record that is the worst class
--     of bug — silent, and hard to untangle afterwards.
--
-- Until an explicit workspace switcher exists, the database refuses the second
-- organization. Accepting an INVITE is deliberately still allowed (that is how
-- a post-MVP clinic will onboard, and it is an explicit act by two people),
-- but a user who already belongs to a workspace cannot create another one.
--
-- Superadmins are exempt: platform operators legitimately create tenants.
-- ============================================================

create or replace function public.create_organization(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- One workspace per professional (MVP). Without this, a second workspace
  -- silently resets the Pro trial and the library quota, and splits the
  -- clinical record across tenants the UI cannot tell apart.
  if not public.is_superadmin()
     and exists (select 1 from public.memberships m where m.user_id = auth.uid()) then
    raise exception 'workspace_limit_reached'
      using hint = 'MedChina MVP: one workspace per professional. Join an existing workspace by invite instead.';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (org_name, org_slug, auth.uid())
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'owner');

  return new_org;
end;
$$;

comment on function public.create_organization(text, text) is
  'Creates a workspace and its owner membership. MedChina MVP: refuses a SECOND workspace for the same user (trial and quota are per org; the app has no active-workspace concept yet).';

-- The signup trigger creates the first organization for a brand-new user and
-- runs before any membership exists, so it is unaffected by the guard above.

-- ---------- Belt and braces: the trial is per PROFESSIONAL, not just per org ----------

/**
 * Even with the guard above, someone who joins a second workspace BY INVITE
 * could start a trial that workspace never had — the same person, a second
 * free 14 days / 300 minutes. `pro_trials.started_by` already records who
 * started it (0024); this makes the RPC actually read it.
 *
 * Everything else is preserved verbatim from 0033: the row lock that stops web
 * and mobile from racing on the first real AI capture, the trial_available
 * check, and `on conflict do nothing` as the final fence.
 */
create index if not exists pro_trials_started_by_idx on public.pro_trials (started_by);

create or replace function public.start_pro_trial(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  params jsonb;
  trial_days integer;
  trial_minutes integer;
  allowance jsonb;
begin
  if not public.is_org_member(target_org) then
    raise exception 'not a member of this organization';
  end if;

  perform 1
  from public.organizations o
  where o.id = target_org
  for update;

  allowance := public.org_audio_allowance(target_org);
  if not coalesce((allowance ->> 'trial_available')::boolean, false) then
    return allowance;
  end if;

  -- One promotion per professional. Returning the allowance unchanged (rather
  -- than raising) keeps every caller's contract: the recorder reads
  -- can_start/reason and explains the block from there.
  if auth.uid() is not null
     and exists (select 1 from public.pro_trials where started_by = auth.uid()) then
    return allowance;
  end if;

  select value into params from public.platform_settings where key = 'trial';
  trial_days := coalesce((params ->> 'days')::int, 14);
  trial_minutes := coalesce((params ->> 'minutes')::int, 300);

  insert into public.pro_trials (org_id, started_at, ends_at, minutes_limit, started_by)
  values (
    target_org,
    now(),
    now() + make_interval(days => trial_days),
    trial_minutes,
    auth.uid()
  )
  on conflict (org_id) do nothing;

  return public.org_audio_allowance(target_org);
end;
$$;

revoke all on function public.start_pro_trial(uuid) from public, anon;
grant execute on function public.start_pro_trial(uuid) to authenticated, service_role;
