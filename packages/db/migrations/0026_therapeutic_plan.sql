-- ============================================================
-- 0026_therapeutic_plan: the therapeutic plan (PRD §10.9) — the second half of
-- the Pro clinical value, built on the pattern hypotheses (0025).
--
-- One plan per consultation, holding the modalities the practitioner actually
-- uses (acupuncture, Chinese dietary therapy, moxibustion, auriculotherapy,
-- cupping — PRD §10.9). Each modality is a draft she edits; the plan as a whole
-- is what she VALIDATES.
--
-- Two things the schema makes non-negotiable:
--   - `safety_flags` (PRD §10.10: never hide a known contraindication —
--     medications, pregnancy, anticoagulants, pacemaker, surgery, lesions,
--     allergies). These are DERIVED IN CODE from the recorded anamnesis, not
--     produced by the model, so a fluent draft cannot make one disappear;
--   - a plan is a DRAFT until the professional validates it (PRD §10.10:
--     "Não prescrever ou finalizar documento sem ação profissional"). Issuing
--     the signed, QR-verifiable document (packages/documents, PRD §9.8) is a
--     later, separate act on a VALIDATED plan.
--
-- Frozen with the consultation (PRD §8.5) and row-versioned, like every other
-- clinical row.
-- ============================================================

create type public.therapeutic_plan_status as enum ('draft', 'validated');

create table public.consultation_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,

  -- The overall therapeutic aim, in the consultation's language.
  objective text,

  -- Per-modality drafts, keyed by modality slug. Each value is the modality's
  -- own structured shape (see lib/therapeutic-plan.ts). Only the modalities the
  -- practitioner uses are present — the schema does not force all five.
  -- { "acupuncture": { enabled, points, ... }, "diet": { ... }, ... }
  modalities jsonb not null default '{}'::jsonb,

  -- Contraindications and cautions surfaced from the recorded anamnesis
  -- (PRD §10.10). DERIVED IN CODE — never the model's to omit.
  -- [{ "category": "anticoagulant", "matchedText": "...", "fieldKey": "..." }]
  safety_flags jsonb not null default '[]'::jsonb,

  -- The professional's action turns a draft into a plan (PRD §10.10). She must
  -- acknowledge the surfaced contraindications to validate.
  status public.therapeutic_plan_status not null default 'draft',
  validated_by uuid references public.profiles (id) on delete set null,
  validated_at timestamptz,

  -- Provenance of the generation (PRD §10.10).
  -- [{ "title", "source", "kind", "documentId", "chunkId" }]
  sources jsonb not null default '[]'::jsonb,
  model text,
  prompt_version text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One live plan per consultation (a reissue is a document, not a new plan).
  unique (consultation_id)
);

create index consultation_plans_org_idx on public.consultation_plans (org_id);

-- ---------- RLS ----------

alter table public.consultation_plans enable row level security;

create policy "consultation_plans_select_member" on public.consultation_plans for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

create policy "consultation_plans_insert_member" on public.consultation_plans for insert to authenticated
  with check (public.is_org_member(org_id));

create policy "consultation_plans_update_member" on public.consultation_plans for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create policy "consultation_plans_delete_member" on public.consultation_plans for delete to authenticated
  using (public.is_org_member(org_id));

create trigger consultation_plans_updated_at
  before update on public.consultation_plans
  for each row execute function public.set_updated_at();

select public.enable_row_versioning('public.consultation_plans');

-- ---------- Frozen with the consultation (PRD §8.5) ----------

create or replace function public.guard_finalized_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  target := coalesce(new.consultation_id, old.consultation_id);

  if exists (select 1 from public.consultations c where c.id = target and c.status = 'finalized') then
    raise exception 'consultation is finalized: the therapeutic plan is frozen (PRD §8.5)'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger consultation_plans_finalized_guard
  before insert or update or delete on public.consultation_plans
  for each row execute function public.guard_finalized_plan();
