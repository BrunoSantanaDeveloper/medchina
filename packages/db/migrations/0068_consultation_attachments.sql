-- ============================================================
-- 0068_consultation_attachments
--
-- Attach documents and photos to a consultation (PRD §9.6 attachments): exam
-- PDFs/lab results and clinical photos (tongue, a lesion, the affected area).
-- Two capture paths share ONE data model and ONE upload mechanism:
--   * desktop — the professional uploads from the browser;
--   * phone via the SAME QR capture session (0053/0058) — no login, no app.
--
-- Consent posture: a PHOTO of the patient is gated on the `clinical-images`
-- consent (0022), pinned to the acceptance valid at capture time. A DOCUMENT
-- (a PDF the professional attaches) is a clinical record like typed exam data
-- and does not need the image consent.
--
-- Fase A is storage + review only — the AI does not read attachments yet. The
-- schema already carries what a later AI pass needs (kind, mime, provenance).
--
-- Upload uses a signed upload URL minted by the service role (like the QR
-- audio), so BOTH the authenticated desktop and the anonymous phone upload
-- straight to storage without a bucket RLS policy — the reserve/confirm RPCs
-- are the authorization boundary.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('clinical-attachments', 'clinical-attachments', false)
on conflict (id) do nothing;

create table if not exists public.consultation_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,

  -- 'image' = a clinical photo (gated on clinical-images consent);
  -- 'document' = a PDF/exam result attached as a record.
  kind text not null check (kind in ('image', 'document')),
  -- pending → ready (upload confirmed) → failed. Only 'ready' rows are shown.
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  mime text not null,
  storage_path text,
  size_bytes bigint,
  checksum_sha256 text,
  caption text,
  source text not null default 'web' check (source in ('web', 'qr')),

  -- The clinical-images acceptance that authorized a photo (null for documents).
  consent_acceptance_id uuid references public.consent_acceptances (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete: an attachment is revoked, never hard-deleted, so the record
  -- stays auditable (the storage object IS removed by the caller on delete).
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null
);

create index if not exists consultation_attachments_consultation_idx
  on public.consultation_attachments (consultation_id)
  where deleted_at is null;

alter table public.consultation_attachments enable row level security;
revoke all on table public.consultation_attachments from public;
grant select on table public.consultation_attachments to authenticated;

drop policy if exists consultation_attachments_select_member on public.consultation_attachments;
create policy consultation_attachments_select_member
  on public.consultation_attachments for select
  using (public.is_org_member(org_id) and deleted_at is null);

comment on table public.consultation_attachments is
  'Documents and photos attached to a consultation (0068). Images are gated on clinical-images consent; upload is confirmed via RPC after the object lands in the clinical-attachments bucket.';

-- ---------- Shared verification ----------

