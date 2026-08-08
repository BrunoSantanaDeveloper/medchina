-- ---------------------------------------------------------------------------
-- 0084 — The Pro trial starts at the first real USE, not only at the recorder
-- ---------------------------------------------------------------------------
-- PRD §5.7 tied the trial start to the first AI consultation. That is the
-- highest-commitment action in the product (patient in the room + consent +
-- recording), so a professional who spends her first week importing her charts
-- and filling the agenda never reached the Pro features she is entitled to try.
-- The trial now starts at the first operational action of ANY kind — an AI tool,
-- a data import, an appointment.
--
-- Two things this migration adds, both required BY that change rather than
-- nice-to-have:
--
--  1. `started_via` — with several possible triggers, "what started the trial"
--     becomes a real commercial question (does an import convert better than an
--     appointment?) and it cannot be backfilled later.
--
--  2. `trial_started` in the return value. The old function returned the same
--     allowance whether or not it created anything, which was harmless while a
--     single deliberate confirmation called it. Now that ordinary actions call
--     it on every save, the caller MUST be able to tell a real start from a
--     no-op: the route fires the Meta CAPI StartTrial conversion and enqueues
--     the trial e-mail drip, and re-firing those on every appointment would
--     corrupt attribution and mail the professional repeatedly.
--
-- The one-arg signature is kept as a delegating overload: `packages/db/tests`
-- pins `start_pro_trial(uuid)` by regprocedure, and an overload without a
-- DEFAULT stays unambiguous (a one-arg call cannot match the two-arg form).

alter table public.pro_trials
  add column if not exists started_via text;

comment on column public.pro_trials.started_via is
  'Which operational action started the trial. Allowlisted below — adding an origin is a migration, deliberately, so the funnel keeps a closed vocabulary.';

alter table public.pro_trials
  drop constraint if exists pro_trials_started_via_check;

alter table public.pro_trials
  add constraint pro_trials_started_via_check
  check (
    started_via is null
    or started_via in ('recorder', 'agenda', 'import', 'library', 'patient', 'other')
  );

-- ---------- The trial start, now reporting what it did ----------

create or replace function public.start_pro_trial(target_org uuid, via text)
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
  inserted_org uuid;
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
    -- Not eligible: say so explicitly rather than letting the caller infer a
    -- start from the absence of a key.
    return allowance || jsonb_build_object('trial_started', false);
  end if;

  -- One promotion per professional. Returning the allowance unchanged (rather
  -- than raising) keeps every caller's contract: the recorder reads
  -- can_start/reason and explains the block from there.
  if auth.uid() is not null
     and exists (select 1 from public.pro_trials where started_by = auth.uid()) then
    return allowance || jsonb_build_object('trial_started', false);
  end if;

  select value into params from public.platform_settings where key = 'trial';
  trial_days := coalesce((params ->> 'days')::int, 14);
  trial_minutes := coalesce((params ->> 'minutes')::int, 300);

  insert into public.pro_trials (org_id, started_at, ends_at, minutes_limit, started_by, started_via)
  values (
    target_org,
    now(),
    now() + make_interval(days => trial_days),
    trial_minutes,
    auth.uid(),
    case
      when via in ('recorder', 'agenda', 'import', 'library', 'patient') then via
      else 'other'
    end
  )
  on conflict (org_id) do nothing
  returning org_id into inserted_org;

  -- `on conflict do nothing` returns no row when it skipped, which is exactly
  -- the signal the caller needs: only a real insert may fire the conversion.
  return public.org_audio_allowance(target_org)
    || jsonb_build_object('trial_started', inserted_org is not null);
end;
$$;

revoke all on function public.start_pro_trial(uuid, text) from public, anon;
grant execute on function public.start_pro_trial(uuid, text) to authenticated, service_role;

-- Kept for the pinned signature; delegates so the guards live in one place.
create or replace function public.start_pro_trial(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.start_pro_trial(target_org, 'other');
end;
$$;

revoke all on function public.start_pro_trial(uuid) from public, anon;
grant execute on function public.start_pro_trial(uuid) to authenticated, service_role;
