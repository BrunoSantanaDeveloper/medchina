-- ============================================================
-- 0104_consultation_product_events
--
-- A tela de consulta passa a ser medida.
--
-- Ela é a tela onde a profissional passa o dia — e era a única grande sem uma
-- única chamada de telemetria: o produto sabia dizer quantas conversas a
-- biblioteca teve e quantas trilhas de onboarding foram concluídas, e não sabia
-- dizer quantas consultas foram abertas nem por onde ela anda dentro delas.
-- Redesenhar a condução dessa tela sem isso seria opinião contra opinião.
--
-- Três eventos, nenhum deles sobre conteúdo clínico:
--
--   consultation.opened     — a tela foi aberta.
--   consultation.step_jump  — ela usou o trilho para ir a uma etapa.
--   consultation.next_action — ela usou o botão da próxima ação recomendada.
--
-- E uma propriedade nova, `step`, restrita às sete chaves de JourneyStepKey.
-- A disciplina da 0034 continua valendo inteira: a função reconstrói as
-- propriedades a partir de chaves E valores permitidos, então id de paciente,
-- texto livre ou qualquer coisa clínica não atravessa essa fronteira.
--
-- Copiada verbatim da 0054, com os três eventos e a propriedade somados.
-- ============================================================

-- ---------- A tabela também tem a lista ----------
--
-- O nome é validado em DOIS lugares: a função descarta o que não conhece e a
-- tabela recusa. Ampliar só a função deixaria o evento morrer no insert, que
-- foi exatamente o que o teste pgTAP apontou.

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
    'consultation.next_action'
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
      'step', step_value
    ));
  end if;

  insert into public.product_events (org_id, actor_id, event_name, properties)
  values (target_org, auth.uid(), target_event, safe_properties);
end;
$$;

revoke all on function public.track_product_event(text, jsonb) from public;
grant execute on function public.track_product_event(text, jsonb) to authenticated;
