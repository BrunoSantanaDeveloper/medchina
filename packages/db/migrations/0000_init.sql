-- ============================================================
-- 0000_init: multi-tenant foundation (profiles, organizations,
-- memberships, invites) with Row Level Security.
--
-- Apply with the Supabase CLI (supabase db push / migration up)
-- or psql against the project database.
-- ============================================================

-- ---------- Enums ----------

create type public.org_role as enum ('owner', 'admin', 'member');

-- ---------- Tables ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.org_role not null default 'member',
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index memberships_user_idx on public.memberships (user_id);
create index memberships_org_idx on public.memberships (org_id);
create index invites_org_idx on public.invites (org_id);

-- ---------- Helper functions (security definer, used by policies) ----------

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(target_org uuid, roles public.org_role[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

-- ---------- Row Level Security ----------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.invites enable row level security;

-- profiles: read own profile and profiles of co-members; update own.
create policy "profiles_select_own_or_comember" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships mine
      join public.memberships theirs on mine.org_id = theirs.org_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- organizations: members read; owners/admins update; owners delete.
-- Creation goes through create_organization() below (security definer),
-- so no direct insert policy is exposed.
create policy "organizations_select_member" on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy "organizations_update_admin" on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

create policy "organizations_delete_owner" on public.organizations
  for delete to authenticated
  using (public.has_org_role(id, array['owner']::public.org_role[]));

-- memberships: members read their org's roster; owners/admins manage it.
create policy "memberships_select_member" on public.memberships
  for select to authenticated
  using (public.is_org_member(org_id));

create policy "memberships_insert_admin" on public.memberships
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "memberships_update_admin" on public.memberships
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "memberships_delete_admin_or_self" on public.memberships
  for delete to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
    or user_id = auth.uid()
  );

-- invites: owners/admins manage; acceptance goes through accept_invite().
create policy "invites_select_admin" on public.invites
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "invites_insert_admin" on public.invites
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create policy "invites_delete_admin" on public.invites
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- ---------- Profile bootstrap on signup ----------

-- Creates the profile and, when the signup metadata carries a company
-- name, the user's first organization with an owner membership.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company text;
  new_org uuid;
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  company := nullif(trim(new.raw_user_meta_data ->> 'company'), '');
  if company is not null then
    insert into public.organizations (name, slug, created_by)
    values (
      company,
      lower(regexp_replace(company, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(new.id::text, 1, 8),
      new.id
    )
    returning id into new_org;

    insert into public.memberships (org_id, user_id, role)
    values (new_org, new.id, 'owner');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RPCs ----------

-- Creates an organization and makes the caller its owner. Exposed as a
-- security definer RPC because RLS has no sane "insert org + first
-- membership" path for regular users.
create or replace function public.create_organization(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (org_name, org_slug, auth.uid())
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'owner');

  return new_org;
end;
$$;

-- Accepts a pending invite by token for the current user.
create or replace function public.accept_invite(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into inv
  from public.invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite not found or expired';
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, auth.uid(), inv.role)
  on conflict (org_id, user_id) do nothing;

  update public.invites set accepted_at = now() where id = inv.id;

  return inv.org_id;
end;
$$;

-- ---------- updated_at maintenance ----------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();
