-- ============================================================
-- 0041_agenda_series_noshow
--
-- Two agenda evolutions that stay deliberately light (PRD §9.3):
--  * A weekly series is N INDEPENDENT scheduled consultations created in one
--    atomic call — no recurrence rule, no linked-series semantics. After
--    creation each occurrence cancels/reschedules exactly like a single one.
--    Occurrences that conflict are skipped and reported, never silently
--    dropped nor force-booked.
--  * A cancellation now carries a structured category so "a paciente faltou"
--    (no-show) stops being an untyped free-text cancel. This is the data the
--    adhesion/return metrics (PRD §15) will read later; nothing is deleted.
-- ============================================================

-- ---------- Structured cancellation category ----------

alter table public.consultations
  add column if not exists cancellation_category text
    check (
      cancellation_category is null
      or cancellation_category in ('patient', 'no_show', 'professional', 'other')
    );

comment on column public.consultations.cancellation_category is
  'Why the appointment left the calendar: patient asked, patient did not show, professional cancelled, other. Null on rows cancelled before this column existed.';

-- The 2-arg signature must go away entirely: keeping both overloads makes the
-- PostgREST call ambiguous. Clients (web only) are updated in the same release.
drop function if exists public.cancel_scheduled_consultation(uuid, text);

create or replace function public.cancel_scheduled_consultation(
  target_consultation uuid,
  reason text default null,
  category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.consultations%rowtype;
begin
  if category is not null and category not in ('patient', 'no_show', 'professional', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_category');
  end if;

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
      cancellation_reason = nullif(btrim(reason), ''),
      cancellation_category = category
  where id = target_row.id
    and status = 'scheduled';

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_row.org_id,
    auth.uid(),
    'appointment.cancelled',
    'consultation',
    target_row.id::text,
    jsonb_build_object(
      'reasonProvided', nullif(btrim(reason), '') is not null,
      'category', category
    )
  );

  return jsonb_build_object('ok', true, 'code', 'cancelled', 'consultationId', target_row.id);
end;
$$;

-- Restoring a cancelled appointment clears the category with the other
-- cancellation fields — the row is scheduled again, not "a restored no-show".
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
      cancellation_reason = null,
      cancellation_category = null
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

-- ---------- Weekly series: N independent appointments, atomically ----------

-- The client computes the occurrence timestamps (wall-clock weekly steps in the
-- practice timezone — the server cannot know "same time next week" across a DST
-- change without re-deriving the practice calendar). The server enforces
-- everything else: membership, patient availability, per-occurrence conflicts,
-- bounds, and the audit trail. Occurrences are checked in ascending order
-- inside one transaction, so a later occurrence also conflicts against an
-- earlier one just created.

create or replace function public.save_scheduled_series(
  target_org uuid,
  target_patient uuid,
  target_starts timestamptz[],
  target_duration integer,
  target_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_patient_name text;
  occurrence timestamptz;
  candidate_end timestamptz;
  conflict_row record;
  saved_row public.consultations%rowtype;
  created jsonb := '[]'::jsonb;
  conflicts jsonb := '[]'::jsonb;
  series_size integer;
  series_index integer := 0;
begin
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  series_size := coalesce(array_length(target_starts, 1), 0);

  if target_duration is null or target_duration <= 0 or target_duration > 1440
     or series_size < 1 or series_size > 12
     or exists (select 1 from unnest(target_starts) s where s is null) then
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

  perform pg_advisory_xact_lock(hashtext(target_org::text));

  for occurrence in select s from unnest(target_starts) s order by s
  loop
    series_index := series_index + 1;
    candidate_end := occurrence + make_interval(mins => target_duration);

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
      and c.scheduled_for < candidate_end
      and occurrence < c.scheduled_for + make_interval(mins => greatest(c.duration_minutes, 1))
    order by c.scheduled_for
    limit 1;

    if conflict_row.id is not null then
      conflicts := conflicts || jsonb_build_object(
        'scheduledFor', occurrence,
        'conflict', jsonb_build_object(
          'id', conflict_row.id,
          'patientId', conflict_row.patient_id,
          'patientName', conflict_row.patient_name,
          'scheduledFor', conflict_row.scheduled_for,
          'durationMinutes', conflict_row.duration_minutes
        )
      );
      continue;
    end if;

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
      occurrence,
      occurrence,
      target_duration,
      nullif(btrim(target_note), ''),
      auth.uid()
    )
    returning * into saved_row;

    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      target_org,
      auth.uid(),
      'appointment.scheduled',
      'consultation',
      saved_row.id::text,
      jsonb_build_object(
        'scheduledFor', saved_row.scheduled_for,
        'durationMinutes', saved_row.duration_minutes,
        'series', true,
        'seriesSize', series_size,
        'seriesIndex', series_index
      )
    );

    created := created || jsonb_build_object(
      'consultationId', saved_row.id,
      'scheduledFor', saved_row.scheduled_for
    );
  end loop;

  return jsonb_build_object(
    'ok', jsonb_array_length(created) > 0,
    'code', case when jsonb_array_length(created) = 0 then 'series_all_conflict' else 'series_created' end,
    'patientId', target_patient,
    'patientName', target_patient_name,
    'createdCount', jsonb_array_length(created),
    'conflictCount', jsonb_array_length(conflicts),
    'created', created,
    'conflicts', conflicts
  );
end;
$$;

revoke all on function public.cancel_scheduled_consultation(uuid, text, text) from public;
revoke all on function public.save_scheduled_series(uuid, uuid, timestamptz[], integer, text) from public;

grant execute on function public.cancel_scheduled_consultation(uuid, text, text) to authenticated;
grant execute on function public.save_scheduled_series(uuid, uuid, timestamptz[], integer, text) to authenticated;
