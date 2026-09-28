-- ============================================================
-- 0114_trial_origin_onboarding
--
-- `pro_trials.started_via` (0084) exists to answer "what starts trials?", and
-- two of its answers were wrong — both on the guided onboarding's path:
--
-- 1. THE GUIDE HAD NO ORIGIN. Its "Ativar teste Pro" is a deliberate start
--    with no operational action behind it, and the closed vocabulary stopped
--    at six values, so the guide sent 'other'. The trials the onboarding
--    converts were indistinguishable from the catch-all. It gets 'onboarding'.
--
-- 2. 'recorder' WAS NEVER WRITTEN. The recorder starts the trial inside
--    `begin_clinical_recording` (its deliberate confirmation, web and mobile),
--    which called the ONE-arg overload — and that one delegates with 'other'.
--    docs/FUNIL.md cuts "consulta com IA" by `started_via = 'recorder'`, a cut
--    that returned nothing. The call now names its origin.
--
-- Adding an origin is a migration on purpose (0084: the funnel keeps a closed
-- vocabulary). Every function body below is its predecessor's, unchanged except
-- where marked `0114:`.
-- ============================================================

alter table public.pro_trials
  drop constraint if exists pro_trials_started_via_check;

alter table public.pro_trials
  add constraint pro_trials_started_via_check
  check (
    started_via is null
    or started_via in ('recorder', 'agenda', 'import', 'library', 'patient', 'onboarding', 'other')
  );

comment on column public.pro_trials.started_via is
  'Which action started the trial: an operational one (recorder, agenda, import, library, patient), the guided onboarding''s explicit start (onboarding) or the catch-all (other). Allowlisted — adding an origin is a migration, deliberately, so the funnel keeps a closed vocabulary.';

-- ---------- The trial start (body from 0084) ----------

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
      -- 0114: 'onboarding' joins the allowlist.
      when via in ('recorder', 'agenda', 'import', 'library', 'patient', 'onboarding') then via
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

-- ---------- The capture start (body from 0049) ----------

