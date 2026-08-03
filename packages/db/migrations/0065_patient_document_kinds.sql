-- ============================================================
-- 0065_patient_document_kinds
--
-- Two more documents a real practice hands out (PRD §9.8):
--
--   * `home-guidance` — the patient's half of a VALIDATED plan, in her
--     language (no points, no meridians, no disharmony pattern);
--   * `attendance-certificate` — the note she takes to work or school, which
--     certifies attendance and its hours and NOTHING clinical.
--
-- Both go through the existing issuance pipeline (versioning, sha256, verify
-- code, revoke-on-reissue), but `reserve_document_version` (0031) had two
-- hard-coded assumptions that refuse them:
--
--   1. `source_type = 'consultation_plan'` demanded `kind = 'therapeutic-plan'`
--      — so a second kind derived from the same validated plan was rejected as
--      `invalid_request`;
--   2. any OTHER source_type fell through with NO validation at all: no check
--      that the source belongs to the org, and no check that the subject is
--      its patient. Adding `source_type = 'consultation'` without closing that
--      would let a caller issue a document naming any patient it liked.
--
-- This rewrites the function to accept both kinds and to validate the new
-- source explicitly. Everything else — the advisory lock, the idempotency
-- contract, the staleness fence, the version chain — is preserved verbatim.
-- ============================================================

