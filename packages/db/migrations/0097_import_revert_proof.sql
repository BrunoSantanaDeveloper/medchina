-- ============================================================
-- 0097_import_revert_proof: what an undo is allowed to take back.
--
-- `revert_import_batch` (0076) deletes what an import created, and refuses —
-- never cascades — once any of it has become part of the practice. Its proof
-- was wrong in both directions, found by walking a real incident (a practice
-- that imported its ATTENDANCES through the patients door) and then by an
-- adversarial review of the first version of this very migration.
--
--  1. IT PROVED TOO LITTLE, AND COULD DELETE REAL CLINICAL WORK.
--     An agenda import inserts consultations `scheduled` with the batch stamp,
--     which is immutable. When the professional attends that appointment, the
--     row keeps the stamp while gaining an anamnesis, audio, hypotheses, a
--     plan — and `anamnesis_answers`, `consultation_hypotheses` and
--     `consultation_plans` are ON DELETE CASCADE. The proof named three child
--     tables. Thirteen tables point at `consultations` and nine at `patients`;
--     the first draft of this migration named nine and three, and the review
--     found the five it had still missed (capture sessions, AI feedback, gap
--     dismissals, QR consent sessions, mobile capture authorizations). A list
--     that someone has to remember to extend is exactly how this bug happened
--     twice, so the proof now ASKS THE CATALOG: any row, in any table, holding
--     a foreign key to something this batch created means something happened
--     to it. The import itself creates no such row, so an untouched batch
--     still reverts. The three blockers the UI already names keep their keys;
--     everything else is counted under one catch-all.
--
--     A row can also be worked on without gaining a child: an imported
--     appointment she RESCHEDULED, or moved to a real patient, is still
--     `scheduled` and has no children — the first draft deleted it from that
--     patient's agenda. So each imported record is compared with what the
--     import WROTE, using the INSERT snapshot `record_versions` keeps (0005;
--     `consultations` is row-versioned since 0020).
--
--  2. IT PROVED TOO MUCH, AND PUNISHED THE OBVIOUS CLEANUP.
--     An archived chart blocked the whole batch — and archiving is the first
--     thing anyone does when an import goes wrong, one patient at a time. The
--     check was `updated_at > created_at`, which archiving bumps. It is now
--     the same snapshot comparison, ignoring the columns of the gestures that
--     MEAN "this should not be here": archiving, requesting deletion (the
--     first draft forgot those three columns, and the deletion request is the
--     strongest version of the gesture) and, for an appointment, cancelling it.
--     A cancelled appointment was never started — the cancel RPC requires
--     `scheduled` — so nothing clinical can be lost with it.
--
-- Columns added to a table AFTER a row's INSERT are not compared: they are
-- absent from the snapshot, and a backfill would otherwise read as her edit
-- and silently freeze every open undo. The residual — an edit to a brand-new
-- column on an imported row inside the 30-day window — is narrow and accepted.
--
-- Not changed, on purpose: the undo stays ALL-OR-NOTHING. A per-row revert is
-- a bigger decision than a bug fix.
-- ============================================================

