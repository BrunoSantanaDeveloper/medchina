-- ============================================================
-- 0093_finalize_warnings_post_freeze: fechar a consulta deixa de esconder o
-- que ela precisava rever, e deixa de tornar um receituário inassinável.
--
-- (1) O AVISO QUE NINGUÉM VIA. finalize_consultation já calculava
--     attention_fields / draft_hypotheses / draft_plan e recusava fechar sem
--     confirmação — mas o cliente reenviava com todos marcados sem nunca
--     mostrá-los ("tick them and retry"), e as strings de aviso existiam nos
--     cinco idiomas sem uma única referência em código. Campos marcados para
--     atenção são justamente medicação, gestação, anticoagulante, marca-passo,
--     cirurgia e alergia: o banco barrava o fechamento por causa deles e a
--     interface engolia o aviso. Falta ainda o receituário, que nem aviso
--     tinha — e é o que costuma ser escrito no fim do atendimento.
--
-- (2) O RECEITUÁRIO QUE CONGELAVA EM RASCUNHO. Um receituário só vira PDF
--     assinado depois de VALIDADO, e o guard de congelamento recusava toda
--     mudança pós-finalização — inclusive a validação. Um clique na ordem
--     "errada" deixava o documento mais pedido pela paciente permanentemente
--     inacessível: não assina, não imprime, não exclui, não recria. O atestado
--     já é emitido DEPOIS de finalizar; alinhamos os dois.
--
--     O conteúdo clínico continua congelado (PRD §8.5). O que passa a ser
--     permitido é exclusivamente a transição draft → validated, por ALLOWLIST
--     de colunas: qualquer coluna nova cai automaticamente no lado seguro.
--     Assinar não reescreve o registro — atesta o que ele já dizia.
-- ============================================================

-- ---------- (1) O aviso que faltava ----------
-- Corpo de 0029 recriado verbatim, com draft_prescription somado à lista.

create or replace function public.finalize_consultation(
  target_consultation uuid,
  expected_revision bigint default null,
  acknowledged_warnings text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.consultations%rowtype;
  warnings text[] := array[]::text[];
begin
  if expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'expectedRevision');
  end if;

  select c.* into target_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(target_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', target_row.status);
  end if;
  if target_row.clinical_revision <> expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'clinical_revision_conflict',
      'revision', target_row.clinical_revision
    );
  end if;
  if exists (
    select 1 from public.recordings r
    where r.consultation_id = target_consultation
      and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing', 'failed')
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_pending');
  end if;

  if exists (
    select 1 from public.anamnesis_answers a
    where a.consultation_id = target_consultation and a.state = 'attention'
  ) then
    warnings := array_append(warnings, 'attention_fields');
  end if;
  if exists (
    select 1 from public.consultation_hypotheses h
    where h.consultation_id = target_consultation and h.status = 'draft'
  ) then
    warnings := array_append(warnings, 'draft_hypotheses');
  end if;
  if exists (
    select 1 from public.consultation_plans p
    where p.consultation_id = target_consultation and p.status = 'draft'
  ) then
    warnings := array_append(warnings, 'draft_plan');
  end if;
  -- Novo: um receituário escrito e não assinado. Depois de 0074 ele congelava
  -- sem que nada nem ninguém tivesse avisado que faltava validá-lo.
  if exists (
    select 1 from public.consultation_prescriptions p
    where p.consultation_id = target_consultation and p.status = 'draft'
  ) then
    warnings := array_append(warnings, 'draft_prescription');
  end if;
  if nullif(btrim(target_row.chief_complaint), '') is null
     and nullif(btrim(target_row.summary), '') is null
     and not exists (
       select 1 from public.anamnesis_answers a
       where a.consultation_id = target_consultation
     ) then
    warnings := array_append(warnings, 'empty_consultation');
  end if;

  if not warnings <@ coalesce(acknowledged_warnings, array[]::text[]) then
    return jsonb_build_object(
      'ok', false,
      'code', 'finalization_confirmation_required',
      'warnings', to_jsonb(warnings),
      'revision', target_row.clinical_revision
    );
  end if;

  update public.consultations
  set status = 'finalized'
  where id = target_consultation;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_row.org_id,
    auth.uid(),
    'consultation.finalized',
    'consultation',
    target_consultation::text,
    jsonb_build_object('revision', target_row.clinical_revision, 'acknowledgedWarnings', to_jsonb(warnings))
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'finalized',
    'consultationId', target_consultation,
    'revision', target_row.clinical_revision,
    'warnings', to_jsonb(warnings)
  );
end;
$$;

revoke all on function public.finalize_consultation(uuid, bigint, text[]) from public, anon;
grant execute on function public.finalize_consultation(uuid, bigint, text[]) to authenticated;

