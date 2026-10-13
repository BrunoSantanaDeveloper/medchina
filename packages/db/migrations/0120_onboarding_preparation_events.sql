-- ============================================================
-- 0120_onboarding_preparation_events
--
-- O preparo do consultório passa a ser medido passo a passo.
--
-- O onboarding emitia um único evento — a escolha da trilha — e nenhum por
-- passo. O que se sabia sobre onde ele perdia alguém vinha de abrir o banco e
-- contar linhas ("travou no passo 5 de 8"), depois do fato. Com o onboarding
-- virando preparo (0119), a pergunta que decide se a mudança funcionou é
-- justamente essa: quem começa termina? onde sai?
--
-- Cinco eventos, nenhum sobre conteúdo:
--
--   onboarding.step_viewed    — o passo apareceu na tela.
--   onboarding.step_completed — ela concluiu o passo.
--   onboarding.step_skipped   — ela seguiu sem fazer ("Agora não").
--   onboarding.exited         — ela saiu do preparo ("Fazer depois"), e de qual passo.
--   onboarding.completed      — chegou ao fim.
--
-- E uma propriedade nova, `prep_step`, restrita às quatro chaves do preparo.
-- Abandono por fechar a aba não tem evento e não precisa: é um step_viewed sem
-- o completed/skipped/exited que o fecharia.
--
-- A disciplina da 0034 continua inteira: a função reconstrói as propriedades a
-- partir de chaves E valores permitidos. O que ela digitou no passo — as
-- modalidades, o registro profissional — não atravessa essa fronteira.
--
-- Copiada verbatim da 0104, com os cinco eventos e a propriedade somados.
-- ============================================================

-- ---------- A tabela também tem a lista ----------
--
-- O nome é validado em DOIS lugares (0104): a função descarta o que não
-- conhece e a tabela recusa. Ampliar só a função deixaria o evento morrer no
-- insert.

alter table public.product_events
  drop constraint product_events_name_check;

alter table public.product_events
  add constraint product_events_name_check check (event_name in (
    'journey.track_selected',
    'journey.track_reentered',
    'appointment.started',
    'appointment.completed',
    'appointment.abandoned',
    'patient.created_inline',
    'appointment.conflict',
    'recording.started',
    'recording.interrupted',
    'recording.recovered',
    'recording.upload_completed',
    'recording.processing_completed',
    'recording.failed',
    'consultation.finalized',
    'document.issued',
    'library.message_sent',
    'library.quota_hit',
    'case_review.started',
    'acervo.document_opened',
    'citation.opened',
    'briefing.opened',
    'protocol.saved',
    'upgrade.prompt_viewed',
    'upgrade.prompt_clicked',
    'billing.contact_clicked',
    'consultation.opened',
    'consultation.step_jump',
    'consultation.next_action',
    'onboarding.step_viewed',
    'onboarding.step_completed',
    'onboarding.step_skipped',
    'onboarding.exited',
    'onboarding.completed'
  ));

