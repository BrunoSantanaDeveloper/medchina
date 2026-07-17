-- ============================================================
-- 0033_mobile_delivery
--
-- Short-lived offline capture authorization and PHI-free push devices.
-- There is deliberately no purchase, plan or checkout state in this layer.
-- ============================================================

create table if not exists public.mobile_capture_authorizations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  audio_acceptance_id uuid not null references public.consent_acceptances(id),
  ai_acceptance_id uuid references public.consent_acceptances(id),
  ai_authorized boolean not null default false,
  used_at timestamptz,
  used_client_upload_id uuid,
  authorized_from_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, consultation_id)
);

-- `create table if not exists` does not add columns to a database that ran an
-- earlier draft of this migration. Backfill the actual authorization boundary
-- from the original row creation time before enforcing it.
alter table public.mobile_capture_authorizations
  add column if not exists authorized_from_at timestamptz;
update public.mobile_capture_authorizations
set authorized_from_at = created_at
where authorized_from_at is null;
alter table public.mobile_capture_authorizations
  alter column authorized_from_at set default now(),
  alter column authorized_from_at set not null;

alter table public.mobile_capture_authorizations enable row level security;

drop policy if exists mobile_capture_authorizations_select_own on public.mobile_capture_authorizations;
create policy mobile_capture_authorizations_select_own
  on public.mobile_capture_authorizations for select
  using (user_id = auth.uid() and public.is_org_member(org_id));

create table if not exists public.mobile_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  locale text not null default 'pt-BR' check (locale in ('pt-BR', 'en', 'es', 'fr', 'de')),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

alter table public.mobile_devices
  drop constraint if exists mobile_devices_user_id_expo_push_token_key;
create unique index if not exists mobile_devices_token_unique_idx
  on public.mobile_devices (expo_push_token);

alter table public.mobile_devices enable row level security;

drop policy if exists mobile_devices_select_own on public.mobile_devices;
create policy mobile_devices_select_own
  on public.mobile_devices for select
  using (user_id = auth.uid() and public.is_org_member(org_id));

create index if not exists mobile_devices_delivery_idx
  on public.mobile_devices (org_id, enabled)
  where enabled;

alter table public.recordings
  add column if not exists status_notification_state text,
  add column if not exists status_notified_at timestamptz;

alter table public.recordings
  drop constraint if exists recordings_status_notification_state_check;
alter table public.recordings
  add constraint recordings_status_notification_state_check
  check (status_notification_state is null or status_notification_state in ('recording_ready', 'recording_failed'));

alter table public.notifications add column if not exists source_key text;
create unique index if not exists notifications_source_key_unique_idx
  on public.notifications (source_key) where source_key is not null;

create table if not exists public.recording_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  kind text not null check (kind in ('recording_ready', 'recording_failed')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent')),
  attempts integer not null default 0 check (attempts >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recording_id, kind)
);
alter table public.recording_notification_outbox
  add column if not exists claim_token uuid;
alter table public.recording_notification_outbox enable row level security;
revoke all on table public.recording_notification_outbox from public;

create or replace function public.claim_recording_status_notification(
  target_recording uuid,
  target_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.recordings%rowtype;
  outbox_row public.recording_notification_outbox%rowtype;
  next_claim_token uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     or target_kind is null
     or target_kind not in ('recording_ready', 'recording_failed') then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select r.* into claimed
  from public.recordings r
  where r.id = target_recording
    and r.status = case when target_kind = 'recording_ready' then 'ready'::public.recording_status else 'failed'::public.recording_status end
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'recording_invalid_state'); end if;

  insert into public.recording_notification_outbox (recording_id, kind)
  values (target_recording, target_kind)
  on conflict (recording_id, kind) do nothing;

  select o.* into outbox_row
  from public.recording_notification_outbox o
  where o.recording_id = target_recording and o.kind = target_kind
  for update;

  if outbox_row.status = 'sent'
     or (
       outbox_row.status = 'processing'
       and outbox_row.claim_token is not null
       and outbox_row.lease_expires_at > now()
     ) then
    return jsonb_build_object('ok', false, 'code', 'already_notified');
  end if;

  next_claim_token := gen_random_uuid();
  update public.recording_notification_outbox
  set status = 'processing',
      attempts = attempts + 1,
      claim_token = next_claim_token,
      lease_expires_at = now() + interval '5 minutes',
      last_error_code = null,
      updated_at = now()
  where id = outbox_row.id;

  return jsonb_build_object(
    'ok', true,
    'outboxId', outbox_row.id,
    'claimToken', next_claim_token,
    'orgId', claimed.org_id,
    'consultationId', claimed.consultation_id,
    'userId', claimed.created_by
  );
