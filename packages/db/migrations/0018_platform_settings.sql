-- ============================================================
-- 0018_platform_settings: singleton key/value platform configuration
-- edited by the superadmin. First consumer: the quick-support widget
-- channels ('support' key: { whatsapp, email }), which render on the
-- PUBLIC marketing site — so reads are open to anon by design; never
-- store secrets here.
-- ============================================================

create table public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------

alter table public.platform_settings enable row level security;

-- Public, non-sensitive configuration: everyone can read.
create policy "platform_settings_select_all" on public.platform_settings
  for select to anon, authenticated
  using (true);

-- Only the platform superadmin writes.
create policy "platform_settings_all_superadmin" on public.platform_settings
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- updated_at maintenance ----------

create trigger platform_settings_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();