create or replace function public.begin_clinical_recording(
  target_consultation uuid,
  target_mode text,
  target_client_upload_id uuid,
  target_start_trial boolean default false,
  target_captured_on text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  existing_row public.recordings%rowtype;
  created_row public.recordings%rowtype;
  allowance jsonb;
  audio_acceptance uuid;
  ai_acceptance uuid;
  violated_constraint text;
begin
  if target_mode is null
     or target_mode not in ('audio_only', 'ai')
     or target_captured_on is null
     or target_captured_on not in ('web', 'mobile')
     or target_client_upload_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('scheduled', 'draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', consultation_row.status);
  end if;

  select r.* into existing_row
  from public.recordings r
  where r.org_id = consultation_row.org_id and r.client_upload_id = target_client_upload_id
  limit 1;

  if found then
    if existing_row.consultation_id is distinct from target_consultation
       or existing_row.mode is distinct from target_mode
       or existing_row.captured_on is distinct from target_captured_on then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    -- 0049: only a still-in-flight row is a resumable idempotent retry. A
    -- terminal row means this upload id is spent.
    if existing_row.status not in ('recording', 'local', 'uploading', 'uploaded', 'processing') then
      return jsonb_build_object('ok', false, 'code', 'stale_upload_id');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'existing',
      'recordingId', existing_row.id,
      'status', existing_row.status,
      'mode', existing_row.mode
    );
  end if;

  if exists (
    select 1 from public.recordings r
    where r.consultation_id = target_consultation
      and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing')
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_already_open');
  end if;

  audio_acceptance := public.active_consent_acceptance(
    consultation_row.org_id,
    consultation_row.patient_id,
    'audio-recording'
  );
  if audio_acceptance is null then
    return jsonb_build_object('ok', false, 'code', 'audio_consent_required');
  end if;

  if target_mode = 'ai' then
    ai_acceptance := public.active_consent_acceptance(
      consultation_row.org_id,
      consultation_row.patient_id,
      'ai-processing'
    );
  end if;
  if target_mode = 'ai' and ai_acceptance is null then
    return jsonb_build_object('ok', false, 'code', 'ai_consent_required');
  end if;

  if target_mode = 'ai' then
    allowance := public.org_audio_allowance(consultation_row.org_id);
    if not coalesce((allowance ->> 'can_start')::boolean, false) then
      if coalesce((allowance ->> 'trial_available')::boolean, false) then
        if target_start_trial is not true then
          return jsonb_build_object('ok', false, 'code', 'trial_not_started');
        end if;
        -- 0114: the recorder's confirmation names its origin. The one-arg
        -- overload delegates with 'other', which left 'recorder' never written.
        perform public.start_pro_trial(consultation_row.org_id, 'recorder');
        allowance := public.org_audio_allowance(consultation_row.org_id);
      end if;
    end if;
    if not coalesce((allowance ->> 'can_start')::boolean, false) then
      return jsonb_build_object('ok', false, 'code', 'audio_allowance_exhausted');
    end if;
  end if;

  insert into public.recordings (
    org_id,
    patient_id,
    consultation_id,
    status,
    mode,
    client_upload_id,
    captured_on,
    created_by,
    consent_acceptance_id,
    ai_consent_acceptance_id,
    capture_started_at
  ) values (
    consultation_row.org_id,
    consultation_row.patient_id,
    consultation_row.id,
    'recording',
    target_mode,
    target_client_upload_id,
    target_captured_on,
    auth.uid(),
    audio_acceptance,
    ai_acceptance,
    now()
  )
  returning * into created_row;

  if consultation_row.status in ('scheduled', 'draft', 'awaiting_review') then
    update public.consultations set status = 'in_progress' where id = consultation_row.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'created',
    'recordingId', created_row.id,
    'status', created_row.status,
    'mode', created_row.mode,
    'clientUploadId', created_row.client_upload_id
  );
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = CONSTRAINT_NAME;

    if violated_constraint = 'recordings_client_upload_unique_idx' then
      select r.* into existing_row
      from public.recordings r
      where r.org_id = consultation_row.org_id
        and r.client_upload_id = target_client_upload_id
      limit 1;
      if found
         and existing_row.consultation_id is not distinct from target_consultation
         and existing_row.mode is not distinct from target_mode
         and existing_row.captured_on is not distinct from target_captured_on then
        -- 0049: a concurrent insert that resolves to a terminal row is likewise
        -- a spent id, not a resumable capture.
        if existing_row.status not in ('recording', 'local', 'uploading', 'uploaded', 'processing') then
          return jsonb_build_object('ok', false, 'code', 'stale_upload_id');
        end if;
        return jsonb_build_object(
          'ok', true,
          'code', 'existing',
          'recordingId', existing_row.id,
          'status', existing_row.status,
          'mode', existing_row.mode
        );
      end if;
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    elsif violated_constraint = 'recordings_one_open_per_consultation_idx' then
      return jsonb_build_object(
        'ok', false,
        'code', 'recording_already_open',
        'recordingId', (
          select r.id from public.recordings r
          where r.consultation_id = target_consultation
            and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing')
          order by r.created_at desc
          limit 1
        )
      );
    elsif violated_constraint = 'consultations_one_active_clinical_per_patient_idx' then
      return jsonb_build_object(
        'ok', false,
        'code', 'active_consultation_exists',
        'consultationId', (
          select c.id from public.consultations c
          where c.org_id = consultation_row.org_id
            and c.patient_id = consultation_row.patient_id
            and c.status in ('draft', 'in_progress', 'awaiting_review')
            and c.id <> target_consultation
          order by c.updated_at desc
          limit 1
        )
      );
    end if;
    raise;
  when check_violation then
    if sqlerrm in (
      'consent_required',
      'consent_acceptance_mismatch',
      'trial_not_started',
      'audio_allowance_exhausted',
      'ai_consent_required'
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', case when sqlerrm = 'consent_required' then 'audio_consent_required' else sqlerrm end
      );
    end if;
    raise;
end;
$$;

grant execute on function public.begin_clinical_recording(uuid, text, uuid, boolean, text) to authenticated;

-- ---------- Backfill: the recorder's trials, relabelled ----------
--
-- Exact, not heuristic. `begin_clinical_recording` starts the trial and inserts
-- the recording in ONE transaction, so `pro_trials.started_at` and that
-- recording's `created_at` are the same `now()`. Every other origin starts the
-- trial in a request of its own, after its action committed, so it cannot
-- produce that equality. The guide's 'other' trials have no such trace and stay
-- as they are.

update public.pro_trials t
set started_via = 'recorder'
where t.started_via = 'other'
  and exists (
    select 1
    from public.recordings r
    where r.org_id = t.org_id
      and r.created_at = t.started_at
  );
