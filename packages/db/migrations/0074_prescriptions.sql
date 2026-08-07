-- ============================================================
-- 0074_prescriptions: the professional's receituário (prescription).
--
-- The AI NEVER prescribes (PRD §10/§16), so a prescription is entirely
-- professional-authored. Two kinds:
--   * 'herbal'  — a Chinese herbal formula: components + dosage + preparation
--                 + posology;
--   * 'generic' — a free structured prescription (items + guidance).
--
-- It is a DRAFT until she validates (signs) it; editing a validated one returns
-- it to draft (a signature was of a specific content). A consultation may carry
-- MORE THAN ONE (a formula AND a generic script), so this is a child table, not
-- one-per-consultation like the therapeutic plan. Frozen with the consultation
-- (PRD §8.5) and row-versioned for the audit trail.
--
-- Phase 2 issues a validated prescription as a signed, QR-verifiable PDF through
-- @flyee/documents, exactly like the therapeutic plan.
-- ============================================================

create table if not exists public.consultation_prescriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  kind text not null check (kind in ('herbal', 'generic')),
  title text,
  -- Array of { name, amount, notes } — a herb/component or a free item.
  items jsonb not null default '[]'::jsonb,
  posology text,
  preparation text,
  notes text,
  status text not null default 'draft' check (status in ('draft', 'validated')),
  validated_by uuid references public.profiles (id) on delete set null,
  validated_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultation_prescriptions_consultation_idx
  on public.consultation_prescriptions (consultation_id);

alter table public.consultation_prescriptions enable row level security;

-- Org members read/write their workspace's prescriptions; superadmin sees all.
drop policy if exists "prescriptions_select" on public.consultation_prescriptions;
create policy "prescriptions_select" on public.consultation_prescriptions
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

drop policy if exists "prescriptions_insert" on public.consultation_prescriptions;
create policy "prescriptions_insert" on public.consultation_prescriptions
  for insert to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists "prescriptions_update" on public.consultation_prescriptions;
create policy "prescriptions_update" on public.consultation_prescriptions
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop policy if exists "prescriptions_delete" on public.consultation_prescriptions;
create policy "prescriptions_delete" on public.consultation_prescriptions
  for delete to authenticated
  using (public.is_org_member(org_id));

-- updated_at housekeeping.
create or replace function public.touch_prescription_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prescriptions_touch_updated_at on public.consultation_prescriptions;
create trigger prescriptions_touch_updated_at
  before update on public.consultation_prescriptions
  for each row execute function public.touch_prescription_updated_at();

-- A finalized consultation freezes its prescriptions (PRD §8.5). Referential
-- housekeeping (cascade delete on account/patient erasure) runs nested and is
-- never blocked.
create or replace function public.guard_finalized_prescription()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent uuid;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    parent := old.consultation_id;
  else
    parent := new.consultation_id;
  end if;
  if exists (select 1 from public.consultations c where c.id = parent and c.status = 'finalized') then
    raise exception 'consultation % is finalized: its prescriptions can no longer change', parent
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists prescriptions_guard_finalized on public.consultation_prescriptions;
create trigger prescriptions_guard_finalized
  before insert or update or delete on public.consultation_prescriptions
  for each row execute function public.guard_finalized_prescription();

-- Immutable row versioning for the audit trail (packages/audit).
select public.enable_row_versioning('public.consultation_prescriptions');
