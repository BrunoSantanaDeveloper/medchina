-- ============================================================
-- 0029_clinical_workflow_integrity
--
-- One authoritative consultation lifecycle, optimistic clinical revision,
-- transactional finalization, and version-correct patient consent.
-- Compatible with the scheduling/continuity RPCs introduced by 0028.
-- ============================================================

alter table public.consultations
  add column if not exists clinical_revision bigint not null default 0;

comment on column public.consultations.clinical_revision is
  'Monotonic revision of the editable clinical payload. Long-running AI work and finalization use it to reject stale decisions.';

-- ---------- Consultation lifecycle ----------

create or replace function public.guard_consultation_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  valid_transition boolean := false;
begin
  -- Cascading housekeeping must remain possible for account/patient erasure.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is distinct from old.status then
    valid_transition :=
      (old.status = 'scheduled' and new.status in ('in_progress', 'cancelled'))
      or (old.status = 'draft' and new.status in ('in_progress', 'awaiting_review', 'finalized', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('awaiting_review', 'finalized', 'cancelled'))
      or (old.status = 'awaiting_review' and new.status in ('in_progress', 'finalized', 'cancelled'))
      -- 0028 deliberately supports restoring a cancelled appointment. A
      -- cancelled clinical draft (no scheduled_for) remains terminal.
      or (old.status = 'cancelled' and new.status = 'scheduled' and old.scheduled_for is not null);

    if not valid_transition then
      raise exception 'invalid_consultation_transition'
        using errcode = 'check_violation',
              detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
    end if;
  end if;

  if old.status = 'cancelled' and new.status = 'cancelled' then
    if new.patient_id is distinct from old.patient_id
       or new.summary is distinct from old.summary
       or new.chief_complaint is distinct from old.chief_complaint
       or new.transcription_id is distinct from old.transcription_id
       or new.ai_gaps is distinct from old.ai_gaps then
      raise exception 'consultation_cancelled' using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'finalized' and old.status <> 'finalized' then
    if exists (
      select 1
      from public.recordings r
      where r.consultation_id = old.id
        and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing', 'failed')
    ) then
      raise exception 'recording_pending' using errcode = 'check_violation';
    end if;

    new.finalized_at := coalesce(new.finalized_at, now());
    new.finalized_by := coalesce(new.finalized_by, auth.uid());
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
  elsif old.status = 'cancelled' and new.status = 'scheduled' then
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
  end if;

  if new.patient_id is distinct from old.patient_id
     or new.summary is distinct from old.summary
     or new.chief_complaint is distinct from old.chief_complaint
     or new.transcription_id is distinct from old.transcription_id
     or new.ai_gaps is distinct from old.ai_gaps then
    new.clinical_revision := old.clinical_revision + 1;
  end if;

  return new;
end;
$$;

drop trigger if exists consultations_guard_lifecycle on public.consultations;
create trigger consultations_guard_lifecycle
  before update on public.consultations
  for each row execute function public.guard_consultation_lifecycle();

-- Lock the parent consultation before an answer mutation is allowed to
-- proceed. Without this lock an answer write can pass the finalized guard,
-- wait behind finalization, and then commit into an already-finalized chart.
-- UPDATE can move an answer between consultations, so lock both parents in a
-- stable order to avoid creating a second lock order in the clinical workflow.
create or replace function public.guard_finalized_answers()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_ids uuid[];
  target uuid;
begin
  -- Cascades / referential actions (FK triggers) run nested: never block them.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    parent_ids := array[new.consultation_id];
    target := new.consultation_id;
  elsif tg_op = 'DELETE' then
    parent_ids := array[old.consultation_id];
    target := old.consultation_id;
  else
    parent_ids := array[old.consultation_id, new.consultation_id];
    target := new.consultation_id;
  end if;

  perform c.id
  from public.consultations c
  where c.id = any(parent_ids)
  order by c.id
  for update;

  if not exists (
    select 1
    from public.consultations c
    where c.id = any(parent_ids)
      and c.status = 'finalized'
  ) then
    return coalesce(new, old);
  end if;

  -- Finalized: the clinical payload is frozen. Referential housekeeping on
  -- bookkeeping columns remains possible, matching the 0021 contract.
  if tg_op = 'UPDATE' then
    if new.value is distinct from old.value
       or new.state is distinct from old.state
       or new.source is distinct from old.source
       or new.provenance is distinct from old.provenance
       or new.block_key is distinct from old.block_key
       or new.field_key is distinct from old.field_key
       or new.consultation_id is distinct from old.consultation_id then
      raise exception 'consultation % is finalized: its anamnesis can no longer change', target
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  raise exception 'consultation % is finalized: its anamnesis can no longer change', target
    using errcode = 'check_violation';
end;
$$;

create or replace function public.touch_consultation_revision_from_answer()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target uuid := coalesce(new.consultation_id, old.consultation_id);
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.consultation_id is distinct from old.consultation_id then
    -- Moving an answer changes both clinical records: the destination gains
    -- content and the source loses it. Both optimistic revisions must become
    -- stale in the same transaction.
    update public.consultations
    set clinical_revision = clinical_revision + 1,
        updated_at = now()
    where id in (old.consultation_id, new.consultation_id);
  else
    update public.consultations
    set clinical_revision = clinical_revision + 1,
        updated_at = now()
    where id = target;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists anamnesis_answers_touch_consultation on public.anamnesis_answers;
create trigger anamnesis_answers_touch_consultation
  after insert or update or delete on public.anamnesis_answers
  for each row execute function public.touch_consultation_revision_from_answer();

create or replace function public.finalize_consultation(
  target_consultation uuid,
  expected_revision bigint default null,
  acknowledged_warnings text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.consultations%rowtype;
  warnings text[] := array[]::text[];
begin
  if expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'expectedRevision');
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
  if target_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', target_row.status);
  end if;
  if target_row.clinical_revision <> expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'clinical_revision_conflict',
      'revision', target_row.clinical_revision
    );
  end if;
  if exists (
    select 1 from public.recordings r
    where r.consultation_id = target_consultation
      and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing', 'failed')
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_pending');
  end if;

  if exists (
    select 1 from public.anamnesis_answers a
    where a.consultation_id = target_consultation and a.state = 'attention'
  ) then
    warnings := array_append(warnings, 'attention_fields');
  end if;
  if exists (
    select 1 from public.consultation_hypotheses h
    where h.consultation_id = target_consultation and h.status = 'draft'
  ) then
    warnings := array_append(warnings, 'draft_hypotheses');
  end if;
  if exists (
    select 1 from public.consultation_plans p
    where p.consultation_id = target_consultation and p.status = 'draft'
  ) then
    warnings := array_append(warnings, 'draft_plan');
  end if;
  if nullif(btrim(target_row.chief_complaint), '') is null
     and nullif(btrim(target_row.summary), '') is null
     and not exists (
       select 1 from public.anamnesis_answers a
       where a.consultation_id = target_consultation
     ) then
    warnings := array_append(warnings, 'empty_consultation');
  end if;

  if not warnings <@ coalesce(acknowledged_warnings, array[]::text[]) then
    return jsonb_build_object(
      'ok', false,
      'code', 'finalization_confirmation_required',
      'warnings', to_jsonb(warnings),
      'revision', target_row.clinical_revision
    );
  end if;

  update public.consultations
  set status = 'finalized',
      finalized_at = now(),
      finalized_by = auth.uid()
  where id = target_consultation;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_row.org_id,
    auth.uid(),
    'consultation.finalized',
    'consultation',
    target_consultation::text,
    jsonb_build_object('revision', target_row.clinical_revision, 'acknowledgedWarnings', to_jsonb(warnings))
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'finalized',
    'consultationId', target_consultation,
    'revision', target_row.clinical_revision,
    'warnings', to_jsonb(warnings)
  );
