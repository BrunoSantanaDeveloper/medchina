-- ============================================================
-- 0028_continuity_agenda_patients
--
-- Keeps scheduling, patient lifecycle and the clinical record honest:
--  * scheduled_for is the administrative appointment time. started_at stays
--    available to older clients and as the existing clinical timeline field.
--  * appointment_note is not a clinical chief complaint.
--  * patients are archived/restored and may request deletion without silently
--    deleting an auditable clinical history.
--  * one patient may have several future appointments, but never more than one
--    active clinical consultation (draft/in_progress/awaiting_review).
--  * agenda mutations are atomic, membership checked and stale-state aware.
-- ============================================================

-- ---------- Patient lifecycle ----------

alter table public.patients
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_requested_by uuid references public.profiles (id) on delete set null,
  add column if not exists deletion_request_reason text;

comment on column public.patients.archived_at is
  'Soft archive. The clinical history is preserved and the patient is hidden from active pickers.';
comment on column public.patients.deletion_requested_at is
  'Auditable LGPD deletion request. This is a request marker, never an immediate destructive delete.';

create index if not exists patients_org_active_name_idx
  on public.patients (org_id, lower(full_name))
  where archived_at is null;

create index if not exists patients_deletion_requests_idx
  on public.patients (org_id, deletion_requested_at)
  where deletion_requested_at is not null;

-- ---------- Appointment metadata ----------

alter table public.consultations
  add column if not exists scheduled_for timestamptz,
  add column if not exists appointment_note text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null,
  add column if not exists cancellation_reason text;

comment on column public.consultations.scheduled_for is
  'Administrative appointment time. Null means the consultation was not created from the agenda.';
comment on column public.consultations.appointment_note is
  'Administrative scheduling note; intentionally separate from the clinical chief_complaint.';

-- The current code can prove that scheduled/in_progress rows originated in the
-- agenda. It cannot safely infer that for historical finalized rows, so those
-- stay null rather than manufacturing history.
update public.consultations
set scheduled_for = started_at
where scheduled_for is null
  and status in ('scheduled', 'in_progress');

-- Existing agenda UI stored its administrative reason in chief_complaint.
-- Copy it for continuity, but never erase the clinical field during migration.
update public.consultations
set appointment_note = chief_complaint
where appointment_note is null
  and scheduled_for is not null
  and chief_complaint is not null;

create index if not exists consultations_org_scheduled_for_idx
  on public.consultations (org_id, scheduled_for)
  where scheduled_for is not null;

-- Fail loudly if pre-existing data violates the clinical invariant. Silently
-- cancelling or deleting a real record here would be unsafe.
do $$
begin
  if exists (
    select 1
    from public.consultations
    where status in ('draft', 'in_progress', 'awaiting_review')
    group by patient_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot install 0028: a patient has more than one active clinical consultation. Resolve the duplicate records without deleting clinical history, then retry.';
  end if;
end;
$$;

create unique index if not exists consultations_one_active_clinical_per_patient_idx
  on public.consultations (patient_id)
  where status in ('draft', 'in_progress', 'awaiting_review');

alter table public.consultations
  add constraint consultations_scheduled_time_required
  check (status <> 'scheduled' or scheduled_for is not null);

-- Archiving must not strand live work. The professional resolves/cancels the
-- open item first; all finalized/cancelled history remains preserved.
create or replace function public.guard_patient_archive()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1
    from public.consultations c
    where c.patient_id = old.id
      and c.status in ('scheduled', 'draft', 'in_progress', 'awaiting_review')
  ) then
    raise exception 'patient_has_open_work' using errcode = 'check_violation';
  end if;

  if old.archived_at is not null
     and new.archived_at is null
     and new.deletion_requested_at is not null then
    raise exception 'patient_deletion_pending' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists patients_guard_archive on public.patients;
create trigger patients_guard_archive
  before update of archived_at, deletion_requested_at on public.patients
  for each row execute function public.guard_patient_archive();