-- ---------- (2) Assinar depois de fechar ----------

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
    -- Assinar o que já estava escrito é o único ato permitido depois do
    -- congelamento. Allowlist, nunca blocklist: toda coluna de conteúdo é
    -- comparada explicitamente, então uma coluna futura só passa se alguém
    -- decidir conscientemente adicioná-la aqui.
    if tg_op = 'UPDATE'
       and old.status = 'draft' and new.status = 'validated'
       and new.consultation_id is not distinct from old.consultation_id
       and new.org_id is not distinct from old.org_id
       and new.kind is not distinct from old.kind
       and new.title is not distinct from old.title
       and new.items is not distinct from old.items
       and new.posology is not distinct from old.posology
       and new.preparation is not distinct from old.preparation
       and new.notes is not distinct from old.notes
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at then
      return new;
    end if;
    raise exception 'consultation % is finalized: its prescriptions can no longer change', parent
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.guard_finalized_prescription() is
  'Freezes prescription CONTENT with the consultation (PRD §8.5) while still allowing the draft to be signed afterwards — a signature attests what the record already said.';

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
    -- Mesma allowlist do receituário: só a validação, e só a partir de draft.
    -- As colunas livres são exatamente as que validate_consultation_plan
    -- escreve — nada além disso.
    if tg_op = 'UPDATE'
       and old.status = 'draft' and new.status = 'validated'
       and new.consultation_id is not distinct from old.consultation_id
       and new.org_id is not distinct from old.org_id
       and new.objective is not distinct from old.objective
       and new.modalities is not distinct from old.modalities
       and new.safety_flags is not distinct from old.safety_flags
       and new.sources is not distinct from old.sources
       and new.basis_hypotheses is not distinct from old.basis_hypotheses
       and new.origin is not distinct from old.origin
       and new.model is not distinct from old.model
       and new.prompt_version is not distinct from old.prompt_version
       and new.input_revision is not distinct from old.input_revision
       and new.stale_at is not distinct from old.stale_at
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at then
      return new;
    end if;
    raise exception 'consultation is finalized: the therapeutic plan is frozen (PRD §8.5)'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.guard_finalized_plan() is
  'Freezes plan CONTENT with the consultation (PRD §8.5) while still allowing a draft to be validated afterwards, so a closed record can still produce its signed document.';

-- O RPC de validação recusava por status da consulta; agora recusa apenas o
-- que de facto não pode ser assinado. O resto do corpo é o de 0059, verbatim —
-- inclusive o teste de frescor (input_revision), que continua correto: fechar
-- uma consulta não incrementa clinical_revision.

create or replace function public.validate_consultation_plan(
  target_plan uuid,
  expected_updated_at timestamptz,
  acknowledge_safety boolean,
  target_validation_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.consultation_plans%rowtype;
  consultation_row public.consultations%rowtype;
  target_consultation_id uuid;
  moxibustion jsonb;
begin
  if expected_updated_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'expectedUpdatedAt');
  end if;
  if acknowledge_safety is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'acknowledgeSafety');
  end if;

  select p.consultation_id into target_consultation_id
  from public.consultation_plans p
  where p.id = target_plan;
  if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

  select p.* into plan_row
  from public.consultation_plans p
  where p.id = target_plan and p.consultation_id = target_consultation_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'clinical_revision_conflict'); end if;

  if not (public.is_org_member(plan_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  -- Era `not in ('draft','in_progress','awaiting_review')`, o que tornava um
  -- plano fechado junto com a consulta impossível de assinar para sempre.
  if consultation_row.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', consultation_row.status);
  end if;
  if plan_row.updated_at is distinct from expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'clinical_revision_conflict');
  end if;
  if plan_row.stale_at is not null
     or plan_row.input_revision <> consultation_row.clinical_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'plan_stale',
      'planRevision', plan_row.input_revision,
      'clinicalRevision', consultation_row.clinical_revision
    );
  end if;
  if nullif(btrim(plan_row.objective), '') is null
     or not exists (
       select 1 from jsonb_each(plan_row.modalities) modality
       where coalesce((modality.value ->> 'enabled')::boolean, false)
     ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  moxibustion := plan_row.modalities -> 'moxibustion';
  if coalesce((moxibustion ->> 'enabled')::boolean, false) then
    if jsonb_typeof(moxibustion -> 'contraindicationChecklist') is distinct from 'array'
       or not exists (
         select 1
         from jsonb_array_elements_text(moxibustion -> 'contraindicationChecklist') entry
         where nullif(btrim(entry), '') is not null
       ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'moxibustion_checklist_required',
        'modality', 'moxibustion'
      );
    end if;
  end if;

  if jsonb_array_length(plan_row.safety_flags) > 0 and acknowledge_safety is not true then
    return jsonb_build_object('ok', false, 'code', 'safety_acknowledgement_required');
  end if;

  update public.consultation_plans
  set status = 'validated',
      validated_by = auth.uid(),
      validated_at = now(),
      safety_acknowledged_by = case when jsonb_array_length(safety_flags) > 0 then auth.uid() else null end,
      safety_acknowledged_at = case when jsonb_array_length(safety_flags) > 0 then now() else null end,
      validation_context = coalesce(target_validation_context, '{}'::jsonb)
  where id = target_plan;

  return jsonb_build_object('ok', true, 'code', 'validated', 'planId', target_plan);
end;
$$;

revoke all on function public.validate_consultation_plan(uuid, timestamptz, boolean, jsonb) from public, anon;
grant execute on function public.validate_consultation_plan(uuid, timestamptz, boolean, jsonb) to authenticated;
