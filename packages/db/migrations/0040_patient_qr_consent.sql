-- ============================================================
-- 0040_patient_qr_consent
-- Patient-owned consent collection through a short-lived, one-time QR
-- session. The UI is one step, while each purpose remains an independent,
-- version-pinned decision and acceptance.
-- ============================================================

create table public.patient_consent_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  consultation_id uuid references public.consultations (id) on delete set null,
  -- Only a SHA-256 digest is persisted. The bearer token never reaches SQL.
  token_hash text not null,
  client_request_id uuid not null,
  status text not null default 'pending',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  opened_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  completion_idempotency_key uuid,
  signer_role text,
  signer_name text,
  representative_relationship text,
  identity_declared_at timestamptz,
  affirmation_version integer not null default 1,
  presented_locale text not null default 'pt-BR',
  constraint patient_consent_sessions_token_hash_format_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint patient_consent_sessions_status_check
    check (status in ('pending', 'completed', 'cancelled', 'expired', 'invalidated')),
  constraint patient_consent_sessions_expiry_check
    check (expires_at > created_at),
  constraint patient_consent_sessions_close_reason_size_check
    check (close_reason is null or char_length(close_reason) <= 120),
  constraint patient_consent_sessions_affirmation_version_check
    check (affirmation_version > 0),
  constraint patient_consent_sessions_presented_locale_check
    check (presented_locale in ('pt-BR', 'en', 'es', 'fr', 'de')),
  constraint patient_consent_sessions_lifecycle_check
    check (
      (status = 'pending' and completed_at is null and closed_at is null)
      or (status = 'completed' and completed_at is not null and closed_at is null)
      or (
        status in ('cancelled', 'expired', 'invalidated')
        and completed_at is null
        and closed_at is not null
      )
    ),
  constraint patient_consent_sessions_identity_check
    check (
      (
        status = 'completed'
        and signer_role in ('patient', 'legal_representative')
        and nullif(btrim(signer_name), '') is not null
        and char_length(signer_name) <= 160
        and identity_declared_at is not null
        and completion_idempotency_key is not null
        and (
          (signer_role = 'patient' and representative_relationship is null)
          or (
            signer_role = 'legal_representative'
            and nullif(btrim(representative_relationship), '') is not null
            and char_length(representative_relationship) <= 120
          )
        )
      )
      or (
        status <> 'completed'
        and signer_role is null
        and signer_name is null
        and representative_relationship is null
        and identity_declared_at is null
        and completion_idempotency_key is null
      )
    ),
  unique (token_hash),
  unique (org_id, client_request_id)
);

create unique index patient_consent_sessions_one_pending_patient_idx
  on public.patient_consent_sessions (patient_id)
  where status = 'pending';

create index patient_consent_sessions_org_created_idx
  on public.patient_consent_sessions (org_id, created_at desc);

create index patient_consent_sessions_pending_expiry_idx
  on public.patient_consent_sessions (expires_at)
  where status = 'pending';

alter table public.consent_acceptances
  -- NO ACTION deliberately preserves direct-patient evidence. A hard patient
  -- delete is blocked once a QR acceptance exists; the audited deletion
  -- workflow must handle the legal-retention decision explicitly.
  add column consent_session_id uuid references public.patient_consent_sessions (id),
  add column manifested_by text not null default 'professional';

alter table public.consent_acceptances
  add constraint consent_acceptances_manifested_by_check
    check (manifested_by in ('professional', 'patient', 'legal_representative')) not valid,
  add constraint consent_acceptances_patient_manifestation_session_check
    check (manifested_by = 'professional' or consent_session_id is not null) not valid;

alter table public.consent_acceptances
  validate constraint consent_acceptances_manifested_by_check;
alter table public.consent_acceptances
  validate constraint consent_acceptances_patient_manifestation_session_check;

create unique index consent_acceptances_session_term_unique_idx
  on public.consent_acceptances (consent_session_id, term_id)
  where consent_session_id is not null;

