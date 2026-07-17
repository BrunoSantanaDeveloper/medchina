-- ============================================================
-- 0030_recording_recovery
--
-- Recoverable capture/upload, idempotent processing and one-time usage.
-- Source audio is deleted only after professional transcript validation.
-- ============================================================

alter table public.recordings
  add column if not exists mode text not null default 'ai',
  add column if not exists client_upload_id uuid,
  add column if not exists checksum_sha256 text,
  add column if not exists failure_stage text,
  add column if not exists error_code text,
  add column if not exists ai_consent_acceptance_id uuid references public.consent_acceptances (id) on delete set null,
  add column if not exists processing_claim_id uuid,
  add column if not exists processing_clinical_revision bigint,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists processing_heartbeat_at timestamptz,
  add column if not exists processing_lease_expires_at timestamptz,
  add column if not exists capture_started_at timestamptz,
  add column if not exists capture_ended_at timestamptz,
  add column if not exists upload_started_at timestamptz,
  add column if not exists uploaded_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists audio_deletion_requested_at timestamptz,
  add column if not exists audio_deleted_at timestamptz;

alter table public.recordings
  add constraint recordings_mode_check check (mode in ('audio_only', 'ai')) not valid,
  add constraint recordings_checksum_check check (
    checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'
  ) not valid,
  add constraint recordings_failure_stage_check check (
    failure_stage is null or failure_stage in ('capture', 'upload', 'transcription', 'extraction', 'apply', 'deletion')
  ) not valid,
  add constraint recordings_processing_attempts_check check (processing_attempts >= 0) not valid;

alter table public.transcriptions
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by uuid references public.profiles (id) on delete set null,
  add column if not exists audio_deleted_at timestamptz,
  add column if not exists deletion_error text;

comment on column public.recordings.client_upload_id is
  'Client-generated UUID used to resume/retry one capture without creating a duplicate recording.';
comment on column public.recordings.processing_clinical_revision is
  'Clinical revision snapshotted when a processing lease is claimed; stale AI results may not cross this boundary.';
comment on column public.recordings.ai_consent_acceptance_id is
  'Exact ai-processing acceptance that authorized an AI capture; null for audio-only or unresolved historical rows.';
comment on column public.transcriptions.validated_at is
  'Professional validation boundary. delete_audio_after is acted on only after this timestamp exists.';

insert into public.platform_settings (key, value)
values (
  'recording',
  '{"max_duration_minutes":120,"max_size_bytes":536870912,"processing_lease_minutes":15,"audio_retention":"after_validation"}'::jsonb
)
on conflict (key) do nothing;

-- A resumed upload targets the same idempotent object path.
drop policy if exists "transcriptions_bucket_insert_member" on storage.objects;
drop policy if exists "transcriptions_bucket_update_member" on storage.objects;
drop policy if exists "transcriptions_bucket_delete_member" on storage.objects;

create policy "transcriptions_bucket_insert_uploading" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'transcriptions'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
    and exists (
      select 1 from public.recordings r
      where r.org_id = ((storage.foldername(name))[1])::uuid
        and r.id::text = split_part(storage.filename(name), '.', 1)
        and r.status = 'uploading'
    )
  );

create policy "transcriptions_bucket_update_uploading" on storage.objects for update to authenticated
  using (
    bucket_id = 'transcriptions'
    and exists (
      select 1 from public.recordings r
      where r.org_id = ((storage.foldername(name))[1])::uuid
        and r.id::text = split_part(storage.filename(name), '.', 1)
        and r.status = 'uploading'
        and public.is_org_member(r.org_id)
    )
  )
  with check (
    bucket_id = 'transcriptions'
    and exists (
      select 1 from public.recordings r
      where r.org_id = ((storage.foldername(name))[1])::uuid
        and r.id::text = split_part(storage.filename(name), '.', 1)
        and r.status = 'uploading'
        and public.is_org_member(r.org_id)
    )
  );

update public.recordings
set capture_started_at = coalesce(capture_started_at, created_at),
    capture_ended_at = case
      when status <> 'recording' then coalesce(capture_ended_at, created_at + make_interval(secs => coalesce(duration_seconds, 0)))
      else capture_ended_at
    end,
    uploaded_at = case
      when status in ('uploaded', 'processing', 'ready') then coalesce(uploaded_at, updated_at)
      else uploaded_at
    end,
    ready_at = case when status = 'ready' then coalesce(ready_at, updated_at) else ready_at end;

