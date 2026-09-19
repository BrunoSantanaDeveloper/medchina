begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- ============================================================
-- Migration 0106 — the account dossier.
--
-- The fixture is built out of the traps the schema sweep turned up, because
-- those are the assertions worth having: a refund that would otherwise make
-- money disappear, a failed recording that burns no minutes (so a broken
-- account reads as a light one), a support visit that would inflate her
-- sign-ins, an open checkout the list query cannot see, an account that
-- never finalized anything (where `greatest(null, 0)` would claim instant
-- activation), and clinical content sitting one join away from every number
-- here — a patient name in an audit metadata blob, a raw CPF in a column.
-- ============================================================

select ok(
  has_function_privilege('authenticated', 'public.admin_account_dossier(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_account_dossier(uuid)', 'EXECUTE'),
  'the dossier is reachable by a signed-in session only (is_superadmin inside is the gate)'
);

-- ---------- People and workspaces ----------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at
) values
  ('f5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operator@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Operator"}'::jsonb, now(), now(), now()),
  ('f5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dona@medchina.invalid', 'hash', '{}'::jsonb, '{"display_name":"Dra. Dona"}'::jsonb, now() - interval '90 days', now(), now()),
  ('f5000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'nova@medchina.invalid', '', '{}'::jsonb, '{"display_name":"Dra. Nova"}'::jsonb, now(), now(), now());

update public.profiles set is_superadmin = true where id = 'f5000000-0000-4000-8000-000000000001';

insert into public.organizations (id, name, slug, created_by, created_at,
  billing_cpf_cnpj, billing_postal_code, billing_address_number, billing_phone) values
  ('f5100000-0000-4000-8000-000000000001', 'Consultório da Dona', 'dona-f5', 'f5000000-0000-4000-8000-000000000002',
   now() - interval '90 days', '12345678990', '01310100', '100', '11999998888');

-- Never finalized anything: the account where "0 days to first record" would lie.
insert into public.organizations (id, name, slug, created_by) values
  ('f5100000-0000-4000-8000-000000000002', 'Consultório Novo', 'novo-f5', 'f5000000-0000-4000-8000-000000000003');

insert into public.memberships (org_id, user_id, role) values
  ('f5100000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002', 'owner'),
  ('f5100000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000003', 'owner')
on conflict do nothing;

-- ---------- Clinical shape: the funnel, kept apart ----------

insert into public.patients (id, org_id, full_name) values
  ('f5200000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'Paciente Sigilosa Dossie'),
  ('f5200000-0000-4000-8000-000000000002', 'f5100000-0000-4000-8000-000000000001', 'Paciente Arquivada Dossie'),
  ('f5200000-0000-4000-8000-000000000003', 'f5100000-0000-4000-8000-000000000001', 'Paciente Terceira Dossie');
-- Archiving refuses a patient with open work, and an archived patient refuses
-- a new consultation: the archived one stays genuinely idle.
update public.patients set archived_at = now() where id = 'f5200000-0000-4000-8000-000000000002';
-- Backdated the way an import leaves it: older than the workspace itself.
update public.patients set created_at = now() - interval '100 days'
where id = 'f5200000-0000-4000-8000-000000000001';

insert into public.transcriptions (id, org_id, mime, status) values
  ('f5300000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'audio/webm', 'ready'),
  ('f5300000-0000-4000-8000-000000000002', 'f5100000-0000-4000-8000-000000000001', 'audio/webm', 'error');
update public.transcriptions set error = 'provider said: RESOURCE_EXHAUSTED quota for model gemini-2.5-pro'
where id = 'f5300000-0000-4000-8000-000000000002';

insert into public.consultations (id, org_id, patient_id, status, started_at, finalized_at, finalized_by, duration_minutes, transcription_id)
values ('f5400000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001',
        'f5200000-0000-4000-8000-000000000001', 'finalized', now() - interval '40 days', now() - interval '40 days',
        'f5000000-0000-4000-8000-000000000002', 50, 'f5300000-0000-4000-8000-000000000001');
insert into public.consultations (id, org_id, patient_id, status) values
  ('f5400000-0000-4000-8000-000000000002', 'f5100000-0000-4000-8000-000000000001',
   'f5200000-0000-4000-8000-000000000003', 'draft');
insert into public.consultations (id, org_id, patient_id, status, scheduled_for) values
  ('f5400000-0000-4000-8000-000000000003', 'f5100000-0000-4000-8000-000000000001',
   'f5200000-0000-4000-8000-000000000001', 'scheduled', now() + interval '3 days');

-- ---------- Recordings: one of each kind of broken ----------

alter table public.recordings disable trigger recordings_allowance_guard;
alter table public.recordings disable trigger recordings_guard_consent;
alter table public.recordings disable trigger recordings_guard_lifecycle;
insert into public.recordings (id, org_id, patient_id, status, mode, captured_on, transcription_id, failure_stage, error_code, created_at, updated_at)
values
  ('f5500000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001',
   'failed', 'ai', 'mobile', 'f5300000-0000-4000-8000-000000000002', 'transcription', 'transcribe_failed',
   now() - interval '2 days', now() - interval '2 days'),
  ('f5500000-0000-4000-8000-000000000002', 'f5100000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001',
   'ready', 'ai', 'mobile', 'f5300000-0000-4000-8000-000000000001', null, null, now() - interval '40 days', now());
insert into public.recordings (id, org_id, patient_id, status, mode, captured_on, processing_lease_expires_at, processing_attempts)
values ('f5500000-0000-4000-8000-000000000003', 'f5100000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001',
        'processing', 'ai', 'web', now() - interval '1 hour', 3);
insert into public.recordings (id, org_id, patient_id, status, mode, captured_on, uploaded_at)
values ('f5500000-0000-4000-8000-000000000004', 'f5100000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001',
        'uploaded', 'ai', 'web', now() - interval '30 minutes');
alter table public.recordings enable trigger recordings_allowance_guard;
alter table public.recordings enable trigger recordings_guard_consent;
alter table public.recordings enable trigger recordings_guard_lifecycle;

insert into public.audio_usage (org_id, seconds, cycle_seconds, pack_seconds, kind) values
  ('f5100000-0000-4000-8000-000000000001', 3000, 3000, 0, 'adjustment');

-- ---------- Money: two paid, one refunded, one failing ----------

insert into public.invoices (org_id, provider, provider_invoice_id, amount_cents, status, paid_at, created_at) values
  -- Older than the workspace itself, the way a migrated payment arrives.
  ('f5100000-0000-4000-8000-000000000001', 'stripe', 'in_f5_1', 19900, 'paid', now() - interval '100 days', now() - interval '100 days'),
  ('f5100000-0000-4000-8000-000000000001', 'stripe', 'in_f5_2', 19900, 'paid', now() - interval '30 days', now() - interval '30 days'),
  -- A reversal FLIPS the row (0069); it never inserts a negative one.
  ('f5100000-0000-4000-8000-000000000001', 'stripe', 'in_f5_3', 19900, 'refunded', now() - interval '20 days', now() - interval '20 days'),
  ('f5100000-0000-4000-8000-000000000001', 'stripe', 'in_f5_4', 19900, 'failed', null, now() - interval '2 days');

update public.subscriptions
set plan_id = (select id from public.plans where slug = 'assistente'),
    period = (select period from public.plans where slug = 'assistente'),
    status = 'active', provider = 'stripe', provider_subscription_id = 'sub_f5', provider_customer_id = 'cus_f5',
    current_period_start = now() - interval '10 days', current_period_end = now() + interval '20 days'
where org_id = 'f5100000-0000-4000-8000-000000000001' and status in ('trialing', 'active', 'past_due');

-- An abandoned checkout: 0104's live-subscription filter cannot see it.
insert into public.billing_operations (id, org_id, actor_id, kind, idempotency_key, status, result) values
  ('f5600000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002',
   'checkout', 'f5600000-0000-4000-8000-0000000000aa', 'completed',
   '{"url": "https://pay.example/invoice/f5"}'::jsonb);
insert into public.subscriptions (org_id, plan_id, status, period, provider, billing_operation_id, created_at) values
  ('f5100000-0000-4000-8000-000000000001', (select id from public.plans where slug = 'pro'), 'incomplete',
   (select period from public.plans where slug = 'pro'), 'asaas', 'f5600000-0000-4000-8000-000000000001', now() - interval '3 days');

-- ---------- Consent: cleared, refused, and revoked-with-audio ----------

-- The product's own terms, by slug: the dossier counts coverage per purpose,
-- and 'audio-recording' (capture) and 'ai-processing' (sending it out) are
-- two different gates.

insert into public.patient_consent_sessions (id, org_id, patient_id, token_hash, client_request_id, expires_at, status, completed_at)
values ('f5800000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'f5200000-0000-4000-8000-000000000001',
        repeat('f5', 32), 'f5800000-0000-4000-8000-0000000000aa', now() + interval '1 day', 'pending', null);

insert into public.consent_acceptances (id, term_id, org_id, subject_type, subject_id, manifested_by, consent_session_id)
select 'f5900000-0000-4000-8000-000000000001', t.id, 'f5100000-0000-4000-8000-000000000001',
       'patient', 'f5200000-0000-4000-8000-000000000001', 'patient', 'f5800000-0000-4000-8000-000000000001'
from public.consent_terms t where t.slug = 'audio-recording' order by t.version desc limit 1;
insert into public.consent_acceptances (id, term_id, org_id, subject_type, subject_id, manifested_by)
select 'f5900000-0000-4000-8000-000000000002', t.id, 'f5100000-0000-4000-8000-000000000001',
       'patient', 'f5200000-0000-4000-8000-000000000001', 'professional'
from public.consent_terms t where t.slug = 'ai-processing' order by t.version desc limit 1;
insert into public.consent_acceptances (id, term_id, org_id, subject_type, subject_id, manifested_by)
select 'f5900000-0000-4000-8000-000000000003', t.id, 'f5100000-0000-4000-8000-000000000001',
       'patient', 'f5200000-0000-4000-8000-000000000002', 'professional'
from public.consent_terms t where t.slug = 'audio-recording' order by t.version desc limit 1;
update public.consent_acceptances set revoked_at = now() - interval '1 day'
where id = 'f5900000-0000-4000-8000-000000000003';

-- Audio still stored under the revoked consent: act-today material. The
-- identity guard refuses to move a recording's consent after the fact (it
-- protects the product path), so the fixture links it with the guard off.
alter table public.recordings disable trigger recordings_guard_lifecycle;
update public.recordings set consent_acceptance_id = 'f5900000-0000-4000-8000-000000000003'
where id = 'f5500000-0000-4000-8000-000000000002';
alter table public.recordings enable trigger recordings_guard_lifecycle;

insert into public.patient_consent_session_items (session_id, term_id, slug, term_title, term_body, term_version, decision, decided_at)
select 'f5800000-0000-4000-8000-000000000001', t.id, 'clinical-images', 'Imagens', 'Corpo', 1, false, now()
from public.consent_terms t where t.slug = 'clinical-images' order by t.version desc limit 1;

-- ---------- AI verdicts ----------

insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value, source) values
  ('f5100000-0000-4000-8000-000000000001', 'f5400000-0000-4000-8000-000000000002', 'queixa', 'principal', 'Dor', 'patient_report'),
  ('f5100000-0000-4000-8000-000000000001', 'f5400000-0000-4000-8000-000000000002', 'sono', 'qualidade', 'Acorda', 'ai_inference');

insert into public.ai_answer_decisions (org_id, consultation_id, block_key, field_key, decision, ai_value, ai_source, ai_state) values
  ('f5100000-0000-4000-8000-000000000001', 'f5400000-0000-4000-8000-000000000002', 'queixa', 'principal', 'edited', 'Dor leve', 'ai_inference', 'attention'),
  ('f5100000-0000-4000-8000-000000000001', 'f5400000-0000-4000-8000-000000000002', 'sono', 'qualidade', 'rejected', 'Insônia', 'ai_inference', 'attention');

-- A reviewed hypothesis must carry when it was reviewed (the status alone is
-- not evidence of a decision).
insert into public.consultation_hypotheses (org_id, consultation_id, pattern, correspondence, status, reviewed_at, reviewed_by) values
  ('f5100000-0000-4000-8000-000000000001', 'f5400000-0000-4000-8000-000000000002', 'Estagnação de Qi', 'moderate', 'draft', null, null),
  ('f5100000-0000-4000-8000-000000000001', 'f5400000-0000-4000-8000-000000000002', 'Deficiência de Yang', 'weak', 'accepted',
   now(), 'f5000000-0000-4000-8000-000000000002');

-- ---------- Access: three of her own, one support visit ----------

insert into public.access_events (user_id, created_at) values
  ('f5000000-0000-4000-8000-000000000002', now() - interval '3 days'),
  ('f5000000-0000-4000-8000-000000000002', now() - interval '2 days'),
  ('f5000000-0000-4000-8000-000000000002', now() - interval '1 day');
insert into public.access_events (user_id, created_at, impersonated_by) values
  ('f5000000-0000-4000-8000-000000000002', now(), 'f5000000-0000-4000-8000-000000000001');

-- An audit row whose metadata carries a patient name: the timeline must not
-- carry it across.
insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata) values
  ('f5100000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002', 'patient.viewed', 'patient',
   'f5200000-0000-4000-8000-000000000001', '{"patient_name":"Paciente Sigilosa Dossie"}'::jsonb);

