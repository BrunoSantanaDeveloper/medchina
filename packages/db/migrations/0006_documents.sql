-- ============================================================
-- 0006_documents: issued documents (professional records, invoices,
-- certificates...) with versioning, content hash and a public
-- verification code (QR target). PDFs live in the private
-- "documents" bucket; verification exposes only non-sensitive
-- fields via a security-definer RPC.
-- ============================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Project-defined template slug (e.g. "session-plan", "prescription", "invoice").
  kind text not null,
  title text not null,
  -- Data the project used to render the document (not exposed by verification).
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  -- Previous version of this document, when reissued.
  parent_id uuid references public.documents (id),
  status text not null default 'draft' check (status in ('draft', 'issued', 'revoked')),
  -- Public verification code printed as QR on the document.
  verify_code text not null unique,
  -- sha256 of the stored PDF, proving integrity at verification time.
  content_hash text,
  storage_path text,
  issued_by uuid references public.profiles (id) on delete set null,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_org_idx on public.documents (org_id, created_at desc);

-- ---------- RLS ----------

alter table public.documents enable row level security;

create policy "documents_select_member" on public.documents for select to authenticated
  using (public.is_org_member(org_id));
create policy "documents_insert_manager" on public.documents for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy "documents_update_manager" on public.documents for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
-- Issued documents are never deleted (revoke instead); drafts may be discarded.
create policy "documents_delete_draft" on public.documents for delete to authenticated
  using (status = 'draft' and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- ---------- Storage bucket (private; path: <org_id>/...) ----------

insert into storage.buckets (id, name, public) values ('documents', 'documents', false);

create policy "documents_bucket_select_member" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "documents_bucket_insert_manager" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin']::public.org_role[])
  );

-- ---------- Public verification (QR target) ----------

-- Anonymous-callable, security definer: exposes only what a third party
-- needs to check authenticity — never the payload or the file itself.
create or replace function public.verify_document(code text)
returns table (
  kind text,
  title text,
  status text,
  version integer,
  issued_at timestamptz,
  content_hash text,
  organization_name text
)
language sql
security definer
set search_path = ''
stable
as $$
  select d.kind, d.title, d.status, d.version, d.issued_at, d.content_hash, o.name as organization_name
  from public.documents d
  join public.organizations o on o.id = d.org_id
  where d.verify_code = code and d.status in ('issued', 'revoked');
$$;

grant execute on function public.verify_document(text) to anon, authenticated;

-- ---------- updated_at maintenance ----------

create trigger documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();
