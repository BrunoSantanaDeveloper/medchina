-- ============================================================
-- 0092_recording_apply_semantics: o apply de uma gravação para de
-- descartar trabalho da profissional — e passa a completar o registro.
--
-- Três defeitos do mesmo corpo (apply_recording_result_without_usage,
-- última definição em 0059), por isso uma migração só:
--
-- (1) DIGITAR DURANTE O PROCESSAMENTO MATAVA O RASCUNHO. Todo save de campo
--     incrementa consultations.clinical_revision (trigger de 0029). O claim
--     fotografa a revisão (0030) e o apply recusava qualquer divergência com
--     clinical_revision_conflict — código que NÃO está no conjunto retentável
--     do pipeline, logo a gravação terminava em status='failed' e a
--     transcrição inteira era descartada. Enquanto isso a própria tela
--     convida: "O que você escrever agora é preservado — a IA nunca
--     substitui sua anotação."
--     A barreira era redundante: o merge por campo do ON CONFLICT abaixo já
--     é quem protege conteúdo humano, campo a campo, e continua protegendo.
--     Só a COMPARAÇÃO morre; recordings.processing_clinical_revision segue
--     sendo estampada no claim (telemetria e diagnóstico).
--     O lock otimista de finalize_consultation e dos RPCs de hipóteses/plano
--     NÃO é tocado: lá ele arbitra decisões da profissional, que é outra
--     coisa — e o código clinical_revision_conflict continua existindo.
--
-- (2) A SEGUNDA GRAVAÇÃO DESCARTAVA A OBSERVAÇÃO RE-DITADA. O WHERE do
--     ON CONFLICT protegia toda linha 'professional_voice' — mas essa é
--     justamente a origem que o PRÓPRIO pipeline grava para língua, pulso e
--     palpação ditados em voz alta. Resultado: re-ditar o pulso numa segunda
--     gravação era silenciosamente jogado fora. O que distingue o ditado do
--     digitado é o carimbo de transcrição na proveniência (o mesmo critério
--     que a tela usa para saber se um campo veio da IA). Agora: digitado
--     nunca é tocado; ditado-pela-pipeline pode ser atualizado por uma
--     gravação posterior; 'edited'/'rejected' seguem intocáveis SEMPRE —
--     crucial, porque save_consultation_answer preserva a proveniência (e o
--     carimbo!) quando ela edita um ditado: ali quem protege é o state.
--
-- (3) A QUEIXA PRINCIPAL ERA ÓRFÃ. consultations.chief_complaint move a
--     linha do tempo e alimenta resumo, hipóteses e briefing, mas o catálogo
--     de extração a exclui de propósito (ela não é um campo de bloco) e
--     nenhuma tela a escrevia. O apply agora a grava — e SÓ quando ainda
--     está vazia, nunca por cima do que a profissional escreveu.
--
-- Assinaturas mudam (parâmetro novo), então é drop + create, não replace.
-- packages/db/tests/0001 fixa a aridade pública e foi atualizado junto.
-- ============================================================

-- ---------- O merge clínico ----------

drop function if exists public.apply_recording_result_without_usage(uuid, uuid, uuid, jsonb, jsonb);

