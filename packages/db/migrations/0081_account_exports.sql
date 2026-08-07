-- ============================================================
-- 0081_account_exports: taking the whole practice away.
--
-- Item 6 of docs/IMPORT-EXPORT.md, and the other half of PRD §9.10/§14: the
-- per-patient export answers "give me this chart", this one answers "give me
-- everything", which is what portability actually means when someone decides
-- to leave.
--
-- It is a request, not a download: assembling every chart of a practice takes
-- long enough that doing it inside a request would time out on exactly the
-- accounts that need it most. So a row here is the promise, a job fulfils it,
-- and the file is handed over through a short-lived signed URL.
--
-- Three properties the schema enforces rather than trusts the app for:
--
--   * ONE at a time per workspace. Without it, a frustrated click repeated
--     five times queues five full-database jobs.
--   * The archive EXPIRES. It is the entire clinical record of a practice in
--     plain text; leaving it in a bucket forever creates a second copy of the
--     most sensitive data we hold, outside every access control that protects
--     the first one.
--   * The professional never writes the result. Status, path and size are the
--     job's to set (service role), so a client cannot mark a failed export
--     ready and hand out a link to nothing.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

-- No storage policy on purpose: nobody reaches this bucket directly. The
-- download route checks membership and mints a signed URL with the service
-- role, which is also where the access is audited.

create table if not exists public.account_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'ready', 'failed', 'expired')),
  -- <org_id>/<export_id>.zip in the private 'exports' bucket.
  file_path text,
  size_bytes bigint,
  patient_count integer,
  error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  last_downloaded_at timestamptz
);

create index if not exists account_exports_org_idx
  on public.account_exports (org_id, requested_at desc);

-- One live request per workspace: the guard is the index, not a check in the
-- app, because two clicks race through any check the app could make.
create unique index if not exists account_exports_one_live
  on public.account_exports (org_id)
  where status in ('pending', 'running');

comment on table public.account_exports is
  'A request to package the whole practice for download (0081). The archive is short-lived by design — it is every chart in plain text.';

alter table public.account_exports enable row level security;
revoke all on table public.account_exports from public, anon;
grant select, insert on table public.account_exports to authenticated;
-- She asks; the job answers. Updating the outcome is not hers.
revoke update, delete, truncate on table public.account_exports from authenticated;

drop policy if exists account_exports_select_member on public.account_exports;
create policy account_exports_select_member
  on public.account_exports for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

drop policy if exists account_exports_insert_member on public.account_exports;
create policy account_exports_insert_member
  on public.account_exports for insert to authenticated
  with check (public.is_org_member(org_id));

-- Support may not export a professional's entire practice while working
-- inside her account (0057): that is the single largest exfiltration this
-- product could offer, and it is never support work.
do $$
begin
  execute 'drop trigger if exists guard_impersonation_account_exports on public.account_exports';
  execute 'create trigger guard_impersonation_account_exports
             after insert or update or delete on public.account_exports
             for each statement execute function public.guard_impersonation_readonly()';
end;
$$;

select public.enable_row_versioning('public.account_exports');

insert into public.platform_settings (key, value)
values ('account_exports', '{"expires_hours": 72}'::jsonb)
on conflict (key) do nothing;

-- ---------- Requesting ----------

create or replace function public.request_account_export()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_org uuid;
  live_id uuid;
  created public.account_exports%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  -- MVP account model: one workspace per professional (PRD §6). Resolving it
  -- here rather than taking it as an argument means a caller cannot request
  -- another practice's data even by guessing an id.
  select m.org_id into target_org
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;

  if target_org is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select e.id into live_id
  from public.account_exports e
  where e.org_id = target_org and e.status in ('pending', 'running')
  limit 1;

  if live_id is not null then
    return jsonb_build_object('ok', true, 'code', 'already_running', 'exportId', live_id);
  end if;

  insert into public.account_exports (org_id, requested_by)
  values (target_org, auth.uid())
  returning * into created;

  return jsonb_build_object('ok', true, 'code', 'requested', 'exportId', created.id, 'orgId', target_org);
end;
$$;

comment on function public.request_account_export() is
  'Queues a full-practice export for the caller''s workspace (0081), refusing a second one while any is in flight.';

-- ---------- Retention ----------

-- The archive is deleted, not merely hidden: the row survives as the record
-- that an export happened (and when), which is what an audit asks about.
create or replace function public.purge_expired_account_exports()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  paths text[];
  purged integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select coalesce(array_agg(e.file_path) filter (where e.file_path is not null), '{}')
  into paths
  from public.account_exports e
  where e.status = 'ready' and e.expires_at is not null and e.expires_at < now();

  update public.account_exports
  set status = 'expired', file_path = null
  where status = 'ready' and expires_at is not null and expires_at < now();
  get diagnostics purged = row_count;

  return jsonb_build_object('ok', true, 'expired', purged, 'paths', to_jsonb(paths));
end;
$$;

revoke all on function public.request_account_export() from public, anon;
revoke all on function public.purge_expired_account_exports() from public, anon, authenticated;
grant execute on function public.request_account_export() to authenticated;
grant execute on function public.purge_expired_account_exports() to service_role;