create table public.patient_consent_session_items (
  session_id uuid not null references public.patient_consent_sessions (id) on delete cascade,
  term_id uuid not null references public.consent_terms (id),
  slug text not null,
  -- Exact text shown on the patient's device. Later term edits cannot rewrite
  -- the evidence for a completed manifestation.
  term_title text not null,
  term_body text not null,
  term_version integer not null,
  decision boolean,
  decided_at timestamptz,
  acceptance_id uuid references public.consent_acceptances (id),
  primary key (session_id, slug),
  unique (session_id, term_id),
  constraint patient_consent_session_items_slug_check
    check (slug in ('audio-recording', 'ai-processing', 'clinical-images')),
  constraint patient_consent_session_items_version_check check (term_version > 0),
  constraint patient_consent_session_items_decision_check
    check (
      (decision is null and decided_at is null and acceptance_id is null)
      or (decision is true and decided_at is not null and acceptance_id is not null)
      or (decision is false and decided_at is not null and acceptance_id is null)
    )
);

alter table public.patient_consent_sessions enable row level security;
alter table public.patient_consent_session_items enable row level security;

-- Sessions contain bearer-token digests and are deliberately RPC-only.
-- Even the service API must pass through the narrowly scoped definer RPCs.
revoke all on table public.patient_consent_sessions
  from public, anon, authenticated, service_role;
revoke all on table public.patient_consent_session_items
  from public, anon, authenticated, service_role;

-- Acceptance history is also mutation-RPC-only. Reads remain available to
-- members through the existing tenant-scoped select policy.
drop policy if exists "consent_acceptances_insert_member" on public.consent_acceptances;
drop policy if exists "consent_acceptances_update_member" on public.consent_acceptances;
revoke insert, update, delete on table public.consent_acceptances
  from public, anon, authenticated, service_role;

-- Include QR provenance in the immutable acceptance-history boundary.
create or replace function public.guard_consent_acceptance_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.term_id is distinct from old.term_id
     or new.org_id is distinct from old.org_id
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.recorded_by is distinct from old.recorded_by
     or new.metadata is distinct from old.metadata
     or new.accepted_at is distinct from old.accepted_at
     or new.consent_session_id is distinct from old.consent_session_id
     or new.manifested_by is distinct from old.manifested_by
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.revoked_at is null and new.revoked_at is null) then
    raise exception 'consent_history_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Professional-recorded consent remains available, but arbitrary metadata
