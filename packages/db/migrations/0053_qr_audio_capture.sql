-- ============================================================
-- 0053_qr_audio_capture
--
-- "Grave pelo celular" without the app and without a phone login: the
-- professional generates a QR in the consultation sidebar; scanning opens a
-- public, capture-ONLY web page authorized by a short-lived bearer token.
--
-- Security posture (the token is a bearer secret):
--   * SCOPE MINIMAL — one consultation, one purpose (push audio_only). The
--     page cannot read the chart, cannot see other patients, cannot do
--     anything but capture audio for THIS consultation.
--   * The RAW token lives only in the QR/URL fragment; only its SHA-256 hash
--     reaches the database (same discipline as patient consent, 0035+).
--   * SHORT-LIVED — 15 minutes, RENEWED while a capture is in flight so an
--     active recording never expires under the professional's hands.
--   * REVOCABLE — finishing, cancelling or generating a new link kills the old
--     one; a session is single active per consultation.
--   * The DB stays the gate: the recording insert still fires the 0022 consent
--     trigger and the 0030 lifecycle trigger. audio_only is not AI, so no
--     ai-processing consent and no minutes are required (0030/0033 guards).
--
-- The public flow runs under the SERVICE ROLE (no auth.uid()), so these RPCs
-- are the ONLY authorization path and each one re-validates the token session.
-- ============================================================

