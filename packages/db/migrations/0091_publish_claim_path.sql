-- ============================================================
-- 0091_publish_claim_path
--
-- Document publication has NEVER succeeded in production: every attempt — plan,
-- guidance, attendance declaration, prescription — returned
-- `invalid_document_artifact` and left the row a draft.
--
-- Root cause: two halves of the issuance path disagree about the artifact's
-- storage path. 0037 introduced claim-scoped uploads in @flyee/documents —
-- the renderer writes `<org>/<doc>-v<version>-<claim_token>.pdf` so a zombie
-- invocation holding a dead lease can never overwrite the winner's bytes.
-- But `publish_document_version_unfenced` (created by 0031, renamed by 0037)
-- kept validating the PRE-claim path `<org>/<doc>-v<version>.pdf`, so the
-- claim-scoped path the package actually uploads is rejected before any other
-- check runs.
--
-- Fix: validate against the claim-scoped path. The claim token is still set on
-- the row when this helper runs — the fenced wrapper (0037) verifies the live
-- lease BEFORE delegating here and clears the token only AFTER success — so the
-- expected path is fully determined by the row itself and the check stays as
-- strict as before (a caller cannot name an arbitrary object).
--
-- The rest of the function is recreated verbatim from 0031: issued-replay
-- branch, newer-version fence, consultation_plan staleness recheck, storage
-- existence check, revoke-olders + flip to issued.
-- ============================================================

create or replace function public.publish_document_version_unfenced(
  target_document uuid,
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
  source_plan public.consultation_plans%rowtype;
  source_consultation public.consultations%rowtype;
  source_consultation_id uuid;
  document_org uuid;
  document_source uuid;
  current_source_snapshot jsonb;
  expected_storage_path text;
begin
  -- Read only enough to acquire the source-wide advisory lock. Re-read the
  -- document under a row lock afterwards.
  select d.org_id, d.source_id into document_org, document_source
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

  -- The artifact lives at the CLAIM-scoped path (@flyee/documents since 0037):
  -- `<org>/<doc>-v<version>-<claim_token>.pdf`. For an already-issued row the
  -- token is gone — the stored path is the authority and the replay branch
  -- below compares hash+path anyway. A draft with no live claim has no path a
  -- renderer could legitimately have written.
  if document_row.status = 'issued' then
    expected_storage_path := document_row.storage_path;
  elsif document_row.issue_claim_token is not null then
    expected_storage_path := format(
      '%s/%s-v%s-%s.pdf',
      document_row.org_id,
      document_row.id,
      document_row.version,
      document_row.issue_claim_token
    );
  else
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  if target_content_hash is null
     or target_content_hash !~ '^[0-9a-f]{64}$'
     or target_storage_path is distinct from expected_storage_path then
    return jsonb_build_object('ok', false, 'code', 'invalid_document_artifact');
  end if;

  if document_row.status = 'issued' then
    if document_row.content_hash is distinct from target_content_hash
       or document_row.storage_path is distinct from target_storage_path then
      return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'issued',
      'documentId', document_row.id,
      'version', document_row.version,
      'verifyCode', document_row.verify_code
    );
  end if;
  if document_row.status <> 'draft' or document_row.source_id is null then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  if exists (
    select 1 from public.documents newer
    where newer.org_id = document_row.org_id
      and newer.kind = document_row.kind
      and newer.source_type = document_row.source_type
      and newer.source_id = document_row.source_id
      and newer.version > document_row.version
  ) then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  if document_row.source_type = 'consultation_plan' then
    select p.consultation_id into source_consultation_id
    from public.consultation_plans p
    where p.id = document_row.source_id
      and p.org_id = document_row.org_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select c.* into source_consultation
    from public.consultations c
    where c.id = source_consultation_id
      and c.org_id = document_row.org_id
    for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select p.* into source_plan
    from public.consultation_plans p
    where p.id = document_row.source_id
      and p.org_id = document_row.org_id
      and p.consultation_id = source_consultation_id
    for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    current_source_snapshot := jsonb_build_object(
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

    if source_plan.status <> 'validated'
       or source_plan.validated_at is null
       or source_plan.stale_at is not null
       or source_plan.input_revision <> source_consultation.clinical_revision
       or document_row.subject_type is distinct from 'patient'
       or document_row.subject_id is distinct from source_consultation.patient_id::text
       or document_row.source_revision is distinct from source_plan.input_revision
       or document_row.source_updated_at is distinct from source_plan.updated_at
       or document_row.source_validated_at is distinct from source_plan.validated_at
       or document_row.source_snapshot is distinct from current_source_snapshot then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'documents'
      and o.name = target_storage_path
  ) then
    return jsonb_build_object('ok', false, 'code', 'document_storage_missing');
  end if;

  update public.documents
  set status = 'revoked'
  where org_id = document_row.org_id
    and kind = document_row.kind
    and source_type = document_row.source_type
    and source_id = document_row.source_id
    and id <> document_row.id
    and version < document_row.version
    and status = 'issued';

  update public.documents
  set status = 'issued',
      content_hash = target_content_hash,
      storage_path = target_storage_path,
      issued_at = now()
  where id = document_row.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'issued',
    'documentId', document_row.id,
    'version', document_row.version,
    'verifyCode', document_row.verify_code
  );
end;
$$;

-- create or replace preserves ACLs, but pin the intended surface explicitly:
-- the unfenced helper is owner-only — every caller goes through the fenced
-- public.publish_document_version(uuid, uuid, text, text) wrapper from 0037.
revoke all on function public.publish_document_version_unfenced(uuid, text, text)
  from public, anon, authenticated, service_role;
