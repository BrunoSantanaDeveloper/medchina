-- ============================================================
-- 0076_data_import: bringing a practice's records in from another system.
--
-- Plan and rationale: docs/IMPORT-EXPORT.md (PRD §9.10). This is Fase A —
-- the schema, its guards and the ability to UNDO an import. The parser, the
-- commit RPC and the wizard land on top of it.
--
-- What the schema has to make impossible, not merely discouraged:
--
--  * Imported content is NEVER anamnesis. A record written in another system
--    has no per-field provenance (no audio segment, no timestamp, no
--    verifiable authorship), so filling `anamnesis_answers` from it would
--    state as the patient's data something inferred from a third party's
--    text — exactly what 0020 exists to prevent. Legacy history therefore
--    lands in its OWN column on the consultation, whole, labelled and frozen,
--    and `summary` is left alone because that is where SHE writes.
--
--  * Imported rows are recognizable forever. `import_batch_id` is stamped at
--    insert and cannot be changed afterwards: a row whose origin we cannot
--    vouch for must never come to look like one she typed and checked.
--
--  * Re-sending the same spreadsheet updates instead of duplicating —
--    `external_ref` (the old system's id) is unique per workspace.
--
--  * Undo refuses instead of cascading. `revert_import_batch` deletes only
--    what the batch created AND only while nothing has happened to it since;
--    anything else and it returns the reason, naming what blocks it. A
--    permissive undo would delete a patient along with the real consultation
--    recorded after the import. Note `documents.patient_id` is ON DELETE
--    RESTRICT (0037), so a sloppy revert would not even fail cleanly — it
--    would fail as a foreign-key error in the middle of a multi-table delete.
--
--  * Support cannot import. `patients` is on the impersonation write fence
--    (0057) because creating a third party's record is never support work;
--    the staging tables join it, or the fence would be walked around by
--    committing a batch. Assisted migration is a service-role path with its
--    own authorization, never an operator acting as her.
--
-- Importing is free on every plan (it is what removes the cost of leaving
-- another system, not a premium feature). The only limit is rows per batch,
-- and it is a plan row, never a constant — see org_import_allowance below.
-- ============================================================

-- ---------- The original file ----------

-- Private: a practice's spreadsheet is clinical data in plain text. The app
-- deletes the object once the undo window closes (purge_import_staging).
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

drop policy if exists "imports_select_member" on storage.objects;
create policy "imports_select_member" on storage.objects
  for select to authenticated
  using (bucket_id = 'imports' and public.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "imports_insert_member" on storage.objects;
create policy "imports_insert_member" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imports' and public.is_org_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "imports_delete_member" on storage.objects;
create policy "imports_delete_member" on storage.objects
  for delete to authenticated
  using (bucket_id = 'imports' and public.is_org_member(((storage.foldername(name))[1])::uuid));

-- ---------- The batch: one import, one unit of undo ----------

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('patients', 'history', 'schedule')),
  -- What she declared she is leaving. Free text on purpose: aggregated, this
  -- is the only honest signal about which systems deserve a dedicated parser.
  source_system text,
  status text not null default 'parsing'
    check (status in ('parsing', 'preview', 'importing', 'completed', 'failed', 'reverted')),
  file_name text,
  -- <org_id>/<batch_id>/<file> in the private 'imports' bucket.
  file_path text,
  file_checksum text,
  -- Spreadsheet column -> field of this system, as SHE confirmed it.
  mapping jsonb not null default '{}'::jsonb,
  -- {created, updated, skipped, failed} — filled at commit.
  counts jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reverted_at timestamptz,
  reverted_by uuid references public.profiles (id) on delete set null,
  -- When the staged rows and the source file were dropped (retention).
  purged_at timestamptz
);

create index if not exists import_batches_org_idx
  on public.import_batches (org_id, created_at desc);

comment on table public.import_batches is
  'One import from another system (0076): its file, its column mapping, its outcome and its undo. Never deleted — it is the provenance of every row it created.';

-- ---------- Staged rows: what preview approved is what commit writes ----------

-- Preview and commit read the SAME parsed rows. Re-parsing the file at commit
-- time would approve one result and execute another.
create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  row_number integer not null,
  -- The line as it came out of the file.
  raw jsonb not null default '{}'::jsonb,
  -- After mapping, validation and normalization (digits, never masks).
  normalized jsonb not null default '{}'::jsonb,
  action text not null default 'create'
    check (action in ('create', 'update', 'skip', 'error')),
  target_type text check (target_type in ('patient', 'consultation')),
  target_id uuid,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index if not exists import_rows_batch_idx
  on public.import_rows (batch_id, row_number);