create table if not exists public.capture_link_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  -- The professional who issued the link. The recording it opens is created
  -- AS this user, so notifications, audit and provenance stay correct.
  created_by uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  purpose text not null default 'mobile_audio_capture'
    check (purpose = 'mobile_audio_capture'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- The recording this link opened, once capture begins (idempotency anchor).
  recording_id uuid references public.recordings (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists capture_link_sessions_consultation_idx
  on public.capture_link_sessions (consultation_id);

-- One live link per consultation: partial unique on the active window.
create unique index if not exists capture_link_sessions_one_active_idx
  on public.capture_link_sessions (consultation_id)
  where revoked_at is null;

alter table public.capture_link_sessions enable row level security;
revoke all on table public.capture_link_sessions from public;
grant select on table public.capture_link_sessions to authenticated;

-- The professional sees the link she owns (to render/refresh the QR + status).
-- Writes only ever happen through the security-definer RPCs below.
drop policy if exists capture_link_sessions_select_own on public.capture_link_sessions;
create policy capture_link_sessions_select_own
  on public.capture_link_sessions for select
  using (created_by = auth.uid() and public.is_org_member(org_id));

comment on table public.capture_link_sessions is
  'Short-lived bearer sessions for the QR "record from your phone" audio-only capture. Raw token never stored (hash only).';

-- ---------- Issue (authenticated professional) ----------

create or replace function public.create_capture_link(
  target_consultation uuid,
  target_token_hash text,
  target_ttl_seconds integer default 900
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
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
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

  -- A new link supersedes any prior active one for this consultation.
  update public.capture_link_sessions
  set revoked_at = now(), updated_at = now()
  where consultation_id = target_consultation and revoked_at is null;

  insert into public.capture_link_sessions (
    org_id, consultation_id, patient_id, created_by, token_hash, expires_at
  ) values (
    consultation_row.org_id, consultation_row.id, consultation_row.patient_id,
    auth.uid(), target_token_hash, now() + make_interval(secs => ttl)
  )
  returning * into session_row;

  return jsonb_build_object(
    'ok', true,
    'code', 'created',
    'sessionId', session_row.id,
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
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  select c.* into consultation_row from public.consultations c where c.id = target_consultation;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(consultation_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  update public.capture_link_sessions
  set revoked_at = now(), updated_at = now()
  where consultation_id = target_consultation and revoked_at is null;

  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

-- ---------- Token-scoped helpers (service role; token IS the credential) ----------

-- Resolve a live session and lock it. Shared preamble for every public RPC.
-- Returns null (via not found) when the token is unknown, revoked or expired.
create or replace function public.capture_link_active(target_token_hash text)
returns public.capture_link_sessions
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select s.*
  from public.capture_link_sessions s
  where s.token_hash = target_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;
$$;

-- Push the expiry forward while a capture is in flight (15 min from now),
-- never shortening it. Called on every state heartbeat.
create or replace function public.renew_capture_link_session(target_session uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.capture_link_sessions
  set expires_at = greatest(expires_at, now() + interval '15 minutes'), updated_at = now()
  where id = target_session and revoked_at is null;
$$;

/**
 * Minimal context for the phone page. Deliberately PHI-thin: the patient's
 * FIRST name only, and booleans — never the chart, never other patients.
 */
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
    'expiresAt', session_row.expires_at,
    'recordingStatus', open_status
  );
end;
$$;

/**
 * Open (or idempotently resume) the audio_only recording for this link. The
 * insert flows through the 0022 consent trigger and 0030 lifecycle trigger,
 * so consent and state integrity hold even though the caller is anonymous.
 */
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
       or existing_row.mode is distinct from 'audio_only'
       or existing_row.captured_on is distinct from 'qr' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    perform public.renew_capture_link_session(session_row.id);
    return jsonb_build_object(
      'ok', true, 'code', 'existing',
      'recordingId', existing_row.id, 'status', existing_row.status
    );
  end if;

  if exists (
    select 1 from public.recordings r
    where r.consultation_id = session_row.consultation_id
      and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing')
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_already_open');
  end if;

  -- created_by is the ISSUING professional; consent_acceptance_id is filled by
  -- the guard_recording_consent trigger (which also rejects a missing consent).
  insert into public.recordings (
    org_id, patient_id, consultation_id, status, mode, client_upload_id,
    captured_on, created_by, capture_started_at
  ) values (
    session_row.org_id, session_row.patient_id, session_row.consultation_id,
    'recording', 'audio_only', target_client_upload_id, 'qr', session_row.created_by, now()
  )
  returning * into created_row;

  update public.capture_link_sessions
  set recording_id = created_row.id, updated_at = now()
  where id = session_row.id;
  perform public.renew_capture_link_session(session_row.id);

  if consultation_row.status in ('scheduled', 'draft', 'awaiting_review') then
    update public.consultations set status = 'in_progress' where id = consultation_row.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'created',
    'recordingId', created_row.id, 'status', created_row.status
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
        return jsonb_build_object('ok', true, 'code', 'existing', 'recordingId', existing_row.id, 'status', existing_row.status);
      end if;
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    elsif violated_constraint = 'recordings_one_open_per_consultation_idx' then
      return jsonb_build_object('ok', false, 'code', 'recording_already_open');
    end if;
    raise;
  when check_violation then
    if sqlerrm in ('consent_required', 'consent_acceptance_mismatch') then
      return jsonb_build_object('ok', false, 'code', 'audio_consent_required');
    end if;
    raise;
end;
$$;

/**
 * Drive the audio_only recording forward from the phone. Mirrors the state
 * transitions of the authenticated RPCs (mark_local / mark_uploading /
 * confirm_upload / cancel), but authorized by the token session instead of org
 * membership. The lifecycle trigger still enforces valid transitions.
 */
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
    if recording_row.status = 'ready' then
      return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
    end if;
    update public.recordings
    set status = 'cancelled', error_code = nullif(btrim(target_error_code), ''), error = null
    where id = recording_row.id;
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
  if recording_row.status = 'ready' then
    return jsonb_build_object('ok', true, 'code', 'ready', 'recordingId', recording_row.id);
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

  -- audio_only terminates at 'ready' (0030 confirm semantics). The link's job
  -- is done — revoke it so the bearer token cannot be replayed.
  update public.recordings
  set status = 'ready', audio_path = target_audio_path, uploaded_at = coalesce(uploaded_at, now())
  where id = recording_row.id;
  update public.capture_link_sessions
  set revoked_at = now(), updated_at = now()
  where id = session_row.id;

  return jsonb_build_object('ok', true, 'code', 'ready', 'recordingId', recording_row.id, 'audioPath', target_audio_path);
end;
$$;

-- ---------- Grants ----------

revoke all on function public.create_capture_link(uuid, text, integer) from public;
revoke all on function public.revoke_capture_link(uuid) from public;
revoke all on function public.capture_link_active(text) from public;
revoke all on function public.renew_capture_link_session(uuid) from public;
revoke all on function public.resolve_capture_link(text) from public;
revoke all on function public.begin_capture_via_link(text, uuid) from public;
revoke all on function public.set_capture_link_recording_state(text, text, integer, bigint, text, text, text) from public;

grant execute on function public.create_capture_link(uuid, text, integer) to authenticated;
grant execute on function public.revoke_capture_link(uuid) to authenticated;
grant execute on function public.resolve_capture_link(text) to service_role;
grant execute on function public.begin_capture_via_link(text, uuid) to service_role;
grant execute on function public.set_capture_link_recording_state(text, text, integer, bigint, text, text, text) to service_role;
-- Internal helpers: never callable directly by any client role.
revoke execute on function public.capture_link_active(text) from authenticated, anon;
revoke execute on function public.renew_capture_link_session(uuid) from authenticated, anon;