create or replace function public.reserve_document_version(
  target_org uuid,
  target_kind text,
  target_title text,
  target_payload jsonb,
  target_source_type text,
  target_source_id uuid,
  target_subject_type text,
  target_subject_id text,
  target_idempotency_key uuid,
  target_verify_code text,
  target_issued_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_row public.documents%rowtype;
  prior_row public.documents%rowtype;
  created_row public.documents%rowtype;
  source_plan public.consultation_plans%rowtype;
  source_consultation public.consultations%rowtype;
  source_consultation_id uuid;
  reserved_source_snapshot jsonb;
  next_version integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_source_type is null or target_source_id is null or target_idempotency_key is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and target_issued_by is distinct from auth.uid()
     and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  -- All reserve/publish operations for one source share this lock. Take it
  -- before row locks so a retry cannot deadlock publication.
  perform pg_advisory_xact_lock(hashtextextended(target_org::text || ':' || target_source_id::text, 0));

  select d.* into existing_row
  from public.documents d
  where d.org_id = target_org and d.idempotency_key = target_idempotency_key
  limit 1
  for update;

  if found then
    if existing_row.kind is distinct from target_kind
       or existing_row.source_type is distinct from target_source_type
       or existing_row.source_id is distinct from target_source_id
       or existing_row.subject_type is distinct from target_subject_type
       or existing_row.subject_id is distinct from target_subject_id
       or existing_row.issued_by is distinct from target_issued_by then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    if existing_row.status = 'issued' then
      return jsonb_build_object(
        'ok', true,
        'code', 'existing',
        'documentId', existing_row.id,
        'verifyCode', existing_row.verify_code,
        'version', existing_row.version,
        'sourceSnapshot', existing_row.source_snapshot,
        'status', existing_row.status
      );
    elsif existing_row.status <> 'draft' then
      return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
    end if;
  end if;

  if target_source_type = 'consultation_plan' then
    -- Both kinds derive from the SAME validated plan and share every guarantee
    -- below (validated, not stale, subject is its patient).
    if target_kind not in ('therapeutic-plan', 'home-guidance') then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;

    -- Discover the parent without locking the child, then lock and re-read in
    -- the same consultation -> plan order used by the plan RPCs.
    select p.consultation_id into source_consultation_id
    from public.consultation_plans p
    where p.id = target_source_id and p.org_id = target_org;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select c.* into source_consultation
    from public.consultations c
    where c.id = source_consultation_id and c.org_id = target_org
    for update;

    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select p.* into source_plan
    from public.consultation_plans p
    where p.id = target_source_id
      and p.org_id = target_org
      and p.consultation_id = source_consultation_id
    for update;

    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;
    if source_plan.status <> 'validated' or source_plan.validated_at is null then
      return jsonb_build_object('ok', false, 'code', 'plan_not_validated');
    end if;
    if target_subject_type is distinct from 'patient'
       or target_subject_id is distinct from source_consultation.patient_id::text then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    if source_plan.stale_at is not null
       or source_plan.input_revision <> source_consultation.clinical_revision then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;

    reserved_source_snapshot := jsonb_build_object(
      'planId', source_plan.id,
      'consultationId', source_plan.consultation_id,
      'inputRevision', source_plan.input_revision,
      'objective', source_plan.objective,
      'modalities', source_plan.modalities,
      'safetyFlags', source_plan.safety_flags,
      'basisHypotheses', source_plan.basis_hypotheses,
      'sources', source_plan.sources,
      'origin', source_plan.origin,
      'model', source_plan.model,
      'promptVersion', source_plan.prompt_version,
      'validatedBy', source_plan.validated_by,
      'validatedAt', source_plan.validated_at
    );

    if existing_row.id is not null then
      if existing_row.source_revision is distinct from source_plan.input_revision
         or existing_row.source_updated_at is distinct from source_plan.updated_at
         or existing_row.source_validated_at is distinct from source_plan.validated_at
         or existing_row.source_snapshot is distinct from reserved_source_snapshot then
        return jsonb_build_object('ok', false, 'code', 'plan_stale');
      end if;
      return jsonb_build_object(
        'ok', true,
        'code', 'existing',
        'documentId', existing_row.id,
        'verifyCode', existing_row.verify_code,
        'version', existing_row.version,
        'sourceSnapshot', existing_row.source_snapshot,
        'status', existing_row.status
      );
    end if;

  elsif target_source_type = 'consultation' then
    -- The attendance certificate attests to a period that HAS AN END, so the
    -- consultation must be finalized. Validated here, not only in the route:
    -- the route is one caller, this is the boundary.
    if target_kind is distinct from 'attendance-certificate' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;

    select c.* into source_consultation
    from public.consultations c
    where c.id = target_source_id and c.org_id = target_org
    for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    if source_consultation.status <> 'finalized' or source_consultation.started_at is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition');
    end if;
    -- The document names a person: it must be the consultation's own patient.
    if target_subject_type is distinct from 'patient'
       or target_subject_id is distinct from source_consultation.patient_id::text then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;

    reserved_source_snapshot := jsonb_build_object(
      'consultationId', source_consultation.id,
      'startedAt', source_consultation.started_at,
      'finalizedAt', source_consultation.finalized_at,
      'durationMinutes', source_consultation.duration_minutes
    );

    if existing_row.id is not null then
      return jsonb_build_object(
        'ok', true,
        'code', 'existing',
        'documentId', existing_row.id,
        'verifyCode', existing_row.verify_code,
        'version', existing_row.version,
        'sourceSnapshot', existing_row.source_snapshot,
        'status', existing_row.status
      );
    end if;

  else
    -- Unknown source type. 0031 let these through to the insert with NO
    -- validation at all — no org check on the source, no check that the
    -- subject is its patient — which meant any caller reaching this function
    -- could mint a document naming any patient. There are exactly two
    -- sources in this product; anything else is a bug or an attempt.
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select d.* into prior_row
  from public.documents d
  where d.org_id = target_org
    and d.kind = target_kind
    and d.source_type = target_source_type
    and d.source_id = target_source_id
  order by d.version desc
  limit 1
  for update;

  next_version := coalesce(prior_row.version, 0) + 1;

  insert into public.documents (
    org_id,
    kind,
    title,
    payload,
    version,
    parent_id,
    status,
    verify_code,
    issued_by,
    source_type,
    source_id,
    subject_type,
    subject_id,
    idempotency_key,
    source_revision,
    source_updated_at,
    source_validated_at,
    source_snapshot
  ) values (
    target_org,
    target_kind,
    target_title,
    coalesce(target_payload, '{}'::jsonb),
    next_version,
    prior_row.id,
    'draft',
    target_verify_code,
    target_issued_by,
    target_source_type,
    target_source_id,
    target_subject_type,
    target_subject_id,
    target_idempotency_key,
    case when target_source_type = 'consultation_plan' then source_plan.input_revision else null end,
    case when target_source_type = 'consultation_plan' then source_plan.updated_at else null end,
    case when target_source_type = 'consultation_plan' then source_plan.validated_at else null end,
    reserved_source_snapshot
  )
  returning * into created_row;

  return jsonb_build_object(
    'ok', true,
    'code', 'reserved',
    'documentId', created_row.id,
    'verifyCode', created_row.verify_code,
    'version', created_row.version,
    'parentId', created_row.parent_id,
    'sourceSnapshot', created_row.source_snapshot,
    'status', created_row.status
  );
exception
  when unique_violation then
    select d.* into existing_row
    from public.documents d
    where d.org_id = target_org and d.idempotency_key = target_idempotency_key
    limit 1;
    if found then
      if existing_row.kind is distinct from target_kind
         or existing_row.source_type is distinct from target_source_type
         or existing_row.source_id is distinct from target_source_id
         or existing_row.subject_type is distinct from target_subject_type
         or existing_row.subject_id is distinct from target_subject_id
         or existing_row.issued_by is distinct from target_issued_by then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'ok', true,
        'code', 'existing',
        'documentId', existing_row.id,
        'verifyCode', existing_row.verify_code,
        'version', existing_row.version,
        'sourceSnapshot', existing_row.source_snapshot,
        'status', existing_row.status
      );
    end if;
    raise;
end;
$$;

-- Same privilege posture as 0039: worker RPCs stay off the API roles.
revoke all on function public.reserve_document_version(uuid, text, text, jsonb, text, uuid, text, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_document_version(uuid, text, text, jsonb, text, uuid, text, text, uuid, text, uuid)
  to service_role;
