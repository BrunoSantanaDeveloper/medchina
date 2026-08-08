-- ============================================================
-- 0083_import_history_timezone: a date-only legacy record belongs to the
-- practice's calendar, not to UTC.
--
-- Found by walking the flow, not by a test: an imported record dated
-- 14/03/2019 showed up on the patient timeline as 13/03/2019. 0080 cast the
-- date straight to timestamptz, which the server reads as midnight UTC —
-- 21:00 of the previous day in São Paulo, and one day earlier on every screen
-- for every practice west of Greenwich.
--
-- The fix is the one 0082 already applies to appointments: read the wall clock
-- in `organizations.timezone` (0036). Same function, same three branches; only
-- the history instant changes, plus the timezone lookup moving out of the
-- schedule-only path.
-- ============================================================

create or replace function public.commit_import_batch(target_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  batch public.import_batches%rowtype;
  allowance jsonb;
  max_rows integer;
  pending integer;
  staged record;
  candidate_id uuid;
  row_name text;
  row_external text;
  row_patient uuid;
  row_body text;
  row_moment timestamptz;
  row_local text;
  row_duration integer;
  org_timezone text;
  created_count integer := 0;
  updated_count integer := 0;
  skipped_count integer := 0;
  failed_count integer := 0;
begin
  select b.* into batch from public.import_batches b where b.id = target_batch for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_org_member(batch.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  -- Committing twice is the retry of a request whose response was lost, not
  -- an error to show her.
  if batch.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_committed', 'counts', batch.counts);
  end if;
  if batch.status not in ('preview', 'importing') then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'status', batch.status);
  end if;
  if batch.kind not in ('patients', 'history', 'schedule') then
    return jsonb_build_object('ok', false, 'code', 'kind_not_supported', 'kind', batch.kind);
  end if;

  allowance := public.org_import_allowance(batch.org_id);
  if not (allowance ->> 'allowed')::boolean then
    return jsonb_build_object(
      'ok', false, 'code', 'import_not_allowed', 'reason', allowance ->> 'reason'
    );
  end if;
  max_rows := nullif(allowance ->> 'maxRows', '')::integer;

  select count(*) into pending
  from public.import_rows r
  where r.batch_id = target_batch and r.action in ('create', 'update');

  if pending = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_to_import');
  end if;
  if max_rows is not null and pending > max_rows then
    return jsonb_build_object(
      'ok', false, 'code', 'row_limit_exceeded', 'maxRows', max_rows, 'rows', pending
    );
  end if;

  -- Every wall clock in this function belongs to the practice, so the zone is
  -- resolved once for all kinds.
  select o.timezone into org_timezone from public.organizations o where o.id = batch.org_id;

  if batch.kind = 'schedule' then
    -- Serialize scheduling decisions for this workspace, exactly as the app's
    -- own scheduler does, so a slot cannot be taken between the check and the
    -- insert.
    perform pg_advisory_xact_lock(hashtext(batch.org_id::text));
  end if;

  update public.import_batches set status = 'importing' where id = target_batch;

  for staged in
    select r.*
    from public.import_rows r
    where r.batch_id = target_batch and r.action in ('create', 'update')
    order by r.row_number
    for update
  loop
    row_external := nullif(btrim(coalesce(staged.normalized ->> 'external_ref', '')), '');

    if batch.kind = 'patients' then
      row_name := nullif(btrim(staged.normalized ->> 'full_name'), '');

      -- A person with no name is not a patient record. The engine already
      -- refuses these; this is the fence, not the message.
      if row_name is null then
        update public.import_rows
        set action = 'error', error_code = 'full_name_required'
        where id = staged.id;
        continue;
      end if;

      candidate_id := null;

      if row_external is not null then
        select p.id into candidate_id
        from public.patients p
        where p.org_id = batch.org_id and p.external_ref = row_external;
      end if;

      -- The preview may have matched an existing patient by document; the row
      -- carries that decision, and it is re-checked against the workspace so a
      -- stale or forged target cannot reach another practice's record.
      if candidate_id is null and staged.target_id is not null then
        select p.id into candidate_id
        from public.patients p
        where p.id = staged.target_id and p.org_id = batch.org_id;
      end if;

      if candidate_id is null then
        insert into public.patients (
          org_id, full_name, birth_date, document, email, phone, notes,
          external_ref, import_batch_id, created_by
        ) values (
          batch.org_id,
          row_name,
          nullif(btrim(coalesce(staged.normalized ->> 'birth_date', '')), '')::date,
          nullif(btrim(coalesce(staged.normalized ->> 'document', '')), ''),
          nullif(btrim(coalesce(staged.normalized ->> 'email', '')), ''),
          nullif(btrim(coalesce(staged.normalized ->> 'phone', '')), ''),
          nullif(btrim(coalesce(staged.normalized ->> 'notes', '')), ''),
          row_external,
          target_batch,
          coalesce(batch.created_by, auth.uid())
        )
        returning id into candidate_id;

        created_count := created_count + 1;
        update public.import_rows
        set action = 'create', target_type = 'patient', target_id = candidate_id,
            error_code = null, error_message = null
        where id = staged.id;
      else
        -- Fill-only: the chart wins over the spreadsheet, always.
        update public.patients p
        set birth_date = coalesce(p.birth_date, nullif(btrim(coalesce(staged.normalized ->> 'birth_date', '')), '')::date),
            document = coalesce(p.document, nullif(btrim(coalesce(staged.normalized ->> 'document', '')), '')),
            email = coalesce(p.email, nullif(btrim(coalesce(staged.normalized ->> 'email', '')), '')),
            phone = coalesce(p.phone, nullif(btrim(coalesce(staged.normalized ->> 'phone', '')), '')),
            notes = coalesce(p.notes, nullif(btrim(coalesce(staged.normalized ->> 'notes', '')), '')),
            external_ref = coalesce(p.external_ref, row_external)
        where p.id = candidate_id;

        updated_count := updated_count + 1;
        update public.import_rows
        set action = 'update', target_type = 'patient', target_id = candidate_id,
            error_code = null, error_message = null
        where id = staged.id;
      end if;

    elsif batch.kind = 'history' then
      row_body := nullif(btrim(coalesce(staged.normalized ->> 'body', '')), '');
      -- Cast defensively: `normalized` is client-supplied jsonb, and an
      -- invalid literal here would abort the whole import with a Postgres
      -- error instead of failing the one bad line.
      row_patient := case
        when coalesce(staged.normalized ->> 'patient_id', '') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (staged.normalized ->> 'patient_id')::uuid
      end;
      -- Midnight IN HER TIMEZONE. Casting the bare date to timestamptz would
      -- pin it to midnight UTC, which every negative-offset practice reads as
      -- the day before.
      row_moment := case
        when coalesce(staged.normalized ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}'
        then (left(staged.normalized ->> 'date', 10) || ' 00:00')::timestamp
          at time zone coalesce(org_timezone, 'America/Sao_Paulo')
      end;

      if row_body is null then
        update public.import_rows
        set action = 'error', error_code = 'legacy_body_required'
        where id = staged.id;
        continue;
      end if;

      if row_moment is null then
        update public.import_rows
        set action = 'error', error_code = 'record_date_required'
        where id = staged.id;
        continue;
      end if;

      candidate_id := null;
      if row_patient is not null then
        select p.id into candidate_id
        from public.patients p
        where p.id = row_patient and p.org_id = batch.org_id;
      end if;

      if candidate_id is null then
        update public.import_rows
        set action = 'error', error_code = 'patient_not_found'
        where id = staged.id;
        continue;
      end if;

      if row_external is not null and exists (
        select 1 from public.consultations c
        where c.org_id = batch.org_id and c.external_ref = row_external
      ) then
        -- Already here. An imported record is immutable (0076), so there is
        -- nothing to update — re-sending the same file changes nothing.
        update public.import_rows
        set action = 'skip', error_code = 'already_imported'
        where id = staged.id;
        continue;
      end if;

      insert into public.consultations (
        org_id, patient_id, status, started_at, finalized_at,
        legacy_body, legacy_source, external_ref, import_batch_id, created_by
      ) values (
        batch.org_id,
        candidate_id,
        'finalized',
        row_moment,
        row_moment,
        row_body,
        coalesce(nullif(btrim(coalesce(staged.normalized ->> 'source', '')), ''), batch.source_system),
        row_external,
        target_batch,
        coalesce(batch.created_by, auth.uid())
      )
      returning id into candidate_id;

      created_count := created_count + 1;
      update public.import_rows
      set action = 'create', target_type = 'consultation', target_id = candidate_id,
          error_code = null, error_message = null
      where id = staged.id;

    else
      -- ---------- schedule ----------
      row_patient := case
        when coalesce(staged.normalized ->> 'patient_id', '') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (staged.normalized ->> 'patient_id')::uuid
      end;
      row_local := nullif(btrim(coalesce(staged.normalized ->> 'local_datetime', '')), '');

      if row_local is null or row_local !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
        update public.import_rows
        set action = 'error', error_code = 'record_date_required'
        where id = staged.id;
        continue;
      end if;

      -- The wall clock belongs to the practice, not to the server.
      row_moment := (replace(row_local, 'T', ' '))::timestamp
        at time zone coalesce(org_timezone, 'America/Sao_Paulo');

      -- A duration outside the column's own bounds falls back to the default;
      -- the engine already refuses these, so this is a fence, not a decision.
      row_duration := case
        when coalesce(staged.normalized ->> 'duration', '') ~ '^\d{1,4}$'
          and (staged.normalized ->> 'duration')::integer between 1 and 1440
        then (staged.normalized ->> 'duration')::integer
        else 50
      end;

      if row_moment <= now() then
        update public.import_rows
        set action = 'error', error_code = 'schedule_in_past'
        where id = staged.id;
        continue;
      end if;

      candidate_id := null;
      if row_patient is not null then
        select p.id into candidate_id
        from public.patients p
        where p.id = row_patient and p.org_id = batch.org_id and p.archived_at is null
        for share;
      end if;

      if candidate_id is null then
        -- Covers both "not this workspace's" and "archived": either way the
        -- appointment cannot be created, and the 0028 trigger would abort the
        -- whole import if we tried.
        update public.import_rows
        set action = 'error', error_code = 'patient_unavailable'
        where id = staged.id;
        continue;
      end if;

      if row_external is not null and exists (
        select 1 from public.consultations c
        where c.org_id = batch.org_id and c.external_ref = row_external
      ) then
        update public.import_rows
        set action = 'skip', error_code = 'already_imported'
        where id = staged.id;
        continue;
      end if;

      -- Rows already inserted by THIS batch are visible here, so two
      -- appointments importing into the same slot conflict with each other.
      if exists (
        select 1
        from public.consultations c
        where c.org_id = batch.org_id
          and c.status in ('scheduled', 'in_progress')
          and c.scheduled_for is not null
          and c.scheduled_for < row_moment + make_interval(mins => row_duration)
          and row_moment < c.scheduled_for + make_interval(mins => greatest(c.duration_minutes, 1))
      ) then
        update public.import_rows
        set action = 'error', error_code = 'schedule_conflict'
        where id = staged.id;
        continue;
      end if;

      insert into public.consultations (
        org_id, patient_id, status, started_at, scheduled_for, duration_minutes,
        appointment_note, external_ref, import_batch_id, created_by
      ) values (
        batch.org_id,
        candidate_id,
        'scheduled',
        row_moment,
        row_moment,
        row_duration,
        nullif(btrim(coalesce(staged.normalized ->> 'note', '')), ''),
        row_external,
        target_batch,
        coalesce(batch.created_by, auth.uid())
      )
      returning id into candidate_id;

      created_count := created_count + 1;
      update public.import_rows
      set action = 'create', target_type = 'consultation', target_id = candidate_id,
          error_code = null, error_message = null
      where id = staged.id;
    end if;
  end loop;

  select
    count(*) filter (where r.action = 'skip'),
    count(*) filter (where r.action = 'error')
  into skipped_count, failed_count
  from public.import_rows r
  where r.batch_id = target_batch;

  update public.import_batches
  set status = 'completed',
      completed_at = now(),
      counts = jsonb_build_object(
        'created', created_count,
        'updated', updated_count,
        'skipped', skipped_count,
        'failed', failed_count
      )
  where id = target_batch;

  return jsonb_build_object(
    'ok', true, 'code', 'completed',
    'created', created_count,
    'updated', updated_count,
    'skipped', skipped_count,
    'failed', failed_count
  );
end;
$$;

comment on function public.commit_import_batch(uuid) is
  'Writes an approved import in one transaction (0077; history 0080; schedule 0082; timezone fix 0083). Patients fill-only, history whole and frozen, appointments refused rather than double-booked — and every wall clock read in the practice''s own timezone.';

revoke all on function public.commit_import_batch(uuid) from public, anon;
grant execute on function public.commit_import_batch(uuid) to authenticated, service_role;