-- All creation paths (not only the new agenda RPC) respect the archive. A row
-- lock also makes starting/scheduling and archiving deterministic when they
-- happen concurrently.
create or replace function public.guard_consultation_patient_available()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('scheduled', 'draft', 'in_progress', 'awaiting_review') then
    perform p.id
    from public.patients p
    where p.id = new.patient_id
      and p.org_id = new.org_id
      and p.archived_at is null
    for share;

    if not found then
      raise exception 'patient_unavailable' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists consultations_guard_patient_available on public.consultations;
create trigger consultations_guard_patient_available
  before insert or update of patient_id, org_id, status on public.consultations
  for each row execute function public.guard_consultation_patient_available();

-- Extend the latest finalized-record guard (0023) with the scheduling fields.
-- A finalized record cannot be moved on the calendar or have its administrative
-- context rewritten after the fact.
create or replace function public.guard_finalized_consultation()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.status = 'finalized' then
    if new.status is distinct from old.status
       or new.summary is distinct from old.summary
       or new.chief_complaint is distinct from old.chief_complaint
       or new.patient_id is distinct from old.patient_id
       or new.transcription_id is distinct from old.transcription_id
       or new.ai_gaps is distinct from old.ai_gaps
       or new.started_at is distinct from old.started_at
       or new.scheduled_for is distinct from old.scheduled_for
       or new.duration_minutes is distinct from old.duration_minutes
       or new.appointment_note is distinct from old.appointment_note then
      raise exception 'consultation % is finalized: append an addendum instead of editing it', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ---------- Shared conflict answer ----------

-- Keep the 0027 RPC compatible for older clients, but prefer scheduled_for for
-- every row created after this migration.
create or replace function public.consultation_schedule_conflict(
  target_org uuid,
  start_at timestamptz,
  duration_minutes integer,
  exclude_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  candidate_end timestamptz := start_at + make_interval(mins => greatest(duration_minutes, 1));
  conflict boolean;
begin
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select exists (
    select 1
    from public.consultations c
    where c.org_id = target_org
      and c.status in ('scheduled', 'in_progress')
      and c.scheduled_for is not null
      and (exclude_id is null or c.id <> exclude_id)
      and c.scheduled_for < candidate_end
      and start_at < c.scheduled_for + make_interval(mins => greatest(c.duration_minutes, 1))
  ) into conflict;

  return conflict;
end;
$$;

-- ---------- Atomic schedule / reschedule ----------

create or replace function public.save_scheduled_consultation(
  target_org uuid,
  target_patient uuid,
  target_start timestamptz,
  target_duration integer,
  target_note text default null,
  target_consultation uuid default null,
  force_conflict boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.consultations%rowtype;
  saved_row public.consultations%rowtype;
  conflict_row record;
  target_patient_name text;
  candidate_end timestamptz;
begin
  -- PostgREST callers may explicitly send JSON null, bypassing a SQL default.
  -- Treat it as the safe choice; NULL must never behave like an override.
  force_conflict := coalesce(force_conflict, false);

  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  if target_start is null or target_duration is null or target_duration <= 0 or target_duration > 1440 then
    return jsonb_build_object('ok', false, 'code', 'invalid_schedule');
  end if;

  select p.full_name
  into target_patient_name
  from public.patients p
  where p.id = target_patient
    and p.org_id = target_org
    and p.archived_at is null
  for share;

  if target_patient_name is null then
    return jsonb_build_object('ok', false, 'code', 'patient_unavailable');
  end if;

  -- Serializes scheduling decisions per workspace without banning an explicit
  -- double-book override (an exclusion constraint could not support that).
  perform pg_advisory_xact_lock(hashtext(target_org::text));

  if target_consultation is not null then
    select c.*
    into target_row
    from public.consultations c
    where c.id = target_consultation
      and c.org_id = target_org
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if target_row.status <> 'scheduled' then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_status',
        'status', target_row.status
      );
    end if;
  end if;

  candidate_end := target_start + make_interval(mins => target_duration);

  select
    c.id,
    c.patient_id,
    p.full_name as patient_name,
    c.scheduled_for,
    c.duration_minutes
  into conflict_row
  from public.consultations c
  join public.patients p on p.id = c.patient_id
  where c.org_id = target_org
    and c.status in ('scheduled', 'in_progress')
    and c.scheduled_for is not null
    and (target_consultation is null or c.id <> target_consultation)
    and c.scheduled_for < candidate_end
    and target_start < c.scheduled_for + make_interval(mins => greatest(c.duration_minutes, 1))
  order by c.scheduled_for
  limit 1;

  if conflict_row.id is not null and not force_conflict then
    return jsonb_build_object(
      'ok', false,
      'code', 'schedule_conflict',
      'conflict', jsonb_build_object(
        'id', conflict_row.id,
        'patientId', conflict_row.patient_id,
        'patientName', conflict_row.patient_name,
        'scheduledFor', conflict_row.scheduled_for,
        'durationMinutes', conflict_row.duration_minutes
      )
    );
  end if;

  if target_consultation is null then
    insert into public.consultations (
      org_id,
      patient_id,
      status,
      started_at,
      scheduled_for,
      duration_minutes,
      appointment_note,
      created_by
    ) values (
      target_org,
      target_patient,
      'scheduled',
      target_start,
      target_start,
      target_duration,
      nullif(btrim(target_note), ''),
      auth.uid()
    )
    returning * into saved_row;
  else
    update public.consultations
    set patient_id = target_patient,
        started_at = target_start,
        scheduled_for = target_start,
        duration_minutes = target_duration,
        appointment_note = nullif(btrim(target_note), '')
    where id = target_consultation
      and org_id = target_org
      and status = 'scheduled'
    returning * into saved_row;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'stale_status');
    end if;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    case when target_consultation is null then 'appointment.scheduled' else 'appointment.rescheduled' end,
    'consultation',
    saved_row.id::text,
    jsonb_build_object(
      'scheduledFor', saved_row.scheduled_for,
      'durationMinutes', saved_row.duration_minutes,
      'conflictOverride', conflict_row.id is not null and force_conflict
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', case when target_consultation is null then 'created' else 'updated' end,
    'consultationId', saved_row.id,
    'patientId', saved_row.patient_id,
    'patientName', target_patient_name,
    'scheduledFor', saved_row.scheduled_for,
    'durationMinutes', saved_row.duration_minutes,
    'appointmentNote', saved_row.appointment_note,
    'overrodeConflict', conflict_row.id is not null and force_conflict
  );