comment on table public.import_rows is
  'Parsed staging for one import batch (0076). Holds personal data verbatim, so it is purged with the source file once the undo window closes.';

-- ---------- Provenance on the rows an import creates ----------

alter table public.patients
  add column if not exists external_ref text,
  add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null;

-- Idempotency: the old system's id, unique per workspace. Re-sending the same
-- spreadsheet updates the same people instead of duplicating them.
create unique index if not exists patients_org_external_ref_key
  on public.patients (org_id, external_ref)
  where external_ref is not null;

create index if not exists patients_import_batch_idx
  on public.patients (import_batch_id)
  where import_batch_id is not null;

comment on column public.patients.external_ref is
  'Identifier of this patient in the system she migrated from — the idempotency key of an import.';
comment on column public.patients.import_batch_id is
  'Set when the row was created by an import (0076). Stamped at insert and immutable: an imported row must stay recognizable as one.';

alter table public.consultations
  add column if not exists external_ref text,
  add column if not exists import_batch_id uuid references public.import_batches (id) on delete set null,
  add column if not exists legacy_body text,
  add column if not exists legacy_source text;

create unique index if not exists consultations_org_external_ref_key
  on public.consultations (org_id, external_ref)
  where external_ref is not null;

create index if not exists consultations_import_batch_idx
  on public.consultations (import_batch_id)
  where import_batch_id is not null;

-- Legacy text may exist only on an imported consultation. Without this the
-- column would eventually be used as a second free-text field and the line
-- between "she wrote this" and "another system did" would blur.
alter table public.consultations
  drop constraint if exists consultations_legacy_requires_import;
alter table public.consultations
  add constraint consultations_legacy_requires_import
  check (
    (legacy_body is null and legacy_source is null)
    or import_batch_id is not null
  );

comment on column public.consultations.legacy_body is
  'The record as it existed in the previous system, whole and unparsed (0076). NEVER split into anamnesis_answers: a legacy record has no per-field provenance, so it can be read but not asserted as structured clinical data.';
comment on column public.consultations.legacy_source is
  'Name of the system this record came from, shown as the origin label.';

-- ---------- The provenance stamp is immutable ----------

-- Relabelling an existing row would let a hand-typed patient be swept away by
-- the undo of an unrelated batch, and would let imported content pass as
-- reviewed. Both guards let nested writes through (pg_trigger_depth() > 1) for
-- the reason 0021 documents: referential actions are the database maintaining
-- its own integrity, never a professional editing a record.

create or replace function public.guard_patient_import_provenance()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.import_batch_id is distinct from old.import_batch_id then
    raise exception 'import_provenance_immutable: a patient cannot be relabelled as imported (or un-imported) after creation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists patients_guard_import_provenance on public.patients;
create trigger patients_guard_import_provenance
  before update on public.patients
  for each row execute function public.guard_patient_import_provenance();

create or replace function public.guard_consultation_import_provenance()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.import_batch_id is distinct from old.import_batch_id then
    raise exception 'import_provenance_immutable: a consultation cannot be relabelled as imported (or un-imported) after creation'
      using errcode = '42501';
  end if;
  -- A record from another system is not ours to rewrite. Corrections to it
  -- follow the same rule as any finalized consultation: an addendum.
  if new.legacy_body is distinct from old.legacy_body
     or new.legacy_source is distinct from old.legacy_source then
    raise exception 'import_provenance_immutable: an imported record cannot be edited — append an addendum instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists consultations_guard_import_provenance on public.consultations;
create trigger consultations_guard_import_provenance
  before update on public.consultations
  for each row execute function public.guard_consultation_import_provenance();

-- ---------- Batch lifecycle ----------

-- Terminal states are terminal. A completed batch that could go back to
-- 'parsing' would accept new staged rows under a mapping already approved.
create or replace function public.guard_import_batch_status()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.org_id is distinct from old.org_id or new.kind is distinct from old.kind then
    raise exception 'import_batch_immutable: a batch cannot change workspace or kind'
      using errcode = '42501';
  end if;
  if old.status in ('completed', 'failed') and new.status not in ('completed', 'failed', 'reverted') then
    raise exception 'import_batch_closed: a finished import cannot be reopened'
      using errcode = '42501';
  end if;
  if old.status = 'reverted' and new.status <> 'reverted' then
    raise exception 'import_batch_closed: a reverted import cannot be reopened'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists import_batches_guard_status on public.import_batches;
