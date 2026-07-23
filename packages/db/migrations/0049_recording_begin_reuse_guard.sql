-- ============================================================
-- 0049_recording_begin_reuse_guard
--
-- Fixes a capture dead-end: begin_clinical_recording (0030) resolved a reused
-- client_upload_id to its existing row REGARDLESS of status, so a spent id
-- (whose prior capture was cancelled or failed) was handed back as if it were
-- resumable. The client then drove that terminal row forward and every state
-- transition 409'd (`recording_invalid_state`), stranding the consultation on
-- an endless "retry" against a dead row.
--
-- An upload id is only idempotently RESUMABLE while its row is still in flight
-- (recording/local/uploading/uploaded/processing). A terminal row (cancelled,
-- failed, ready) means the id is consumed — report `stale_upload_id` so the
-- client mints a fresh id and starts a clean capture. Everything else in the
-- function is unchanged from 0030.
-- ============================================================

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
        perform public.start_pro_trial(consultation_row.org_id);
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
