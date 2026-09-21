-- ============================================================
-- 0108_people_without_workspace: the support case the console could not see.
--
-- `admin_accounts_overview` (0104) lists ORGANIZATIONS. A person who has a
-- profile but no membership is therefore invisible there — and she is exactly
-- the one who writes "me cadastrei e não consigo usar". The users tab did
-- show her, as a row with "Consultórios: 0" among every other profile, with
-- no signal and no reason to look twice.
--
-- Why such a person exists at all, verified against the code that creates
-- accounts (do NOT simplify this into "social login has no workspace" — the
-- console would then teach the operator a cause that is false):
--
--   * `handle_new_user` (0019) creates the organization only when the sign-up
--     metadata carries `company`;
--   * the sign-up form requires `company`, EXCEPT when joining an invite
--     (apps/web/src/app/auth/sign-up/page.tsx) — the invite supplies the one
--     MVP workspace on acceptance;
--   * OAuth carries no `company`, so `auth/callback/route.ts` redirects a
--     first-time Google/GitHub user to `/auth/complete-profile`, which calls
--     `create_organization`.
--
-- So being workspace-less is a RESIDUE, never a steady state: an abandoned
-- complete-profile, an invite never accepted, or a workspace that went away.
-- Each residue has a DIFFERENT repair, which is why this function reports the
-- cause instead of a boolean. In particular an invite still pending must not
-- be "fixed" by creating a personal workspace: `auth/callback` refuses that
-- on purpose ("creating a second personal workspace would be wrong"), and a
-- second org is what the MVP does not support.
--
-- Deliberately a SEPARATE function, and a separate payload key, rather than a
-- branch inside 0104:
--   * `totals.accounts` keeps meaning "workspaces", so the summary tiles and
--     `lib/admin-jobs.ts` do not silently change definition;
--   * the nightly digest filters `accounts` by flag, and a person without a
--     workspace is a PERMANENT condition — folded into that array she would
--     be reported every morning forever, the failure `TRIAL_ENDED_NEWS_HOURS`
--     already exists to prevent;
--   * 0104's `account` CTE carries nine lateral subqueries and
--     `org_audio_allowance`; none of it applies to a person with no org, and
--     union-ing a hollow row through it buys nothing.
-- ============================================================

create or replace function public.admin_people_without_workspace()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  -- Same gate as 0104: the platform role, or the service role for a job.
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  with person as (
    select
      p.id as user_id,
      p.display_name,
      p.is_superadmin,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.banned_until,
      nullif(btrim(coalesce(u.raw_app_meta_data ->> 'provider', '')), '') as auth_provider
    from public.profiles p
    join auth.users u on u.id = p.id
    where not exists (
      select 1 from public.memberships m where m.user_id = p.id
    )
  ),
  -- The invite that explains her, if there is one. Most recent wins: a
  -- resent invite supersedes the one before it.
  pending as (
    select distinct on (lower(i.email))
      lower(i.email) as email,
      i.org_id,
      o.name as org_name,
      i.role::text as role,
      i.expires_at,
      i.created_at as invited_at,
      (i.expires_at > now()) as still_valid
    from public.invites i
    join public.organizations o on o.id = i.org_id
    where i.accepted_at is null
    order by lower(i.email), i.created_at desc
  ),
  shaped as (
    select
      person.*,
      pending.org_id as invite_org_id,
      pending.org_name as invite_org_name,
      pending.role as invite_role,
      pending.expires_at as invite_expires_at,
      pending.invited_at as invite_sent_at,
      pending.still_valid as invite_valid,
      case
        when pending.email is not null and pending.still_valid then 'invite_pending'
        when pending.email is not null then 'invite_expired'
        -- She came in through a provider that carries no practice name and
        -- did not finish /auth/complete-profile.
        when coalesce(person.auth_provider, 'email') <> 'email' then 'setup_abandoned'
        -- E-mail sign-up requires a practice name, so this one SHOULD have a
        -- workspace: it was removed, or the org was deleted. Saying "unknown"
        -- is the honest answer; guessing would put a false cause in front of
        -- the operator, who repeats it to the customer.
        else 'unknown'
      end as cause
    from person
    left join pending on pending.email = lower(person.email)
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'people', count(*),
      'invitePending', count(*) filter (where cause = 'invite_pending'),
      'inviteExpired', count(*) filter (where cause = 'invite_expired'),
      'setupAbandoned', count(*) filter (where cause = 'setup_abandoned'),
      'unknown', count(*) filter (where cause = 'unknown'),
      'neverSignedIn', count(*) filter (where last_sign_in_at is null)
    ),
    'people', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'userId', user_id,
          'name', display_name,
          'email', email,
          'createdAt', created_at,
          'lastSignInAt', last_sign_in_at,
          'confirmed', email_confirmed_at is not null,
          'bannedUntil', banned_until,
          'isSuperadmin', coalesce(is_superadmin, false),
          'authProvider', auth_provider,
          'cause', cause,
          'invite', case when invite_org_id is null then null else jsonb_build_object(
            'orgId', invite_org_id,
            'orgName', invite_org_name,
            'role', invite_role,
            'sentAt', invite_sent_at,
            'expiresAt', invite_expires_at,
            'valid', invite_valid
          ) end
        )
        order by created_at desc
      ),
      '[]'::jsonb
    )
  )
  into result
  from shaped;

  return result;
end;
$$;

comment on function public.admin_people_without_workspace() is
  'Superadmin view of profiles with no membership — the "signed up and cannot use the product" support case — with the CAUSE distinguished (pending invite, expired invite, abandoned setup, unknown), because each one has a different repair.';

revoke all on function public.admin_people_without_workspace() from public, anon;
-- `is_superadmin()` inside the function is the real gate; the grant only lets
-- an authenticated session reach it.
grant execute on function public.admin_people_without_workspace() to authenticated;
