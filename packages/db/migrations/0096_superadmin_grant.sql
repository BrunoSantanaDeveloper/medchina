-- ============================================================
-- 0096_superadmin_grant: making the platform role grantable from the
-- console — and ungrantable by anybody else.
--
-- `profiles.is_superadmin` (0001) is the highest privilege in the product:
-- it opens every workspace's chart through the `*_select_superadmin`
-- policies (0010), support impersonation (0057), the suspension
-- kill-switch and comped plans (0067). Until now it was set exactly the way
-- the bootstrap comment in 0001 describes — by hand, in SQL.
--
-- The gap that matters is NOT the missing button. It is that
-- `profiles_update_own` (0000) lets a session update its OWN row, the legacy
-- default privileges grant `authenticated` every column of the table, and
-- nothing singled this column out. A single
--
--     PATCH /rest/v1/profiles?id=eq.<self>   {"is_superadmin": true}
--
-- promoted any signed-in user to platform operator, with read access to
-- every patient record in the database. Closing that is the point of this
-- migration; the console action is only what replaces the hole.
--
-- Two objects, in this order of importance:
--
--   1. A trigger that refuses the column to anyone who is not already a
--      superadmin. It is deliberately NOT keyed on "did this come from the
--      RPC" — a transaction-local flag is something the caller could try to
--      set itself — but on WHO is asking, which PostgREST cannot forge:
--      `is_superadmin()` reads the database, not the request.
--
--   2. `set_user_superadmin()`, the only path an authenticated session has
--      to the column. RLS gives a superadmin no update policy on anybody
--      else's profile (0000/0010 are select-only for other people), so
--      without a definer function the flag is simply unreachable from the
--      product.
--
-- Self-change is refused on both sides. Granting to yourself is the
-- escalation the trigger exists to stop; REVOKING from yourself is refused
-- for a duller reason: with self-demotion allowed, the last operator locks
-- the platform out of its own admin area with one click and no in-product
-- path exists to get back in. It also makes the "last superadmin" case
-- unreachable by construction — the actor is always a superadmin who stays
-- one, so no grant or revoke can ever empty the set.
--
-- The FIRST superadmin is still made outside the product: the 0001
-- bootstrap, the service role or psql, where `auth.uid()` is null. There is
-- nobody to authorize that click yet, and that same path is the way back if
-- the set is ever emptied by a direct write.
-- ============================================================

-- ---------- The fence ----------

create or replace function public.guard_superadmin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `before update of is_superadmin` fires whenever the column is MENTIONED,
  -- so a write that merely carries the same value is not a change.
  if new.is_superadmin is not distinct from old.is_superadmin then
    return new;
  end if;

  -- No JWT at all: the service role, a migration or psql. The bootstrap
  -- path, and the only way back in if the set of superadmins is emptied.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_superadmin() then
    raise exception 'superadmin_not_self_assignable'
      using errcode = '42501',
            hint = 'Only a platform superadmin can grant this role.';
  end if;

  if new.id = auth.uid() then
    raise exception 'superadmin_self_change_forbidden'
      using errcode = '42501',
            hint = 'Ask another superadmin: removing your own role could leave the platform with no operator.';
  end if;

  return new;
end;
$$;

comment on function public.guard_superadmin_flag() is
  'Refuses any change to profiles.is_superadmin that does not come from an existing superadmin acting on somebody else (or from a session with no JWT: service role, migration, psql).';

drop trigger if exists guard_superadmin_flag on public.profiles;
create trigger guard_superadmin_flag
  before update of is_superadmin on public.profiles
  for each row execute function public.guard_superadmin_flag();

-- ---------- The grant path ----------

create or replace function public.set_user_superadmin(
  target_user uuid,
  value boolean,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous boolean;
  target_name text;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized';
  end if;

  -- A support visit runs inside somebody else's session (0057). Handing out
  -- the platform role from there would attribute the grant to the
  -- professional being visited, which is precisely what the trail must not
  -- say. Impersonated sessions are non-superadmin anyway; this covers the
  -- one case that is not (a superadmin visiting a superadmin).
  if public.is_impersonated() then
    raise exception 'not_authorized';
  end if;

  if target_user = auth.uid() then
    raise exception 'self_change_forbidden'
      using hint = 'Another superadmin has to do it.';
  end if;

  select p.is_superadmin, p.display_name
    into previous, target_name
  from public.profiles p
  where p.id = target_user
  for update;

  if not found then
    raise exception 'user_not_found';
  end if;

  if previous = value then
    return jsonb_build_object('ok', true, 'changed', false, 'isSuperadmin', value);
  end if;

  update public.profiles set is_superadmin = value where id = target_user;

  -- Platform-level act: no org_id, like every other /admin action. Who
  -- promoted whom is the line an auditor comes here to read.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    auth.uid(),
    case when value then 'admin.user.superadmin_granted' else 'admin.user.superadmin_revoked' end,
    'user',
    target_user::text,
    jsonb_strip_nulls(jsonb_build_object(
      'display_name', target_name,
      'note', nullif(btrim(target_note), '')
    ))
  );

  return jsonb_build_object('ok', true, 'changed', true, 'isSuperadmin', value);
end;
$$;

comment on function public.set_user_superadmin(uuid, boolean, text) is
  'Grants or revokes profiles.is_superadmin for another user. Superadmin-only, never on yourself, always audited.';

revoke all on function public.set_user_superadmin(uuid, boolean, text) from public, anon;
-- `is_superadmin()` inside the function is the real gate; the grant only lets
-- an authenticated session reach it.
grant execute on function public.set_user_superadmin(uuid, boolean, text) to authenticated;