create temporary table dossier_result (name text primary key, payload jsonb);
grant select, insert on table dossier_result to authenticated;

-- ---------- Only a superadmin (or a cron) may read it ----------

select set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_account_dossier('f5100000-0000-4000-8000-000000000001')$$,
  'not_authorized',
  'the professional cannot read her own dossier through this door'
);
reset role;

select set_config('request.jwt.claims',
  '{"sub":"f5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_account_dossier('f5100000-0000-4000-8000-00000000dead')$$,
  'workspace_not_found',
  'and a workspace that does not exist is an error, not an empty dossier'
);
insert into dossier_result values
  ('main', public.admin_account_dossier('f5100000-0000-4000-8000-000000000001')),
  ('fresh', public.admin_account_dossier('f5100000-0000-4000-8000-000000000002'));
reset role;

create function pg_temp.d(part text)
returns jsonb language sql stable as $$
  select payload -> part from dossier_result where name = 'main'
$$;

-- ---------- Registration, and what each blank blocks ----------

select is(pg_temp.d('identity') ->> 'fiscalId', 'CPF ***90', 'the fiscal id is a type and two digits, never the number');
select ok(
  (select payload::text not like '%12345678990%' from dossier_result where name = 'main'),
  'and the raw CPF appears nowhere in the payload'
);
select is(
  (pg_temp.d('identity') ->> 'checkoutReady')::boolean,
  true,
  'checkout readiness is the four fields Asaas needs, answered as one fact'
);
select is(
  pg_temp.d('identity') ->> 'billingPhone',
  '11999998888',
  'the billing phone is reported on its own, not coalesced behind the owner''s'
);

