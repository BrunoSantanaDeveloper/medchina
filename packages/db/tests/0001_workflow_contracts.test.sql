begin;
create extension if not exists pgtap with schema extensions;
select plan(101);

select ok(
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultations' and column_name = 'clinical_revision'),
  'consultations have an optimistic clinical revision'
);
select ok(
  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultations' and column_name = 'scheduled_for'),
  'appointments have a dedicated schedule timestamp'
);
select ok(
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'consultations_one_active_clinical_per_patient_idx'),
  'only one active clinical consultation is allowed per patient'
);
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_scheduled_consultation'), 'schedule save is atomic');
select ok(to_regprocedure('public.save_scheduled_series(uuid,uuid,timestamptz[],integer,text)') is not null, 'weekly series are created atomically server-side');
select ok(has_function_privilege('authenticated', 'public.save_scheduled_series(uuid,uuid,timestamptz[],integer,text)', 'EXECUTE'), 'professionals can schedule a weekly series');
select ok(to_regprocedure('public.cancel_scheduled_consultation(uuid,text)') is null, 'the pre-category cancel overload is gone so the RPC call stays unambiguous');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultations' and column_name = 'cancellation_category'), 'cancellations carry a structured category including no-show');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'restore_cancelled_consultation'), 'cancelled appointments can be restored through validation');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'finalize_consultation'), 'consultation finalization is server coordinated');
select ok(
  exists(
    select 1 from pg_trigger
    where tgrelid = 'public.anamnesis_answers'::regclass
      and tgname = 'anamnesis_answers_guard_finalized'
      and not tgisinternal
  ),
  'answer writes pass through the parent-locking finalized guard'
);
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_patient_consent'), 'patient consent changes use the idempotent RPC');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'consent_terms_one_active_slug_idx'), 'only the current active consent term is authoritative');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recordings' and column_name = 'client_upload_id'), 'recordings carry a client idempotency id');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'audio_usage_one_transcription_per_recording_idx'), 'one recording cannot be billed twice for transcription');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'claim_recording_for_processing'), 'recording workers claim work idempotently');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recordings' and column_name = 'processing_clinical_revision'), 'recording claims snapshot the clinical revision');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recordings' and column_name = 'ai_consent_acceptance_id'), 'AI recordings pin their processing-consent provenance');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transcriptions' and column_name = 'validated_at'), 'transcript validation is a persisted retention boundary');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_hypotheses' and column_name = 'input_revision'), 'hypotheses retain their clinical input revision');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_hypotheses' and column_name = 'stale_at'), 'hypotheses persist stale state');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.consultation_hypotheses'::regclass and conname = 'consultation_hypotheses_pattern_nonempty_check' and convalidated), 'hypothesis patterns are protected by a validated constraint');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.consultation_hypotheses'::regclass and conname = 'consultation_hypotheses_decision_authorship_check' and convalidated), 'hypothesis decisions are protected by a validated review constraint');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.consultation_hypotheses'::regclass and conname = 'consultation_hypotheses_rejection_note_check' and convalidated), 'hypothesis rejections are protected by a validated note constraint');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultation_plans' and column_name = 'input_revision'), 'plans retain their clinical input revision');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.consultation_plans'::regclass and conname = 'consultation_plans_origin_check' and convalidated), 'plan origin is protected by a validated constraint');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.consultation_plans'::regclass and conname = 'consultation_plans_safety_flags_array_check' and convalidated), 'plan safety flags are constrained to arrays');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.consultation_plans'::regclass and conname = 'consultation_plans_validation_authorship_check' and convalidated), 'plan validation evidence is protected by a validated constraint');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.consultation_plans'::regclass and conname = 'consultation_plans_safety_acknowledgement_check' and convalidated), 'plan safety acknowledgement is protected by a validated constraint');
select ok(has_function_privilege('service_role', 'public.save_consultation_plan(uuid,text,jsonb,jsonb,timestamptz)', 'EXECUTE'), 'the trusted service path can refresh derived safety flags');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'documents_idempotency_unique_idx'), 'document issue retries are idempotent');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_revision'), 'documents pin the source clinical revision');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_updated_at'), 'documents pin the source update token');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_validated_at'), 'documents pin the source validation token');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'source_snapshot'), 'documents retain the validated clinical source snapshot');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'mobile_capture_authorizations'), 'mobile offline authorization is short-lived server state');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mobile_capture_authorizations' and column_name = 'ai_authorized'), 'offline authorization preserves whether AI capture was granted');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mobile_capture_authorizations' and column_name = 'authorized_from_at'), 'offline authorization refreshes an explicit lower validity boundary');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'begin_authorized_mobile_recording'), 'offline mobile capture is materialized idempotently after reconnecting');
select ok(
  coalesce((
    select position('pinned_ai_acceptance' in prosrc) > 0
      and position('newer_term.version > term.version' in prosrc) > 0
    from pg_proc
    where oid = 'public.guard_recording_consent()'::regprocedure
  ), false)
  and coalesce((
    select position('authorization_row.ai_acceptance_id' in prosrc) > 0
      and position('newer_term.version > t.version' in prosrc) > 0
    from pg_proc
    where oid = 'public.begin_authorized_mobile_recording(uuid,text,uuid,uuid,timestamptz)'::regprocedure
  ), false),
  'offline mobile AI consent is pinned and version-valid at capture time'
);
-- The guards live in the two-arg form since 0084 (the trial may now be started
-- by any operational action, each naming its origin); the one-arg signature is
-- kept as a delegating wrapper, asserted below.
select ok(
  exists(
    select 1
    from pg_proc
    where oid = 'public.start_pro_trial(uuid,text)'::regprocedure
      and position('on conflict (org_id) do nothing' in lower(prosrc)) > 0
  ),
  'promotion activation is concurrency-idempotent'
);
select ok(
  exists(
    select 1
    from pg_proc
    where oid = 'public.start_pro_trial(uuid)'::regprocedure
      and position('start_pro_trial(target_org' in lower(prosrc)) > 0
  ),
  'the legacy one-arg trial start delegates instead of duplicating the guards'
);
select ok(
  exists(
    select 1
    from pg_proc
    where oid = 'public.authorize_mobile_recording(uuid,text,uuid)'::regprocedure
      and regexp_replace(prosrc, '[[:space:]]+', ' ', 'g') like
        '%begin_clinical_recording( target_consultation, target_mode, target_client_upload_id, target_mode = ''ai'', ''mobile'' )%'
  ),
  'online mobile AI authorization starts an eligible promotion at the server capture boundary'
);
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'mobile_devices'), 'push devices are registered separately from clinical content');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'track_product_event'), 'privacy-filtered product telemetry is available');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recordings' and column_name = 'processing_lease_expires_at'), 'recording processing claims have a recoverable lease');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'heartbeat_recording_processing'), 'recording workers can renew their processing lease');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'recording_notification_outbox'), 'recording notifications use a durable outbox');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recording_notification_outbox' and column_name = 'claim_token'), 'recording notification completion is fenced by a claim token');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mobile_capture_authorizations' and column_name = 'used_at'), 'mobile capture authorizations are single use');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'billing_operations'), 'billing mutations have durable idempotency state');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'billing_webhook_events'), 'billing webhooks have a durable inbox');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'billing_operations' and column_name = 'claim_token'), 'billing operation completion is fenced by a claim token');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'billing_webhook_events' and column_name = 'claim_token'), 'billing webhook completion is fenced by a claim token');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'billing_operations' and column_name = 'attempts'), 'billing operation retries are observable');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'subscriptions_provider_subscription_unique_idx'), 'one provider subscription maps to one local subscription');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'credit_transactions_source_invoice_unique_idx'), 'one provider invoice cannot grant credits twice');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'complete_checkout_billing_operation'), 'checkout state and idempotency completion share one transaction');
select ok(exists(select 1 from pg_trigger where tgname = 'onboarding_state_guard_medchina_activation' and not tgisinternal), 'permanent activation state is protected from client tampering');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'timezone'), 'practices persist an authoritative IANA timezone');
select ok(exists(select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_practice_settings'), 'practice identity and timezone update atomically');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.anamnesis_answers'::regclass and conname = 'anamnesis_answers_value_nonempty_check' and convalidated), 'an unanswered anamnesis field cannot be stored as blank text');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'patient_id'), 'clinical documents link directly to their patient');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'consultation_id'), 'clinical documents link directly to their consultation');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'plan_id'), 'clinical documents link directly to their validated plan');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.documents'::regclass and conname = 'documents_consultation_plan_links_check' and convalidated), 'clinical document source links are validated together');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'issue_claim_token'), 'document publication is fenced by a claim token');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'issue_lease_expires_at'), 'abandoned document issue claims have a recovery deadline');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'issue_attempts'), 'document rendering retries are observable');
select ok(to_regprocedure('public.claim_document_issue(uuid,uuid)') is not null, 'document rendering requires an atomic claim');
select ok(to_regprocedure('public.release_document_issue(uuid,uuid)') is not null, 'failed document rendering releases only its own claim');
select ok(has_function_privilege('service_role', 'public.publish_document_version(uuid,uuid,text,text)', 'EXECUTE'), 'the trusted publication path requires a fencing token');
select ok(to_regprocedure('public.publish_document_version(uuid,text,text)') is null, 'the unfenced publication signature is no longer exposed');
select ok(not has_function_privilege('service_role', 'public.publish_document_version_unfenced(uuid,text,text)', 'EXECUTE'), 'the source-revalidating helper is owner-only');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.documents'::regclass and confrelid = 'public.patients'::regclass and confdeltype = 'r'), 'patient deletion cannot cascade-delete an immutable document');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.documents'::regclass and confrelid = 'public.consultations'::regclass and confdeltype = 'r'), 'consultation deletion cannot cascade-delete an immutable document');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.documents'::regclass and confrelid = 'public.consultation_plans'::regclass and confdeltype = 'r'), 'plan deletion cannot cascade-delete an immutable document');
select ok(to_regprocedure('public.apply_recording_result(uuid,uuid,uuid,jsonb,jsonb,integer)') is not null, 'clinical apply accepts server-measured billable seconds');
select ok(to_regprocedure('public.apply_recording_result(uuid,uuid,uuid,jsonb,jsonb)') is null, 'a worker cannot mark a recording ready outside the usage-ledger transaction');
select ok(has_function_privilege('service_role', 'public.apply_recording_result(uuid,uuid,uuid,jsonb,jsonb,integer)', 'EXECUTE'), 'the fenced worker can atomically apply clinical data and usage');
select ok(to_regprocedure('public.commit_billing_subscription_change(uuid,uuid,uuid,text,timestamptz)') is not null, 'billing cancellation state and claim completion share one transaction');
select ok(has_function_privilege('service_role', 'public.commit_billing_subscription_change(uuid,uuid,uuid,text,timestamptz)', 'EXECUTE'), 'only the trusted billing path can commit a fenced subscription change');
select ok(to_regprocedure('public.save_consultation_answer(uuid,bigint,text,text,text,text,text)') is not null, 'manual answer autosave compares the clinical revision');
select ok(to_regprocedure('public.save_consultation_header(uuid,bigint,text,text)') is not null, 'manual header autosave compares the clinical revision');
select ok(has_function_privilege('authenticated', 'public.save_consultation_answer(uuid,bigint,text,text,text,text,text)', 'EXECUTE'), 'authenticated professionals can use the fenced answer autosave');
select ok(has_function_privilege('authenticated', 'public.save_consultation_header(uuid,bigint,text,text)', 'EXECUTE'), 'authenticated professionals can use the fenced header autosave');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'source_key'), 'generic push delivery has an idempotent source key');
select ok(coalesce((select position('old.consultation_id, new.consultation_id' in prosrc) > 0 from pg_proc where oid = 'public.touch_consultation_revision_from_answer()'::regprocedure), false), 'moving an answer invalidates both source and destination revisions');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'audio_retention'), 'practices persist their audio retention preference');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.organizations'::regclass and conname = 'organizations_audio_retention_check' and convalidated), 'practice audio retention accepts only supported policies');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transcriptions' and column_name = 'retention_policy'), 'transcriptions snapshot the selected retention policy');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transcriptions' and column_name = 'retain_until'), 'thirty-day retention has an explicit deadline');
select ok(exists(select 1 from pg_constraint where conrelid = 'public.transcriptions'::regclass and conname = 'transcriptions_retain_until_check' and convalidated), 'retention deadlines are consistent with their policy');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'transcriptions_retention_due_idx'), 'due retained audio can be claimed without scanning clinical content');
select ok(exists(select 1 from pg_trigger where tgname = 'transcriptions_snapshot_retention' and not tgisinternal), 'new transcriptions snapshot the practice retention policy');
select ok(to_regprocedure('public.set_audio_retention_policy(uuid,text)') is not null, 'audio retention changes use an audited RPC');
select ok(has_function_privilege('authenticated', 'public.set_audio_retention_policy(uuid,text)', 'EXECUTE'), 'practice administrators can set audio retention');
select ok(to_regprocedure('public.complete_retention_audio_deletion(uuid,text)') is not null, 'automatic retention deletion has a fenced completion');
select ok(has_function_privilege('service_role', 'public.complete_retention_audio_deletion(uuid,text)', 'EXECUTE'), 'the trusted retention worker can complete deletion');
select ok(not has_function_privilege('authenticated', 'public.complete_retention_audio_deletion(uuid,text)', 'EXECUTE'), 'clients cannot forge automatic audio deletion completion');
select ok(
  (
    select coalesce(bool_and(
      function_oid is not null
      and has_function_privilege('service_role', function_oid, 'EXECUTE')
      and not has_function_privilege('authenticated', function_oid, 'EXECUTE')
      and not has_function_privilege('anon', function_oid, 'EXECUTE')
    ), false)
    from unnest(array[
      to_regprocedure('public.heartbeat_recording_processing(uuid,uuid)'),
      to_regprocedure('public.replace_draft_hypotheses(uuid,bigint,jsonb,text,text,uuid)'),
      to_regprocedure('public.save_generated_consultation_plan(uuid,bigint,text,jsonb,jsonb,jsonb,jsonb,text,text,uuid,boolean)'),
      to_regprocedure('public.reserve_document_version(uuid,text,text,jsonb,text,uuid,text,text,uuid,text,uuid)'),
      to_regprocedure('public.claim_recording_status_notification(uuid,text)'),
      to_regprocedure('public.complete_recording_status_notification(uuid,uuid,boolean,text)'),
      to_regprocedure('public.claim_billing_operation(uuid,uuid,text,uuid,text,uuid,uuid)'),
      to_regprocedure('public.complete_billing_operation(uuid,uuid,boolean,jsonb,text)'),
      to_regprocedure('public.complete_checkout_billing_operation(uuid,uuid,uuid,text,text,text,text)'),
      to_regprocedure('public.claim_billing_webhook_event(text,text,text)'),
      to_regprocedure('public.complete_billing_webhook_event(uuid,uuid,boolean,text)'),
      to_regprocedure('public.complete_retention_audio_deletion(uuid,text)'),
      to_regprocedure('public.claim_document_issue(uuid,uuid)'),
      to_regprocedure('public.release_document_issue(uuid,uuid)'),
      to_regprocedure('public.publish_document_version(uuid,uuid,text,text)'),
      to_regprocedure('public.apply_recording_result(uuid,uuid,uuid,jsonb,jsonb,integer)'),
      to_regprocedure('public.commit_billing_subscription_change(uuid,uuid,uuid,text,timestamptz)')
    ]) as service_functions(function_oid)
  ),
  'worker RPCs are executable by service_role and never by API user roles'
);

select * from finish();
rollback;