-- Pin historical recordings to the acceptance that was valid when capture
-- began. Rows with no defensible historical match stay null and are counted in
-- the audit trail rather than being assigned a newer consent retroactively.
update public.recordings r
set consent_acceptance_id = (
  select a.id
  from public.consent_acceptances a
  join public.consent_terms t on t.id = a.term_id
  where a.org_id = r.org_id
    and a.subject_type = 'patient'
    and a.subject_id = r.patient_id::text
    and t.slug = 'audio-recording'
    and a.accepted_at <= coalesce(r.capture_started_at, r.created_at)
    and (a.revoked_at is null or a.revoked_at > coalesce(r.capture_started_at, r.created_at))
  order by t.version desc, a.accepted_at desc
  limit 1
)
where r.consent_acceptance_id is null
  and exists (
    select 1
    from public.consent_acceptances a
    join public.consent_terms t on t.id = a.term_id
    where a.org_id = r.org_id
      and a.subject_type = 'patient'
      and a.subject_id = r.patient_id::text
      and t.slug = 'audio-recording'
      and a.accepted_at <= coalesce(r.capture_started_at, r.created_at)
      and (a.revoked_at is null or a.revoked_at > coalesce(r.capture_started_at, r.created_at))
  );

insert into public.audit_events (org_id, actor_id, action, entity_type, metadata)
select r.org_id, null, 'migration.recording_consent.unresolved', 'recording',
       jsonb_build_object('count', count(*), 'migration', '0030')
from public.recordings r
where r.consent_acceptance_id is null
group by r.org_id;

create unique index if not exists recordings_client_upload_unique_idx
  on public.recordings (org_id, client_upload_id)
  where client_upload_id is not null;

-- Older retries could point more than one recording at the same transcript.
-- Keep the most clinically useful/newest link before enforcing the invariant.
with ranked as (
  select
    id,
    row_number() over (
      partition by transcription_id
      order by (status = 'ready') desc, created_at desc, id desc
    ) as position
  from public.recordings
  where transcription_id is not null
)
update public.recordings r
set transcription_id = null,
    status = case when r.status = 'ready' then 'failed'::public.recording_status else r.status end,
    failure_stage = case when r.status = 'ready' then 'apply' else r.failure_stage end,
    error_code = case when r.status = 'ready' then 'duplicate_transcription_link' else r.error_code end
from ranked x
where r.id = x.id and x.position > 1;

create unique index if not exists recordings_transcription_unique_idx
  on public.recordings (transcription_id)
  where transcription_id is not null;

-- If an older client opened several unfinished captures, keep the newest as
-- the resumable one. Older rows remain auditable and explicitly actionable.
with ranked as (
  select
    id,
    row_number() over (partition by consultation_id order by created_at desc, id desc) as position
  from public.recordings
  where consultation_id is not null
    and status in ('recording', 'local', 'uploading', 'uploaded', 'processing')
)
update public.recordings r
set status = 'failed',
    failure_stage = coalesce(r.failure_stage, 'capture'),
    error_code = coalesce(r.error_code, 'duplicate_open_recording'),
    error = coalesce(r.error, 'An older unfinished capture was superseded during workflow migration.')
from ranked x
where r.id = x.id and x.position > 1;

create unique index if not exists recordings_one_open_per_consultation_idx
  on public.recordings (consultation_id)
  where consultation_id is not null
    and status in ('recording', 'local', 'uploading', 'uploaded', 'processing');

-- The append-only ledger remains intact. If historical retries charged the
-- same recording more than once, retain those entries but remove the duplicate
-- recording link before enforcing one future transcription charge.
with ranked as (
  select
    id,
    row_number() over (partition by recording_id order by created_at, id) as position
  from public.audio_usage
  where recording_id is not null and kind = 'transcription'
)
update public.audio_usage u
set recording_id = null,
    description = concat_ws(' · ', u.description, 'Historical duplicate recording link cleared by 0030')
from ranked x
where u.id = x.id and x.position > 1;

create unique index if not exists audio_usage_one_transcription_per_recording_idx
  on public.audio_usage (recording_id)
  where recording_id is not null and kind = 'transcription';

