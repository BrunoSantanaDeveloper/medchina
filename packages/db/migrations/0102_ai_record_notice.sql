-- ============================================================
-- 0102_ai_record_notice
--
-- Consentimento de IA deixa de ser exigido para RACIOCINAR sobre o que foi
-- digitado; passa a valer para o que COLETA um dado novo.
--
-- A regra antiga tratava dois atos diferentes como um só. Ligar o microfone
-- coleta a voz da paciente — dado novo, autorização dela. Preparar hipóteses
-- sobre o que a profissional digitou apenas processa o que já está no
-- prontuário, sob tutela da saúde (LGPD art. 11, II, "f"), com a profissional
-- respondendo pelo resultado. Exigir consentimento para o segundo caso parava
-- a ferramenta numa consulta inteiramente manual, sem proteger nada.
--
-- O que esta migração cria:
--
--   1. 'ai-record-notice' — a CIÊNCIA. Não autoriza nada e não bloqueia nada:
--      é a prova, versionada como qualquer termo, de que a paciente foi
--      informada de que o prontuário pode ser organizado com apoio de IA. O
--      envio a um fornecedor externo continua exigindo transparência mesmo
--      quando não exige consentimento.
--
--   2. `patient_refused_ai_reasoning` — o limite da regra nova. Nunca ter sido
--      perguntada não é recusa; ter dito NÃO é. Uma recusa no aparelho da
--      paciente não cria aceite nenhum para revogar (ela vive em
--      patient_consent_session_items.decision = false), e uma revogação apaga
--      o aceite que existia — as duas contam. Um aceite ativo depois disso
--      encerra o assunto, então basta olhar o estado atual.
--
-- Continuam exigindo o aceite ATIVO de 'ai-processing', porque coletam ou
-- expõem dado novo: transcrever áudio, analisar imagem anexada e as tools MCP
-- (que servem o prontuário fora da tela de atendimento).
--
-- As três funções de sessão são recriadas copiando a 0040 verbatim, com o
-- quarto item somado. O SQL entra antes do deploy: a página antiga manda três
-- votos e continua funcionando.
-- ============================================================

alter table public.patient_consent_session_items
  drop constraint if exists patient_consent_session_items_slug_check;
alter table public.patient_consent_session_items
  add constraint patient_consent_session_items_slug_check
  check (slug in ('audio-recording', 'ai-processing', 'clinical-images', 'ai-record-notice'));

-- Texto provisório, como os outros três — pendente de revisão jurídica.
insert into public.consent_terms (slug, version, title, body, is_active)
select
  'ai-record-notice', 1,
  'Ciência sobre o uso de inteligência artificial no prontuário',
  'Estou ciente de que as informações do meu prontuário podem ser organizadas com apoio de inteligência artificial, '
  'sempre sob revisão e responsabilidade da profissional, e de que isso envolve o envio dessas informações a '
  'fornecedores de tecnologia contratados para essa finalidade. As informações não são utilizadas para treinar '
  'modelos públicos. Esta é uma ciência, e não uma autorização: posso pedir a qualquer momento que meu prontuário '
  'não seja processado dessa forma.',
  true
where not exists (
  select 1 from public.consent_terms t where t.slug = 'ai-record-notice' and t.version = 1
);

-- ---------- O limite da regra nova ----------

