-- Preserve the core clinical meaning of an unanswered field: no row exists.
-- Older pre-launch writes may have persisted whitespace, so remove those
-- semantically empty rows before making the invariant enforceable.

delete from public.anamnesis_answers
where nullif(btrim(value), '') is null;

alter table public.anamnesis_answers
  add constraint anamnesis_answers_value_nonempty_check
  check (nullif(btrim(value), '') is not null)
  not valid;

alter table public.anamnesis_answers
  validate constraint anamnesis_answers_value_nonempty_check;

-- Issued clinical documents must be directly addressable from every source
-- entity. Generic source/subject fields remain useful for the document
-- package, while these foreign keys make patient/consultation/plan timelines
-- and retention rules enforceable by PostgreSQL.
alter table public.documents
  add column if not exists patient_id uuid references public.patients (id) on delete restrict,
  add column if not exists consultation_id uuid references public.consultations (id) on delete restrict,
  add column if not exists plan_id uuid references public.consultation_plans (id) on delete restrict;

comment on column public.documents.patient_id is
  'Retention fence: an issued clinical document must be revoked, never cascade-deleted with its patient.';
comment on column public.documents.consultation_id is
  'Retention fence linking the immutable document to its consultation.';
comment on column public.documents.plan_id is
  'Retention fence linking the immutable document to its validated source plan.';

update public.documents d
set patient_id = c.patient_id,
    consultation_id = p.consultation_id,
    plan_id = p.id
from public.consultation_plans p
join public.consultations c on c.id = p.consultation_id and c.org_id = p.org_id
where d.org_id = p.org_id
  and d.source_type = 'consultation_plan'
  and d.source_id = p.id
  and (
    d.patient_id is distinct from c.patient_id
    or d.consultation_id is distinct from p.consultation_id
    or d.plan_id is distinct from p.id
  );

create or replace function public.bind_document_clinical_links()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_consultation uuid;
  source_patient uuid;
begin
  if new.source_type is distinct from 'consultation_plan' then
    return new;
  end if;

  select p.consultation_id, c.patient_id
  into source_consultation, source_patient
  from public.consultation_plans p
  join public.consultations c on c.id = p.consultation_id and c.org_id = p.org_id
  where p.id = new.source_id and p.org_id = new.org_id;

  if not found then
    raise exception 'plan_not_found' using errcode = 'foreign_key_violation';
  end if;
  if (new.plan_id is not null and new.plan_id is distinct from new.source_id)
     or (new.consultation_id is not null and new.consultation_id is distinct from source_consultation)
     or (new.patient_id is not null and new.patient_id is distinct from source_patient) then
    raise exception 'document_source_link_mismatch' using errcode = 'check_violation';
  end if;

  new.plan_id := new.source_id;
  new.consultation_id := source_consultation;
  new.patient_id := source_patient;
  return new;
end;
$$;

drop trigger if exists documents_bind_clinical_links on public.documents;
create trigger documents_bind_clinical_links
  before insert or update of source_type, source_id, plan_id, consultation_id, patient_id
  on public.documents
  for each row execute function public.bind_document_clinical_links();

alter table public.documents
  add constraint documents_consultation_plan_links_check
  check (
    source_type is distinct from 'consultation_plan'
    or (
      source_id is not null
      and plan_id is not null
      and plan_id = source_id
      and consultation_id is not null
      and patient_id is not null
    )
  )
  not valid;

alter table public.documents
  validate constraint documents_consultation_plan_links_check;

create index if not exists documents_patient_timeline_idx
  on public.documents (org_id, patient_id, created_at desc)
  where patient_id is not null;

create index if not exists documents_consultation_timeline_idx
  on public.documents (org_id, consultation_id, created_at desc)
  where consultation_id is not null;

-- A document is rendered and uploaded outside PostgreSQL, so reservation
-- alone cannot choose which retry may publish. Fence that external work with
-- a short-lived claim; the caller also uses a claim-specific object path so a
-- stale renderer cannot overwrite the winning bytes. The five-minute lease is
-- deliberately longer than the 120-second server route budget; an abandoned
-- claim remains recoverable.
alter table public.documents
  add column if not exists issue_claim_token uuid,
  add column if not exists issue_lease_expires_at timestamptz,
  add column if not exists issue_attempts integer not null default 0;