create or replace function public.apply_recording_result_without_usage(
  target_recording uuid,
  target_transcription uuid,
  target_claim_id uuid,
  target_answers jsonb,
  target_gaps jsonb,
  target_chief_complaint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_consultation_id uuid;
  consultation_row public.consultations%rowtype;
  recording_row public.recordings%rowtype;
  item jsonb;
  answer_source public.answer_source;
  answer_state public.answer_state;
  affected integer;
  written integer := 0;
  skipped integer := 0;
begin
  if target_transcription is null or target_claim_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select r.consultation_id into claimed_consultation_id from public.recordings r where r.id = target_recording;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = claimed_consultation_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select r.* into recording_row
  from public.recordings r
  where r.id = target_recording
  for update;

  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if recording_row.status <> 'processing'
     or recording_row.transcription_id is distinct from target_transcription
     or recording_row.processing_claim_id is distinct from target_claim_id then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', consultation_row.status);
  end if;
  if not public.has_active_consent(recording_row.org_id, recording_row.patient_id, 'ai-processing') then
    return jsonb_build_object('ok', false, 'code', 'consent_required', 'consent', 'ai-processing');
  end if;

  -- Defeito (1): AQUI ficava a recusa por clinical_revision_conflict. Ela não
  -- protegia nada que o merge abaixo já não proteja, e custava a consulta
  -- inteira sempre que a profissional anotasse algo durante o processamento.

  for item in select value from jsonb_array_elements(coalesce(target_answers, '[]'::jsonb)) loop
    if nullif(btrim(item ->> 'value'), '') is null
       or nullif(btrim(item ->> 'blockKey'), '') is null
       or nullif(btrim(item ->> 'fieldKey'), '') is null then
      continue;
    end if;

    -- She already looked at this field and threw the draft away. Writing it
    -- back would overrule a clinical decision with a retry.
    if exists (
      select 1
      from public.ai_answer_decisions d
      where d.consultation_id = consultation_row.id
        and d.block_key = item ->> 'blockKey'
        and d.field_key = item ->> 'fieldKey'
        and d.decision = 'rejected'
    ) then
      skipped := skipped + 1;
      continue;
    end if;

    answer_source := case
      when item ->> 'source' in ('patient_report', 'professional_voice', 'ai_inference')
        then (item ->> 'source')::public.answer_source
      else 'ai_inference'::public.answer_source
    end;
    answer_state := case
      when item ->> 'state' in ('clear', 'attention')
        then (item ->> 'state')::public.answer_state
      else 'attention'::public.answer_state
    end;

    insert into public.anamnesis_answers (
      org_id, consultation_id, block_key, field_key, value, source, state, provenance, created_by
    ) values (
      recording_row.org_id,
      consultation_row.id,
      item ->> 'blockKey',
      item ->> 'fieldKey',
      btrim(item ->> 'value'),
      answer_source,
      answer_state,
      coalesce(item -> 'provenance', '{}'::jsonb) || jsonb_build_object('transcriptionId', target_transcription),
      recording_row.created_by
    )
    on conflict (consultation_id, block_key, field_key) do update
    set value = excluded.value,
        source = excluded.source,
        state = excluded.state,
        provenance = excluded.provenance,
        updated_at = now()
    -- Defeito (2): o que ela decidiu é intocável — o que a pipeline ditou não.
    -- 'edited'/'rejected' primeiro, porque editar um ditado PRESERVA o carimbo
    -- de transcrição: sem esta linha o teste de proveniência abaixo deixaria
    -- passar por cima de uma correção dela.
    where public.anamnesis_answers.state not in ('edited', 'rejected')
      and (
        public.anamnesis_answers.source not in ('professional', 'professional_voice')
        or (
          public.anamnesis_answers.source = 'professional_voice'
          and coalesce(jsonb_exists(public.anamnesis_answers.provenance, 'transcriptionId'), false)
        )
      );

    get diagnostics affected = row_count;
    written := written + affected;
  end loop;

  update public.consultations
  set status = 'awaiting_review',
      transcription_id = target_transcription,
      -- Defeito (3): completa a queixa só quando ela ainda não existe.
      chief_complaint = coalesce(
        nullif(btrim(consultation_row.chief_complaint), ''),
        nullif(btrim(target_chief_complaint), '')
      ),
      ai_gaps = case when jsonb_typeof(target_gaps) = 'array' then target_gaps else '[]'::jsonb end
  where id = consultation_row.id;

  update public.recordings
  set status = 'ready',
      transcription_id = target_transcription,
      processing_heartbeat_at = null,
      processing_lease_expires_at = null
  where id = target_recording;

  return jsonb_build_object(
    'ok', true,
    'code', 'ready',
    'recordingId', target_recording,
    'transcriptionId', target_transcription,
    'answers', written,
    'rejectedSkipped', skipped,
    -- Diagnóstico do que a barreira removida teria recusado: quanto a ficha
    -- andou entre o claim e o merge.
    'claimRevision', recording_row.processing_clinical_revision,
    'revisionAtApply', consultation_row.clinical_revision,
    'gaps', jsonb_array_length(case when jsonb_typeof(target_gaps) = 'array' then target_gaps else '[]'::jsonb end)
  );
end;
$$;

revoke all on function public.apply_recording_result_without_usage(uuid, uuid, uuid, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;

comment on function public.apply_recording_result_without_usage(uuid, uuid, uuid, jsonb, jsonb, text) is
  'Owner-only clinical merge. Never overwrites what the professional typed or decided; a later recording may update what an earlier one dictated. Fills chief_complaint only when it is still empty.';

-- ---------- O wrapper cobrado ----------
-- Corpo idêntico ao de 0055 (ciclo primeiro, depois pacote); só repassa a
-- queixa extraída para o merge.

drop function if exists public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer);

create or replace function public.apply_recording_result(
  target_recording uuid,
  target_transcription uuid,
  target_claim_id uuid,
  target_answers jsonb,
  target_gaps jsonb,
  target_billable_seconds integer,
  target_chief_complaint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  apply_result jsonb;
  recording_org uuid;
  recording_author uuid;
  allowance jsonb;
  window_start timestamptz;
  window_end timestamptz;
  cycle_limit_seconds bigint := 0;
  cycle_used_seconds bigint := 0;
  cycle_available bigint := 0;
  pack_part integer := 0;
  remaining integer;
  taken integer;
  usage_id uuid;
  pack_row public.audio_minute_packs%rowtype;
begin
  if target_billable_seconds is null or target_billable_seconds <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  apply_result := public.apply_recording_result_without_usage(
    target_recording,
    target_transcription,
    target_claim_id,
    target_answers,
    target_gaps,
    target_chief_complaint
  );

  if not coalesce((apply_result ->> 'ok')::boolean, false) then
    return apply_result;
  end if;

  select r.org_id, r.created_by into recording_org, recording_author
  from public.recordings r
  where r.id = target_recording;

  if recording_org is null then
    raise exception 'usage_record_failed' using errcode = 'check_violation';
  end if;

  allowance := public.org_audio_allowance(recording_org);
  window_start := nullif(allowance ->> 'window_start', '')::timestamptz;
  window_end := nullif(allowance ->> 'window_end', '')::timestamptz;
  cycle_limit_seconds := coalesce((allowance ->> 'minutes_limit')::bigint, 0) * 60;

  if cycle_limit_seconds > 0 and window_start is not null then
    select coalesce(sum(u.cycle_seconds), 0) into cycle_used_seconds
    from public.audio_usage u
    where u.org_id = recording_org
      and u.created_at >= window_start
      and (window_end is null or u.created_at < window_end);
    cycle_available := greatest(cycle_limit_seconds - cycle_used_seconds, 0);
  end if;

  -- The ledger row is claimed BEFORE any pack is debited, and the unique index
  -- from 0030 is the fence. Debiting first and inserting with `on conflict do
  -- nothing` would silently spend the pack twice whenever a retry lost the
  -- race: the second run's insert would be swallowed while its debit stood.
  -- The split is provisional here and corrected below, once we know how far
  -- the packs actually reached.
  insert into public.audio_usage (
    org_id, recording_id, transcription_id, seconds, cycle_seconds, pack_seconds, kind, created_by
  )
  values (
    recording_org, target_recording, target_transcription, target_billable_seconds,
    target_billable_seconds, 0, 'transcription', recording_author
  )
  on conflict do nothing
  returning id into usage_id;

  if usage_id is null then
    -- Someone else already billed this recording. Idempotent, and crucially
    -- no pack was touched on this path.
    if not exists (
      select 1 from public.audio_usage u
      where u.recording_id = target_recording and u.kind = 'transcription'
    ) then
      raise exception 'usage_record_failed' using errcode = 'check_violation';
    end if;
    return apply_result || jsonb_build_object('billableSeconds', target_billable_seconds);
  end if;

  -- Cycle first, then the pack for what is left and only as far as it reaches.
  remaining := greatest(target_billable_seconds - least(target_billable_seconds::bigint, cycle_available), 0)::integer;

  for pack_row in
    select * from public.audio_minute_packs
    where org_id = recording_org
      and seconds_consumed < seconds_total
      and (expires_at is null or expires_at > now())
    -- Soonest to expire first, then oldest purchase: the order that wastes
    -- the least of what she paid for.
    order by expires_at nulls last, created_at
    for update
  loop
    exit when remaining <= 0;
    taken := least(remaining, pack_row.seconds_total - pack_row.seconds_consumed);
    update public.audio_minute_packs
    set seconds_consumed = seconds_consumed + taken
    where id = pack_row.id;
    pack_part := pack_part + taken;
    remaining := remaining - taken;
  end loop;

  -- Whatever no pack covered stays on the cycle, overrun included.
  if pack_part > 0 then
    update public.audio_usage
    set cycle_seconds = target_billable_seconds - pack_part,
        pack_seconds = pack_part
    where id = usage_id;
  end if;

  return apply_result || jsonb_build_object('billableSeconds', target_billable_seconds);
end;
$$;

revoke all on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer, text)
  to service_role;

comment on function public.apply_recording_result(uuid, uuid, uuid, jsonb, jsonb, integer, text) is
  'Atomic clinical merge + usage ledger for one processed recording. Billable seconds are server-measured; the chief complaint is filled only when still empty.';