create trigger import_batches_guard_status
  before update on public.import_batches
  for each row execute function public.guard_import_batch_status();

-- Staged rows belong to a batch still being prepared. Once it is committed
-- they are the evidence of what was written, not a working area.
create or replace function public.guard_import_rows_writable()
returns trigger
language plpgsql
as $$
declare
  batch_status text;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  select b.status into batch_status
  from public.import_batches b
  where b.id = coalesce(new.batch_id, old.batch_id);
  if batch_status in ('completed', 'failed', 'reverted') then
    raise exception 'import_batch_closed: the rows of a finished import can no longer change'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists import_rows_guard_writable on public.import_rows;
create trigger import_rows_guard_writable
  before insert or update or delete on public.import_rows
  for each row execute function public.guard_import_rows_writable();

-- ---------- RLS ----------

alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

revoke all on table public.import_batches from public, anon;
revoke all on table public.import_rows from public, anon;
grant select, insert, update on table public.import_batches to authenticated;
grant select, insert, update, delete on table public.import_rows to authenticated;
-- Supabase's default privileges grant ALL on new public tables to
-- authenticated, so the grants above ADD to a full set instead of defining
-- it: without this revoke a batch would be deletable. It must not be — a
-- batch is the provenance of every row it created, and it is reverted, never
-- erased.
revoke delete, truncate on table public.import_batches from authenticated;

drop policy if exists import_batches_select_member on public.import_batches;
create policy import_batches_select_member
  on public.import_batches for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

drop policy if exists import_batches_insert_member on public.import_batches;
create policy import_batches_insert_member
  on public.import_batches for insert to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists import_batches_update_member on public.import_batches;
create policy import_batches_update_member
  on public.import_batches for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists import_rows_select_member on public.import_rows;
create policy import_rows_select_member
  on public.import_rows for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

drop policy if exists import_rows_write_member on public.import_rows;
create policy import_rows_write_member
  on public.import_rows for insert to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists import_rows_update_member on public.import_rows;
create policy import_rows_update_member
  on public.import_rows for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists import_rows_delete_member on public.import_rows;
create policy import_rows_delete_member
  on public.import_rows for delete to authenticated
  using (public.is_org_member(org_id));

-- ---------- Immutable row versioning (0005) ----------

-- The batch is the provenance of clinical rows: how it moved matters later.
-- The staging table is deliberately NOT versioned — it is bulk personal data
-- with a short life, and versioning it would outlive the purge.
select public.enable_row_versioning('public.import_batches');

-- ---------- Impersonation write fence (0057) ----------

-- Committing a batch creates patients, which support may never do. Fencing
-- only `patients` would leave the staging tables as a way around it.
do $$
declare
  guarded text;
begin
  foreach guarded in array array['import_batches', 'import_rows']
  loop
    execute format(
      'drop trigger if exists guard_impersonation_%1$s on public.%1$I',
      guarded
    );
    execute format(
      'create trigger guard_impersonation_%1$s
         after insert or update or delete on public.%1$I
         for each statement execute function public.guard_impersonation_readonly()',
      guarded
    );
  end loop;
end;
$$;

-- ---------- Configuration ----------

insert into public.platform_settings (key, value)
values ('imports', '{"revert_days": 30, "retention_days": 30}'::jsonb)
on conflict (key) do nothing;

-- The free plan gets a ceiling per batch; paid plans carry no key, and no key
-- means unlimited. A launch hypothesis like every other limit — a row, not a
-- constant.
update public.plans
set limits = limits || '{"import_rows": 200}'::jsonb
where slug = 'gratuito';

-- ---------- May this workspace import, and how much per batch? ----------