end;
$$;

drop function if exists public.complete_recording_status_notification(uuid, boolean, text);
create or replace function public.complete_recording_status_notification(
  target_outbox uuid,
  target_claim_token uuid,
  target_success boolean,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  outbox_row public.recording_notification_outbox%rowtype;
  claimed_recording_id uuid;
  claimed_recording public.recordings%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_claim_token is null or target_success is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Match the claim path's lock order (recording, then outbox). The first read
  -- is intentionally unlocked; both rows are re-read after their locks exist.
  select o.recording_id into claimed_recording_id
  from public.recording_notification_outbox o
  where o.id = target_outbox;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select r.* into claimed_recording
  from public.recordings r
  where r.id = claimed_recording_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select o.* into outbox_row
  from public.recording_notification_outbox o
  where o.id = target_outbox
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if outbox_row.status = 'sent' then return jsonb_build_object('ok', true, 'code', 'sent'); end if;
  if outbox_row.status <> 'processing'
     or outbox_row.claim_token is distinct from target_claim_token then
    return jsonb_build_object('ok', false, 'code', 'notification_claim_lost');
  end if;

  if target_success is true then
    update public.recording_notification_outbox
    set status = 'sent', sent_at = now(), claim_token = null, lease_expires_at = null,
        last_error_code = null, updated_at = now()
    where id = target_outbox;
    update public.recordings
    set status_notification_state = outbox_row.kind,
        status_notified_at = now()
    where id = outbox_row.recording_id;
    return jsonb_build_object('ok', true, 'code', 'sent');
  end if;

  update public.recording_notification_outbox
  set status = 'pending', claim_token = null, lease_expires_at = null,
      last_error_code = coalesce(nullif(btrim(target_error_code), ''), 'delivery_failed'),
      updated_at = now()
  where id = target_outbox;
  return jsonb_build_object('ok', false, 'code', 'delivery_failed');
end;
$$;

-- The original trial RPC is logically idempotent but its check-then-insert can
-- race when web and mobile start the first real AI capture concurrently. Lock
-- the workspace and retain ON CONFLICT as a final fence. Callers still decide
-- whether starting the promotion is deliberate: web passes its confirmation;
-- authorize_mobile_recording below owns the online-mobile decision.
create or replace function public.start_pro_trial(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  params jsonb;
  trial_days integer;
  trial_minutes integer;
  allowance jsonb;
begin
  if not public.is_org_member(target_org) then
    raise exception 'not a member of this organization';
  end if;

  perform 1
  from public.organizations o
  where o.id = target_org
  for update;

  allowance := public.org_audio_allowance(target_org);
  if not coalesce((allowance ->> 'trial_available')::boolean, false) then
    return allowance;
  end if;

  select value into params from public.platform_settings where key = 'trial';
  trial_days := coalesce((params ->> 'days')::int, 14);
  trial_minutes := coalesce((params ->> 'minutes')::int, 300);

  insert into public.pro_trials (org_id, started_at, ends_at, minutes_limit, started_by)
  values (
    target_org,
    now(),
    now() + make_interval(days => trial_days),
    trial_minutes,
    auth.uid()
  )
  on conflict (org_id) do nothing;

  return public.org_audio_allowance(target_org);
end;
$$;

create or replace function public.authorize_mobile_recording(
  target_consultation uuid,
  target_mode text,
  target_client_upload_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  begin_result jsonb;
  target_org uuid;
  target_patient uuid;
  existing_recording public.recordings%rowtype;
  existing_authorization public.mobile_capture_authorizations%rowtype;
  audio_acceptance uuid;
  ai_acceptance uuid;
  authorization_data jsonb;
  authorization_row public.mobile_capture_authorizations%rowtype;
begin
  if target_mode is null
     or target_mode not in ('audio_only', 'ai')
     or target_client_upload_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select org_id, patient_id into target_org, target_patient
  from public.consultations
  where id = target_consultation;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.is_org_member(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  -- Online authorization is idempotent too. Return the durable result before
  -- current consent, allowance or consultation status can invalidate a retry
  -- whose original transaction already committed.
  select r.* into existing_recording
  from public.recordings r
  where r.org_id = target_org
    and r.client_upload_id = target_client_upload_id
  limit 1;
  if found then
    if existing_recording.consultation_id is distinct from target_consultation
       or existing_recording.mode is distinct from target_mode
       or existing_recording.captured_on is distinct from 'mobile' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;

    select a.* into existing_authorization
    from public.mobile_capture_authorizations a
    where a.org_id = target_org
      and a.user_id = auth.uid()
      and a.consultation_id = target_consultation
    limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'existing',
      'recordingId', existing_recording.id,
      'status', existing_recording.status,
      'mode', existing_recording.mode,
      'clientUploadId', existing_recording.client_upload_id,
      'authorizationId', existing_authorization.id,
      'authorizationFromAt', existing_authorization.authorized_from_at,
      'authorizationExpiresAt', existing_authorization.expires_at,
      'authorizations', '[]'::jsonb
    );
  end if;

  -- The authenticated mobile RPC is the deliberate online capture boundary:
  -- it may activate an eligible promotion for the first real AI capture. The
  -- client receives no trial-start switch and the web path remains explicit.
  -- begin_clinical_recording performs the consent/state checks before starting
  -- the promotion, and this outer transaction rolls everything back together.
  begin_result := public.begin_clinical_recording(
    target_consultation,
    target_mode,
    target_client_upload_id,
    target_mode = 'ai',
    'mobile'
  );

  if not coalesce((begin_result ->> 'ok')::boolean, false) then
    return begin_result;
  end if;

  audio_acceptance := public.active_consent_acceptance(target_org, target_patient, 'audio-recording');
  ai_acceptance := public.active_consent_acceptance(target_org, target_patient, 'ai-processing');
  if audio_acceptance is null or (target_mode = 'ai' and ai_acceptance is null) then
    raise exception 'consent_changed_during_authorization' using errcode = 'check_violation';
  end if;

  insert into public.mobile_capture_authorizations (
    org_id, user_id, consultation_id, patient_id, audio_acceptance_id,
    ai_acceptance_id, authorized_from_at, expires_at, ai_authorized, used_at, used_client_upload_id
  ) values (
    target_org, auth.uid(), target_consultation, target_patient, audio_acceptance,
    ai_acceptance, now(), now() + interval '24 hours', target_mode = 'ai', now(), target_client_upload_id
  )
  on conflict (org_id, user_id, consultation_id) do update
    set authorized_from_at = excluded.authorized_from_at,
        expires_at = excluded.expires_at,
        ai_authorized = excluded.ai_authorized,
        patient_id = excluded.patient_id,
        audio_acceptance_id = excluded.audio_acceptance_id,
        ai_acceptance_id = excluded.ai_acceptance_id,
        used_at = excluded.used_at,
        used_client_upload_id = excluded.used_client_upload_id,
        updated_at = now()
  returning * into authorization_row;

  -- Cache grants for the professional's other scheduled consultations in the
  -- next 24 hours without creating recording rows or starting another use.
  -- Each grant is pinned to the exact patient and acceptance ids valid now.
  insert into public.mobile_capture_authorizations (
    org_id, user_id, consultation_id, patient_id, audio_acceptance_id,
    ai_acceptance_id, authorized_from_at, expires_at, ai_authorized
  )
  select
    c.org_id,
    auth.uid(),
    c.id,
    c.patient_id,
    consents.audio_id,
    consents.ai_id,
    now(),
    now() + interval '24 hours',
    target_mode = 'ai' and consents.ai_id is not null
  from public.consultations c
  cross join lateral (
    select
      public.active_consent_acceptance(c.org_id, c.patient_id, 'audio-recording') as audio_id,
      public.active_consent_acceptance(c.org_id, c.patient_id, 'ai-processing') as ai_id
  ) consents
  where c.org_id = target_org
    and c.id <> target_consultation
    and c.status in ('scheduled', 'in_progress')
    and c.scheduled_for >= now() - interval '2 hours'
    and c.scheduled_for < now() + interval '24 hours'
    and consents.audio_id is not null
  on conflict (org_id, user_id, consultation_id) do update
    set patient_id = excluded.patient_id,
        audio_acceptance_id = excluded.audio_acceptance_id,
        ai_acceptance_id = excluded.ai_acceptance_id,
        authorized_from_at = excluded.authorized_from_at,
        expires_at = excluded.expires_at,
        ai_authorized = excluded.ai_authorized,
        updated_at = now();

  select coalesce(jsonb_agg(jsonb_build_object(
    'consultationId', a.consultation_id,
    'authorizationId', a.id,
    'authorizationFromAt', a.authorized_from_at,
    'authorizationExpiresAt', a.expires_at,
    'aiAuthorized', a.ai_authorized
  )), '[]'::jsonb)
  into authorization_data
  from public.mobile_capture_authorizations a
  where a.org_id = target_org
    and a.user_id = auth.uid()
    and a.expires_at > now()
    and a.used_at is null;

  return begin_result || jsonb_build_object(
    'authorizationId', authorization_row.id,
    'authorizationFromAt', authorization_row.authorized_from_at,
    'authorizationExpiresAt', authorization_row.expires_at,
    'authorizations', authorization_data
  );
end;
$$;

-- Let a still-valid offline grant authorize exactly the eventual recording
-- insert. The transaction-local setting is written only by the security
-- definer RPC below; arbitrary callers cannot manufacture a matching row.
create or replace function public.guard_recording_allowance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowance jsonb;
  authorization_text text := nullif(current_setting('medchina.mobile_capture_authorization', true), '');
  captured_text text := nullif(current_setting('medchina.mobile_capture_started_at', true), '');
begin
  if pg_trigger_depth() > 1 or new.mode = 'audio_only' then
    return new;
  end if;

  if authorization_text is not null and captured_text is not null and exists (
    select 1
    from public.mobile_capture_authorizations a
    where a.id = authorization_text::uuid
      and a.org_id = new.org_id
      and a.user_id = auth.uid()
      and a.consultation_id = new.consultation_id
      and a.patient_id = new.patient_id
      and a.ai_authorized
      and (a.used_at is null or a.used_client_upload_id is not distinct from new.client_upload_id)
      and captured_text::timestamptz >= a.authorized_from_at - interval '1 minute'
      and captured_text::timestamptz <= a.expires_at
  ) then
    return new;
  end if;

  allowance := public.org_audio_allowance(new.org_id);
  if not coalesce((allowance ->> 'can_start')::boolean, false) then
    if coalesce((allowance ->> 'trial_available')::boolean, false) then
      raise exception 'trial_not_started' using errcode = 'check_violation';
    end if;
    raise exception 'audio_allowance_exhausted' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Preserve the acceptance that authorized the offline capture, even if the
-- patient accepted a newer term version before the device reconnected. The
-- materialization RPC still requires a currently active consent immediately
-- before insert; this branch only fixes the historical provenance written on
-- the recording.
create or replace function public.guard_recording_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_acceptance uuid;
  current_ai_acceptance uuid;
  pinned_acceptance uuid;
  pinned_ai_acceptance uuid;
  captured_at timestamptz;
  authorization_text text := nullif(current_setting('medchina.mobile_capture_authorization', true), '');
  captured_text text := nullif(current_setting('medchina.mobile_capture_started_at', true), '');
begin
  if authorization_text is not null and captured_text is not null then
    captured_at := captured_text::timestamptz;
    select a.audio_acceptance_id, a.ai_acceptance_id
    into pinned_acceptance, pinned_ai_acceptance
    from public.mobile_capture_authorizations a
    where a.id = authorization_text::uuid
      and a.org_id = new.org_id
      and a.user_id = auth.uid()
      and a.consultation_id = new.consultation_id
      and a.patient_id = new.patient_id
      and (a.used_at is null or a.used_client_upload_id is not distinct from new.client_upload_id)
      and captured_at >= a.authorized_from_at - interval '1 minute'
      and captured_at <= a.expires_at
    limit 1;

    if found then
      if pinned_acceptance is null or not exists (
        select 1
        from public.consent_acceptances acceptance
        join public.consent_terms term on term.id = acceptance.term_id
        where acceptance.id = pinned_acceptance
          and acceptance.org_id = new.org_id
          and acceptance.subject_type = 'patient'
          and acceptance.subject_id = new.patient_id::text
          and acceptance.accepted_at <= captured_at
          and (acceptance.revoked_at is null or acceptance.revoked_at > captured_at)
          and term.slug = 'audio-recording'
          and term.created_at <= captured_at
          and not exists (
            select 1
            from public.consent_terms newer_term
            where newer_term.slug = term.slug
              and newer_term.version > term.version
              and newer_term.created_at <= captured_at
          )
      ) then
        raise exception 'consent_acceptance_mismatch' using errcode = 'check_violation';
      end if;
      if new.consent_acceptance_id is not null
         and new.consent_acceptance_id is distinct from pinned_acceptance then
        raise exception 'consent_acceptance_mismatch' using errcode = 'check_violation';
      end if;
      new.consent_acceptance_id := pinned_acceptance;

      if new.mode = 'ai' then
        if pinned_ai_acceptance is null or not exists (
          select 1
          from public.consent_acceptances acceptance
          join public.consent_terms term on term.id = acceptance.term_id
          where acceptance.id = pinned_ai_acceptance
            and acceptance.org_id = new.org_id
            and acceptance.subject_type = 'patient'
            and acceptance.subject_id = new.patient_id::text
            and acceptance.accepted_at <= captured_at
            and (acceptance.revoked_at is null or acceptance.revoked_at > captured_at)
            and term.slug = 'ai-processing'
            and term.created_at <= captured_at
            and not exists (
              select 1
              from public.consent_terms newer_term
              where newer_term.slug = term.slug
                and newer_term.version > term.version
                and newer_term.created_at <= captured_at
            )
        ) then
          raise exception 'consent_acceptance_mismatch' using errcode = 'check_violation';
        end if;
        if new.ai_consent_acceptance_id is not null
           and new.ai_consent_acceptance_id is distinct from pinned_ai_acceptance then
          raise exception 'consent_acceptance_mismatch' using errcode = 'check_violation';
        end if;
        new.ai_consent_acceptance_id := pinned_ai_acceptance;
      else
        new.ai_consent_acceptance_id := null;
      end if;
      return new;
    end if;
  end if;

  current_acceptance := public.active_consent_acceptance(new.org_id, new.patient_id, 'audio-recording');
  if current_acceptance is null then
    raise exception 'consent_required' using errcode = 'check_violation';
  end if;
  if new.consent_acceptance_id is not null
     and new.consent_acceptance_id is distinct from current_acceptance then
    raise exception 'consent_acceptance_mismatch' using errcode = 'check_violation';
  end if;
  new.consent_acceptance_id := current_acceptance;

  if new.mode = 'ai' then
    current_ai_acceptance := public.active_consent_acceptance(new.org_id, new.patient_id, 'ai-processing');
    if current_ai_acceptance is null then
      raise exception 'ai_consent_required' using errcode = 'check_violation';
    end if;
    if new.ai_consent_acceptance_id is not null
       and new.ai_consent_acceptance_id is distinct from current_ai_acceptance then
      raise exception 'consent_acceptance_mismatch' using errcode = 'check_violation';
    end if;
    new.ai_consent_acceptance_id := current_ai_acceptance;
  else
    new.ai_consent_acceptance_id := null;
  end if;
  return new;
end;
$$;

/**
 * Materialize a capture made offline under a 24-hour server grant. Consent is
 * checked again when connectivity returns; the immutable client upload id
 * makes a lost response/retry return the same recording.
 */
create or replace function public.begin_authorized_mobile_recording(
  target_consultation uuid,
  target_mode text,
  target_client_upload_id uuid,
  target_authorization uuid,
  target_captured_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  authorization_row public.mobile_capture_authorizations%rowtype;
  existing_row public.recordings%rowtype;
  created_row public.recordings%rowtype;
  violated_constraint text;
begin
  if target_mode is null
     or target_mode not in ('audio_only', 'ai')
     or target_client_upload_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not public.is_org_member(consultation_row.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  -- A lost response must remain replayable after the grant expires, consent
  -- changes, or the consultation advances. Those mutable checks authorized
  -- the original insert; the immutable client id proves this is its retry.
  select r.* into existing_row
  from public.recordings r
  where r.org_id = consultation_row.org_id
    and r.client_upload_id = target_client_upload_id
  limit 1;
  if found then
    if existing_row.consultation_id is distinct from target_consultation
       or existing_row.mode is distinct from target_mode
       or existing_row.captured_on is distinct from 'mobile' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'existing',
      'recordingId', existing_row.id,
      'status', existing_row.status,
      'mode', existing_row.mode,
      'clientUploadId', existing_row.client_upload_id
    );
  end if;

  select a.* into authorization_row
  from public.mobile_capture_authorizations a
  where a.id = target_authorization
    and a.org_id = consultation_row.org_id
    and a.user_id = auth.uid()
    and a.consultation_id = consultation_row.id
    and a.patient_id = consultation_row.patient_id
  for update;
  if not found
     or target_captured_at is null
     or target_captured_at < authorization_row.authorized_from_at - interval '1 minute'
     or target_captured_at > authorization_row.expires_at
     or target_captured_at > now() + interval '5 minutes'
     or target_captured_at < now() - interval '30 days'
     or (target_mode = 'ai' and not authorization_row.ai_authorized) then
    return jsonb_build_object('ok', false, 'code', 'allowance_unavailable');
  end if;

  if authorization_row.used_at is not null
     and authorization_row.used_client_upload_id is distinct from target_client_upload_id then
    return jsonb_build_object('ok', false, 'code', 'allowance_unavailable');
  end if;

  if not exists (
       select 1
       from public.consent_acceptances a
       join public.consent_terms t on t.id = a.term_id
       where a.id = authorization_row.audio_acceptance_id
         and a.org_id = consultation_row.org_id
         and a.subject_type = 'patient'
         and a.subject_id = consultation_row.patient_id::text
         and a.accepted_at <= target_captured_at
         and (a.revoked_at is null or a.revoked_at > target_captured_at)
         and t.slug = 'audio-recording'
         and t.created_at <= target_captured_at
         and not exists (
           select 1
           from public.consent_terms newer_term
           where newer_term.slug = t.slug
             and newer_term.version > t.version
             and newer_term.created_at <= target_captured_at
         )
     ) or (target_mode = 'ai' and not exists (
       select 1
       from public.consent_acceptances a
       join public.consent_terms t on t.id = a.term_id
       where a.id = authorization_row.ai_acceptance_id
         and a.org_id = consultation_row.org_id
         and a.subject_type = 'patient'
         and a.subject_id = consultation_row.patient_id::text
         and a.accepted_at <= target_captured_at
         and (a.revoked_at is null or a.revoked_at > target_captured_at)
         and t.slug = 'ai-processing'
         and t.created_at <= target_captured_at
         and not exists (
           select 1
           from public.consent_terms newer_term
           where newer_term.slug = t.slug
             and newer_term.version > t.version
             and newer_term.created_at <= target_captured_at
         )
     )) then
    return jsonb_build_object('ok', false, 'code', 'consent_acceptance_mismatch');
  end if;

  if consultation_row.status not in ('scheduled', 'draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition');
  end if;

  if not public.has_active_consent(consultation_row.org_id, consultation_row.patient_id, 'audio-recording') then
    return jsonb_build_object('ok', false, 'code', 'audio_consent_required');
  end if;
  if target_mode = 'ai'
     and not public.has_active_consent(consultation_row.org_id, consultation_row.patient_id, 'ai-processing') then
    return jsonb_build_object('ok', false, 'code', 'ai_consent_required');
  end if;

  if exists (
    select 1 from public.recordings r
    where r.consultation_id = target_consultation
      and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing')
  ) then
    return jsonb_build_object('ok', false, 'code', 'recording_already_open');
  end if;

  perform set_config('medchina.mobile_capture_authorization', authorization_row.id::text, true);
  perform set_config('medchina.mobile_capture_started_at', target_captured_at::text, true);
  insert into public.recordings (
    org_id, patient_id, consultation_id, status, mode, client_upload_id,
    captured_on, created_by, consent_acceptance_id, ai_consent_acceptance_id, capture_started_at
  ) values (
    consultation_row.org_id, consultation_row.patient_id, consultation_row.id,
    'recording', target_mode, target_client_upload_id, 'mobile', auth.uid(),
    authorization_row.audio_acceptance_id,
    case when target_mode = 'ai' then authorization_row.ai_acceptance_id else null end,
    target_captured_at
  ) returning * into created_row;

  update public.mobile_capture_authorizations
  set used_at = coalesce(used_at, now()),
      used_client_upload_id = coalesce(used_client_upload_id, target_client_upload_id),
      updated_at = now()
  where id = authorization_row.id;

  if consultation_row.status in ('scheduled', 'draft', 'awaiting_review') then
    update public.consultations set status = 'in_progress' where id = consultation_row.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'created',
    'recordingId', created_row.id,
    'status', created_row.status,
    'mode', created_row.mode,
    'clientUploadId', created_row.client_upload_id
  );
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = CONSTRAINT_NAME;

    if violated_constraint = 'recordings_client_upload_unique_idx' then
      select r.* into existing_row
      from public.recordings r
      where r.org_id = consultation_row.org_id
        and r.client_upload_id = target_client_upload_id
      limit 1;
      if found
         and existing_row.consultation_id is not distinct from target_consultation
         and existing_row.mode is not distinct from target_mode
         and existing_row.captured_on is not distinct from 'mobile' then
        return jsonb_build_object(
          'ok', true,
          'code', 'existing',
          'recordingId', existing_row.id,
          'status', existing_row.status,
          'mode', existing_row.mode,
          'clientUploadId', existing_row.client_upload_id
        );
      end if;
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    elsif violated_constraint = 'recordings_one_open_per_consultation_idx' then
      return jsonb_build_object(
        'ok', false,
        'code', 'recording_already_open',
        'recordingId', (
          select r.id from public.recordings r
          where r.consultation_id = target_consultation
            and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing')
          order by r.created_at desc
          limit 1
        )
      );
    elsif violated_constraint = 'consultations_one_active_clinical_per_patient_idx' then
      return jsonb_build_object(
        'ok', false,
        'code', 'active_consultation_exists',
        'consultationId', (
          select c.id from public.consultations c
          where c.org_id = consultation_row.org_id
            and c.patient_id = consultation_row.patient_id
            and c.status in ('draft', 'in_progress', 'awaiting_review')
            and c.id <> target_consultation
          order by c.updated_at desc
          limit 1
        )
      );
    end if;
    raise;
  when check_violation then
    if sqlerrm = 'consent_required' then
      return jsonb_build_object('ok', false, 'code', 'audio_consent_required');
    elsif sqlerrm = 'ai_consent_required' then
      return jsonb_build_object('ok', false, 'code', 'ai_consent_required');
    elsif sqlerrm = 'consent_acceptance_mismatch' then
      return jsonb_build_object('ok', false, 'code', 'consent_acceptance_mismatch');
    elsif sqlerrm in ('trial_not_started', 'audio_allowance_exhausted') then
      return jsonb_build_object('ok', false, 'code', 'allowance_unavailable');
    end if;
    raise;
end;
$$;

create or replace function public.current_mobile_capture_authorization(target_org uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case
    when not (public.is_org_member(target_org) or public.is_superadmin())
      then jsonb_build_object('ok', false, 'code', 'not_authorized')
    else jsonb_build_object(
      'ok', true,
      'authorizations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'authorizationId', a.id,
          'consultationId', a.consultation_id,
          'authorizationFromAt', a.authorized_from_at,
          'authorizationExpiresAt', a.expires_at,
          'aiAuthorized', a.ai_authorized
        ) order by a.expires_at, a.consultation_id)
        from public.mobile_capture_authorizations a
        where a.org_id = target_org
          and a.user_id = auth.uid()
          and a.expires_at > now()
          and a.used_at is null
      ), '[]'::jsonb)
    )
  end;