create or replace function public.revert_import_batch(target_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  batch public.import_batches%rowtype;
  window_days integer;
  blocked jsonb;
  batch_patients uuid[];
  batch_records uuid[];
  children_sql text;
  in_use integer;
  removed_consultations integer := 0;
  removed_patients integer := 0;
begin
  select b.* into batch from public.import_batches b where b.id = target_batch for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(batch.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if batch.status = 'reverted' then
    return jsonb_build_object('ok', true, 'code', 'already_reverted');
  end if;
  if batch.status <> 'completed' then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'status', batch.status);
  end if;

  window_days := coalesce(
    (select nullif(value ->> 'revert_days', '')::integer from public.platform_settings where key = 'imports'),
    30
  );
  if coalesce(batch.completed_at, batch.created_at) < now() - make_interval(days => window_days) then
    return jsonb_build_object(
      'ok', false, 'code', 'revert_window_closed', 'windowDays', window_days
    );
  end if;

  select coalesce(array_agg(p.id), '{}') into batch_patients
  from public.patients p where p.import_batch_id = target_batch;
  select coalesce(array_agg(c.id), '{}') into batch_records
  from public.consultations c where c.import_batch_id = target_batch;

  -- ---------- The charts this batch created ----------

  select jsonb_strip_nulls(jsonb_build_object(
    'editedPatients', nullif(count(*) filter (
      where case
        when exists (
          select 1 from public.record_versions v
          where v.table_name = 'patients' and v.record_id = p.id and v.operation = 'INSERT'
        )
        then exists (
          select 1
          from public.record_versions v
          join lateral jsonb_each_text(to_jsonb(p)) current_field(key, value) on true
          where v.table_name = 'patients'
            and v.record_id = p.id
            and v.operation = 'INSERT'
            and v.data ? current_field.key
            and current_field.key not in (
              'updated_at',
              'archived_at', 'archived_by',
              'deletion_requested_at', 'deletion_requested_by', 'deletion_request_reason'
            )
            and current_field.value is distinct from (v.data ->> current_field.key)
        )
        -- No snapshot (versioning was off when the row was written): fall back
        -- to the timestamp. Coarse — it misses an edit made in the same
        -- transaction as the insert, which the import flow never does — and it
        -- errs toward refusing.
        else p.updated_at > p.created_at
      end
    ), 0),
    'patientsSeen', nullif(count(*) filter (
      where exists (
        select 1 from public.consultations c
        where c.patient_id = p.id
          and c.import_batch_id is distinct from target_batch
      )
    ), 0),
    -- Not a foreign key (the subject is polymorphic text), so it stays named.
    'patientsWithConsent', nullif(count(*) filter (
      where exists (
        select 1 from public.consent_acceptances a
        where a.org_id = p.org_id and a.subject_type = 'patient' and a.subject_id = p.id::text
      )
    ), 0),
    'patientsWithDocuments', nullif(count(*) filter (
      where exists (select 1 from public.documents d where d.patient_id = p.id)
    ), 0),
    'patientsInConversations', nullif(count(*) filter (
      where exists (select 1 from public.conversations v where v.patient_id = p.id)
    ), 0)
  ))
  into blocked
  from public.patients p
  where p.import_batch_id = target_batch;

  blocked := coalesce(blocked, '{}'::jsonb);

  -- Everything else that points at those charts, found in the catalog so the
  -- next table to reference a patient is covered the day it is created.
  -- `consultations`, `documents` and `conversations` are answered above.
  if cardinality(batch_patients) > 0 then
    select string_agg(
      format('select t.%I as id from %I.%I t where t.%I = any($1)', a.attname, n.nspname, k.relname, a.attname),
      ' union all '
    )
    into children_sql
    from pg_constraint fk
    join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = fk.conkey[1]
    join pg_class k on k.oid = fk.conrelid
    join pg_namespace n on n.oid = k.relnamespace
    where fk.contype = 'f'
      and fk.confrelid = 'public.patients'::regclass
      and cardinality(fk.conkey) = 1
      and not (n.nspname = 'public' and k.relname in ('consultations', 'documents', 'conversations'));

    if children_sql is not null then
      execute format('select count(distinct w.id) from (%s) w', children_sql)
      into in_use
      using batch_patients;
      if in_use > 0 then
        blocked := blocked || jsonb_build_object('patientsInUse', in_use);
      end if;
    end if;
  end if;

  -- ---------- The records this batch created ----------

  select blocked || jsonb_strip_nulls(jsonb_build_object(
    'recordsWithAddenda', nullif(count(*) filter (
      where exists (
        select 1 from public.consultation_addenda a where a.consultation_id = c.id
      )
    ), 0),
    'recordsWithAttachments', nullif(count(*) filter (
      where exists (
        select 1 from public.consultation_attachments t
        where t.consultation_id = c.id and t.deleted_at is null
      )
    ), 0),
    'recordsWithDocuments', nullif(count(*) filter (
      where exists (select 1 from public.documents d where d.consultation_id = c.id)
    ), 0),
    -- Rescheduled, moved to another patient, started, attended, finalized:
    -- anything that makes the row differ from what the import wrote. A
    -- cancellation does not count — see the header.
    'recordsChanged', nullif(count(*) filter (
      where case
        when exists (
          select 1 from public.record_versions v
          where v.table_name = 'consultations' and v.record_id = c.id and v.operation = 'INSERT'
        )
        then exists (
          select 1
          from public.record_versions v
          join lateral jsonb_each_text(to_jsonb(c)) current_field(key, value) on true
          where v.table_name = 'consultations'
            and v.record_id = c.id
            and v.operation = 'INSERT'
            and v.data ? current_field.key
            and current_field.key not in (
              'updated_at',
              'cancelled_at', 'cancelled_by', 'cancellation_reason', 'cancellation_category'
            )
            and not (current_field.key = 'status' and c.status = 'cancelled')
            and current_field.value is distinct from (v.data ->> current_field.key)
        )
        else c.updated_at > c.created_at
      end
    ), 0)
  ))
  into blocked
  from public.consultations c
  where c.import_batch_id = target_batch;

  -- Anamnesis, audio, reasoning, plan, prescription, capture sessions, AI
  -- feedback, dismissed gaps — and whatever references a consultation next.
  if cardinality(batch_records) > 0 then
    select string_agg(
      format('select t.%I as id from %I.%I t where t.%I = any($1)', a.attname, n.nspname, k.relname, a.attname),
      ' union all '
    )
    into children_sql
    from pg_constraint fk
    join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = fk.conkey[1]
    join pg_class k on k.oid = fk.conrelid
    join pg_namespace n on n.oid = k.relnamespace
    where fk.contype = 'f'
      and fk.confrelid = 'public.consultations'::regclass
      and cardinality(fk.conkey) = 1
      and not (
        n.nspname = 'public'
        and k.relname in ('consultation_addenda', 'consultation_attachments', 'documents')
      );

    if children_sql is not null then
      execute format('select count(distinct w.id) from (%s) w', children_sql)
      into in_use
      using batch_records;
      if in_use > 0 then
        blocked := blocked || jsonb_build_object('recordsWithClinicalWork', in_use);
      end if;
    end if;
  end if;

  if blocked <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'batch_in_use', 'blocked', blocked);
  end if;

  delete from public.consultations where import_batch_id = target_batch;
  get diagnostics removed_consultations = row_count;

  delete from public.patients where import_batch_id = target_batch;
  get diagnostics removed_patients = row_count;

  update public.import_batches
  set status = 'reverted',
      reverted_at = now(),
      reverted_by = auth.uid(),
      counts = counts || jsonb_build_object(
        'revertedPatients', removed_patients,
        'revertedConsultations', removed_consultations
      )
  where id = target_batch;

  -- import_rows keep their target_id on purpose: which line produced which
  -- row is the record of what the undo removed.
  return jsonb_build_object(
    'ok', true, 'code', 'reverted',
    'patients', removed_patients,
    'consultations', removed_consultations
  );
end;
$$;

comment on function public.revert_import_batch(uuid) is
  'Undo an import batch, refusing (never cascading) once anything it created has become part of the practice: edited, rescheduled or attended, or referenced by any row in any table. Archiving, requesting deletion and cancelling do not block.';

revoke all on function public.revert_import_batch(uuid) from public, anon;
grant execute on function public.revert_import_batch(uuid) to authenticated;
