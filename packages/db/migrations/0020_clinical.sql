-- ============================================================
-- 0020_clinical: the MVP clinical core — patients, consultations and
-- the structured anamnesis (PRD §9.4, §9.6, §8.4, §13).
--
-- Design notes that the schema enforces:
--  * Everything is scoped to an organization (one professional per
--    workspace in the MVP) and protected by RLS through is_org_member().
--  * A consultation has an explicit lifecycle (PRD §8.4). Once finalized
--    it must not be silently overwritten: a trigger freezes the clinical
--    payload and later corrections become addenda (PRD §8.5).
--  * Anamnesis answers carry PROVENANCE and a review state (PRD §10.6):
--    who/what produced the value (professional typing, patient report via
--    AI, professional voice note, AI inference) — absence is NEVER a
--    negative answer, so "not informed" is the absence of a row, not a
--    stored "no".
--  * Row versioning (0005) is enabled on every clinical table.
-- ============================================================

-- ---------- Enums ----------

create type public.consultation_status as enum (
  'scheduled',      -- agendada
  'in_progress',    -- em atendimento
  'awaiting_review',-- rascunho de IA pronto para revisão
  'draft',          -- rascunho manual
  'finalized',      -- finalizada (imutável)
  'cancelled'
);

-- Where a recorded value came from (PRD §10.3) — facts, observations and
-- inferences must remain visually and structurally distinct.
create type public.answer_source as enum (
  'professional',      -- typed/selected by the professional
  'patient_report',    -- extracted from what the patient said
  'professional_voice',-- dictated by the professional (tongue, pulse, palpation)
  'ai_inference'       -- prepared by the AI — never a fact
);

-- Per-field review state (PRD §10.6).
create type public.answer_state as enum (
  'clear',      -- evidência clara
  'attention',  -- requer atenção (ambíguo/contraditório/sensível)
  'edited',     -- editado pela profissional
  'rejected'    -- sugestão rejeitada (mantém log, não polui o prontuário)
);

-- ---------- Patients ----------

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null,
  birth_date date,
  -- Minimization (PRD §14.4): document, address and emergency contact are
  -- optional and collected only when a purpose requires them.
  document text,
  email text,
  phone text,
  notes text,
  -- Clinical alerts shown before every consultation (allergies, pregnancy,
  -- anticoagulants, pacemaker…): [{ label, severity }]
  alerts jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index patients_org_idx on public.patients (org_id);
create index patients_org_name_idx on public.patients (org_id, lower(full_name));

-- ---------- Consultations ----------

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  status public.consultation_status not null default 'draft',
  -- Free-text clinical summary written (or reviewed) by the professional.
  summary text,
  chief_complaint text,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  finalized_by uuid references public.profiles (id) on delete set null,
  -- Set when the consultation was prepared with AI (drives the trial/minute
  -- accounting later); manual consultations keep it null.
  transcription_id uuid references public.transcriptions (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index consultations_org_idx on public.consultations (org_id);
create index consultations_patient_idx on public.consultations (patient_id, started_at desc);

-- ---------- Anamnesis answers ----------

-- One row per ANSWERED field. A field with no row is "não informado" — the
-- schema makes it impossible to store absence as a negative answer.
create table public.anamnesis_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  -- Block + field keys come from the app's anamnesis model (PRD §9.6),
  -- e.g. block 'complaint', field 'onset'.
  block_key text not null,
  field_key text not null,
  value text not null,
  source public.answer_source not null default 'professional',
  state public.answer_state not null default 'clear',
  -- Provenance to the audio segment (PRD §13.1): { segment_id, start_ms, end_ms, quote }
  provenance jsonb not null default '{}'::jsonb,
  -- Preserved when the professional edits an AI-filled value.
  original_value text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (consultation_id, block_key, field_key)
);

create index anamnesis_answers_consultation_idx on public.anamnesis_answers (consultation_id);

-- ---------- Addenda (PRD §8.5) ----------

-- A finalized record is never silently overwritten: corrections are appended
-- with author, date and reason, linked to the consultation they amend.
create table public.consultation_addenda (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  body text not null,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index consultation_addenda_consultation_idx on public.consultation_addenda (consultation_id);

-- ---------- Immutability of finalized consultations ----------

create or replace function public.guard_finalized_consultation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'finalized' then
    -- Reopening or rewriting the clinical payload of a closed record is not
    -- allowed; corrections go to consultation_addenda.
    if new.status <> 'finalized'
       or new.summary is distinct from old.summary
       or new.chief_complaint is distinct from old.chief_complaint
       or new.patient_id is distinct from old.patient_id then
      raise exception 'consultation % is finalized: append an addendum instead of editing it', old.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger consultations_guard_finalized
  before update on public.consultations
  for each row execute function public.guard_finalized_consultation();

-- Answers of a finalized consultation are frozen too.
create or replace function public.guard_finalized_answers()
returns trigger
language plpgsql
as $$
declare
  current_status public.consultation_status;
  target uuid;
begin
  target := coalesce(new.consultation_id, old.consultation_id);
  select status into current_status from public.consultations where id = target;
  if current_status = 'finalized' then
    raise exception 'consultation % is finalized: its anamnesis can no longer change', target
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger anamnesis_answers_guard_finalized
  before insert or update or delete on public.anamnesis_answers
  for each row execute function public.guard_finalized_answers();

-- ---------- RLS ----------

alter table public.patients enable row level security;
alter table public.consultations enable row level security;
alter table public.anamnesis_answers enable row level security;
alter table public.consultation_addenda enable row level security;

create policy "patients_all_member" on public.patients
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create policy "consultations_all_member" on public.consultations
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create policy "anamnesis_answers_all_member" on public.anamnesis_answers
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Addenda are append-only: no update/delete policy exists on purpose.
create policy "consultation_addenda_select_member" on public.consultation_addenda
  for select to authenticated
  using (public.is_org_member(org_id));

create policy "consultation_addenda_insert_member" on public.consultation_addenda
  for insert to authenticated
  with check (public.is_org_member(org_id));

-- ---------- updated_at maintenance ----------

create trigger patients_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

create trigger consultations_updated_at
  before update on public.consultations
  for each row execute function public.set_updated_at();

create trigger anamnesis_answers_updated_at
  before update on public.anamnesis_answers
  for each row execute function public.set_updated_at();

-- ---------- Immutable row versioning (0005) ----------

select public.enable_row_versioning('public.patients');
select public.enable_row_versioning('public.consultations');
select public.enable_row_versioning('public.anamnesis_answers');