end;
$$;

-- ---------- Conditional lifecycle transitions ----------

create or replace function public.start_scheduled_consultation(target_consultation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.consultations%rowtype;
  active_row record;
begin
  select c.* into target_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(target_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_row.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'stale_status', 'status', target_row.status);
  end if;

  -- Do not let an archive race with starting care for that patient.
  perform p.id
  from public.patients p
  where p.id = target_row.patient_id
    and p.archived_at is null
  for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'patient_unavailable');
  end if;

  select c.id, c.status into active_row
  from public.consultations c
  where c.patient_id = target_row.patient_id
    and c.id <> target_row.id
    and c.status in ('draft', 'in_progress', 'awaiting_review')
  limit 1;

  if active_row.id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'active_consultation_exists',
      'consultationId', active_row.id,
      'status', active_row.status
    );
  end if;

  begin
    update public.consultations
    set status = 'in_progress',
        started_at = now()
    where id = target_row.id
      and status = 'scheduled';
  exception when unique_violation then
    -- A direct/manual consultation may have been inserted after the check.
    -- The partial unique index remains the authority; return the surviving
    -- active record instead of surfacing a raw database error to the user.
    select c.id, c.status into active_row
    from public.consultations c
    where c.patient_id = target_row.patient_id
      and c.id <> target_row.id
      and c.status in ('draft', 'in_progress', 'awaiting_review')
    limit 1;
    return jsonb_build_object(
      'ok', false,
      'code', 'active_consultation_exists',
      'consultationId', active_row.id,
      'status', active_row.status
    );
  end;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_row.org_id,
    auth.uid(),
    'appointment.started',
    'consultation',
    target_row.id::text,
    jsonb_build_object('scheduledFor', target_row.scheduled_for, 'startedAt', now())
  );

  return jsonb_build_object('ok', true, 'code', 'started', 'consultationId', target_row.id);
