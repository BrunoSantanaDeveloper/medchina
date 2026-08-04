-- ============================================================
-- 0069_capture_photo_decoupling
--
-- A PHOTO is not audio. A free workspace (no AI minutes) can still attach exam
-- photos and documents to a consultation — it just gets no AI analysis. So the
-- QR capture session must be mintable WITHOUT audio consent or an AI allowance,
-- and the phone page decides per capability what it can offer.
--
-- Safe to relax `create_capture_link`'s upfront gates because
-- `begin_capture_via_link` ALREADY re-validates ai-processing consent and the
-- allowance at capture time (0058), and the recordings trigger still rejects an
-- audio insert without audio-recording consent. The pre-check only decided
-- whether the QR appeared at all — which is exactly what blocked photos.
--
-- `resolve_capture_link` now tells the phone what is available: `audioAvailable`
-- (consent + minutes) and `imagesConsent` (photos). Documents need neither.
-- ============================================================

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

  -- Deliberately NO audio-consent / allowance gate here: the session is a grant
  -- to CAPTURE for this consultation (photos, documents, and — when consent and
  -- minutes allow — audio). Audio is re-checked at begin_capture_via_link; a
  -- photo is checked at reserve time. This is what lets a free workspace attach
  -- photos from the phone.

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
  audio_consent boolean;
  ai_consent boolean;
  audio_available boolean;
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

  audio_consent := public.has_active_consent(session_row.org_id, session_row.patient_id, 'audio-recording');
  ai_consent := public.has_active_consent(session_row.org_id, session_row.patient_id, 'ai-processing');
  -- Audio is offerable only when it can actually be captured: consent, and for
  -- an AI link the ai-consent plus an allowance that can start.
  audio_available := audio_consent
    and (
      session_row.mode = 'audio_only'
      or (ai_consent and coalesce((public.org_audio_allowance(session_row.org_id) ->> 'can_start')::boolean, false))
    );

  return jsonb_build_object(
    'ok', true,
    'patientFirstName', coalesce(nullif(patient_first, ''), null),
    'consultationEditable', consultation_row.status in ('scheduled', 'draft', 'in_progress', 'awaiting_review'),
    'audioConsent', audio_consent,
    'audioAvailable', audio_available,
    'imagesConsent', public.has_active_consent(session_row.org_id, session_row.patient_id, 'clinical-images'),
    'mode', session_row.mode,
    'expiresAt', session_row.expires_at,
    'recordingStatus', open_status
  );
end;
$$;