-- ---------- Money ----------

select is((pg_temp.d('money') ->> 'lifetimePaidCents')::int, 39800, 'lifetime paid counts the two payments that stuck');
select is(
  (pg_temp.d('money') ->> 'daysToFirstPayment')::int,
  0,
  'a payment older than the workspace (migrated from the old system) reads as zero, not as negative days'
);
select is((pg_temp.d('money') ->> 'refundedCents')::int, 19900, 'and reports the refund beside it, instead of letting it vanish');
select is((pg_temp.d('money') -> 'failedCharges' ->> 'count')::int, 1, 'a charge that is failing right now is a number, not a guess');
select is(
  pg_temp.d('money') -> 'openCheckout' ->> 'planName',
  'Pro',
  'the abandoned checkout surfaces here — the accounts list cannot see it at all'
);
select is(
  pg_temp.d('money') -> 'openCheckout' ->> 'url',
  'https://pay.example/invoice/f5',
  'with the live payment link, which is the whole point of showing it'
);

-- ---------- Use ----------

select is(
  pg_temp.d('usage') -> 'funnel',
  '{"draft": 1, "cancelled": 0, "finalized": 1, "scheduled": 1, "inProgress": 0, "awaitingReview": 0}'::jsonb,
  'the funnel keeps her drafts and the AI''s pile apart'
);
select is((pg_temp.d('usage') ->> 'activePatients')::int, 2, 'archived patients are not active patients');
select is(
  pg_temp.d('usage') -> 'captureSurface' ->> 'mobile',
  '2',
  'where her recordings come from tells whether the companion app ever landed'
);
select is(
  (select payload -> 'usage' ->> 'daysToFirstRecord' from dossier_result where name = 'fresh'),
  null,
  'an account that never finalized a record reports nothing — never "0 days", which would read as instant activation'
);
select is(
  (pg_temp.d('usage') ->> 'daysToFirstPatient')::int,
  0,
  'and a chart older than the workspace (imported history) reads as zero, never as a negative number of days'
);

