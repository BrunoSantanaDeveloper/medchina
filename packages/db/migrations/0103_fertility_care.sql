-- ============================================================
-- 0103_fertility_care
--
-- Um bloco de anamnese que NÃO se aplica a toda paciente: "Ciclo menstrual e
-- fertilidade" (ciclo, fluxo, muco cervical, contracepção, história
-- obstétrica, fertilidade, climatério e libido).
--
-- Ele aparece — e a IA só o preenche — quando duas coisas valem ao mesmo tempo:
--
--   1. A PROFISSIONAL declara que atende fertilidade. Nova lista
--      `profiles.practice_areas` ("áreas de atendimento"), separada das
--      modalidades (0050/0078): modalidade é COMO ela trata, área é O QUE ela
--      acompanha. Hoje o único valor aceito é 'fertility'; a lista existe para
--      que a próxima área não precise de coluna nova.
--
--   2. A PACIENTE está marcada no cadastro para esse acompanhamento
--      (`patients.fertility_care`). Sem sexo/gênero no cadastro, o marcador é
--      a única forma honesta de dizer a quem o bloco se aplica — e ele é uma
--      decisão da profissional, não uma inferência.
--
-- A regra vive em UMA função (`fertility_care_applies`), usada pelo contexto
-- da consulta (tela) e pelo pipeline de gravação (service role), para que a
-- tela e a IA nunca discordem sobre o que se aplica.
-- ============================================================

-- ---------- Áreas de atendimento da profissional ----------

alter table public.profiles
  add column if not exists practice_areas text[] not null default '{}'::text[];

alter table public.profiles
  drop constraint if exists profiles_practice_areas_check;
alter table public.profiles
  add constraint profiles_practice_areas_check
  check (practice_areas <@ array['fertility']::text[]);

comment on column public.profiles.practice_areas is
  'Áreas que a profissional acompanha (0103). Hoje só ''fertility'', que habilita o bloco de ciclo menstrual e fertilidade na anamnese.';

-- Mesmo desenho de update_practice_modalities (0078): auditado, validado aqui e
-- recusado durante uma sessão de suporte.
create or replace function public.update_practice_areas(target_areas text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_areas text[];
  actor_org uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[])
    into normalized_areas
  from (
    select distinct lower(btrim(area)) as value
    from unnest(coalesce(target_areas, '{}'::text[])) as area
    where nullif(btrim(area), '') is not null
  ) normalized;

  if exists (
    select 1 from unnest(normalized_areas) as area
    where area <> all (array['fertility']::text[])
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_area');
  end if;

  update public.profiles
     set practice_areas = normalized_areas,
         updated_at = now()
   where id = auth.uid();

  select m.org_id into actor_org
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_org,
    auth.uid(),
    'practice.areas.updated',
    'profile',
    auth.uid()::text,
    jsonb_build_object('areas', to_jsonb(normalized_areas))
  );

  return jsonb_build_object('ok', true, 'code', 'updated', 'practice_areas', normalized_areas);
end;
$$;

revoke all on function public.update_practice_areas(text[]) from public, anon;
grant execute on function public.update_practice_areas(text[]) to authenticated;

comment on function public.update_practice_areas(text[]) is
  'Atualiza as áreas de atendimento da própria profissional (/settings). Auditado, validado contra a lista de áreas do produto e recusado durante sessão de suporte.';

-- ---------- Marcador na paciente ----------

alter table public.patients
  add column if not exists fertility_care boolean not null default false;

comment on column public.patients.fertility_care is
  'A profissional acompanha ciclo menstrual e fertilidade desta paciente (0103). Com a área declarada no perfil, mostra o bloco na anamnese.';

-- ---------- A regra, num lugar só ----------

create or replace function public.fertility_care_applies(
  target_org uuid,
  target_patient uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;

  return exists (
    select 1
    from public.patients p
    where p.id = target_patient
      and p.org_id = target_org
      and p.fertility_care
  )
  and exists (
    -- MVP: um workspace por profissional. Olhar os membros (e não o usuário da
    -- sessão) é o que deixa o pipeline, que roda sem usuário, chegar à mesma
    -- resposta que a tela.
    select 1
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.org_id = target_org
      and 'fertility' = any(pr.practice_areas)
  );
end;
$$;

revoke all on function public.fertility_care_applies(uuid, uuid) from public, anon;
grant execute on function public.fertility_care_applies(uuid, uuid) to authenticated, service_role;

comment on function public.fertility_care_applies(uuid, uuid) is
  'True quando o bloco "Ciclo menstrual e fertilidade" se aplica: paciente marcada e a prática declara atender fertilidade. Usada pela tela (contexto da consulta) e pelo pipeline de gravação.';

-- ---------- O contexto da consulta conta se o bloco se aplica ----------
--
-- Copiada da 0102 verbatim, com um campo somado em `patient`.

create or replace function public.get_consultation_context(target_consultation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  consultation_row public.consultations%rowtype;
  patient_row public.patients%rowtype;
  recording_data jsonb;
begin
  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select p.* into patient_row from public.patients p where p.id = consultation_row.patient_id;

  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'error', r.error,
    'updatedAt', r.updated_at,
    'transcriptionId', r.transcription_id,
    'mode', r.mode,
    'capturedOn', r.captured_on
  ) into recording_data
  from public.recordings r
  where r.consultation_id = target_consultation
    and r.status not in ('ready', 'cancelled')
  order by r.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'consultation', jsonb_build_object(
      'id', consultation_row.id,
      'orgId', consultation_row.org_id,
      'patientId', consultation_row.patient_id,
      'status', consultation_row.status,
      'clinicalRevision', consultation_row.clinical_revision,
      'startedAt', consultation_row.started_at,
      'scheduledFor', consultation_row.scheduled_for
    ),
    'patient', jsonb_build_object(
      'id', patient_row.id,
      'name', patient_row.full_name,
      'birthDate', patient_row.birth_date,
      'alerts', patient_row.alerts,
      -- Whether the "Ciclo menstrual e fertilidade" block applies (0103): the
      -- patient is marked for it AND the practice declares fertility care.
      'fertilityCare', public.fertility_care_applies(consultation_row.org_id, patient_row.id)
    ),
    'consents', jsonb_build_object(
      'audio', public.has_active_consent(consultation_row.org_id, patient_row.id, 'audio-recording'),
      'ai', public.has_active_consent(consultation_row.org_id, patient_row.id, 'ai-processing'),
      'images', public.has_active_consent(consultation_row.org_id, patient_row.id, 'clinical-images'),
      -- She said NO to AI (0102): the only thing that stops reasoning over a
      -- record she typed. Never having been asked is not a refusal.
      'aiRefused', public.patient_refused_ai_reasoning(consultation_row.org_id, patient_row.id),
      -- The ciência: informed, not authorized. Shown, never blocking.
      'aiNotice', public.has_active_consent(consultation_row.org_id, patient_row.id, 'ai-record-notice')
    ),
    'recording', recording_data
  );
end;
$$;

revoke all on function public.get_consultation_context(uuid) from public, anon;
grant execute on function public.get_consultation_context(uuid) to authenticated;
