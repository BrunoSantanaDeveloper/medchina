-- ============================================================
-- 0050_product_ux_optimization
-- Progressive professional context and privacy-filtered upgrade telemetry.
-- ============================================================

alter table public.profiles
  add column if not exists practice_modalities text[] not null default '{}'::text[];

alter table public.organizations
  add column if not exists timezone_confirmed_at timestamptz;

-- Saving the practice settings is also an explicit timezone confirmation.
create or replace function public.update_practice_settings(
  target_org uuid,
  target_name text,
  target_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := nullif(btrim(target_name), '');
  normalized_timezone text := nullif(btrim(target_timezone), '');
  previous_org public.organizations%rowtype;
  updated_org public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if target_org is null
     or normalized_name is null
     or char_length(normalized_name) < 3
     or char_length(normalized_name) > 120 then
    raise exception using errcode = '22023', message = 'invalid_practice_name';
  end if;
  if normalized_timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
     ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;

  select o.* into previous_org
  from public.organizations o
  where o.id = target_org
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  update public.organizations
     set name = normalized_name,
         timezone = normalized_timezone,
         timezone_confirmed_at = coalesce(timezone_confirmed_at, now())
   where id = target_org
     and (
       name is distinct from normalized_name
       or timezone is distinct from normalized_timezone
       or timezone_confirmed_at is null
     )
   returning * into updated_org;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'code', 'unchanged',
      'id', previous_org.id,
      'name', previous_org.name,
      'timezone', previous_org.timezone,
      'timezone_confirmed_at', previous_org.timezone_confirmed_at
    );
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'org.settings.updated',
    'organization',
    target_org::text,
    jsonb_build_object(
      'nameChanged', previous_org.name is distinct from updated_org.name,
      'previousName', previous_org.name,
      'name', updated_org.name,
      'timezoneChanged', previous_org.timezone is distinct from updated_org.timezone,
      'previousTimezone', previous_org.timezone,
      'timezone', updated_org.timezone,
      'timezoneConfirmed', previous_org.timezone_confirmed_at is null
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'updated',
    'id', updated_org.id,
    'name', updated_org.name,
    'timezone', updated_org.timezone,
    'timezone_confirmed_at', updated_org.timezone_confirmed_at
  );
end;
$$;

revoke all on function public.update_practice_settings(uuid, text, text) from public;
grant execute on function public.update_practice_settings(uuid, text, text) to authenticated;

create or replace function public.complete_practice_context(
  target_org uuid,
  target_timezone text,
  target_modalities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_timezone text := nullif(btrim(target_timezone), '');
  normalized_modalities text[];
  previous_timezone text;
  confirmed_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if target_org is null
     or not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if normalized_timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
     ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[])
    into normalized_modalities
  from (
    select distinct lower(btrim(modality)) as value
    from unnest(coalesce(target_modalities, '{}'::text[])) as modality
    where nullif(btrim(modality), '') is not null
  ) normalized;

  if exists (
    select 1
    from unnest(normalized_modalities) as modality
    where modality <> all (
      array['acupuncture', 'diet', 'moxibustion', 'auriculotherapy', 'cupping']::text[]
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_modality';
  end if;

  select timezone
    into previous_timezone
  from public.organizations
  where id = target_org
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  update public.organizations
     set timezone = normalized_timezone,
         timezone_confirmed_at = now()
   where id = target_org
   returning timezone_confirmed_at into confirmed_at;

  update public.profiles
     set practice_modalities = normalized_modalities,
         updated_at = now()
   where id = auth.uid();

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'practice.context.completed',
    'organization',
    target_org::text,
    jsonb_build_object(
      'timezoneChanged', previous_timezone is distinct from normalized_timezone,
      'timezone', normalized_timezone,
      'modalityCount', cardinality(normalized_modalities)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'timezone', normalized_timezone,
    'practice_modalities', normalized_modalities,
    'timezone_confirmed_at', confirmed_at
  );
end;
$$;

revoke all on function public.complete_practice_context(uuid, text, text[]) from public;
grant execute on function public.complete_practice_context(uuid, text, text[]) to authenticated;

-- Commercial prompts are measured without patient, consultation or free-text
-- data. The RPC continues to rebuild properties from allowlisted values only.
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
    'billing.contact_clicked'
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
  feature_value := case when target_properties ->> 'feature' in
    ('plans', 'audio', 'clinical_reasoning')
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
      'has_patient', has_patient_value
    ));
  end if;

  insert into public.product_events (org_id, actor_id, event_name, properties)
  values (target_org, auth.uid(), target_event, safe_properties);
end;
$$;

revoke all on function public.track_product_event(text, jsonb) from public;
grant execute on function public.track_product_event(text, jsonb) to authenticated;