-- Deliberately NOT tied to payment state. A failed card, an exhausted cycle
-- or an expired trial stop AI work, not data entry — importing is how she
-- stops paying the cost of the system she is leaving. Administrative
-- suspension is the one thing that stops it, because that is the kill switch.
create or replace function public.org_import_allowance(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  max_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if sub.id is not null and sub.admin_suspended then
    return jsonb_build_object(
      'allowed', false, 'unlimited', false, 'maxRows', 0, 'reason', 'suspended'
    );
  end if;

  if sub.plan_id is not null then
    select * into plan from public.plans where id = sub.plan_id;
  end if;
  -- A workspace with no live subscription is on the free tier, and the free
  -- tier still imports.
  if plan.id is null then
    select * into plan from public.plans where is_free and is_active order by sort limit 1;
  end if;

  max_rows := nullif(plan.limits ->> 'import_rows', '')::integer;
  if max_rows is null then
    return jsonb_build_object(
      'allowed', true, 'unlimited', true, 'maxRows', null, 'reason', 'ok'
    );
  end if;

  return jsonb_build_object(
    'allowed', true, 'unlimited', false, 'maxRows', max_rows, 'reason', 'ok'
  );
end;
$$;

comment on function public.org_import_allowance(uuid) is
  'Single answer to "may this workspace import, and how many rows per batch?" (0076). Free on every plan; only administrative suspension refuses. The ceiling comes from plans.limits.import_rows — absent means unlimited.';

-- ---------- Undo ----------

-- Deletes ONLY what the batch created, and only while nothing has happened to
-- it since. Every other case returns the reason with counts, so the UI can say
-- what is holding the undo instead of failing halfway through.
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

  -- What the batch created, and what happened to it afterwards. A patient
  -- edited by hand, seen in a real consultation, who signed a consent, holds
  -- an issued document or was discussed with the AI is no longer "just an
  -- import" — she is part of the practice.
  select jsonb_strip_nulls(jsonb_build_object(
    'editedPatients', nullif(count(*) filter (
      where p.updated_at > p.created_at or p.archived_at is not null
    ), 0),
    'patientsSeen', nullif(count(*) filter (
      where exists (
        select 1 from public.consultations c
        where c.patient_id = p.id
          and c.import_batch_id is distinct from target_batch
      )
    ), 0),
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

  -- Imported consultations must also be untouched. They are inserted
  -- finalized, so the only thing that can be added to one is an addendum —
  -- and an addendum is her clinical writing, which an undo may not take.
  select coalesce(blocked, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
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
    ), 0)
  ))
  into blocked
  from public.consultations c
  where c.import_batch_id = target_batch;

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
  'Undo one import (0076): deletes only what the batch created, only while untouched, and otherwise refuses naming what blocks it.';

-- ---------- Retention of the staged personal data ----------

-- The spreadsheet and its parsed rows are personal data kept for one purpose:
-- being able to undo. Past the window they go. Storage objects are removed by
-- the caller, so their paths are returned.
create or replace function public.purge_import_staging(older_than_days integer default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  keep_days integer;
  cutoff timestamptz;
  paths text[];
  purged_batches integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  keep_days := coalesce(
    older_than_days,
    (select nullif(value ->> 'retention_days', '')::integer from public.platform_settings where key = 'imports'),
    30
  );
  cutoff := now() - make_interval(days => keep_days);

  select coalesce(array_agg(b.file_path) filter (where b.file_path is not null), '{}')
  into paths
  from public.import_batches b
  where b.purged_at is null
    and b.status in ('completed', 'failed', 'reverted')
    and coalesce(b.completed_at, b.reverted_at, b.created_at) < cutoff;

  update public.import_rows r
  set raw = '{}'::jsonb, normalized = '{}'::jsonb
  from public.import_batches b
  where r.batch_id = b.id
    and b.purged_at is null
    and b.status in ('completed', 'failed', 'reverted')
    and coalesce(b.completed_at, b.reverted_at, b.created_at) < cutoff;

  update public.import_batches b
  set purged_at = now(), file_path = null
  where b.purged_at is null
    and b.status in ('completed', 'failed', 'reverted')
    and coalesce(b.completed_at, b.reverted_at, b.created_at) < cutoff;
  get diagnostics purged_batches = row_count;

  return jsonb_build_object(
    'ok', true, 'batches', purged_batches, 'paths', to_jsonb(paths)
  );
end;
$$;

comment on function public.purge_import_staging(integer) is
  'Drops the staged rows and reports the source files to delete once the undo window has closed (0076). Service role only — it runs from the nightly job.';

-- ---------- Grants ----------

-- Same trap as the table grants: `from public` alone leaves the roles
-- Supabase grants EXECUTE to by default. Retention purging is the nightly
-- job's, so it has to be taken away from the session roles explicitly.
revoke all on function public.org_import_allowance(uuid) from public, anon;
revoke all on function public.revert_import_batch(uuid) from public, anon;
revoke all on function public.purge_import_staging(integer) from public, anon, authenticated;

grant execute on function public.org_import_allowance(uuid) to authenticated, service_role;
grant execute on function public.revert_import_batch(uuid) to authenticated;
grant execute on function public.purge_import_staging(integer) to service_role;