end;
$$;

create or replace function public.cancel_scheduled_consultation(
  target_consultation uuid,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.consultations%rowtype;
begin
  select c.* into target_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(target_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_row.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'stale_status', 'status', target_row.status);
  end if;

  update public.consultations
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = nullif(btrim(reason), '')
  where id = target_row.id
    and status = 'scheduled';

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_row.org_id,
    auth.uid(),
    'appointment.cancelled',
    'consultation',
    target_row.id::text,
    jsonb_build_object('reasonProvided', nullif(btrim(reason), '') is not null)
  );

  return jsonb_build_object('ok', true, 'code', 'cancelled', 'consultationId', target_row.id);
end;
$$;

create or replace function public.restore_cancelled_consultation(
  target_consultation uuid,
  force_conflict boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.consultations%rowtype;
  conflict_row record;
  candidate_end timestamptz;
begin
  -- An explicit JSON null must not bypass the conflict confirmation gate.
  force_conflict := coalesce(force_conflict, false);

  select c.* into target_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(target_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_row.status <> 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'stale_status', 'status', target_row.status);
  end if;
  if target_row.scheduled_for is null then
    return jsonb_build_object('ok', false, 'code', 'not_an_appointment');
  end if;

  perform p.id
  from public.patients p
  where p.id = target_row.patient_id
    and p.archived_at is null
  for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'patient_unavailable');
  end if;

  perform pg_advisory_xact_lock(hashtext(target_row.org_id::text));
  candidate_end := target_row.scheduled_for + make_interval(mins => target_row.duration_minutes);

  select
    c.id,
    c.patient_id,
    p.full_name as patient_name,
    c.scheduled_for,
    c.duration_minutes
  into conflict_row
  from public.consultations c
  join public.patients p on p.id = c.patient_id
  where c.org_id = target_row.org_id
    and c.id <> target_row.id
    and c.status in ('scheduled', 'in_progress')
    and c.scheduled_for is not null
    and c.scheduled_for < candidate_end
    and target_row.scheduled_for < c.scheduled_for + make_interval(mins => greatest(c.duration_minutes, 1))
  order by c.scheduled_for
  limit 1;

  if conflict_row.id is not null and not force_conflict then
    return jsonb_build_object(
      'ok', false,
      'code', 'schedule_conflict',
      'conflict', jsonb_build_object(
        'id', conflict_row.id,
        'patientId', conflict_row.patient_id,
        'patientName', conflict_row.patient_name,
        'scheduledFor', conflict_row.scheduled_for,
        'durationMinutes', conflict_row.duration_minutes
      )
    );
  end if;

  update public.consultations
  set status = 'scheduled',
      cancelled_at = null,
      cancelled_by = null,
      cancellation_reason = null
  where id = target_row.id
    and status = 'cancelled';

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_row.org_id,
    auth.uid(),
    'appointment.restored',
    'consultation',
    target_row.id::text,
    jsonb_build_object('conflictOverride', conflict_row.id is not null and force_conflict)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'restored',
    'consultationId', target_row.id,
    'overrodeConflict', conflict_row.id is not null and force_conflict
  );
end;
$$;

revoke all on function public.save_scheduled_consultation(uuid, uuid, timestamptz, integer, text, uuid, boolean) from public;
revoke all on function public.start_scheduled_consultation(uuid) from public;
revoke all on function public.cancel_scheduled_consultation(uuid, text) from public;
revoke all on function public.restore_cancelled_consultation(uuid, boolean) from public;

grant execute on function public.save_scheduled_consultation(uuid, uuid, timestamptz, integer, text, uuid, boolean) to authenticated;
grant execute on function public.start_scheduled_consultation(uuid) to authenticated;
grant execute on function public.cancel_scheduled_consultation(uuid, text) to authenticated;
grant execute on function public.restore_cancelled_consultation(uuid, boolean) to authenticated;