$$;

create or replace function public.register_mobile_device(
  target_org uuid,
  target_token text,
  target_platform text,
  target_locale text default 'pt-BR'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  device_row public.mobile_devices%rowtype;
begin
  if not public.is_org_member(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_platform not in ('ios', 'android')
     or target_locale not in ('pt-BR', 'en', 'es', 'fr', 'de')
     or nullif(btrim(target_token), '') is null
     or length(target_token) > 512 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  insert into public.mobile_devices (org_id, user_id, expo_push_token, platform, locale)
  values (target_org, auth.uid(), btrim(target_token), target_platform, target_locale)
  on conflict (expo_push_token) do update
    set org_id = excluded.org_id,
        user_id = excluded.user_id,
        platform = excluded.platform,
        locale = excluded.locale,
        enabled = true,
        last_seen_at = now(),
        updated_at = now()
  returning * into device_row;

  return jsonb_build_object('ok', true, 'code', 'registered', 'deviceId', device_row.id);
end;
$$;

create or replace function public.disable_mobile_device(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mobile_devices
  set enabled = false, updated_at = now()
  where user_id = auth.uid() and expo_push_token = target_token;
  return jsonb_build_object('ok', true, 'code', 'disabled');
end;
$$;

revoke all on table public.mobile_capture_authorizations from public;
revoke all on table public.mobile_devices from public;
grant select on table public.mobile_capture_authorizations to authenticated;
grant select on table public.mobile_devices to authenticated;

revoke all on function public.authorize_mobile_recording(uuid, text, uuid) from public;
revoke all on function public.begin_authorized_mobile_recording(uuid, text, uuid, uuid, timestamptz) from public;
revoke all on function public.current_mobile_capture_authorization(uuid) from public;
revoke all on function public.register_mobile_device(uuid, text, text, text) from public;
revoke all on function public.disable_mobile_device(text) from public;
revoke all on function public.claim_recording_status_notification(uuid, text) from public;
revoke all on function public.complete_recording_status_notification(uuid, uuid, boolean, text) from public;
grant execute on function public.authorize_mobile_recording(uuid, text, uuid) to authenticated;
grant execute on function public.begin_authorized_mobile_recording(uuid, text, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.current_mobile_capture_authorization(uuid) to authenticated;
grant execute on function public.register_mobile_device(uuid, text, text, text) to authenticated;
grant execute on function public.disable_mobile_device(text) to authenticated;
grant execute on function public.claim_recording_status_notification(uuid, text) to service_role;
grant execute on function public.complete_recording_status_notification(uuid, uuid, boolean, text) to service_role;