-- The object exists at the exact reserved path and, when a size was declared,
-- matches it — so a confirmed attachment is a real, complete upload.
create or replace function public.attachment_object_ok(
  target_org uuid,
  target_consultation uuid,
  target_attachment uuid,
  target_path text,
  target_size bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  expected_prefix text := target_org::text || '/' || target_consultation::text || '/' || target_attachment::text || '.';
  stored_size bigint;
begin
  if target_path is null or left(target_path, length(expected_prefix)) <> expected_prefix then
    return false;
  end if;
  select case
    when coalesce(o.metadata ->> 'size', o.metadata ->> 'contentLength') ~ '^[0-9]+$'
      then coalesce(o.metadata ->> 'size', o.metadata ->> 'contentLength')::bigint
    else null
  end
  into stored_size
  from storage.objects o
  where o.bucket_id = 'clinical-attachments' and o.name = target_path;
  if not found then return false; end if;
  if target_size is not null and stored_size is not null and stored_size <> target_size then
    return false;
  end if;
  return true;
end;
$$;

-- ---------- Desktop (authenticated professional) ----------

create or replace function public.reserve_consultation_attachment(
  target_consultation uuid,
  target_kind text,
  target_mime text,
  target_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consultation_row public.consultations%rowtype;
  image_acceptance uuid;
  attachment_row public.consultation_attachments%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if target_kind not in ('image', 'document') or nullif(btrim(target_mime), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row from public.consultations c where c.id = target_consultation;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(consultation_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('scheduled', 'draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;

  if target_kind = 'image' then
    image_acceptance := public.active_consent_acceptance(consultation_row.org_id, consultation_row.patient_id, 'clinical-images');
    if image_acceptance is null then
      return jsonb_build_object('ok', false, 'code', 'images_consent_required');
    end if;
  end if;

  insert into public.consultation_attachments (
    org_id, consultation_id, patient_id, created_by, kind, mime, source, consent_acceptance_id
  ) values (
    consultation_row.org_id, consultation_row.id, consultation_row.patient_id, auth.uid(),
    target_kind, btrim(target_mime), case when target_source = 'qr' then 'qr' else 'web' end, image_acceptance
  )
  returning * into attachment_row;

  return jsonb_build_object('ok', true, 'attachmentId', attachment_row.id, 'orgId', consultation_row.org_id);
end;
$$;

create or replace function public.confirm_consultation_attachment(
  target_attachment uuid,
  target_path text,
  target_size bigint default null,
  target_checksum text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  attachment_row public.consultation_attachments%rowtype;
begin
  select a.* into attachment_row from public.consultation_attachments a where a.id = target_attachment for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(attachment_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if attachment_row.status = 'ready' then
    return jsonb_build_object('ok', true, 'code', 'ready', 'attachmentId', target_attachment);
  end if;
  if attachment_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if not public.attachment_object_ok(attachment_row.org_id, attachment_row.consultation_id, attachment_row.id, target_path, target_size) then
    return jsonb_build_object('ok', false, 'code', 'attachment_not_uploaded');
  end if;

  update public.consultation_attachments
  set status = 'ready', storage_path = target_path, size_bytes = target_size,
      checksum_sha256 = nullif(lower(btrim(target_checksum)), ''), updated_at = now()
  where id = target_attachment;

  return jsonb_build_object('ok', true, 'code', 'ready', 'attachmentId', target_attachment);
end;
$$;

create or replace function public.delete_consultation_attachment(target_attachment uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  attachment_row public.consultation_attachments%rowtype;
begin
  select a.* into attachment_row from public.consultation_attachments a where a.id = target_attachment for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(attachment_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if attachment_row.deleted_at is not null then
    return jsonb_build_object('ok', true, 'code', 'deleted', 'storagePath', attachment_row.storage_path);
  end if;

  update public.consultation_attachments
  set deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  where id = target_attachment;

  -- The caller removes the storage object; the path is returned for that.
  return jsonb_build_object('ok', true, 'code', 'deleted', 'storagePath', attachment_row.storage_path);
end;
$$;

-- ---------- Phone via the QR capture session (token-scoped) ----------

create or replace function public.reserve_capture_attachment_via_link(
  target_token_hash text,
  target_kind text,
  target_mime text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.capture_link_sessions%rowtype;
  consultation_row public.consultations%rowtype;
  image_acceptance uuid;
  attachment_row public.consultation_attachments%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_kind not in ('image', 'document') or nullif(btrim(target_mime), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  session_row := public.capture_link_active(target_token_hash);
  if session_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'capture_link_invalid');
  end if;

  select c.* into consultation_row from public.consultations c where c.id = session_row.consultation_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if consultation_row.status not in ('scheduled', 'draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;

  if target_kind = 'image' then
    image_acceptance := public.active_consent_acceptance(session_row.org_id, session_row.patient_id, 'clinical-images');
    if image_acceptance is null then
      return jsonb_build_object('ok', false, 'code', 'images_consent_required');
    end if;
  end if;

  insert into public.consultation_attachments (
    org_id, consultation_id, patient_id, created_by, kind, mime, source, consent_acceptance_id
  ) values (
    session_row.org_id, session_row.consultation_id, session_row.patient_id, session_row.created_by,
    target_kind, btrim(target_mime), 'qr', image_acceptance
  )
  returning * into attachment_row;

  perform public.renew_capture_link_session(session_row.id);
  return jsonb_build_object('ok', true, 'attachmentId', attachment_row.id, 'orgId', session_row.org_id, 'consultationId', session_row.consultation_id);
end;
$$;

create or replace function public.confirm_capture_attachment_via_link(
  target_token_hash text,
  target_attachment uuid,
  target_path text,
  target_size bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  session_row public.capture_link_sessions%rowtype;
  attachment_row public.consultation_attachments%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  session_row := public.capture_link_active(target_token_hash);
  if session_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'capture_link_invalid');
  end if;

  select a.* into attachment_row from public.consultation_attachments a where a.id = target_attachment for update;
  if not found or attachment_row.consultation_id is distinct from session_row.consultation_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.renew_capture_link_session(session_row.id);
  if attachment_row.status = 'ready' then
    return jsonb_build_object('ok', true, 'code', 'ready', 'attachmentId', target_attachment);
  end if;
  if attachment_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if not public.attachment_object_ok(attachment_row.org_id, attachment_row.consultation_id, attachment_row.id, target_path, target_size) then
    return jsonb_build_object('ok', false, 'code', 'attachment_not_uploaded');
  end if;

  update public.consultation_attachments
  set status = 'ready', storage_path = target_path, size_bytes = target_size, updated_at = now()
  where id = target_attachment;

  return jsonb_build_object('ok', true, 'code', 'ready', 'attachmentId', target_attachment);
end;
$$;

-- ---------- Grants ----------

revoke all on function public.attachment_object_ok(uuid, uuid, uuid, text, bigint) from public;
revoke all on function public.reserve_consultation_attachment(uuid, text, text, text) from public;
revoke all on function public.confirm_consultation_attachment(uuid, text, bigint, text) from public;
revoke all on function public.delete_consultation_attachment(uuid) from public;
revoke all on function public.reserve_capture_attachment_via_link(text, text, text) from public;
revoke all on function public.confirm_capture_attachment_via_link(text, uuid, text, bigint) from public;

grant execute on function public.reserve_consultation_attachment(uuid, text, text, text) to authenticated;
grant execute on function public.confirm_consultation_attachment(uuid, text, bigint, text) to authenticated;
grant execute on function public.delete_consultation_attachment(uuid) to authenticated;
grant execute on function public.reserve_capture_attachment_via_link(text, text, text) to service_role;
grant execute on function public.confirm_capture_attachment_via_link(text, uuid, text, bigint) to service_role;
-- attachment_object_ok is an internal helper for the definer RPCs only.