alter table public.documents
  add constraint documents_issue_claim_pair_check
  check (
    (issue_claim_token is null and issue_lease_expires_at is null)
    or (issue_claim_token is not null and issue_lease_expires_at is not null)
  )
  not valid;

alter table public.documents
  validate constraint documents_issue_claim_pair_check;

alter table public.documents
  add constraint documents_issue_attempts_nonnegative_check
  check (issue_attempts >= 0)
  not valid;

alter table public.documents
  validate constraint documents_issue_attempts_nonnegative_check;

comment on column public.documents.issue_claim_token is
  'Fencing token held by the only renderer allowed to publish this document draft.';
comment on column public.documents.issue_lease_expires_at is
  'Recovery deadline for an abandoned document-rendering claim.';
comment on column public.documents.issue_attempts is
  'Number of rendering claims acquired for this immutable document version.';

create or replace function public.claim_document_issue(
  target_document uuid,
  target_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.documents%rowtype;
  document_org uuid;
  document_source uuid;
  lease_deadline timestamptz;
begin
  if target_document is null or target_claim_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Match reserve/publish lock ordering: source advisory lock, then row lock.
  select d.org_id, d.source_id
  into document_org, document_source
  from public.documents d
  where d.id = target_document;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if document_source is null then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(document_org::text || ':' || document_source::text, 0));

  select d.* into document_row
  from public.documents d
  where d.id = target_document
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_org_role(document_row.org_id, array['owner', 'admin']::public.org_role[]) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if document_row.status = 'issued' then
    return jsonb_build_object(
      'ok', true,
      'code', 'issued',
      'status', 'issued',
      'documentId', document_row.id
    );
  end if;
  if document_row.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  if document_row.issue_claim_token = target_claim_token
     and document_row.issue_lease_expires_at > clock_timestamp() then
    return jsonb_build_object(
      'ok', true,
      'code', 'claimed',
      'status', 'draft',
      'documentId', document_row.id,
      'claimToken', document_row.issue_claim_token,
      'leaseExpiresAt', document_row.issue_lease_expires_at,
      'attempts', document_row.issue_attempts
    );
  end if;

  if document_row.issue_claim_token is not null
     and document_row.issue_lease_expires_at > clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  lease_deadline := clock_timestamp() + interval '5 minutes';
  update public.documents
  set issue_claim_token = target_claim_token,
      issue_lease_expires_at = lease_deadline,
      issue_attempts = issue_attempts + 1
  where id = document_row.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'status', 'draft',
    'documentId', document_row.id,
    'claimToken', target_claim_token,
    'leaseExpiresAt', lease_deadline,
    'attempts', document_row.issue_attempts + 1
  );
end;
$$;