create or replace function public.track_product_event(target_event text, target_properties jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org uuid;
  safe_properties jsonb;
  intent_value text;
  origin_value text;
  state_value text;
  mode_value text;
  platform_value text;
  reason_value text;
  duration_value text;
  viewport_value text;
  step_value text;
  prep_step_value text;
  has_patient_value text;
  feature_value text;
begin
  if auth.uid() is null then return; end if;
  if target_event is null or target_event not in (
    'journey.track_selected', 'journey.track_reentered',
    'appointment.started', 'appointment.completed', 'appointment.abandoned',
    'patient.created_inline', 'appointment.conflict',
    'recording.started', 'recording.interrupted', 'recording.recovered',
    'recording.upload_completed', 'recording.processing_completed', 'recording.failed',
    'consultation.finalized', 'document.issued',
    -- A tela de consulta (0104). Ela não emitia NADA: o produto media a
    -- biblioteca e o onboarding e era cego justamente na tela onde a
    -- profissional passa o dia.
    'consultation.opened', 'consultation.step_jump', 'consultation.next_action',
    -- O preparo do consultório (0120): cada passo visto, concluído ou pulado, e
    -- por onde ela saiu. Sem isso a única forma de saber onde o onboarding
    -- perde alguém era abrir o banco.
    'onboarding.step_viewed', 'onboarding.step_completed', 'onboarding.step_skipped',
    'onboarding.exited', 'onboarding.completed',
    'library.message_sent', 'library.quota_hit', 'case_review.started',
    'acervo.document_opened', 'citation.opened', 'briefing.opened', 'protocol.saved',
    'upgrade.prompt_viewed', 'upgrade.prompt_clicked', 'billing.contact_clicked'
  ) then
    return;
  end if;

  select org_id into target_org
  from public.memberships
  where user_id = auth.uid()
  order by created_at
  limit 1;

  perform pg_advisory_xact_lock(hashtextextended('product-events:' || auth.uid()::text, 0));

  if (select count(*) from public.product_events
      where actor_id = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
    return;
  end if;

  target_properties := coalesce(target_properties, '{}'::jsonb);
  if jsonb_typeof(target_properties) <> 'object' then
    target_properties := '{}'::jsonb;
  end if;

  intent_value := case when target_properties ->> 'intent' in
    ('activation', 'schedule', 'manual', 'ai', 'review', 'demo')
    then target_properties ->> 'intent' end;
  origin_value := case when target_properties ->> 'origin' in
    (
      'agenda', 'schedule', 'getting_started', 'home', 'patient',
      'consultation', 'command_palette', 'onboarding', 'mobile',
      'menu', 'usage', 'billing'
    )
    then target_properties ->> 'origin' end;
  state_value := case when target_properties ->> 'state' in
    ('paused', 'recording', 'local', 'uploading', 'uploaded', 'processing', 'ready', 'failed', 'blocked', 'recovered')
    then target_properties ->> 'state' end;
  mode_value := case when target_properties ->> 'mode' in ('ai', 'audio_only')
    then target_properties ->> 'mode' end;
  platform_value := case when target_properties ->> 'platform' in ('web', 'mobile')
    then target_properties ->> 'platform' end;
  reason_value := case when target_properties ->> 'reason_code' in (
    'audio_consent_required', 'ai_consent_required', 'allowance_unavailable',
    'recording_pending', 'checksum_mismatch', 'not_authorized',
    'invalid_consultation_transition', 'recording_not_uploaded',
    'recording_too_long', 'recording_too_large', 'network_unavailable',
    'provider_unavailable', 'processing_failed', 'audio_file_missing',
    'metadata_corrupt'
  ) then target_properties ->> 'reason_code' end;
  duration_value := case when target_properties ->> 'duration_bucket' in
    ('under_5m', '5_15m', '15_30m', '30_60m', '60_120m')
    then target_properties ->> 'duration_bucket' end;
  viewport_value := case when target_properties ->> 'viewport' in
    ('320', '375', '768', '1440', 'small', 'medium', 'large')
    then target_properties ->> 'viewport' end;
  has_patient_value := case when target_properties ->> 'has_patient' in ('true', 'false')
    then target_properties ->> 'has_patient' end;
  -- As chaves de JourneyStepKey (packages/clinical/src/index.ts). Uma lista
  -- fechada, como todas as outras: o que importa é para ONDE ela pulou, nunca
  -- de qual paciente ou consulta.
  step_value := case when target_properties ->> 'step' in
    ('consent', 'record', 'review', 'hypotheses', 'plan', 'prescription', 'finalize')
    then target_properties ->> 'step' end;
  -- Os quatro passos do preparo (apps/web/src/lib/onboarding.ts, PrepStepKey).
  -- Propriedade própria, e não mais valores em `step`: lá as chaves são as da
  -- jornada da consulta, e `record`/`review` significariam duas coisas.
  prep_step_value := case when target_properties ->> 'prep_step' in
    ('scope', 'signature', 'recording', 'next')
    then target_properties ->> 'prep_step' end;

  feature_value := case when target_properties ->> 'feature' in
    ('plans', 'audio', 'clinical_reasoning', 'payment', 'audio_pack')
    then target_properties ->> 'feature' end;

  if target_event in ('upgrade.prompt_viewed', 'upgrade.prompt_clicked', 'billing.contact_clicked') then
    safe_properties := jsonb_strip_nulls(jsonb_build_object(
      'origin', origin_value,
      'feature', feature_value
    ));
  else
    safe_properties := jsonb_strip_nulls(jsonb_build_object(
      'intent', intent_value,
      'origin', origin_value,
      'state', state_value,
      'mode', mode_value,
      'platform', platform_value,
      'reason_code', reason_value,
      'duration_bucket', duration_value,
      'viewport', viewport_value,
      'has_patient', has_patient_value,
      'step', step_value,
      'prep_step', prep_step_value
    ));
  end if;

  insert into public.product_events (org_id, actor_id, event_name, properties)
  values (target_org, auth.uid(), target_event, safe_properties);
end;
$$;

revoke all on function public.track_product_event(text, jsonb) from public;
grant execute on function public.track_product_event(text, jsonb) to authenticated;
