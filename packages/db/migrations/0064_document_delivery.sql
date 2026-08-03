-- ============================================================
-- 0064_document_delivery
--
-- Delivering the issued document TO THE PATIENT (PRD §9.8).
--
-- Today the cycle ends in a download: the professional fetches a 120-second
-- signed URL and forwards the PDF herself, outside the product. The moment of
-- greatest visible value — the patient leaving with her signed therapeutic
-- plan, QR and all — happens in WhatsApp, by hand, or not at all.
--
-- This adds the missing link: a share link scoped to ONE issued document,
-- carrying a bearer token whose raw value never reaches the database (only its
-- SHA-256), the same discipline as patient consent (0040) and QR capture
-- (0053/0058).
--
-- Why a link and not the file: the message that reaches the patient's phone or
-- inbox carries NO clinical content, only a URL. The PDF stays in the private
-- bucket and is served through a short signed URL minted at open time. A
-- message can be forwarded, screenshotted and backed up to someone else's
-- cloud; a link can expire and be revoked, and every open is auditable.
--
-- Revocation is first-class for the same reason a document can be revoked: if
-- a plan is reissued or shared by mistake, the professional must be able to
-- take it back.
-- ============================================================

create table if not exists public.document_share_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  -- Who the link is FOR. Deleting the patient (LGPD erasure) takes the link.
  patient_id uuid references public.patients (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  channel text not null default 'link' check (channel in ('link', 'whatsapp', 'email')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists document_share_links_document_idx
  on public.document_share_links (document_id, created_at desc);

alter table public.document_share_links enable row level security;
revoke all on table public.document_share_links from public;
grant select on table public.document_share_links to authenticated;
revoke insert, update, delete on table public.document_share_links from anon, authenticated;

-- She sees the links she issued (to know whether the patient opened it and to
-- revoke one). Writes go exclusively through the security-definer RPCs below,
-- so a token digest can never be inserted or altered from the browser.
drop policy if exists document_share_links_select_own on public.document_share_links;
create policy document_share_links_select_own
  on public.document_share_links for select to authenticated
  using (public.is_org_member(org_id));

comment on table public.document_share_links is
  'Bearer links that let a patient download one issued document. Raw token never stored (hash only); expirable, revocable and audited.';

-- ---------- Issue (authenticated professional) ----------

/**
 * Mint a share link for an ISSUED document. Refuses drafts and revoked
 * documents: a link that hands out a superseded plan is worse than no link.
 */
create or replace function public.create_document_share_link(
  target_document uuid,
  target_token_hash text,
  target_channel text default 'link',
  target_ttl_hours integer default 168
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  document_row public.documents%rowtype;
  ttl integer := least(greatest(coalesce(target_ttl_hours, 168), 1), 720);
  link_row public.document_share_links%rowtype;
  target_patient uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if target_channel is null or target_channel not in ('link', 'whatsapp', 'email') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select d.* into document_row from public.documents d where d.id = target_document;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(document_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if document_row.status <> 'issued' then
    return jsonb_build_object('ok', false, 'code', 'document_not_issued', 'status', document_row.status);
  end if;
  if document_row.storage_path is null then
    return jsonb_build_object('ok', false, 'code', 'document_not_issued');
  end if;

  if document_row.subject_type = 'patient' then
    target_patient := document_row.subject_id;
  end if;

  -- A new link supersedes the previous live one for this document: two valid
  -- bearer links to the same clinical PDF is one more than anyone needs.
  update public.document_share_links
  set revoked_at = now()
  where document_id = target_document and revoked_at is null and expires_at > now();

  insert into public.document_share_links (
    org_id, document_id, patient_id, created_by, token_hash, channel, expires_at
  ) values (
    document_row.org_id, document_row.id, target_patient, auth.uid(),
    target_token_hash, target_channel, now() + make_interval(hours => ttl)
  )
  returning * into link_row;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    document_row.org_id, auth.uid(), 'document.share_link.created',
    'document', document_row.id::text,
    jsonb_build_object('channel', target_channel, 'expiresAt', link_row.expires_at, 'patientId', target_patient)
  );

  return jsonb_build_object(
    'ok', true, 'code', 'created',
    'linkId', link_row.id, 'expiresAt', link_row.expires_at
  );
end;
$$;

create or replace function public.revoke_document_share_link(target_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  document_row public.documents%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  select d.* into document_row from public.documents d where d.id = target_document;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(document_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  update public.document_share_links
  set revoked_at = now()
  where document_id = target_document and revoked_at is null;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    document_row.org_id, auth.uid(), 'document.share_link.revoked',
    'document', document_row.id::text, '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

-- ---------- Open (service role; the token IS the credential) ----------

/**
 * Resolve a live link into what the public page needs to serve the file.
 *
 * PHI-thin by construction: the practice's name, the document kind and its
 * storage path — never the patient's name, never clinical content. The caller
 * mints a short signed URL from the path; the path itself is useless without
 * the service role.
 *
 * Every open is counted and audited: "who saw this document" must be
 * answerable for a file that carries a treatment plan.
 */
create or replace function public.open_document_share_link(target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  link_row public.document_share_links%rowtype;
  document_row public.documents%rowtype;
  org_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select l.* into link_row
  from public.document_share_links l
  where l.token_hash = target_token_hash
    and l.revoked_at is null
    and l.expires_at > now()
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'share_link_invalid');
  end if;

  select d.* into document_row from public.documents d where d.id = link_row.document_id;
  if not found or document_row.storage_path is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- A document revoked AFTER the link was sent stops being served: the patient
  -- must not keep pulling a plan the professional has superseded.
  if document_row.status <> 'issued' then
    return jsonb_build_object('ok', false, 'code', 'document_revoked');
  end if;

  select o.name into org_name from public.organizations o where o.id = link_row.org_id;

  update public.document_share_links
  set opened_at = coalesce(opened_at, now()), open_count = open_count + 1
  where id = link_row.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    link_row.org_id, link_row.created_by, 'document.share_link.opened',
    'document', document_row.id::text,
    jsonb_build_object('linkId', link_row.id, 'openCount', link_row.open_count + 1)
  );

  return jsonb_build_object(
    'ok', true,
    'organizationName', org_name,
    'kind', document_row.kind,
    'verifyCode', document_row.verify_code,
    'issuedAt', document_row.issued_at,
    'storagePath', document_row.storage_path
  );
end;
$$;

-- ---------- Grants ----------

revoke all on function public.create_document_share_link(uuid, text, text, integer) from public, anon;
grant execute on function public.create_document_share_link(uuid, text, text, integer) to authenticated;
revoke all on function public.revoke_document_share_link(uuid) from public, anon;
grant execute on function public.revoke_document_share_link(uuid) to authenticated;
-- Token-scoped: Supabase grants new public functions to its API roles, so
-- revoking from PUBLIC alone would leave anon able to call this (0039/0058).
revoke all on function public.open_document_share_link(text) from public, anon, authenticated;
grant execute on function public.open_document_share_link(text) to service_role;