end;
$$;

revoke all on function public.finalize_consultation(uuid, bigint, text[]) from public;
grant execute on function public.finalize_consultation(uuid, bigint, text[]) to authenticated;

create or replace function public.start_manual_consultation(target_patient uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.patients%rowtype;
  existing_id uuid;
  created_id uuid;
begin
  select p.* into patient_row from public.patients p where p.id = target_patient for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(patient_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if patient_row.archived_at is not null then
    return jsonb_build_object('ok', false, 'code', 'patient_unavailable');
  end if;

  select c.id into existing_id
  from public.consultations c
  where c.org_id = patient_row.org_id
    and c.patient_id = patient_row.id
    and c.status in ('draft', 'in_progress', 'awaiting_review')
  order by c.updated_at desc
  limit 1
  for update;
  if found then
    return jsonb_build_object('ok', true, 'code', 'existing', 'consultationId', existing_id);
  end if;

  insert into public.consultations (org_id, patient_id, status, created_by)
  values (patient_row.org_id, patient_row.id, 'in_progress', auth.uid())
  returning id into created_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (patient_row.org_id, auth.uid(), 'consultation.started', 'consultation', created_id::text, '{"source":"manual"}'::jsonb);

  return jsonb_build_object('ok', true, 'code', 'created', 'consultationId', created_id);
exception
  when unique_violation then
    select c.id into existing_id
    from public.consultations c
    where c.org_id = patient_row.org_id
      and c.patient_id = patient_row.id
      and c.status in ('draft', 'in_progress', 'awaiting_review')
    order by c.updated_at desc
    limit 1;
    return jsonb_build_object('ok', true, 'code', 'existing', 'consultationId', existing_id);
end;
$$;

revoke all on function public.start_manual_consultation(uuid) from public;
grant execute on function public.start_manual_consultation(uuid) to authenticated;

-- ---------- Version-correct consent ----------

-- If an earlier deployment left more than one version active, the greatest
-- version is the only defensible current term. Historical rows remain intact.
with ranked as (
  select id, row_number() over (partition by slug order by version desc, created_at desc) as position
  from public.consent_terms
  where is_active
)
update public.consent_terms t
set is_active = false
from ranked r
where t.id = r.id and r.position > 1;

create unique index if not exists consent_terms_one_active_slug_idx
  on public.consent_terms (slug)
  where is_active;

-- Preserve every acceptance while making the newest duplicate the current
-- one for the exact term. Older duplicates become explicitly revoked.
with ranked as (
  select
    id,
    row_number() over (
      partition by term_id, org_id, subject_type, subject_id
      order by accepted_at desc, id desc
    ) as position
  from public.consent_acceptances
  where revoked_at is null
)
update public.consent_acceptances a
set revoked_at = now()
from ranked r
where a.id = r.id and r.position > 1;

create unique index if not exists consent_acceptances_one_current_term_idx
  on public.consent_acceptances (term_id, org_id, subject_type, subject_id)
  where revoked_at is null;

create or replace function public.active_consent_acceptance(
  target_org uuid,
  target_patient uuid,
  term_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  acceptance_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;

  select a.id into acceptance_id
  from public.consent_acceptances a
  join public.consent_terms t on t.id = a.term_id
  join public.patients p
    on p.id = target_patient
   and p.org_id = target_org
  where a.org_id = target_org
    and a.subject_type = 'patient'
    and a.subject_id = target_patient::text
    and a.revoked_at is null
    and t.slug = term_slug
    and t.is_active
  order by t.version desc, a.accepted_at desc
  limit 1;

  return acceptance_id;
end;
$$;

create or replace function public.has_active_consent(
  target_org uuid,
  target_patient uuid,
  term_slug text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.active_consent_acceptance(target_org, target_patient, term_slug) is not null;
$$;

create or replace function public.guard_consent_acceptance_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.term_id is distinct from old.term_id
     or new.org_id is distinct from old.org_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.recorded_by is distinct from old.recorded_by
     or new.metadata is distinct from old.metadata
     or new.accepted_at is distinct from old.accepted_at
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.revoked_at is null and new.revoked_at is null) then
    raise exception 'consent_history_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists consent_acceptances_history_guard on public.consent_acceptances;
create trigger consent_acceptances_history_guard
  before update on public.consent_acceptances
  for each row execute function public.guard_consent_acceptance_history();

create or replace function public.set_patient_consent(
  target_patient uuid,
  target_slug text,
  target_granted boolean,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.patients%rowtype;
  term_row public.consent_terms%rowtype;
  acceptance_row public.consent_acceptances%rowtype;
begin
  select p.* into patient_row
  from public.patients p
  where p.id = target_patient
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(patient_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select t.* into term_row
  from public.consent_terms t
  where t.slug = target_slug and t.is_active
  order by t.version desc
  limit 1
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'consent_term_missing');
  end if;

  if target_granted then
    select a.* into acceptance_row
    from public.consent_acceptances a
    where a.term_id = term_row.id
      and a.org_id = patient_row.org_id
      and a.subject_type = 'patient'
      and a.subject_id = target_patient::text
      and a.revoked_at is null
    limit 1
    for update;

    if not found then
      insert into public.consent_acceptances (
        term_id, org_id, subject_type, subject_id, recorded_by, metadata
      ) values (
        term_row.id,
        patient_row.org_id,
        'patient',
        target_patient::text,
        auth.uid(),
        coalesce(target_metadata, '{}'::jsonb)
      )
      returning * into acceptance_row;
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'granted',
      'active', true,
      'acceptanceId', acceptance_row.id,
      'termId', term_row.id,
      'version', term_row.version,
      'acceptedAt', acceptance_row.accepted_at
    );
  end if;

  update public.consent_acceptances a
  set revoked_at = now()
  from public.consent_terms t
  where a.term_id = t.id
    and a.org_id = patient_row.org_id
    and a.subject_type = 'patient'
    and a.subject_id = target_patient::text
    and a.revoked_at is null
    and t.slug = target_slug;

  return jsonb_build_object('ok', true, 'code', 'revoked', 'active', false, 'version', term_row.version);
end;
$$;

create or replace function public.guard_recording_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_acceptance uuid;
begin
  current_acceptance := public.active_consent_acceptance(new.org_id, new.patient_id, 'audio-recording');
  if current_acceptance is null then
    raise exception 'consent_required' using errcode = 'check_violation';
  end if;
  if new.consent_acceptance_id is not null and new.consent_acceptance_id <> current_acceptance then
    raise exception 'consent_acceptance_mismatch' using errcode = 'check_violation';
  end if;
  new.consent_acceptance_id := current_acceptance;
  return new;
end;
$$;

revoke all on function public.active_consent_acceptance(uuid, uuid, text) from public;
revoke all on function public.set_patient_consent(uuid, text, boolean, jsonb) from public;
grant execute on function public.active_consent_acceptance(uuid, uuid, text) to authenticated;
grant execute on function public.has_active_consent(uuid, uuid, text) to authenticated;
grant execute on function public.set_patient_consent(uuid, text, boolean, jsonb) to authenticated;

-- ---------- One context snapshot for the consultation surface ----------

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
    'transcriptionId', r.transcription_id
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

revoke all on function public.get_consultation_context(uuid) from public;
grant execute on function public.get_consultation_context(uuid) to authenticated;

-- The original MVP policy granted every table mutation to members. Keep
-- reads and the two editable clinical header fields, while lifecycle changes
-- and creation now pass through the atomic RPCs above/0028.
drop policy if exists "consultations_all_member" on public.consultations;
drop policy if exists "consultations_select_member" on public.consultations;
drop policy if exists "consultations_update_clinical_member" on public.consultations;
create policy "consultations_select_member" on public.consultations
  for select to authenticated
  using (public.is_org_member(org_id));
create policy "consultations_update_clinical_member" on public.consultations
  for update to authenticated
  using (public.is_org_member(org_id) and status in ('draft', 'in_progress', 'awaiting_review'))
  with check (public.is_org_member(org_id) and status in ('draft', 'in_progress', 'awaiting_review'));

revoke insert, update, delete on table public.consultations from authenticated;
grant select on table public.consultations to authenticated;
grant update (chief_complaint, summary) on table public.consultations to authenticated;