-- ---------- Broken ----------

select is((pg_temp.d('broken') ->> 'failedRecordings30d')::int, 1, 'failures are counted where the minute meter cannot see them');
select is(
  pg_temp.d('broken') -> 'failureStages' ->> 'transcription',
  '1',
  'and split by stage, so her device and our pipeline are told apart'
);
select is(
  (pg_temp.d('broken') -> 'stuckProcessing' ->> 'count')::int,
  1,
  'a recording stuck with an expired lease is not a failure row — nothing else in the console sees it'
);
select is((pg_temp.d('broken') ->> 'strandedUploads')::int, 1, 'nor is audio that landed and was never picked up');

-- ---------- AI and consent ----------

select is(
  pg_temp.d('ai') -> 'anamnesis',
  '{"edited": 1, "rejected": 1, "fromAudio": 2}'::jsonb,
  'the AI verdict counts what stands and what she overruled (there is no "accepted" row to count)'
);
select is(
  (pg_temp.d('ai') -> 'hypotheses' ->> 'awaitingReview')::int,
  1,
  'a hypothesis in "draft" is the AI''s unreviewed pile, not her work'
);
select is(
  jsonb_build_array(pg_temp.d('consent') -> 'clearedForAudio', pg_temp.d('consent') -> 'clearedForAi'),
  '[1, 1]'::jsonb,
  'capture and AI processing are counted as the two separate gates they are'
);
select is(
  (pg_temp.d('consent') ->> 'audioUnderRevokedConsent')::int,
  1,
  'audio still stored under a revoked consent is surfaced: that one is act-today'
);
select is((pg_temp.d('consent') ->> 'refusals')::int, 1, 'and a purpose the patient refused is the ceiling no product work moves');

-- ---------- Access, and the privacy line ----------

select is(
  (pg_temp.d('access') -> 'signIns' ->> 'total')::int,
  3,
  'support visits do not inflate her sign-ins'
);
select ok(
  (select payload::text not like '%Paciente Sigilosa%' from dossier_result where name = 'main'),
  'and no patient name reaches the dossier — not through the timeline, not through anything else'
);

select * from finish();
rollback;
