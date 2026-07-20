-- ============================================================
-- 0048_library_product_events: the out-of-consultation layer
-- (biblioteca, acervo, briefing, protocolos) becomes measurable.
--
-- 0034 deliberately allowlists BOTH the event names and every property
-- key/value, so clinical content, names and UUIDs cannot cross into the
-- operational table. Adding events therefore means extending the
-- allowlist here — never loosening it. The one new property is
-- `has_patient` ('true'/'false'): whether a library question was about a
-- patient's case, WITHOUT ever carrying which patient.
-- ============================================================

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
    -- Out-of-consultation layer
    'library.message_sent',
    'library.quota_hit',
    'case_review.started',
    'acervo.document_opened',
    'citation.opened',
    'briefing.opened',
    'protocol.saved'
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
  has_patient_value text;
begin
  if auth.uid() is null then return; end if;
  if target_event is null or target_event not in (
    'journey.track_selected', 'journey.track_reentered',
    'appointment.started', 'appointment.completed', 'appointment.abandoned',
    'patient.created_inline', 'appointment.conflict',
    'recording.started', 'recording.interrupted', 'recording.recovered',
    'recording.upload_completed', 'recording.processing_completed', 'recording.failed',
    'consultation.finalized', 'document.issued',
    'library.message_sent', 'library.quota_hit', 'case_review.started',
    'acervo.document_opened', 'citation.opened', 'briefing.opened', 'protocol.saved'
  ) then
    return;
  end if;

  select org_id into target_org
  from public.memberships
  where user_id = auth.uid()
  order by created_at
  limit 1;

  -- Serialize each actor's rate decision. Without the transaction lock, a
  -- burst of concurrent requests could all observe 119 rows and all insert.
  perform pg_advisory_xact_lock(hashtextextended('product-events:' || auth.uid()::text, 0));

  -- Protect the operational table from a noisy or compromised client.
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
    ('agenda', 'schedule', 'getting_started', 'home', 'patient', 'consultation', 'command_palette', 'onboarding', 'mobile')
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
  -- Whether a library question was about a patient case — never WHICH patient.
  has_patient_value := case when target_properties ->> 'has_patient' in ('true', 'false')
    then target_properties ->> 'has_patient' end;

  -- Rebuild from allowlisted keys AND values. UUIDs, free text, nested JSON,
  -- names and clinical content cannot cross this boundary.
  safe_properties := jsonb_strip_nulls(jsonb_build_object(
    'intent', intent_value,
    'origin', origin_value,
    'state', state_value,
    'mode', mode_value,
    'platform', platform_value,
    'reason_code', reason_value,
    'duration_bucket', duration_value,
    'viewport', viewport_value,
    'has_patient', has_patient_value
  ));

  insert into public.product_events (org_id, actor_id, event_name, properties)
  values (target_org, auth.uid(), target_event, safe_properties);
end;
$$;

revoke all on function public.track_product_event(text, jsonb) from public;
grant execute on function public.track_product_event(text, jsonb) to authenticated;
