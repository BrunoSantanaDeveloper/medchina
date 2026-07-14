-- ============================================================
-- 0022_consent_recordings: consent BEFORE capture, and the recording
-- entity itself (PRD §9.5, §12.4, §14.3).
--
-- Design:
--  * Consent terms/acceptances already exist (0005). This migration seeds
--    MedChina's three patient consents and adds a helper the app and the
--    database both use to answer "may I record this patient right now?".
--  * `recordings` tracks a captured consultation audio through its real
--    lifecycle (PRD §12.4) and is the bridge to `transcriptions` (0007).
--  * A recording CANNOT exist without an active recording consent for that
--    patient — enforced by a trigger, not just by the UI. Refusing to be
--    recorded never blocks manual care (PRD §9.5); it only blocks capture.
--  * Audio lives in the existing private `transcriptions` bucket under
--    <org_id>/... (policies already in 0007), and its path is nulled when the
--    audio is deleted after the transcript is validated (PRD §14.3).
-- ============================================================

-- ---------- Recording lifecycle (PRD §12.4) ----------

create type public.recording_status as enum (
  'recording',   -- capture in progress
  'local',       -- captured, still only on the device / browser
  'uploading',
  'uploaded',    -- server confirmed receipt + integrity
  'processing',  -- transcription pipeline running
  'ready',       -- transcript available for review
  'failed',
  'cancelled'
);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  consultation_id uuid references public.consultations (id) on delete set null,
  status public.recording_status not null default 'recording',
  -- Path inside the private `transcriptions` bucket: <org_id>/<recording_id>.<ext>
  -- Nulled once the source audio is deleted (retention policy, PRD §14.3).
  audio_path text,
  mime text,
  duration_seconds integer,
  size_bytes bigint,
  -- Set once the pipeline runs (0007). The consultation links to it too.
  transcription_id uuid references public.transcriptions (id) on delete set null,
  -- Which consent acceptance authorized this capture — provenance for audits.
  consent_acceptance_id uuid references public.consent_acceptances (id) on delete set null,
  -- "web" | "mobile"
  captured_on text not null default 'web',
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recordings_org_idx on public.recordings (org_id, created_at desc);
create index recordings_patient_idx on public.recordings (patient_id, created_at desc);

-- ---------- "May I record this patient?" ----------

-- True when the patient has an ACTIVE (accepted, not revoked) acceptance of
-- the latest active term for the given slug. Security definer so the UI and
-- the guard trigger share one answer.
create or replace function public.has_active_consent(
  target_org uuid,
  target_patient uuid,
  term_slug text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.consent_acceptances a
    join public.consent_terms t on t.id = a.term_id
    where a.org_id = target_org
      and a.subject_type = 'patient'
      and a.subject_id = target_patient::text
      and t.slug = term_slug
      and a.revoked_at is null
  );
$$;

-- A recording may not be created without an active audio-recording consent.
create or replace function public.guard_recording_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_active_consent(new.org_id, new.patient_id, 'audio-recording') then
    raise exception 'patient % has no active audio-recording consent', new.patient_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger recordings_guard_consent
  before insert on public.recordings
  for each row execute function public.guard_recording_consent();

-- ---------- RLS ----------

alter table public.recordings enable row level security;

create policy "recordings_all_member" on public.recordings
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create trigger recordings_updated_at
  before update on public.recordings
  for each row execute function public.set_updated_at();

select public.enable_row_versioning('public.recordings');

-- ---------- MedChina's patient consents (PRD §9.5) ----------

-- Separate purposes, separately granted (recording ≠ AI processing ≠ images).
-- The body text is a PLACEHOLDER pending legal review — version 1.
insert into public.consent_terms (slug, version, title, body, is_active) values
  (
    'audio-recording', 1,
    'Autorização para gravação de áudio da consulta',
    'Autorizo a gravação do áudio desta consulta para fins de registro clínico. '
    'A gravação é opcional: posso recusá-la sem prejuízo ao atendimento, e posso revogar esta autorização a qualquer momento. '
    'O áudio é armazenado de forma protegida e segue a política de retenção informada pela profissional. '
    '(Texto provisório — pendente de revisão jurídica.)',
    true
  ),
  (
    'ai-processing', 1,
    'Autorização para transcrição e processamento por inteligência artificial',
    'Autorizo que o áudio e as informações desta consulta sejam transcritos e organizados com apoio de inteligência artificial, '
    'sempre sob revisão e responsabilidade da profissional. As informações não são utilizadas para treinar modelos públicos. '
    'Posso revogar esta autorização a qualquer momento. '
    '(Texto provisório — pendente de revisão jurídica.)',
    true
  ),
  (
    'clinical-images', 1,
    'Autorização para registro de imagens clínicas',
    'Autorizo o registro de imagens clínicas (por exemplo, fotografias de língua ou de região tratada) para acompanhamento da evolução. '
    'As imagens integram meu prontuário e não são compartilhadas sem autorização específica. Posso revogar esta autorização a qualquer momento. '
    '(Texto provisório — pendente de revisão jurídica.)',
    true
  )
on conflict (slug, version) do nothing;