create or replace function public.release_document_issue(
  target_document uuid,
  target_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.documents%rowtype;
begin
  if target_document is null or target_claim_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select d.* into document_row
  from public.documents d
  where d.id = target_document
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_org_role(document_row.org_id, array['owner', 'admin']::public.org_role[]) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if document_row.status = 'issued' then
    return jsonb_build_object('ok', true, 'code', 'issued', 'status', 'issued');
  end if;
  if document_row.status <> 'draft'
     or document_row.issue_claim_token is distinct from target_claim_token then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  update public.documents
  set issue_claim_token = null,
      issue_lease_expires_at = null
  where id = document_row.id
    and issue_claim_token = target_claim_token;

  return jsonb_build_object('ok', true, 'code', 'released', 'status', 'draft');
end;
$$;

-- Preserve the source-snapshot revalidation implemented by 0031 as an
-- owner-only helper. The public RPC now requires the claim token and checks
-- its live lease before delegating to that exact implementation.
alter function public.publish_document_version(uuid, text, text)
  rename to publish_document_version_unfenced;

revoke all on function public.publish_document_version_unfenced(uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.publish_document_version(
  target_document uuid,
  target_claim_token uuid,
  target_content_hash text,
  target_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.documents%rowtype;
  document_org uuid;
  document_source uuid;
  publish_result jsonb;
begin
  if target_document is null or target_claim_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select d.org_id, d.source_id
  into document_org, document_source
  from public.documents d
  where d.id = target_document;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if document_source is null then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(document_org::text || ':' || document_source::text, 0));

  select d.* into document_row
  from public.documents d
  where d.id = target_document
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if document_row.status <> 'draft'
     or document_row.issue_claim_token is distinct from target_claim_token
     or document_row.issue_lease_expires_at is null
     or document_row.issue_lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  publish_result := public.publish_document_version_unfenced(
    target_document,
    target_content_hash,
    target_storage_path
  );

  if coalesce((publish_result ->> 'ok')::boolean, false) then
    update public.documents
    set issue_claim_token = null,
        issue_lease_expires_at = null
    where id = target_document
      and issue_claim_token = target_claim_token;
  end if;

  return publish_result;
end;
$$;

revoke all on function public.claim_document_issue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_document_issue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.publish_document_version(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_document_issue(uuid, uuid) to service_role;
grant execute on function public.release_document_issue(uuid, uuid) to service_role;
grant execute on function public.publish_document_version(uuid, uuid, text, text) to service_role;

-- ---------- Successful clinical apply and usage ledger are one commit ----------
-- 0030 prepared the clinical merge correctly, but the application wrote the
-- usage ledger in a separate request. A transient failure could therefore
-- leave a ready recording without consumption (or consume a recording whose
-- clinical apply later failed). Keep the proven merge as an owner-only helper
-- and make the public worker RPC append usage in the same transaction.
alter function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb)
  rename to apply_recording_result_without_usage;

revoke all on function public.apply_recording_result_without_usage(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.apply_recording_result(
  target_recording uuid,
  target_transcription uuid,
  target_claim_id uuid,
  target_answers jsonb,
  target_gaps jsonb,
  target_billable_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  apply_result jsonb;
begin
  if target_billable_seconds is null or target_billable_seconds <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  apply_result := public.apply_recording_result_without_usage(
    target_recording,
    target_transcription,
    target_claim_id,
    target_answers,
    target_gaps
  );

  if not coalesce((apply_result ->> 'ok')::boolean, false) then
    return apply_result;
  end if;

  insert into public.audio_usage (
    org_id,
    recording_id,
    transcription_id,
    seconds,
    kind,
    created_by
  )
  select
    r.org_id,
    r.id,
    target_transcription,
    target_billable_seconds,
    'transcription',
    r.created_by
  from public.recordings r
  where r.id = target_recording
  on conflict do nothing;

  if not exists (
    select 1
    from public.audio_usage u
    where u.recording_id = target_recording
      and u.kind = 'transcription'
  ) then
    raise exception 'usage_record_failed' using errcode = 'check_violation';
  end if;

  return apply_result || jsonb_build_object('billableSeconds', target_billable_seconds);
end;
$$;

revoke all on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer)
  to service_role;

-- ---------- Billing cancellation fencing ----------
-- The provider call is external, but the local subscription mutation and
-- operation completion must be one fenced commit. An expired worker can no
-- longer update the subscription after another retry has acquired the claim.
create or replace function public.commit_billing_subscription_change(
  target_operation uuid,
  target_claim_token uuid,
  target_subscription uuid,
  target_kind text,
  target_current_period_end timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
  subscription_row public.subscriptions%rowtype;
  result_payload jsonb;
begin
  if auth.role() is distinct from 'service_role'
     or target_operation is null
     or target_claim_token is null
     or target_subscription is null
     or target_kind not in ('cancel', 'resume') then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select o.* into operation_row
  from public.billing_operations o
  where o.id = target_operation
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if operation_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'completed', 'result', operation_row.result);
  end if;
  if operation_row.status <> 'processing'
     or operation_row.claim_token is distinct from target_claim_token
     or operation_row.lease_expires_at is null
     or operation_row.lease_expires_at <= clock_timestamp()
     or operation_row.subscription_id is distinct from target_subscription
     or operation_row.kind is distinct from target_kind then
    return jsonb_build_object('ok', false, 'code', 'operation_claim_lost');
  end if;

  select s.* into subscription_row
  from public.subscriptions s
  where s.id = target_subscription
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if subscription_row.org_id is distinct from operation_row.org_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if target_kind = 'cancel' then
    if target_current_period_end is null or target_current_period_end <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;
    update public.subscriptions
    set cancel_at_period_end = true,
        cancellation_requested_at = coalesce(cancellation_requested_at, now()),
        current_period_end = target_current_period_end,
        updated_at = now()
    where id = target_subscription;
    result_payload := jsonb_build_object('currentPeriodEnd', target_current_period_end);
  else
    if subscription_row.current_period_end is not null
       and subscription_row.current_period_end <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;
    update public.subscriptions
    set cancel_at_period_end = false,
        cancellation_requested_at = null,
        updated_at = now()
    where id = target_subscription;
    result_payload := '{}'::jsonb;
  end if;

  update public.billing_operations
  set status = 'completed',
      result = result_payload,
      error_code = null,
      completed_at = now(),
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = target_operation
    and claim_token = target_claim_token;

  return jsonb_build_object('ok', true, 'code', 'completed', 'result', result_payload);
end;
$$;

revoke all on function public.commit_billing_subscription_change(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.commit_billing_subscription_change(uuid, uuid, uuid, text, timestamptz)
  to service_role;

-- ---------- Optimistic manual consultation saves ----------
-- Browser tab leases improve local ergonomics, but the database revision is
-- the cross-device authority. Every manual field write locks the consultation,
-- compares the expected revision and returns the revision produced by the
-- existing clinical triggers.
create or replace function public.save_consultation_answer(
  target_consultation uuid,
  expected_revision bigint,
  target_block_key text,
  target_field_key text,
  target_value text,
  target_source text default 'professional',
  target_state text default 'clear'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  next_revision bigint;
begin
  if target_consultation is null
     or expected_revision is null
     or nullif(btrim(target_block_key), '') is null
     or nullif(btrim(target_field_key), '') is null
     or target_source not in ('professional', 'professional_voice')
     or target_state not in ('clear', 'edited') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition');
  end if;
  if consultation_row.clinical_revision is distinct from expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'revision_conflict',
      'revision', consultation_row.clinical_revision
    );
  end if;

  if nullif(btrim(coalesce(target_value, '')), '') is null then
    delete from public.anamnesis_answers
    where consultation_id = target_consultation
      and block_key = btrim(target_block_key)
      and field_key = btrim(target_field_key);
  else
    insert into public.anamnesis_answers (
      org_id,
      consultation_id,
      block_key,
      field_key,
      value,
      source,
      state,
      created_by
    ) values (
      consultation_row.org_id,
      target_consultation,
      btrim(target_block_key),
      btrim(target_field_key),
      btrim(target_value),
      target_source::public.answer_source,
      target_state::public.answer_state,
      auth.uid()
    )
    on conflict (consultation_id, block_key, field_key) do update
    set value = excluded.value,
        source = excluded.source,
        state = excluded.state,
        provenance = '{}'::jsonb,
        updated_at = now();
  end if;

  select c.clinical_revision into next_revision
  from public.consultations c
  where c.id = target_consultation;

  return jsonb_build_object('ok', true, 'code', 'saved', 'revision', next_revision);
end;
$$;

create or replace function public.save_consultation_header(
  target_consultation uuid,
  expected_revision bigint,
  target_field text,
  target_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  next_revision bigint;
begin
  if target_consultation is null
     or expected_revision is null
     or target_field not in ('chief_complaint', 'summary') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition');
  end if;
  if consultation_row.clinical_revision is distinct from expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'revision_conflict',
      'revision', consultation_row.clinical_revision
    );
  end if;

  if target_field = 'chief_complaint' then
    update public.consultations
    set chief_complaint = nullif(btrim(coalesce(target_value, '')), '')
    where id = target_consultation;
  else
    update public.consultations
    set summary = nullif(btrim(coalesce(target_value, '')), '')
    where id = target_consultation;
  end if;

  select c.clinical_revision into next_revision
  from public.consultations c
  where c.id = target_consultation;

  return jsonb_build_object('ok', true, 'code', 'saved', 'revision', next_revision);
end;
$$;

revoke all on function public.save_consultation_answer(uuid, bigint, text, text, text, text, text)
  from public, anon;
revoke all on function public.save_consultation_header(uuid, bigint, text, text)
  from public, anon;
grant execute on function public.save_consultation_answer(uuid, bigint, text, text, text, text, text)
  to authenticated;
grant execute on function public.save_consultation_header(uuid, bigint, text, text)
  to authenticated;
