-- ============================================================
-- 0077_import_commit: writing a prepared patient import, atomically.
--
-- Fase B of docs/IMPORT-EXPORT.md. 0076 gave the batch, the staged rows and
-- the undo; this is the step that turns approved rows into patients.
--
-- It is a database function because the guarantee is transactional: a partly
-- committed import is worse than a refused one — half a practice imported,
-- with no way to tell which half. One statement, one commit, or nothing.
--
-- Two rules are enforced here and NOT left to the caller, because they are
-- the ones a spreadsheet silently breaks:
--
--  * An empty cell is not an answer (PRD §10.5). A blank column never writes
--    an empty string and never clears a field that already has a value.
--
--  * An update FILLS, it never overwrites. Re-sending last month's export
--    would otherwise revert every correction she typed since — silently, on
--    hundreds of rows. So a value already in the chart always wins over the
--    spreadsheet, and an "update" means filling the gaps a fuller export can
--    close. It also makes re-importing the same file harmless, which is what
--    makes `external_ref` idempotency worth having.
--
-- The row ceiling is checked HERE rather than at staging: staging is cheap and
-- reversible, and refusing a 5.000-row file only at the end would be cruel —
-- but the app's pre-check is a courtesy, and this is the gate.
--
-- Only `kind = 'patients'` commits for now. History and schedule reuse the
-- same batch/undo machinery and get their own writer.
-- ============================================================

-- What the engine could NOT bring in from a line it otherwise accepted (an
-- unreadable phone, a CPF whose check digit fails). Kept per row because
-- "which 12 phone numbers were dropped?" is a question she asks after the
-- import, not during it.
alter table public.import_rows
  add column if not exists warnings jsonb not null default '[]'::jsonb;

comment on column public.import_rows.warnings is
  'Per-row issues the import chose to flag rather than fail on (0077). Codes only — the message is rendered in her language by the app.';

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
  if batch.kind <> 'patients' then
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

  update public.import_batches set status = 'importing' where id = target_batch;

  for staged in
    select r.*
    from public.import_rows r
    where r.batch_id = target_batch and r.action in ('create', 'update')
    order by r.row_number
    for update
  loop
    row_name := nullif(btrim(staged.normalized ->> 'full_name'), '');
    row_external := nullif(btrim(coalesce(staged.normalized ->> 'external_ref', '')), '');

    -- A person with no name is not a patient record. The engine already
    -- refuses these; this is the fence, not the message.
    if row_name is null then
      -- The code is the contract; the sentence she reads is rendered by the
      -- app in her language, so nothing user-facing is stored here.
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
  'Writes an approved patient import in one transaction (0077). An empty cell never clears a field and an update only fills gaps — the chart always wins over the spreadsheet, so re-importing the same file is harmless.';

revoke all on function public.commit_import_batch(uuid) from public, anon;
grant execute on function public.commit_import_batch(uuid) to authenticated, service_role;
