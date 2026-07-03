-- ============================================================
-- 0004_connectors: per-organization connections to external APIs.
-- Visible metadata lives in `connections` (RLS: members read,
-- owners/admins manage). Credentials live in `connection_secrets`,
-- which has RLS enabled and NO policies: only the service role can
-- touch tokens — they never reach the browser.
-- ============================================================

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Connector slug registered in @gogo/connectors (e.g. "meta-ads").
  provider text not null,
  name text not null,
  status text not null default 'connected' check (status in ('connected', 'error', 'disabled')),
  -- Provider-side identity/context (account id, scopes...). Non-secret.
  metadata jsonb not null default '{}'::jsonb,
  -- Incremental sync position, owned by the connector implementation.
  sync_cursor jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  sync_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index connections_org_idx on public.connections (org_id);

create table public.connection_secrets (
  connection_id uuid primary key references public.connections (id) on delete cascade,
  -- Tokens / API keys as provided by the connector's auth flow.
  secret jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------

alter table public.connections enable row level security;
alter table public.connection_secrets enable row level security;
-- No policies on connection_secrets: service role only, by design.

create policy "connections_select_member" on public.connections for select to authenticated
  using (public.is_org_member(org_id));
create policy "connections_insert_manager" on public.connections for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy "connections_update_manager" on public.connections for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy "connections_delete_manager" on public.connections for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- ---------- updated_at maintenance ----------

create trigger connections_updated_at
  before update on public.connections
  for each row execute function public.set_updated_at();

create trigger connection_secrets_updated_at
  before update on public.connection_secrets
  for each row execute function public.set_updated_at();