-- A manual/audio-only capture is a clinical attachment, not an AI allowance
-- event. The original 0024 guard remains authoritative for mode = 'ai'.
create or replace function public.guard_recording_allowance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowance jsonb;
begin
  if pg_trigger_depth() > 1 or new.mode = 'audio_only' then
    return new;
  end if;

  allowance := public.org_audio_allowance(new.org_id);
  if not (allowance ->> 'can_start')::boolean then
    if (allowance ->> 'trial_available')::boolean then
      raise exception 'trial_not_started' using errcode = 'check_violation';
    end if;
    raise exception 'audio_allowance_exhausted' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------- Recording state integrity ----------

create or replace function public.guard_recording_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  valid_transition boolean := false;
begin
  if tg_op = 'INSERT' then
    new.capture_started_at := coalesce(new.capture_started_at, now());
    return new;
  end if;

  if pg_trigger_depth() <= 1 and (
    new.mode is distinct from old.mode
    or new.client_upload_id is distinct from old.client_upload_id
    or new.consent_acceptance_id is distinct from old.consent_acceptance_id
    or new.ai_consent_acceptance_id is distinct from old.ai_consent_acceptance_id
  ) then
    raise exception 'recording_identity_immutable' using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    valid_transition :=
      (old.status = 'recording' and new.status in ('local', 'uploading', 'failed', 'cancelled'))
      or (old.status = 'local' and new.status in ('uploading', 'failed', 'cancelled'))
      or (old.status = 'uploading' and new.status in ('local', 'uploaded', 'ready', 'failed', 'cancelled'))
      or (old.status = 'uploaded' and new.status in ('processing', 'failed', 'cancelled'))
      or (old.status = 'processing' and new.status in ('ready', 'failed', 'cancelled'))
      or (old.status = 'failed' and new.status in ('local', 'uploading', 'processing', 'cancelled'));

    if not valid_transition then
      raise exception 'recording_invalid_state'
        using errcode = 'check_violation',
              detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
    end if;
  end if;

  if new.status in ('local', 'uploading', 'uploaded', 'processing', 'ready', 'failed', 'cancelled') then
    new.capture_ended_at := coalesce(new.capture_ended_at, now());
  end if;
  if new.status = 'uploading' and old.status <> 'uploading' then
    new.upload_started_at := now();
  elsif new.status = 'uploaded' and old.status <> 'uploaded' then
    if new.audio_path is null then
      raise exception 'recording_not_uploaded' using errcode = 'check_violation';
    end if;
    new.uploaded_at := now();
  elsif new.status = 'processing' and old.status <> 'processing' then
    new.processing_started_at := now();
    new.processing_attempts := old.processing_attempts + 1;
    new.error := null;
    new.error_code := null;
    new.failure_stage := null;
  elsif new.status = 'ready' and old.status <> 'ready' then
    if new.mode = 'ai' and new.transcription_id is null then
      raise exception 'transcription_missing' using errcode = 'check_violation';
    end if;
    new.ready_at := now();
  elsif new.status = 'failed' and old.status <> 'failed' then
    new.error_code := coalesce(new.error_code, 'processing_failed');
    new.failure_stage := coalesce(
      new.failure_stage,
      case
        when old.status in ('recording', 'local') then 'capture'
        when old.status = 'uploading' then 'upload'
        else 'transcription'
      end
    );
  end if;

  -- Every terminal transition fences the worker that held the lease. A late
  -- heartbeat, failure callback or apply can no longer revive/corrupt it.
  if new.status in ('ready', 'failed', 'cancelled') and new.status is distinct from old.status then
    new.processing_claim_id := null;
    new.processing_heartbeat_at := null;
    new.processing_lease_expires_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists recordings_guard_lifecycle on public.recordings;
create trigger recordings_guard_lifecycle
  before insert or update on public.recordings
  for each row execute function public.guard_recording_lifecycle();

-- ---------- Capture and upload RPCs ----------

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