-- can no longer impersonate a patient-owned QR manifestation.
create or replace function public.set_patient_consent(
  target_patient uuid,
  target_slug text,
  target_granted boolean,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.patients%rowtype;
  term_row public.consent_terms%rowtype;
  acceptance_row public.consent_acceptances%rowtype;
  safe_method text;
  consultation_text text;
  safe_consultation uuid;
  safe_metadata jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if target_granted is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if jsonb_typeof(coalesce(target_metadata, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select p.* into patient_row
  from public.patients p
  where p.id = target_patient
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(patient_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select t.* into term_row
  from public.consent_terms t
  where t.slug = target_slug and t.is_active
  order by t.version desc
  limit 1
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'consent_term_missing');
  end if;

  if target_granted then
    safe_method := target_metadata ->> 'method';
    if safe_method is null or safe_method not in ('verbal', 'in_person') then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;

    consultation_text := nullif(btrim(target_metadata ->> 'consultationId'), '');
    if consultation_text is not null then
      begin
        safe_consultation := consultation_text::uuid;
      exception when invalid_text_representation then
        return jsonb_build_object('ok', false, 'code', 'invalid_request');
      end;

      if not exists (
        select 1 from public.consultations c
        where c.id = safe_consultation
          and c.org_id = patient_row.org_id
          and c.patient_id = patient_row.id
      ) then
        return jsonb_build_object('ok', false, 'code', 'invalid_request');
      end if;
    end if;

    safe_metadata := jsonb_strip_nulls(jsonb_build_object(
      'method', safe_method,
      'manifestedBy', 'professional',
      'consultationId', safe_consultation
    ));

    select a.* into acceptance_row
    from public.consent_acceptances a
    where a.term_id = term_row.id
      and a.org_id = patient_row.org_id
      and a.subject_type = 'patient'
      and a.subject_id = target_patient::text
      and a.revoked_at is null
    limit 1
    for update;

    if not found then
      insert into public.consent_acceptances (
        term_id, org_id, subject_type, subject_id, recorded_by, metadata,
        consent_session_id, manifested_by
      ) values (
        term_row.id,
        patient_row.org_id,
        'patient',
        target_patient::text,
        auth.uid(),
        safe_metadata,
        null,
        'professional'
      )
      returning * into acceptance_row;
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'granted',
      'active', true,
      'acceptanceId', acceptance_row.id,
      'termId', term_row.id,
      'version', term_row.version,
      'acceptedAt', acceptance_row.accepted_at
    );
  end if;

  update public.consent_acceptances a
  set revoked_at = now()
  from public.consent_terms t
  where a.term_id = t.id
    and a.org_id = patient_row.org_id
    and a.subject_type = 'patient'
    and a.subject_id = target_patient::text
    and a.revoked_at is null
    and t.slug = target_slug;

  return jsonb_build_object('ok', true, 'code', 'revoked', 'active', false, 'version', term_row.version);
end;
$$;

create or replace function public.create_patient_consent_session(
  target_patient uuid,
  target_token_hash text,
  target_request_id uuid,
  target_consultation uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.patients%rowtype;
  existing_row public.patient_consent_sessions%rowtype;
  created_session uuid;
  term_count integer;
  current_term_count integer;
  superseded record;
  expires_at_value timestamptz := clock_timestamp() + interval '15 minutes';
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if target_request_id is null
     or target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select p.* into patient_row
  from public.patients p
  where p.id = target_patient
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(patient_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if patient_row.archived_at is not null then
    return jsonb_build_object('ok', false, 'code', 'patient_unavailable');
  end if;

  if target_consultation is not null and not exists (
    select 1 from public.consultations c
    where c.id = target_consultation
      and c.org_id = patient_row.org_id
      and c.patient_id = patient_row.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- A response-lost retry may carry a newly generated raw token. Rotate its
  -- digest and restart the 15-minute window without creating another session.
  select s.* into existing_row
  from public.patient_consent_sessions s
  where s.org_id = patient_row.org_id
    and s.client_request_id = target_request_id
  for update;

  if found then
    if existing_row.patient_id is distinct from target_patient
       or existing_row.consultation_id is distinct from target_consultation
       or existing_row.status <> 'pending' then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;

    if existing_row.expires_at <= clock_timestamp() then
      update public.patient_consent_sessions
      set status = 'expired', closed_at = clock_timestamp(), close_reason = 'link_expired'
      where id = existing_row.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (
        existing_row.org_id, auth.uid(), 'consent.collection.expired',
        'consent_session', existing_row.id::text,
        jsonb_build_object('patientId', existing_row.patient_id)
      );
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;

    perform 1
    from public.consent_terms t
    join public.patient_consent_session_items i on i.term_id = t.id
    where i.session_id = existing_row.id
      and t.is_active
    for share of t;

    select count(*) into current_term_count
    from public.patient_consent_session_items i
    join public.consent_terms t on t.id = i.term_id and t.is_active
    where i.session_id = existing_row.id;

    if current_term_count <> 3 then
      update public.patient_consent_sessions
      set status = 'invalidated', closed_at = clock_timestamp(), close_reason = 'consent_terms_changed'
      where id = existing_row.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (
        existing_row.org_id, auth.uid(), 'consent.collection.invalidated',
        'consent_session', existing_row.id::text,
        jsonb_build_object('reason', 'consent_terms_changed', 'patientId', existing_row.patient_id)
      );
      return jsonb_build_object('ok', false, 'code', 'consent_terms_changed');
    end if;

    update public.patient_consent_sessions
    set token_hash = target_token_hash,
        expires_at = expires_at_value,
        opened_at = null
    where id = existing_row.id;

    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      existing_row.org_id, auth.uid(), 'consent.collection.rotated',
      'consent_session', existing_row.id::text,
      jsonb_build_object('patientId', existing_row.patient_id, 'expiresAt', expires_at_value)
    );

    return jsonb_build_object(
      'ok', true,
      'code', 'rotated',
      'sessionId', existing_row.id,
      'expiresAt', expires_at_value
    );
  end if;

  perform 1
  from public.consent_terms t
  where t.is_active
    and t.slug in ('audio-recording', 'ai-processing', 'clinical-images')
  for share;

  select count(*) into term_count
  from public.consent_terms t
  where t.is_active
    and t.slug in ('audio-recording', 'ai-processing', 'clinical-images');

  if term_count <> 3 then
    return jsonb_build_object('ok', false, 'code', 'consent_term_missing');
  end if;

  for superseded in
    update public.patient_consent_sessions s
    set status = case when s.expires_at <= clock_timestamp() then 'expired' else 'cancelled' end,
        closed_at = clock_timestamp(),
        close_reason = case when s.expires_at <= clock_timestamp() then 'link_expired' else 'superseded' end
    where s.patient_id = target_patient and s.status = 'pending'
    returning s.id, s.org_id, s.status, s.close_reason
  loop
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      superseded.org_id,
      auth.uid(),
      case when superseded.status = 'expired'
        then 'consent.collection.expired'
        else 'consent.collection.cancelled'
      end,
      'consent_session',
      superseded.id::text,
      jsonb_build_object('reason', superseded.close_reason, 'patientId', target_patient)
    );
  end loop;

  insert into public.patient_consent_sessions (
    org_id, patient_id, consultation_id, token_hash, client_request_id,
    created_by, expires_at
  ) values (
    patient_row.org_id, target_patient, target_consultation, target_token_hash,
    target_request_id, auth.uid(), expires_at_value
  ) returning id into created_session;

  insert into public.patient_consent_session_items (
    session_id, term_id, slug, term_title, term_body, term_version
  )
  select created_session, t.id, t.slug, t.title, t.body, t.version
  from public.consent_terms t
  where t.is_active
    and t.slug in ('audio-recording', 'ai-processing', 'clinical-images');

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    patient_row.org_id, auth.uid(), 'consent.collection.created',
    'consent_session', created_session::text,
    jsonb_strip_nulls(jsonb_build_object(
      'patientId', target_patient,
      'consultationId', target_consultation,
      'expiresAt', expires_at_value,
      'purposeCount', 3
    ))
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'created',
    'sessionId', created_session,
    'expiresAt', expires_at_value
  );
end;
$$;

create or replace function public.get_patient_consent_session_status(target_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.patient_consent_sessions%rowtype;
  decisions jsonb;
begin
  select s.* into session_row
  from public.patient_consent_sessions s
  where s.id = target_session
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(session_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if session_row.status = 'pending' and session_row.expires_at <= clock_timestamp() then
    update public.patient_consent_sessions
    set status = 'expired', closed_at = clock_timestamp(), close_reason = 'link_expired'
    where id = session_row.id
    returning * into session_row;

    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      session_row.org_id, auth.uid(), 'consent.collection.expired',
      'consent_session', session_row.id::text,
      jsonb_build_object('patientId', session_row.patient_id)
    );
  end if;

  select coalesce(jsonb_object_agg(i.slug, to_jsonb(i.decision)), '{}'::jsonb)
  into decisions
  from public.patient_consent_session_items i
  where i.session_id = session_row.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'status',
    'sessionId', session_row.id,
    'patientId', session_row.patient_id,
    'consultationId', session_row.consultation_id,
    'status', session_row.status,
    'expiresAt', session_row.expires_at,
    'openedAt', session_row.opened_at,
    'completedAt', session_row.completed_at,
    'decisions', decisions
  );
end;
$$;

create or replace function public.cancel_patient_consent_session(target_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.patient_consent_sessions%rowtype;
begin
  select s.* into session_row
  from public.patient_consent_sessions s
  where s.id = target_session
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (public.is_org_member(session_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if session_row.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'code', 'cancelled', 'sessionId', session_row.id);
  end if;
  if session_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'stale_status');
  end if;

  update public.patient_consent_sessions
  set status = 'cancelled', closed_at = clock_timestamp(), close_reason = 'professional_cancelled'
  where id = session_row.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    session_row.org_id, auth.uid(), 'consent.collection.cancelled',
    'consent_session', session_row.id::text,
    jsonb_build_object('reason', 'professional_cancelled', 'patientId', session_row.patient_id)
  );

  return jsonb_build_object('ok', true, 'code', 'cancelled', 'sessionId', session_row.id);
end;
$$;

create or replace function public.resolve_patient_consent_session(target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.patient_consent_sessions%rowtype;
  terms jsonb;
  organization_name text;
  first_open boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;

  select s.* into session_row
  from public.patient_consent_sessions s
  where s.token_hash = target_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;
  if session_row.status = 'completed' then
    return jsonb_build_object(
      'ok', true, 'code', 'completed', 'status', 'completed',
      'sessionId', session_row.id, 'completedAt', session_row.completed_at
    );
  end if;
  if session_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;
  if session_row.expires_at <= clock_timestamp() then
    update public.patient_consent_sessions
    set status = 'expired', closed_at = clock_timestamp(), close_reason = 'link_expired'
    where id = session_row.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      session_row.org_id, null, 'consent.collection.expired',
      'consent_session', session_row.id::text,
      jsonb_build_object('patientId', session_row.patient_id)
    );
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;

  if session_row.opened_at is null then
    first_open := true;
    update public.patient_consent_sessions
    set opened_at = clock_timestamp()
    where id = session_row.id
    returning * into session_row;
  end if;

  select o.name into organization_name
  from public.organizations o
  where o.id = session_row.org_id;

  select jsonb_agg(
    jsonb_build_object(
      'slug', i.slug,
      'title', i.term_title,
      'body', i.term_body,
      'version', i.term_version
    ) order by case i.slug
      when 'audio-recording' then 1
      when 'ai-processing' then 2
      else 3
    end
  ) into terms
  from public.patient_consent_session_items i
  where i.session_id = session_row.id;

  if first_open then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      session_row.org_id, null, 'consent.collection.opened',
      'consent_session', session_row.id::text,
      jsonb_build_object('patientId', session_row.patient_id)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'pending',
    'status', 'pending',
    'sessionId', session_row.id,
    'organizationName', organization_name,
    'expiresAt', session_row.expires_at,
    'terms', coalesce(terms, '[]'::jsonb),
    'affirmationVersion', session_row.affirmation_version,
    'presentedLocale', session_row.presented_locale
  );
end;
$$;

create or replace function public.submit_patient_consent_session(
  target_token_hash text,
  target_decisions jsonb,
  target_idempotency_key uuid,
  target_signer_role text,
  target_signer_name text,
  target_representative_relationship text default null,
  target_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.patient_consent_sessions%rowtype;
  patient_row public.patients%rowtype;
  item_row record;
  acceptance_row public.consent_acceptances%rowtype;
  decision_value boolean;
  decision_count integer;
  active_term_count integer;
  stored_decisions jsonb;
  normalized_signer_name text;
  normalized_relationship text;
  manifested_by_value text;
  completed_at_value timestamptz := clock_timestamp();
  same_submission boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = 'insufficient_privilege';
  end if;
  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$'
     or target_idempotency_key is null
     or jsonb_typeof(target_decisions) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select count(*) into decision_count from jsonb_object_keys(target_decisions);
  if decision_count <> 3
     or exists (
       select 1 from jsonb_object_keys(target_decisions) k(key)
       where k.key not in ('audio-recording', 'ai-processing', 'clinical-images')
     )
     or jsonb_typeof(target_decisions -> 'audio-recording') <> 'boolean'
     or jsonb_typeof(target_decisions -> 'ai-processing') <> 'boolean'
     or jsonb_typeof(target_decisions -> 'clinical-images') <> 'boolean' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  normalized_signer_name := nullif(btrim(target_signer_name), '');
  normalized_relationship := nullif(btrim(target_representative_relationship), '');
  if target_confirmed is not true
     or target_signer_role is null
     or target_signer_role not in ('patient', 'legal_representative')
     or normalized_signer_name is null
     or char_length(normalized_signer_name) > 160
     or (
       target_signer_role = 'legal_representative'
       and (normalized_relationship is null or char_length(normalized_relationship) > 120)
     ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if target_signer_role = 'patient' then
    normalized_relationship := null;
    manifested_by_value := 'patient';
  else
    manifested_by_value := 'legal_representative';
  end if;

  select s.* into session_row
  from public.patient_consent_sessions s
  where s.token_hash = target_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;

  select coalesce(jsonb_object_agg(i.slug, to_jsonb(i.decision)), '{}'::jsonb)
  into stored_decisions
  from public.patient_consent_session_items i
  where i.session_id = session_row.id;

  if session_row.status = 'completed' then
    same_submission := session_row.completion_idempotency_key = target_idempotency_key
      and stored_decisions = target_decisions
      and session_row.signer_role = target_signer_role
      and session_row.signer_name = normalized_signer_name
      and session_row.representative_relationship is not distinct from normalized_relationship;

    if same_submission then
      return jsonb_build_object(
        'ok', true,
        'code', 'completed',
        'replayed', true,
        'sessionId', session_row.id,
        'completedAt', session_row.completed_at,
        'decisions', stored_decisions
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if session_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;
  if session_row.expires_at <= clock_timestamp() then
    update public.patient_consent_sessions
    set status = 'expired', closed_at = clock_timestamp(), close_reason = 'link_expired'
    where id = session_row.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      session_row.org_id, null, 'consent.collection.expired',
      'consent_session', session_row.id::text,
      jsonb_build_object('patientId', session_row.patient_id)
    );
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;

  select p.* into patient_row
  from public.patients p
  where p.id = session_row.patient_id and p.org_id = session_row.org_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'consent_link_invalid');
  end if;

  -- Lock the snapshotted terms so an activation change cannot interleave with
  -- the three acceptance writes.
  perform 1
  from public.consent_terms t
  join public.patient_consent_session_items i on i.term_id = t.id
  where i.session_id = session_row.id and t.is_active
  for share of t;

  select count(*) into active_term_count
  from public.patient_consent_session_items i
  join public.consent_terms t
    on t.id = i.term_id
   and t.is_active
   and t.slug = i.slug
   and t.version = i.term_version
  where i.session_id = session_row.id;

  if active_term_count <> 3 then
    update public.patient_consent_sessions
    set status = 'invalidated', closed_at = clock_timestamp(), close_reason = 'consent_terms_changed'
    where id = session_row.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      session_row.org_id, null, 'consent.collection.invalidated',
      'consent_session', session_row.id::text,
      jsonb_build_object('reason', 'consent_terms_changed', 'patientId', session_row.patient_id)
    );
    return jsonb_build_object('ok', false, 'code', 'consent_terms_changed');
  end if;

  for item_row in
    select i.*
    from public.patient_consent_session_items i
    where i.session_id = session_row.id
    order by i.slug
    for update
  loop
    decision_value := (target_decisions ->> item_row.slug)::boolean;
    acceptance_row.id := null;

    if decision_value then
      select a.* into acceptance_row
      from public.consent_acceptances a
      where a.term_id = item_row.term_id
        and a.org_id = session_row.org_id
        and a.subject_type = 'patient'
        and a.subject_id = session_row.patient_id::text
        and a.revoked_at is null
      limit 1
      for update;

      -- Replace a professional-recorded current acceptance with the stronger
      -- patient-owned manifestation instead of silently reusing it.
      if found and acceptance_row.consent_session_id is distinct from session_row.id then
        update public.consent_acceptances
        set revoked_at = completed_at_value
        where id = acceptance_row.id;
        acceptance_row.id := null;
      end if;

      if acceptance_row.id is null then
        insert into public.consent_acceptances (
          term_id, org_id, subject_type, subject_id, recorded_by, metadata,
          accepted_at, consent_session_id, manifested_by
        ) values (
          item_row.term_id,
          session_row.org_id,
          'patient',
          session_row.patient_id::text,
          null,
          jsonb_strip_nulls(jsonb_build_object(
            'method', 'patient_qr',
            'manifestedBy', manifested_by_value,
            'sessionId', session_row.id,
            'consultationId', session_row.consultation_id,
            'affirmationVersion', session_row.affirmation_version
          )),
          completed_at_value,
          session_row.id,
          manifested_by_value
        ) returning * into acceptance_row;
      end if;

      update public.patient_consent_session_items
      set decision = true,
          decided_at = completed_at_value,
          acceptance_id = acceptance_row.id
      where session_id = session_row.id and slug = item_row.slug;
    else
      update public.consent_acceptances a
      set revoked_at = completed_at_value
      from public.consent_terms t
      where a.term_id = t.id
        and a.org_id = session_row.org_id
        and a.subject_type = 'patient'
        and a.subject_id = session_row.patient_id::text
        and a.revoked_at is null
        and t.slug = item_row.slug;

      update public.patient_consent_session_items
      set decision = false,
          decided_at = completed_at_value,
          acceptance_id = null
      where session_id = session_row.id and slug = item_row.slug;
    end if;

    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      session_row.org_id,
      null,
      case when decision_value then 'consent.granted' else 'consent.refused' end,
      'patient',
      session_row.patient_id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'slug', item_row.slug,
        'termId', item_row.term_id,
        'termVersion', item_row.term_version,
        'sessionId', session_row.id,
        'consultationId', session_row.consultation_id,
        'manifestedBy', manifested_by_value
      ))
    );
  end loop;

  update public.patient_consent_sessions
  set status = 'completed',
      completed_at = completed_at_value,
      completion_idempotency_key = target_idempotency_key,
      signer_role = target_signer_role,
      signer_name = normalized_signer_name,
      representative_relationship = normalized_relationship,
      identity_declared_at = completed_at_value
  where id = session_row.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    session_row.org_id, null, 'consent.collection.completed',
    'consent_session', session_row.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'patientId', session_row.patient_id,
      'consultationId', session_row.consultation_id,
      'purposeCount', 3,
      'manifestedBy', manifested_by_value,
      'affirmationVersion', session_row.affirmation_version
    ))
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'completed',
    'replayed', false,
    'sessionId', session_row.id,
    'completedAt', completed_at_value,
    'decisions', target_decisions
  );
end;
$$;

-- Explicit API surface. Public-page functions require both an EXECUTE grant
-- and their internal service-role assertion.
revoke all on function public.set_patient_consent(uuid, text, boolean, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_patient_consent_session(uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_patient_consent_session_status(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_patient_consent_session(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_patient_consent_session(text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_patient_consent_session(text, jsonb, uuid, text, text, text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.set_patient_consent(uuid, text, boolean, jsonb)
  to authenticated;
grant execute on function public.create_patient_consent_session(uuid, text, uuid, uuid)
  to authenticated;
grant execute on function public.get_patient_consent_session_status(uuid)
  to authenticated;
grant execute on function public.cancel_patient_consent_session(uuid)
  to authenticated;
grant execute on function public.resolve_patient_consent_session(text)
  to service_role;
grant execute on function public.submit_patient_consent_session(text, jsonb, uuid, text, text, text, boolean)
  to service_role;
