-- ============================================================
-- 0008_whatsapp: message log for the WhatsApp dispatcher.
-- Every outbound (manual, automatic or scheduled) and inbound
-- message is recorded here — the auditable trail of what was
-- sent to whom. Providers (Meta Cloud API / Evolution API) are
-- selected by env in @flyee/whatsapp.
-- ============================================================

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: inbound messages arrive before the project resolves the org.
  org_id uuid references public.organizations (id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  -- E.164-ish digits, e.g. 5511999999999.
  to_number text,
  from_number text,
  kind text not null default 'text' check (kind in ('text', 'template')),
  text text,
  template text,
  template_params jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'received', 'canceled')),
  error text,
  provider text,
  provider_message_id text,
  -- Future timestamp = scheduled send (the Inngest job sleeps until then).
  send_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index wa_messages_org_idx on public.wa_messages (org_id, created_at desc);
create index wa_messages_provider_idx on public.wa_messages (provider, provider_message_id);

-- ---------- RLS ----------

alter table public.wa_messages enable row level security;

-- No delete policy: the log is part of the audit trail.
create policy "wa_messages_select_member" on public.wa_messages for select to authenticated
  using (public.is_superadmin() or (org_id is not null and public.is_org_member(org_id)));
create policy "wa_messages_insert_member" on public.wa_messages for insert to authenticated
  with check (
    direction = 'out'
    and created_by = auth.uid()
    and org_id is not null
    and public.is_org_member(org_id)
  );
create policy "wa_messages_update_member" on public.wa_messages for update to authenticated
  using (org_id is not null and public.is_org_member(org_id))
  with check (org_id is not null and public.is_org_member(org_id));

-- ---------- updated_at maintenance ----------

create trigger wa_messages_updated_at
  before update on public.wa_messages
  for each row execute function public.set_updated_at();