create or replace function public.mark_recording_local(
  target_recording uuid,
  target_duration_seconds integer,
  target_size_bytes bigint,
  target_mime text,
  target_checksum_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recording_row public.recordings%rowtype;
  limits jsonb;
  max_duration_seconds integer;
  max_size_bytes bigint;
begin
  select r.* into recording_row from public.recordings r where r.id = target_recording for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if recording_row.status not in ('recording', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;

  select value into limits from public.platform_settings where key = 'recording';
  max_duration_seconds := greatest(
    coalesce((limits ->> 'max_duration_minutes')::integer, 120),
    1
  ) * 60;
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
      checksum_sha256 = nullif(lower(btrim(target_checksum_sha256)), ''),
      capture_ended_at = now(),
      error = null,
      error_code = null,
      failure_stage = null
  where id = target_recording;

  return jsonb_build_object('ok', true, 'code', 'local', 'recordingId', target_recording);
end;
$$;

create or replace function public.mark_recording_uploading(target_recording uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recording_row public.recordings%rowtype;
begin
  select r.* into recording_row from public.recordings r where r.id = target_recording for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if recording_row.status not in ('local', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;

  update public.recordings set status = 'uploading' where id = target_recording;
  return jsonb_build_object('ok', true, 'code', 'uploading', 'recordingId', target_recording);
end;
$$;

create or replace function public.confirm_recording_upload(
  target_recording uuid,
  target_audio_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  recording_row public.recordings%rowtype;
  expected_prefix text;
  stored_size bigint;
begin
  select r.* into recording_row from public.recordings r where r.id = target_recording for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if recording_row.status in ('uploaded', 'ready') then
    return jsonb_build_object('ok', true, 'code', recording_row.status, 'recordingId', target_recording);
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
  if recording_row.checksum_sha256 is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'transcriptions'
      and o.name = target_audio_path
      and coalesce(o.user_metadata ->> 'checksum_sha256', o.metadata ->> 'checksum_sha256') = recording_row.checksum_sha256
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_integrity_failed');
  end if;

  update public.recordings
  set status = case when mode = 'audio_only' then 'ready'::public.recording_status else 'uploaded'::public.recording_status end,
      audio_path = target_audio_path,
      uploaded_at = coalesce(uploaded_at, now())
  where id = target_recording;

  return jsonb_build_object(
    'ok', true,
    'code', case when recording_row.mode = 'audio_only' then 'ready' else 'uploaded' end,
    'recordingId', target_recording,
    'audioPath', target_audio_path
  );
end;
$$;

create or replace function public.cancel_clinical_recording(
  target_recording uuid,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recording_row public.recordings%rowtype;
begin
  select r.* into recording_row from public.recordings r where r.id = target_recording for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if recording_row.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'code', 'cancelled', 'recordingId', target_recording);
  end if;
  if recording_row.status = 'ready' then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;

  update public.recordings
  set status = 'cancelled',
      error_code = nullif(btrim(target_error_code), ''),
      error = null
  where id = target_recording;

  return jsonb_build_object('ok', true, 'code', 'cancelled', 'recordingId', target_recording);
end;
$$;

create or replace function public.fail_clinical_recording(
  target_recording uuid,
  target_stage text,
  target_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recording_row public.recordings%rowtype;
begin
  select r.* into recording_row from public.recordings r where r.id = target_recording for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if recording_row.status in ('ready', 'cancelled')
     or target_stage not in ('capture', 'upload', 'transcription', 'extraction', 'apply', 'deletion') then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;

  update public.recordings
  set status = 'failed',
      failure_stage = target_stage,
      error_code = coalesce(nullif(btrim(target_error_code), ''), 'processing_failed'),
      error = null,
      processing_heartbeat_at = null,
      processing_lease_expires_at = null
  where id = target_recording;

  return jsonb_build_object('ok', true, 'code', 'failed', 'recordingId', target_recording);
end;
$$;

-- ---------- Idempotent processing ----------

create or replace function public.claim_recording_for_processing(target_recording uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_consultation_id uuid;
  consultation_row public.consultations%rowtype;
  recording_row public.recordings%rowtype;
  claimed_transcription_id uuid;
  claimed_processing_id uuid;
  lease_minutes integer;
begin
  select r.consultation_id into claimed_consultation_id from public.recordings r where r.id = target_recording;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = claimed_consultation_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select r.* into recording_row
  from public.recordings r
  where r.id = target_recording
  for update;

  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if recording_row.status = 'ready' then
    return jsonb_build_object(
      'ok', true, 'code', 'ready', 'recordingId', target_recording, 'transcriptionId', recording_row.transcription_id
    );
  end if;
  if recording_row.status = 'processing'
     and recording_row.processing_claim_id is not null
     and recording_row.processing_clinical_revision is not null
     and recording_row.processing_lease_expires_at is not null
     and recording_row.processing_lease_expires_at > now() then
    return jsonb_build_object(
      'ok', true, 'code', 'processing_already_claimed', 'recordingId', target_recording,
      'transcriptionId', recording_row.transcription_id,
      'claimId', recording_row.processing_claim_id,
      'clinicalRevision', recording_row.processing_clinical_revision
    );
  end if;

  claimed_processing_id := gen_random_uuid();
  if recording_row.status not in ('uploaded', 'failed', 'processing') or recording_row.audio_path is null then
    return jsonb_build_object('ok', false, 'code', 'recording_not_uploaded', 'status', recording_row.status);
  end if;

  select greatest(coalesce((value ->> 'processing_lease_minutes')::integer, 15), 2)
  into lease_minutes
  from public.platform_settings
  where key = 'recording';
  lease_minutes := coalesce(lease_minutes, 15);
  if recording_row.mode <> 'ai' then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', consultation_row.status);
  end if;
  if not public.has_active_consent(recording_row.org_id, recording_row.patient_id, 'ai-processing') then
    return jsonb_build_object('ok', false, 'code', 'consent_required', 'consent', 'ai-processing');
  end if;

  claimed_transcription_id := recording_row.transcription_id;
  if claimed_transcription_id is null then
    insert into public.transcriptions (
      org_id, audio_path, mime, status, delete_audio_after, metadata, created_by
    ) values (
      recording_row.org_id,
      recording_row.audio_path,
      coalesce(recording_row.mime, 'audio/webm'),
      'pending',
      coalesce((
        select value ->> 'audio_retention' = 'after_validation'
        from public.platform_settings where key = 'recording'
      ), true),
      jsonb_build_object('recordingId', recording_row.id, 'consultationId', recording_row.consultation_id),
      recording_row.created_by
    )
    returning id into claimed_transcription_id;
  end if;

  update public.recordings
  set status = 'processing',
      transcription_id = claimed_transcription_id,
      processing_claim_id = claimed_processing_id,
      processing_clinical_revision = consultation_row.clinical_revision,
      processing_attempts = case
        when recording_row.status = 'processing' then processing_attempts + 1
        else processing_attempts
      end,
      processing_started_at = case
        when recording_row.status = 'processing' then now()
        else processing_started_at
      end,
      processing_heartbeat_at = now(),
      processing_lease_expires_at = now() + make_interval(mins => lease_minutes),
      error = null,
      error_code = null,
      failure_stage = null
  where id = target_recording;

  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'recordingId', target_recording,
    'transcriptionId', claimed_transcription_id,
    'claimId', claimed_processing_id,
    'clinicalRevision', consultation_row.clinical_revision
  );
end;
$$;

create or replace function public.heartbeat_recording_processing(
  target_recording uuid,
  target_claim_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lease_minutes integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  select greatest(coalesce((value ->> 'processing_lease_minutes')::integer, 15), 2)
  into lease_minutes
  from public.platform_settings
  where key = 'recording';
  lease_minutes := coalesce(lease_minutes, 15);

  update public.recordings
  set processing_heartbeat_at = now(),
      processing_lease_expires_at = now() + make_interval(mins => lease_minutes)
  where id = target_recording
    and target_claim_id is not null
    and status = 'processing'
    and processing_claim_id = target_claim_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'processing_claim_lost'); end if;
  return jsonb_build_object('ok', true, 'code', 'heartbeat');
end;
$$;

create or replace function public.apply_recording_result(
  target_recording uuid,
  target_transcription uuid,
  target_claim_id uuid,
  target_answers jsonb,
  target_gaps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_consultation_id uuid;
  consultation_row public.consultations%rowtype;
  recording_row public.recordings%rowtype;
  item jsonb;
  answer_source public.answer_source;
  answer_state public.answer_state;
  affected integer;
  written integer := 0;
begin
  if target_transcription is null or target_claim_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select r.consultation_id into claimed_consultation_id from public.recordings r where r.id = target_recording;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = claimed_consultation_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select r.* into recording_row
  from public.recordings r
  where r.id = target_recording
  for update;

  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if recording_row.status <> 'processing'
     or recording_row.transcription_id is distinct from target_transcription
     or recording_row.processing_claim_id is distinct from target_claim_id then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', consultation_row.status);
  end if;
  if not public.has_active_consent(recording_row.org_id, recording_row.patient_id, 'ai-processing') then
    return jsonb_build_object('ok', false, 'code', 'consent_required', 'consent', 'ai-processing');
  end if;
  if recording_row.processing_clinical_revision is distinct from consultation_row.clinical_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'clinical_revision_conflict',
      'claimRevision', recording_row.processing_clinical_revision,
      'revision', consultation_row.clinical_revision
    );
  end if;

  for item in select value from jsonb_array_elements(coalesce(target_answers, '[]'::jsonb)) loop
    if nullif(btrim(item ->> 'value'), '') is null
       or nullif(btrim(item ->> 'blockKey'), '') is null
       or nullif(btrim(item ->> 'fieldKey'), '') is null then
      continue;
    end if;

    answer_source := case
      when item ->> 'source' in ('patient_report', 'professional_voice', 'ai_inference')
        then (item ->> 'source')::public.answer_source
      else 'ai_inference'::public.answer_source
    end;
    answer_state := case
      when item ->> 'state' in ('clear', 'attention')
        then (item ->> 'state')::public.answer_state
      else 'attention'::public.answer_state
    end;

    insert into public.anamnesis_answers (
      org_id, consultation_id, block_key, field_key, value, source, state, provenance, created_by
    ) values (
      recording_row.org_id,
      consultation_row.id,
      item ->> 'blockKey',
      item ->> 'fieldKey',
      btrim(item ->> 'value'),
      answer_source,
      answer_state,
      coalesce(item -> 'provenance', '{}'::jsonb) || jsonb_build_object('transcriptionId', target_transcription),
      recording_row.created_by
    )
    on conflict (consultation_id, block_key, field_key) do update
    set value = excluded.value,
        source = excluded.source,
        state = excluded.state,
        provenance = excluded.provenance,
        updated_at = now()
    where public.anamnesis_answers.source not in ('professional', 'professional_voice')
      and public.anamnesis_answers.state not in ('edited', 'rejected');

    get diagnostics affected = row_count;
    written := written + affected;
  end loop;

  update public.consultations
  set status = 'awaiting_review',
      transcription_id = target_transcription,
      ai_gaps = case when jsonb_typeof(target_gaps) = 'array' then target_gaps else '[]'::jsonb end
  where id = consultation_row.id;

  update public.recordings
  set status = 'ready',
      transcription_id = target_transcription,
      processing_heartbeat_at = null,
      processing_lease_expires_at = null
  where id = target_recording;

  return jsonb_build_object(
    'ok', true,
    'code', 'ready',
    'recordingId', target_recording,
    'transcriptionId', target_transcription,
    'answers', written,
    'gaps', jsonb_array_length(case when jsonb_typeof(target_gaps) = 'array' then target_gaps else '[]'::jsonb end)
  );
end;
$$;

-- ---------- Transcript validation and retention ----------

create or replace function public.validate_clinical_transcription(target_transcription uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  transcription_row public.transcriptions%rowtype;
begin
  select t.* into transcription_row
  from public.transcriptions t
  where t.id = target_transcription
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(transcription_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if transcription_row.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', transcription_row.status);
  end if;

  update public.transcriptions
  set validated_at = coalesce(validated_at, now()),
      validated_by = coalesce(validated_by, auth.uid())
  where id = target_transcription;

  return jsonb_build_object(
    'ok', true,
    'code', 'validated',
    'transcriptionId', target_transcription,
    'deleteAudioAfter', transcription_row.delete_audio_after
  );
end;
$$;

create or replace function public.request_recording_audio_deletion(target_recording uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recording_row public.recordings%rowtype;
  transcription_row public.transcriptions%rowtype;
begin
  select r.* into recording_row from public.recordings r where r.id = target_recording for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select t.* into transcription_row
  from public.transcriptions t
  where t.id = recording_row.transcription_id;

  if not found then
    if recording_row.mode <> 'audio_only' or recording_row.status <> 'ready' then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;

    update public.recordings
    set audio_deletion_requested_at = coalesce(audio_deletion_requested_at, now())
    where id = target_recording;
    return jsonb_build_object(
      'ok', true,
      'code', 'deletion_requested',
      'recordingId', target_recording,
      'audioPath', recording_row.audio_path,
      'transcriptionId', null
    );
  end if;

  if transcription_row.validated_at is null then
    return jsonb_build_object('ok', false, 'code', 'transcript_not_validated');
  end if;

  update public.recordings
  set audio_deletion_requested_at = coalesce(audio_deletion_requested_at, now())
  where id = target_recording;

  update public.transcriptions
  set delete_audio_after = true,
      deletion_error = null
  where id = recording_row.transcription_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'deletion_requested',
    'recordingId', target_recording,
    'audioPath', recording_row.audio_path,
    'transcriptionId', recording_row.transcription_id
  );
end;
$$;

-- Called only after Storage reports success. Verifying that the object is no
-- longer present prevents a client from merely hiding an undeleted source.
create or replace function public.complete_recording_audio_deletion(target_recording uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  recording_row public.recordings%rowtype;
  transcription_row public.transcriptions%rowtype;
begin
  select r.* into recording_row from public.recordings r where r.id = target_recording for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select t.* into transcription_row
  from public.transcriptions t
  where t.id = recording_row.transcription_id
  for update;
  if not found and recording_row.mode <> 'audio_only' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if recording_row.mode <> 'audio_only' and transcription_row.validated_at is null then
    return jsonb_build_object('ok', false, 'code', 'transcript_not_validated');
  end if;
  if recording_row.audio_deletion_requested_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  if recording_row.audio_path is not null and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'transcriptions' and o.name = recording_row.audio_path
  ) then
    return jsonb_build_object('ok', false, 'code', 'audio_deletion_failed');
  end if;

  update public.recordings
  set audio_path = null,
      audio_deleted_at = coalesce(audio_deleted_at, now())
  where id = target_recording;

  if recording_row.transcription_id is not null then
    update public.transcriptions
    set audio_path = null,
        audio_deleted_at = coalesce(audio_deleted_at, now()),
        deletion_error = null
    where id = recording_row.transcription_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'audio_deleted',
    'recordingId', target_recording,
    'transcriptionId', recording_row.transcription_id
  );
end;
$$;

revoke all on function public.begin_clinical_recording(uuid, text, uuid, boolean, text) from public;
revoke all on function public.mark_recording_local(uuid, integer, bigint, text, text) from public;
revoke all on function public.mark_recording_uploading(uuid) from public;
revoke all on function public.confirm_recording_upload(uuid, text) from public;
revoke all on function public.cancel_clinical_recording(uuid, text) from public;
revoke all on function public.fail_clinical_recording(uuid, text, text) from public;
revoke all on function public.claim_recording_for_processing(uuid) from public;
revoke all on function public.heartbeat_recording_processing(uuid, uuid) from public;
revoke all on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb) from public;
revoke all on function public.validate_clinical_transcription(uuid) from public;
revoke all on function public.request_recording_audio_deletion(uuid) from public;
revoke all on function public.complete_recording_audio_deletion(uuid) from public;

grant execute on function public.begin_clinical_recording(uuid, text, uuid, boolean, text) to authenticated;
grant execute on function public.mark_recording_local(uuid, integer, bigint, text, text) to authenticated;
grant execute on function public.mark_recording_uploading(uuid) to authenticated;
grant execute on function public.confirm_recording_upload(uuid, text) to authenticated;
grant execute on function public.cancel_clinical_recording(uuid, text) to authenticated;
grant execute on function public.fail_clinical_recording(uuid, text, text) to authenticated;
grant execute on function public.claim_recording_for_processing(uuid) to authenticated;
grant execute on function public.heartbeat_recording_processing(uuid, uuid) to service_role;
grant execute on function public.validate_clinical_transcription(uuid) to authenticated;
grant execute on function public.request_recording_audio_deletion(uuid) to authenticated;
grant execute on function public.complete_recording_audio_deletion(uuid) to authenticated;
grant execute on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb) to service_role;

drop policy if exists "recordings_all_member" on public.recordings;
drop policy if exists "recordings_select_member" on public.recordings;
create policy "recordings_select_member" on public.recordings
  for select to authenticated
  using (public.is_org_member(org_id));
revoke insert, update, delete on table public.recordings from authenticated;
grant select on table public.recordings to authenticated;

drop policy if exists "transcriptions_insert_member" on public.transcriptions;
drop policy if exists "transcriptions_update_member" on public.transcriptions;
drop policy if exists "transcriptions_delete_creator" on public.transcriptions;
revoke insert, update, delete on table public.transcriptions from authenticated;
grant select on table public.transcriptions to authenticated;
