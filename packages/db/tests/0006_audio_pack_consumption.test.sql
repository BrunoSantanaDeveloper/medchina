begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ============================================================
-- Migration 0055 — how a recording is CHARGED across the two pools.
--
-- This is the part of the pack design that cannot be verified by reading the
-- allowance function, because the whole scheme depends on consumption being
-- attributed at WRITE time. Two failures are specifically hunted here:
--
--   * a recording that straddles the cycle/pack boundary being charged twice,
--     or charged entirely to one pool;
--   * the pack balance reappearing at the next billing cycle, which is what
--     happens if pack usage is derived from "overflow past the cycle limit"
--     instead of being stamped on the row.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pack-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Pack Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('c2000000-0000-4000-8000-000000000001', 'Pack practice', 'pack-practice',
        'c1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

-- A paid plan with a small, exactly-known pool makes the arithmetic legible:
-- 10 minutes of cycle, so a 12-minute recording must straddle the boundary.
update public.plans set limits = limits || '{"audio_minutes": 10}'::jsonb where slug = 'assistente';
update public.subscriptions
set plan_id = (select id from public.plans where slug = 'assistente'),
    status = 'active',
    current_period_start = now() - interval '1 day',
    current_period_end = now() + interval '29 days'
where org_id = 'c2000000-0000-4000-8000-000000000001';

insert into public.patients (id, org_id, full_name, created_by)
values ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Paciente Pack',
        'c1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
        'c3000000-0000-4000-8000-000000000001', 'draft', 'c1000000-0000-4000-8000-000000000001');

-- Capture and AI processing are separately consented; both gates are real
-- triggers, so the fixture has to satisfy them like the app does.
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select public.set_patient_consent(
  'c3000000-0000-4000-8000-000000000001', 'audio-recording', true, '{"method":"in_person"}'::jsonb
);
select public.set_patient_consent(
  'c3000000-0000-4000-8000-000000000001', 'ai-processing', true, '{"method":"in_person"}'::jsonb
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.transcriptions (id, org_id, mime, status)
values ('c5000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'audio/webm', 'ready');

insert into public.recordings (
  id, org_id, patient_id, consultation_id, status, mode,
  transcription_id, processing_claim_id, processing_clinical_revision, created_by
)
select
  'c6000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
  'processing', 'ai',
  'c5000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001',
  c.clinical_revision, 'c1000000-0000-4000-8000-000000000001'
from public.consultations c where c.id = 'c4000000-0000-4000-8000-000000000001';

-- 300 minutes bought à la carte, on top of the 10-minute cycle.
insert into public.audio_minute_packs (org_id, source, minutes_purchased, seconds_total, invoice_key)
values ('c2000000-0000-4000-8000-000000000001', 'purchase', 300, 18000, 'test:pack-invoice');

create temporary table pack_results (name text primary key, payload jsonb);
grant select, insert on table pack_results to authenticated, service_role;

set local role service_role;

-- A 12-minute consultation against a 10-minute cycle: 600s must come from the
-- cycle and the remaining 120s from the pack.
insert into pack_results values (
  'apply',
  public.apply_recording_result(
    'c6000000-0000-4000-8000-000000000001',
    'c5000000-0000-4000-8000-000000000001',
    'c7000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    '[]'::jsonb,
    720
  )
);

reset role;

select is(
  (select payload ->> 'ok' from pack_results where name = 'apply'),
  'true',
  'the recording is applied and billed in one transaction'
);
select is(
  (select seconds from public.audio_usage where recording_id = 'c6000000-0000-4000-8000-000000000001'),
  720,
  'the whole recording is billed, overrun included — it was allowed to start, so it finishes'
);
select is(
  (select cycle_seconds from public.audio_usage where recording_id = 'c6000000-0000-4000-8000-000000000001'),
  600,
  'the cycle is charged first, up to exactly what it had left'
);
select is(
  (select pack_seconds from public.audio_usage where recording_id = 'c6000000-0000-4000-8000-000000000001'),
  120,
  'and only the remainder reaches the pack'
);
select is(
  (select seconds_consumed from public.audio_minute_packs where invoice_key = 'test:pack-invoice'),
  120,
  'the pack ledger and the usage row agree about how much was spent'
);

-- ---------- Idempotency: a retry must not spend the pack twice ----------

set local role service_role;
insert into pack_results values (
  'retry',
  public.apply_recording_result(
    'c6000000-0000-4000-8000-000000000001',
    'c5000000-0000-4000-8000-000000000001',
    'c7000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    '[]'::jsonb,
    720
  )
);
reset role;

select is(
  (select count(*)::integer from public.audio_usage where recording_id = 'c6000000-0000-4000-8000-000000000001'),
  1,
  'a replayed apply still bills the recording exactly once'
);
select is(
  (select seconds_consumed from public.audio_minute_packs where invoice_key = 'test:pack-invoice'),
  120,
  'and crucially does NOT debit the pack a second time'
);

-- ---------- The balance is not refunded by a new cycle ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

insert into pack_results values
  ('same-cycle', public.org_audio_allowance('c2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'pack_minutes_remaining' from pack_results where name = 'same-cycle'),
  '298',
  'the purchased balance reflects exactly what was spent'
);

-- Roll the billing period forward, as a renewal would. `clock_timestamp()`
-- and not `now()`: inside this transaction `now()` is frozen at its start, so
-- a window opened at `now()` would still contain the usage recorded above and
-- the "new cycle" would not be new at all.
update public.subscriptions
set current_period_start = clock_timestamp(),
    current_period_end = clock_timestamp() + interval '30 days'
where org_id = 'c2000000-0000-4000-8000-000000000001';

insert into pack_results values
  ('next-cycle', public.org_audio_allowance('c2000000-0000-4000-8000-000000000001'));

select is(
  (select payload ->> 'minutes_used' from pack_results where name = 'next-cycle'),
  '0',
  'the cycle pool resets with the new period'
);
select is(
  (select payload ->> 'pack_minutes_remaining' from pack_results where name = 'next-cycle'),
  '298',
  'but the purchased balance does NOT come back — this is the bug the write-time split exists to prevent'
);
select is(
  (select payload ->> 'reason' from pack_results where name = 'next-cycle'),
  'ok',
  'and with a fresh cycle she is back to spending the plan, not the pack'
);

reset role;
select * from finish();
rollback;
