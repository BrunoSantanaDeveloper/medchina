-- ============================================================
-- 0005_audit: compliance layer (LGPD / Lei 13.787-style needs).
-- 1. audit_events    — append-only trail of who did what.
-- 2. record_versions — immutable row history for tables a project
--    marks with enable_row_versioning() (mechanism only: the
--    template marks no tables).
-- 3. consent_terms / consent_acceptances — versioned terms and
--    per-subject acceptance records.
-- ============================================================

-- ---------- Audit events (append-only) ----------

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  -- Verb, project-defined (e.g. "patient.viewed", "document.issued").
  action text not null,
  entity_type text,
  entity_id text,
  -- What changed / extra context. Never store secrets here.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_org_idx on public.audit_events (org_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

alter table public.audit_events enable row level security;

-- Append-only by construction: no update/delete policies exist.
create policy "audit_events_select_admin" on public.audit_events for select to authenticated
  using (
    public.is_superadmin()
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  );
create policy "audit_events_insert_member" on public.audit_events for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (public.is_superadmin() or (org_id is not null and public.is_org_member(org_id)))
  );

-- ---------- Immutable row versioning ----------

create table public.record_versions (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  org_id uuid,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  -- Full row snapshot (NEW for insert/update, OLD for delete).
  data jsonb not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);

create index record_versions_record_idx on public.record_versions (table_name, record_id, created_at);

alter table public.record_versions enable row level security;

-- Read-only history: written exclusively by the trigger below
-- (security definer), no insert/update/delete policies.
create policy "record_versions_select_admin" on public.record_versions for select to authenticated
  using (
    public.is_superadmin()
    or (org_id is not null and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  );

-- Trigger function: snapshots every write on marked tables.
-- Requires the table to have an `id uuid` primary key; an `org_id uuid`
-- column, when present, scopes who may read the history.
create or replace function public.audit_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
begin
  if tg_op = 'DELETE' then
    snapshot := to_jsonb(old);
  else
    snapshot := to_jsonb(new);
  end if;

  insert into public.record_versions (table_name, record_id, org_id, operation, data, changed_by)
  values (
    tg_table_name,
    (snapshot ->> 'id')::uuid,
    case when snapshot ? 'org_id' then (snapshot ->> 'org_id')::uuid else null end,
    tg_op,
    snapshot,
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Mechanism only: derived projects mark their sensitive tables in their
-- own migrations, e.g.  select public.enable_row_versioning('public.patients');
create or replace function public.enable_row_versioning(target regclass)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists audit_row_versions on %s', target);
  execute format(
    'create trigger audit_row_versions after insert or update or delete on %s
       for each row execute function public.audit_record_version()',
    target
  );
end;
$$;

-- ---------- Consents (versioned terms + acceptances) ----------

create table public.consent_terms (
  id uuid primary key default gen_random_uuid(),
  -- Scope of the consent (e.g. "treatment", "audio-recording", "ai-processing").
  slug text not null,
  version integer not null default 1,
  title text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (slug, version)
);

create table public.consent_acceptances (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.consent_terms (id),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Who consented, project-defined (e.g. "patient" + patient id, "user" + user id).
  subject_type text not null,
  subject_id text not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index consent_acceptances_subject_idx on public.consent_acceptances (org_id, subject_type, subject_id);

alter table public.consent_terms enable row level security;
alter table public.consent_acceptances enable row level security;

create policy "consent_terms_select" on public.consent_terms for select to authenticated
  using (true);
create policy "consent_terms_all_superadmin" on public.consent_terms for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create policy "consent_acceptances_select_member" on public.consent_acceptances for select to authenticated
  using (public.is_org_member(org_id));
create policy "consent_acceptances_insert_member" on public.consent_acceptances for insert to authenticated
  with check (public.is_org_member(org_id) and recorded_by = auth.uid());
-- Revocation is the only permitted change (set revoked_at); rows are never deleted.
create policy "consent_acceptances_update_member" on public.consent_acceptances for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