create or replace function public.patient_refused_ai_reasoning(
  target_org uuid,
  target_patient uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not public.has_active_consent(target_org, target_patient, 'ai-processing')
     and (
       exists (
         select 1
         from public.consent_acceptances a
         join public.consent_terms t on t.id = a.term_id
         where a.org_id = target_org
           and a.subject_type = 'patient'
           and a.subject_id = target_patient::text
           and t.slug = 'ai-processing'
           and a.revoked_at is not null
       )
       or exists (
         select 1
         from public.patient_consent_session_items i
         join public.patient_consent_sessions s on s.id = i.session_id
         where s.org_id = target_org
           and s.patient_id = target_patient
           and i.slug = 'ai-processing'
           and i.decision is false
       )
     );
$$;

comment on function public.patient_refused_ai_reasoning(uuid, uuid) is
  'True quando a paciente DISSE NÃO à IA (recusa no próprio aparelho ou revogação) e não há aceite ativo. Nunca ter sido perguntada devolve false: o raciocínio sobre o que foi digitado não depende de consentimento.';

-- ---------- Sessão de consentimento com o quarto item ----------

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

    if current_term_count <> 4 then
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
    and t.slug in ('audio-recording', 'ai-processing', 'clinical-images', 'ai-record-notice')
  for share;

  select count(*) into term_count
  from public.consent_terms t
  where t.is_active
    and t.slug in ('audio-recording', 'ai-processing', 'clinical-images', 'ai-record-notice');

  if term_count <> 4 then
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
    and t.slug in ('audio-recording', 'ai-processing', 'clinical-images', 'ai-record-notice');

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    patient_row.org_id, auth.uid(), 'consent.collection.created',
    'consent_session', created_session::text,
    jsonb_strip_nulls(jsonb_build_object(
      'patientId', target_patient,
      'consultationId', target_consultation,
      'expiresAt', expires_at_value,
      'purposeCount', term_count
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
      when 'clinical-images' then 3
      when 'ai-record-notice' then 4
      else 5
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

  -- The three AUTHORIZATIONS are required; the ciência ('ai-record-notice')
  -- is optional here so a browser still running the previous version of the
  -- page — which knows nothing about it — keeps submitting successfully during
  -- the deploy. Absent, it is recorded as not ticked: the text was still shown.
  select count(*) into decision_count from jsonb_object_keys(target_decisions);
  if decision_count < 3
     or decision_count > 4
     or exists (
       select 1 from jsonb_object_keys(target_decisions) k(key)
       where k.key not in ('audio-recording', 'ai-processing', 'clinical-images', 'ai-record-notice')
     )
     or jsonb_typeof(target_decisions -> 'audio-recording') <> 'boolean'
     or jsonb_typeof(target_decisions -> 'ai-processing') <> 'boolean'
     or jsonb_typeof(target_decisions -> 'clinical-images') <> 'boolean'
     or (target_decisions ? 'ai-record-notice'
         and jsonb_typeof(target_decisions -> 'ai-record-notice') <> 'boolean') then
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
    -- Compared key by key over what was STORED, so a replay from a page that
    -- does not send the ciência (or a session created before it existed) is
    -- still recognized as the same submission instead of a conflict.
    same_submission := session_row.completion_idempotency_key = target_idempotency_key
      and not exists (
        select 1 from jsonb_each(stored_decisions) d(key, value)
        where d.value is distinct from coalesce(target_decisions -> d.key, to_jsonb(false))
      )
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

  if active_term_count <> 4 then
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
    -- A key the page did not send (only the ciência can be missing) is read
    -- as not ticked, never as a decision she made.
    decision_value := coalesce((target_decisions ->> item_row.slug)::boolean, false);
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
      -- A ciência não é autorização: registrá-la como "consent.refused" quando
      -- a paciente apenas não marcou diria, na trilha de auditoria, que ela
      -- recusou algo que nunca lhe foi pedido.
      case
        when item_row.slug = 'ai-record-notice'
          then case when decision_value then 'consent.notice.acknowledged' else 'consent.notice.skipped' end
        when decision_value then 'consent.granted'
        else 'consent.refused'
      end,
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

revoke all on function public.patient_refused_ai_reasoning(uuid, uuid)
  from public, anon;
grant execute on function public.patient_refused_ai_reasoning(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.create_patient_consent_session(uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_patient_consent_session(text)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_patient_consent_session(text, jsonb, uuid, text, text, text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.create_patient_consent_session(uuid, text, uuid, uuid)
  to authenticated;
grant execute on function public.resolve_patient_consent_session(text)
  to service_role;
grant execute on function public.submit_patient_consent_session(text, jsonb, uuid, text, text, text, boolean)
  to service_role;

comment on function public.create_patient_consent_session(uuid, text, uuid, uuid) is
  'Abre a sessão de consentimento da paciente com os quatro itens ativos (três autorizações + a ciência de IA), congelando o texto exibido.';
comment on function public.submit_patient_consent_session(text, jsonb, uuid, text, text, text, boolean) is
  'Grava a manifestação da paciente. As três autorizações são obrigatórias; a ciência é opcional no envio e, ausente, é registrada como não marcada.';

-- ---------- O contexto da consulta conta a recusa e a ciência ----------
--
-- Copiada da 0058 verbatim, com dois campos somados. A tela precisa distinguir
-- "nunca foi perguntada" de "disse não": tratar as duas como falta de
-- consentimento era exatamente o erro que esta migração desfaz.

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
      'alerts', patient_row.alerts
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
