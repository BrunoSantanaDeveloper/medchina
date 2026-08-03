-- ============================================================
-- 0058_qr_capture_v2
--
-- Hardening + AI mode for the QR "record from your phone" flow (0053).
--
-- What changes and why:
--   1) capture_link_sessions gains a MODE ('audio_only' | 'ai'). The 0053 flow
--      always inserted audio_only, so a browser-only professional could never
--      reach the product's core loop (audio -> drafted anamnesis) without the
--      app. AI mode is allowed ONLY when the ai-processing consent is active
--      and the workspace allowance can start — checked when the link is minted
--      AND re-checked when the capture begins. The QR path NEVER starts the
--      Pro trial (that stays a deliberate confirmation in the desktop
--      recorder, PRD §5.7).
--   2) revoke_capture_link no longer kills a capture in flight. The dialog
--      used to revoke on close while the phone was still recording, which made
--      the audio irrecoverable (heartbeat 410, upload refused). A session
--      whose recording is in 'recording'/'local'/'uploading'/'failed' is
--      protected; everything else revokes as before.
--   3) create_capture_link refuses to silently supersede an in-flight capture:
--      it returns 'capture_in_progress' (with the live status) unless the
--      caller explicitly forces — reopening the dialog must SHOW the phone's
--      progress, not destroy it.
--   4) The confirm ('uploaded') no longer revokes the session. It expires on
--      its own (<= 15 min, heartbeat stops once done) and this enables
--      "record another segment" for a consultation captured in parts. For AI
--      mode the recording lands as 'uploaded' — the pipeline's normal entry
--      state — instead of the audio_only terminal 'ready'.
--   5) The anonymous leg now writes audit_events (begin / uploaded / cancel),
--      attributed to the professional who issued the link. Compliance is a
--      product pillar; the unauthenticated path needs the trail the most.
--   6) get_consultation_context exposes recording.mode + capturedOn so the
--      desktop page can auto-start processing when the phone delivers an AI
--      capture.
-- ============================================================

alter table public.capture_link_sessions
  add column if not exists mode text not null default 'audio_only'
    check (mode in ('audio_only', 'ai'));

-- ---------- Issue (authenticated professional) ----------

drop function if exists public.create_capture_link(uuid, text, integer);

create or replace function public.create_capture_link(
  target_consultation uuid,
  target_token_hash text,
  target_ttl_seconds integer default 900,
  target_mode text default 'audio_only',
  target_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consultation_row public.consultations%rowtype;
  ttl integer := least(greatest(coalesce(target_ttl_seconds, 900), 60), 3600);
  session_row public.capture_link_sessions%rowtype;
  active_row record;
  allowance jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if target_mode is null or target_mode not in ('audio_only', 'ai') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(consultation_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('scheduled', 'draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  -- Never hand out a link that cannot record: audio consent is the floor.
  if not public.has_active_consent(consultation_row.org_id, consultation_row.patient_id, 'audio-recording') then
    return jsonb_build_object('ok', false, 'code', 'audio_consent_required');
  end if;

  if target_mode = 'ai' then
    if not public.has_active_consent(consultation_row.org_id, consultation_row.patient_id, 'ai-processing') then
      return jsonb_build_object('ok', false, 'code', 'ai_consent_required');
    end if;
    allowance := public.org_audio_allowance(consultation_row.org_id);
    if not coalesce((allowance ->> 'can_start')::boolean, false) then
      -- The QR path never starts the trial; the desktop recorder owns that
      -- deliberate confirmation (PRD §5.7).
      if coalesce((allowance ->> 'trial_available')::boolean, false) then
        return jsonb_build_object('ok', false, 'code', 'trial_not_started');
      end if;
      return jsonb_build_object('ok', false, 'code', 'audio_allowance_exhausted');
    end if;
  end if;

  -- A phone mid-capture must never be superseded by accident: reopening the
  -- dialog surfaces the live status instead of minting a new credential.
  select s.id, s.expires_at, s.mode, r.status as recording_status
  into active_row
  from public.capture_link_sessions s
  left join public.recordings r on r.id = s.recording_id
  where s.consultation_id = target_consultation
    and s.revoked_at is null
    and s.expires_at > now()
    and r.status in ('recording', 'local', 'uploading', 'failed')
  limit 1;
  if active_row.id is not null and target_force is not true then
    return jsonb_build_object(
      'ok', false,
      'code', 'capture_in_progress',
      'sessionId', active_row.id,
      'mode', active_row.mode,
      'recordingStatus', active_row.recording_status,
      'expiresAt', active_row.expires_at
    );
  end if;

  -- A new link supersedes any prior active one for this consultation.
  update public.capture_link_sessions
  set revoked_at = now(), updated_at = now()
  where consultation_id = target_consultation and revoked_at is null;

  insert into public.capture_link_sessions (
    org_id, consultation_id, patient_id, created_by, token_hash, expires_at, mode
  ) values (
    consultation_row.org_id, consultation_row.id, consultation_row.patient_id,
    auth.uid(), target_token_hash, now() + make_interval(secs => ttl), target_mode
  )
  returning * into session_row;

  return jsonb_build_object(
    'ok', true,
    'code', 'created',
    'sessionId', session_row.id,
    'mode', session_row.mode,
    'expiresAt', session_row.expires_at
  );
end;
$$;

create or replace function public.revoke_capture_link(target_consultation uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consultation_row public.consultations%rowtype;
  revoked integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  select c.* into consultation_row from public.consultations c where c.id = target_consultation;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(consultation_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  -- Never kill a capture in flight: the dialog closes routinely mid-session
  -- (the professional needs the chart back) and the phone must keep recording.
  -- A protected session simply expires on its own once the phone goes quiet.
  update public.capture_link_sessions s
  set revoked_at = now(), updated_at = now()
  where s.consultation_id = target_consultation
    and s.revoked_at is null
    and not exists (
      select 1 from public.recordings r
      where r.id = s.recording_id
        and r.status in ('recording', 'local', 'uploading', 'failed')
    );
  get diagnostics revoked = row_count;

  return jsonb_build_object(
    'ok', true,
    'code', case when revoked > 0 then 'revoked' else 'capture_in_progress' end
  );
end;
$$;

-- ---------- Token-scoped RPCs (service role; token IS the credential) ----------

create or replace function public.resolve_capture_link(target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.capture_link_sessions%rowtype;
  consultation_row public.consultations%rowtype;
  patient_first text;
  open_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  session_row := public.capture_link_active(target_token_hash);
  if session_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'capture_link_invalid');
  end if;

  select c.* into consultation_row from public.consultations c where c.id = session_row.consultation_id;
  select split_part(btrim(p.full_name), ' ', 1) into patient_first
  from public.patients p where p.id = session_row.patient_id;

  select r.status::text into open_status
  from public.recordings r
  where r.consultation_id = session_row.consultation_id
    and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing', 'ready')
  order by r.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'patientFirstName', coalesce(nullif(patient_first, ''), null),
    'consultationEditable', consultation_row.status in ('scheduled', 'draft', 'in_progress', 'awaiting_review'),
    'audioConsent', public.has_active_consent(session_row.org_id, session_row.patient_id, 'audio-recording'),
    'mode', session_row.mode,
    'expiresAt', session_row.expires_at,
    'recordingStatus', open_status
  );
end;
$$;

create or replace function public.begin_capture_via_link(
  target_token_hash text,
  target_client_upload_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.capture_link_sessions%rowtype;
  consultation_row public.consultations%rowtype;
  existing_row public.recordings%rowtype;
  created_row public.recordings%rowtype;
  ai_acceptance uuid;
  allowance jsonb;
  violated_constraint text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_client_upload_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  session_row := public.capture_link_active(target_token_hash);
  if session_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'capture_link_invalid');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = session_row.consultation_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if consultation_row.status not in ('scheduled', 'draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;

  -- Idempotency: a lost response replays to the same recording.
  select r.* into existing_row
  from public.recordings r
  where r.org_id = session_row.org_id and r.client_upload_id = target_client_upload_id
  limit 1;
  if found then
    if existing_row.consultation_id is distinct from session_row.consultation_id
       or existing_row.mode is distinct from session_row.mode
       or existing_row.captured_on is distinct from 'qr' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    perform public.renew_capture_link_session(session_row.id);
    return jsonb_build_object(
      'ok', true, 'code', 'existing',
      'recordingId', existing_row.id, 'status', existing_row.status, 'mode', existing_row.mode
    );
  end if;

  if exists (
    select 1 from public.recordings r
    where r.consultation_id = session_row.consultation_id
      and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing')
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_already_open');
  end if;

  -- AI mode: re-validate at capture time — consent may have been revoked and
  -- the allowance may have drained between minting the link and scanning it.
  if session_row.mode = 'ai' then
    ai_acceptance := public.active_consent_acceptance(session_row.org_id, session_row.patient_id, 'ai-processing');
    if ai_acceptance is null then
      return jsonb_build_object('ok', false, 'code', 'ai_consent_required');
    end if;
    allowance := public.org_audio_allowance(session_row.org_id);
    if not coalesce((allowance ->> 'can_start')::boolean, false) then
      if coalesce((allowance ->> 'trial_available')::boolean, false) then
        return jsonb_build_object('ok', false, 'code', 'trial_not_started');
      end if;
      return jsonb_build_object('ok', false, 'code', 'audio_allowance_exhausted');
    end if;
  end if;

  -- created_by is the ISSUING professional; consent_acceptance_id is filled by
  -- the guard_recording_consent trigger (which also rejects a missing consent).
  insert into public.recordings (
    org_id, patient_id, consultation_id, status, mode, client_upload_id,
    captured_on, created_by, ai_consent_acceptance_id, capture_started_at
  ) values (
    session_row.org_id, session_row.patient_id, session_row.consultation_id,
    'recording', session_row.mode, target_client_upload_id, 'qr',
    session_row.created_by, ai_acceptance, now()
  )
  returning * into created_row;

  update public.capture_link_sessions
  set recording_id = created_row.id, updated_at = now()
  where id = session_row.id;
  perform public.renew_capture_link_session(session_row.id);

  if consultation_row.status in ('scheduled', 'draft', 'awaiting_review') then
    update public.consultations set status = 'in_progress' where id = consultation_row.id;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    session_row.org_id, session_row.created_by, 'recording.capture_link.begun',
    'recording', created_row.id::text,
    jsonb_build_object('sessionId', session_row.id, 'mode', session_row.mode, 'via', 'qr_capture_link')
  );

  return jsonb_build_object(
    'ok', true, 'code', 'created',
    'recordingId', created_row.id, 'status', created_row.status, 'mode', created_row.mode
  );
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'recordings_client_upload_unique_idx' then
      select r.* into existing_row
      from public.recordings r
      where r.org_id = session_row.org_id and r.client_upload_id = target_client_upload_id
      limit 1;
      if found and existing_row.consultation_id is not distinct from session_row.consultation_id then
        perform public.renew_capture_link_session(session_row.id);
        return jsonb_build_object('ok', true, 'code', 'existing', 'recordingId', existing_row.id, 'status', existing_row.status, 'mode', existing_row.mode);
      end if;
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    elsif violated_constraint = 'recordings_one_open_per_consultation_idx' then
      return jsonb_build_object('ok', false, 'code', 'recording_already_open');
    end if;
    raise;
  when check_violation then
    if sqlerrm in ('consent_required', 'consent_acceptance_mismatch') then
      return jsonb_build_object('ok', false, 'code', 'audio_consent_required');
    elsif sqlerrm in ('trial_not_started', 'audio_allowance_exhausted') then
      return jsonb_build_object('ok', false, 'code', sqlerrm);
    end if;
    raise;
end;
$$;

create or replace function public.set_capture_link_recording_state(
  target_token_hash text,
  target_action text,
  target_duration_seconds integer default null,
  target_size_bytes bigint default null,
  target_mime text default null,
  target_audio_path text default null,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  session_row public.capture_link_sessions%rowtype;
  recording_row public.recordings%rowtype;
  limits jsonb;
  max_duration_seconds integer;
  max_size_bytes bigint;
  expected_prefix text;
  stored_size bigint;
  final_status public.recording_status;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_action is null or target_action not in ('heartbeat', 'local', 'uploading', 'uploaded', 'cancel') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  session_row := public.capture_link_active(target_token_hash);
  if session_row.id is null or session_row.recording_id is null then
    return jsonb_build_object('ok', false, 'code', 'capture_link_invalid');
  end if;

  select r.* into recording_row
  from public.recordings r
  where r.id = session_row.recording_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  -- Every activity keeps the session alive (renewal while recording). A capture
  -- in flight sends 'heartbeat' so a long consultation never expires the token.
  perform public.renew_capture_link_session(session_row.id);

  if target_action = 'heartbeat' then
    return jsonb_build_object('ok', true, 'code', 'heartbeat', 'status', recording_row.status);
  end if;

  if target_action = 'cancel' then
    if recording_row.status = 'cancelled' then
      return jsonb_build_object('ok', true, 'code', 'cancelled', 'recordingId', recording_row.id);
    end if;
    if recording_row.status in ('ready', 'uploaded', 'processing') then
      return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
    end if;
    update public.recordings
    set status = 'cancelled', error_code = nullif(btrim(target_error_code), ''), error = null
    where id = recording_row.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      session_row.org_id, session_row.created_by, 'recording.capture_link.cancelled',
      'recording', recording_row.id::text,
      jsonb_build_object('sessionId', session_row.id, 'errorCode', nullif(btrim(target_error_code), ''), 'via', 'qr_capture_link')
    );
    return jsonb_build_object('ok', true, 'code', 'cancelled', 'recordingId', recording_row.id);
  end if;

  if target_action = 'local' then
    if recording_row.status not in ('recording', 'failed') then
      return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
    end if;
    select value into limits from public.platform_settings where key = 'recording';
    max_duration_seconds := greatest(coalesce((limits ->> 'max_duration_minutes')::integer, 120), 1) * 60;
    max_size_bytes := greatest(coalesce((limits ->> 'max_size_bytes')::bigint, 536870912), 1048576);
    if coalesce(target_duration_seconds, 0) <= 0 or target_duration_seconds > max_duration_seconds then
      return jsonb_build_object('ok', false, 'code', 'recording_too_long', 'maxSeconds', max_duration_seconds);
    end if;
    if coalesce(target_size_bytes, 0) <= 0 or target_size_bytes > max_size_bytes then
      return jsonb_build_object('ok', false, 'code', 'recording_too_large', 'maxBytes', max_size_bytes);
    end if;
    if nullif(btrim(target_mime), '') is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    update public.recordings
    set status = 'local',
        duration_seconds = greatest(coalesce(target_duration_seconds, 0), 0),
        size_bytes = greatest(coalesce(target_size_bytes, 0), 0),
        mime = nullif(btrim(target_mime), ''),
        capture_ended_at = now(),
        error = null, error_code = null, failure_stage = null
    where id = recording_row.id;
    return jsonb_build_object('ok', true, 'code', 'local', 'recordingId', recording_row.id);
  end if;

  if target_action = 'uploading' then
    if recording_row.status not in ('local', 'failed') then
      return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
    end if;
    update public.recordings set status = 'uploading' where id = recording_row.id;
    return jsonb_build_object('ok', true, 'code', 'uploading', 'recordingId', recording_row.id);
  end if;

  -- target_action = 'uploaded'
  if recording_row.status in ('ready', 'uploaded', 'processing') then
    return jsonb_build_object('ok', true, 'code', case when recording_row.status = 'ready' then 'ready' else 'uploaded' end, 'recordingId', recording_row.id, 'mode', recording_row.mode);
  end if;
  if recording_row.status <> 'uploading' then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;
  expected_prefix := recording_row.org_id::text || '/' || recording_row.id::text || '.';
  if target_audio_path is null or left(target_audio_path, length(expected_prefix)) <> expected_prefix then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'transcriptions' and o.name = target_audio_path
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_not_uploaded');
  end if;
  select case
    when coalesce(o.metadata ->> 'size', o.metadata ->> 'contentLength') ~ '^[0-9]+$'
      then coalesce(o.metadata ->> 'size', o.metadata ->> 'contentLength')::bigint
    else null
  end
  into stored_size
  from storage.objects o
  where o.bucket_id = 'transcriptions' and o.name = target_audio_path;
  if recording_row.size_bytes is not null
     and (stored_size is null or stored_size <> recording_row.size_bytes) then
    return jsonb_build_object('ok', false, 'code', 'recording_integrity_failed');
  end if;

  -- audio_only terminates at 'ready' (0030 confirm semantics). AI mode lands
  -- on 'uploaded' — the pipeline's entry state; the desktop (or Inngest) picks
  -- it up from there. The session is NOT revoked here anymore: it expires on
  -- its own within minutes, and keeping it alive lets the phone show delivery
  -- status and record another segment of the same consultation.
  final_status := (case when recording_row.mode = 'ai' then 'uploaded' else 'ready' end)::public.recording_status;
  update public.recordings
  set status = final_status, audio_path = target_audio_path, uploaded_at = coalesce(uploaded_at, now())
  where id = recording_row.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    session_row.org_id, session_row.created_by, 'recording.capture_link.uploaded',
    'recording', recording_row.id::text,
    jsonb_build_object('sessionId', session_row.id, 'mode', recording_row.mode, 'status', final_status, 'via', 'qr_capture_link')
  );

  return jsonb_build_object(
    'ok', true,
    'code', case when final_status = 'ready' then 'ready' else 'uploaded' end,
    'recordingId', recording_row.id,
    'mode', recording_row.mode,
    'audioPath', target_audio_path
  );
end;
$$;

-- ---------- Desktop context: expose mode/capturedOn for auto-processing ----------

create or replace function public.get_consultation_context(target_consultation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  consultation_row public.consultations%rowtype;
  patient_row public.patients%rowtype;
  recording_data jsonb;
begin
  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select p.* into patient_row from public.patients p where p.id = consultation_row.patient_id;

  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'error', r.error,
    'updatedAt', r.updated_at,
    'transcriptionId', r.transcription_id,
    'mode', r.mode,
    'capturedOn', r.captured_on
  ) into recording_data
  from public.recordings r
  where r.consultation_id = target_consultation
    and r.status not in ('ready', 'cancelled')
  order by r.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'consultation', jsonb_build_object(
      'id', consultation_row.id,
      'orgId', consultation_row.org_id,
      'patientId', consultation_row.patient_id,
      'status', consultation_row.status,
      'clinicalRevision', consultation_row.clinical_revision,
      'startedAt', consultation_row.started_at,
      'scheduledFor', consultation_row.scheduled_for
    ),
    'patient', jsonb_build_object(
      'id', patient_row.id,
      'name', patient_row.full_name,
      'birthDate', patient_row.birth_date,
      'alerts', patient_row.alerts
    ),
    'consents', jsonb_build_object(
      'audio', public.has_active_consent(consultation_row.org_id, patient_row.id, 'audio-recording'),
      'ai', public.has_active_consent(consultation_row.org_id, patient_row.id, 'ai-processing'),
      'images', public.has_active_consent(consultation_row.org_id, patient_row.id, 'clinical-images')
    ),
    'recording', recording_data
  );
end;
$$;

-- ---------- Grants ----------

revoke all on function public.create_capture_link(uuid, text, integer, text, boolean) from public, anon;
grant execute on function public.create_capture_link(uuid, text, integer, text, boolean) to authenticated;
revoke all on function public.revoke_capture_link(uuid) from public, anon;
grant execute on function public.revoke_capture_link(uuid) to authenticated;
revoke all on function public.get_consultation_context(uuid) from public, anon;
grant execute on function public.get_consultation_context(uuid) to authenticated;

-- Token-scoped RPCs: the token is the credential and the service client is the
-- only legitimate caller. Supabase grants newly created public functions
-- directly to its API roles, so revoking from PUBLIC alone leaves anon and
-- authenticated able to CALL them (0053 shipped exactly that gap — harmless
-- only because each function re-checks auth.role() internally, which is
-- defence in depth, not the boundary). Same discipline as 0039.
revoke all on function public.resolve_capture_link(text) from public, anon, authenticated;
grant execute on function public.resolve_capture_link(text) to service_role;
revoke all on function public.begin_capture_via_link(text, uuid) from public, anon, authenticated;
grant execute on function public.begin_capture_via_link(text, uuid) to service_role;
revoke all on function public.set_capture_link_recording_state(text, text, integer, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_capture_link_recording_state(text, text, integer, bigint, text, text, text) to service_role;
revoke all on function public.capture_link_active(text) from public, anon, authenticated;
revoke all on function public.renew_capture_link_session(uuid) from public, anon, authenticated;
