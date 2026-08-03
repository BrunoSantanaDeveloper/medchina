-- The professional's correction is the most valuable signal this product
-- produces, and until now it was destroyed at the exact moment it became
-- meaningful. Editing an AI-filled answer overwrote the value in place AND
-- blanked its provenance (0037); clearing one deleted the row outright. What
-- the model wrote, and what she corrected it to, survived only inside
-- record_versions — which nothing reads.
--
-- Three changes, all additive:
--
--  1. `anamnesis_answers.original_value` — a column that has existed since 0020
--     and was never once written — now keeps the AI's own wording from the
--     first professional edit, and the provenance survives that edit. A
--     correction is a second reading of the same recorded moment, not the
--     erasure of it, so the audio segment stays reachable from the corrected
--     field.
--
--  2. `ai_answer_decisions` records the decision itself. A rejection cannot be
--     a state on the answer row: `value` is NOT NULL with a non-empty check
--     (0037), and a "rejected" answer left in the chart would have to be
--     filtered by every reader that exists — the reasoning prompt, the case
--     review, the briefing, the issued PDF — with a miss meaning discarded
--     clinical content silently re-entering the record. The invariant stays
--     exactly as it is (a field with no row is "não informado", PRD §10.5) and
--     the signal moves to a table whose only job is to hold it.
--
--  3. That table is also a FENCE, not only telemetry. Reprocessing the audio
--     (a second recording, a retry after a corrected upload) used to re-insert
--     precisely the field she had just thrown away, because deleting the row
--     erased the evidence that she had decided anything. A rejection is now
--     durable.
--
-- Nothing here writes a clinical fact. `ai_answer_decisions` mirrors content
-- that already lives in the consultation and cascades with it, so LGPD erasure
-- (PRD §14.5) takes it along.

-- ---------- The decision record ----------

create table if not exists public.ai_answer_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  block_key text not null,
  field_key text not null,
  -- What she did with the draft. 'accepted' is deliberately absent: leaving a
  -- value untouched is not an act, and recording it as one would inflate every
  -- acceptance rate computed from this table.
  decision text not null check (decision in ('edited', 'rejected')),
  -- The AI's draft, verbatim, and how it labelled itself. Written once, on the
  -- first decision, and never updated afterwards — the second edit of the same
  -- field is still a correction OF THE MODEL, not of the previous correction.
  ai_value text not null,
  ai_source public.answer_source not null,
  ai_state public.answer_state not null,
  -- What replaced it. Null means the draft was thrown away.
  final_value text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (consultation_id, block_key, field_key)
);

comment on table public.ai_answer_decisions is
  'What the professional did with an AI-drafted anamnesis field: the draft, her replacement, and the decision. Feeds quality measurement and fences a rejected field against reprocessing.';
comment on column public.ai_answer_decisions.ai_value is
  'The model''s own wording, captured on the FIRST decision and never overwritten.';
comment on column public.ai_answer_decisions.final_value is
  'What the professional put in its place; null when she rejected the draft.';

create index if not exists ai_answer_decisions_org_idx
  on public.ai_answer_decisions (org_id, decided_at desc);
create index if not exists ai_answer_decisions_field_idx
  on public.ai_answer_decisions (org_id, block_key, field_key, decision);

alter table public.ai_answer_decisions enable row level security;

-- Readable by the workspace, writable only through the reviewed RPC below —
-- the same shape every clinical AI output already has (0031).
drop policy if exists "ai_answer_decisions_select_member" on public.ai_answer_decisions;
create policy "ai_answer_decisions_select_member" on public.ai_answer_decisions for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

revoke insert, update, delete on table public.ai_answer_decisions from authenticated;
grant select on table public.ai_answer_decisions to authenticated;

drop trigger if exists ai_answer_decisions_updated_at on public.ai_answer_decisions;
create trigger ai_answer_decisions_updated_at
  before update on public.ai_answer_decisions
  for each row execute function public.set_updated_at();

-- Clinical rows are versioned like every other one (packages/audit).
select public.enable_row_versioning('public.ai_answer_decisions');

-- A support session may look at a record; it may never decide inside one.
drop trigger if exists guard_impersonation_ai_answer_decisions on public.ai_answer_decisions;
create trigger guard_impersonation_ai_answer_decisions
  after insert or update or delete on public.ai_answer_decisions
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Saving an answer now preserves what it replaced ----------

create or replace function public.save_consultation_answer(
  target_consultation uuid,
  expected_revision bigint,
  target_block_key text,
  target_field_key text,
  target_value text,
  target_source text default 'professional',
  target_state text default 'clear'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  existing_row public.anamnesis_answers%rowtype;
  block_key_clean text := btrim(target_block_key);
  field_key_clean text := btrim(target_field_key);
  value_clean text := nullif(btrim(coalesce(target_value, '')), '');
  ai_authored boolean := false;
  effective_state text;
  next_revision bigint;
begin
  if target_consultation is null
     or expected_revision is null
     or nullif(block_key_clean, '') is null
     or nullif(field_key_clean, '') is null
     or target_source not in ('professional', 'professional_voice')
     or target_state not in ('clear', 'edited') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition');
  end if;
  if consultation_row.clinical_revision is distinct from expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'revision_conflict',
      'revision', consultation_row.clinical_revision
    );
  end if;

  select a.* into existing_row
  from public.anamnesis_answers a
  where a.consultation_id = target_consultation
    and a.block_key = block_key_clean
    and a.field_key = field_key_clean;

  -- "The AI wrote this" is a fact on the row, not a guess: the extraction
  -- stamps the transcription id into provenance (0030) and a hand-typed answer
  -- never carries one. The source check catches drafts written before that
  -- stamp existed.
  if found then
    ai_authored := existing_row.source in ('patient_report', 'ai_inference')
                   or (existing_row.provenance ? 'transcriptionId');
  end if;

  -- The client decides the state from the source it can see, and it cannot see
  -- that a dictated tongue finding (`professional_voice`) came from the model.
  -- The database can, so it decides: touching AI output is always an edit.
  effective_state := case when ai_authored then 'edited' else target_state end;

  if value_clean is null then
    -- Clearing an AI draft is a REJECTION, and it has to outlive the row it
    -- deletes — otherwise reprocessing puts it straight back.
    if ai_authored then
      insert into public.ai_answer_decisions (
        org_id, consultation_id, block_key, field_key,
        decision, ai_value, ai_source, ai_state, final_value, decided_by
      ) values (
        consultation_row.org_id, target_consultation, block_key_clean, field_key_clean,
        'rejected', existing_row.value, existing_row.source, existing_row.state, null, auth.uid()
      )
      on conflict (consultation_id, block_key, field_key) do update
      set decision = 'rejected',
          final_value = null,
          decided_by = auth.uid(),
          decided_at = now();
    end if;

    delete from public.anamnesis_answers
    where consultation_id = target_consultation
      and block_key = block_key_clean
      and field_key = field_key_clean;
  else
    if ai_authored then
      insert into public.ai_answer_decisions (
        org_id, consultation_id, block_key, field_key,
        decision, ai_value, ai_source, ai_state, final_value, decided_by
      ) values (
        consultation_row.org_id, target_consultation, block_key_clean, field_key_clean,
        'edited',
        coalesce(existing_row.original_value, existing_row.value),
        existing_row.source, existing_row.state, value_clean, auth.uid()
      )
      on conflict (consultation_id, block_key, field_key) do update
      set decision = 'edited',
          final_value = value_clean,
          decided_by = auth.uid(),
          decided_at = now();
    end if;

    insert into public.anamnesis_answers (
      org_id,
      consultation_id,
      block_key,
      field_key,
      value,
      source,
      state,
      created_by
    ) values (
      consultation_row.org_id,
      target_consultation,
      block_key_clean,
      field_key_clean,
      value_clean,
      target_source::public.answer_source,
      effective_state::public.answer_state,
      auth.uid()
    )
    on conflict (consultation_id, block_key, field_key) do update
    set value = excluded.value,
        source = excluded.source,
        state = excluded.state,
        -- Kept only while it still points at something real: the transcript
        -- excerpt that produced the draft she is correcting. A value she typed
        -- into a never-drafted field has no provenance and must not inherit one.
        provenance = case
          when ai_authored then public.anamnesis_answers.provenance
          else '{}'::jsonb
        end,
        -- Written once. The second correction of the same field is still a
        -- correction of the MODEL's draft, not of the first correction.
        original_value = case
          when ai_authored then coalesce(public.anamnesis_answers.original_value, public.anamnesis_answers.value)
          else public.anamnesis_answers.original_value
        end,
        updated_at = now();
  end if;

  select c.clinical_revision into next_revision
  from public.consultations c
  where c.id = target_consultation;

  return jsonb_build_object(
    'ok', true,
    'code', 'saved',
    'revision', next_revision,
    -- The client mirrors the row it just wrote; without this it would keep
    -- showing "clear" on a field the database now knows was an edit.
    'state', case when value_clean is null then null else effective_state end,
    'wasAiDraft', ai_authored
  );
end;
$$;

revoke all on function public.save_consultation_answer(uuid, bigint, text, text, text, text, text)
  from public, anon;
grant execute on function public.save_consultation_answer(uuid, bigint, text, text, text, text, text)
  to authenticated;

-- ---------- Reprocessing never resurrects a rejected field ----------
-- Same body as 0030 (renamed by 0037), with one guard added: a field the
-- professional threw away stays thrown away. The existing ON CONFLICT clause
-- could not defend this case, because a rejection leaves no row to conflict
-- with — the insert simply succeeded again.

create or replace function public.apply_recording_result_without_usage(
  target_recording uuid,
  target_transcription uuid,
  target_claim_id uuid,
  target_answers jsonb,
  target_gaps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_consultation_id uuid;
  consultation_row public.consultations%rowtype;
  recording_row public.recordings%rowtype;
  item jsonb;
  answer_source public.answer_source;
  answer_state public.answer_state;
  affected integer;
  written integer := 0;
  skipped integer := 0;
begin
  if target_transcription is null or target_claim_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select r.consultation_id into claimed_consultation_id from public.recordings r where r.id = target_recording;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = claimed_consultation_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select r.* into recording_row
  from public.recordings r
  where r.id = target_recording
  for update;

  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(recording_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if recording_row.status <> 'processing'
     or recording_row.transcription_id is distinct from target_transcription
     or recording_row.processing_claim_id is distinct from target_claim_id then
    return jsonb_build_object('ok', false, 'code', 'recording_invalid_state', 'status', recording_row.status);
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition', 'status', consultation_row.status);
  end if;
  if not public.has_active_consent(recording_row.org_id, recording_row.patient_id, 'ai-processing') then
    return jsonb_build_object('ok', false, 'code', 'consent_required', 'consent', 'ai-processing');
  end if;
  if recording_row.processing_clinical_revision is distinct from consultation_row.clinical_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'clinical_revision_conflict',
      'claimRevision', recording_row.processing_clinical_revision,
      'revision', consultation_row.clinical_revision
    );
  end if;

  for item in select value from jsonb_array_elements(coalesce(target_answers, '[]'::jsonb)) loop
    if nullif(btrim(item ->> 'value'), '') is null
       or nullif(btrim(item ->> 'blockKey'), '') is null
       or nullif(btrim(item ->> 'fieldKey'), '') is null then
      continue;
    end if;

    -- She already looked at this field and threw the draft away. Writing it
    -- back would overrule a clinical decision with a retry.
    if exists (
      select 1
      from public.ai_answer_decisions d
      where d.consultation_id = consultation_row.id
        and d.block_key = item ->> 'blockKey'
        and d.field_key = item ->> 'fieldKey'
        and d.decision = 'rejected'
    ) then
      skipped := skipped + 1;
      continue;
    end if;

    answer_source := case
      when item ->> 'source' in ('patient_report', 'professional_voice', 'ai_inference')
        then (item ->> 'source')::public.answer_source
      else 'ai_inference'::public.answer_source
    end;
    answer_state := case
      when item ->> 'state' in ('clear', 'attention')
        then (item ->> 'state')::public.answer_state
      else 'attention'::public.answer_state
    end;

    insert into public.anamnesis_answers (
      org_id, consultation_id, block_key, field_key, value, source, state, provenance, created_by
    ) values (
      recording_row.org_id,
      consultation_row.id,
      item ->> 'blockKey',
      item ->> 'fieldKey',
      btrim(item ->> 'value'),
      answer_source,
      answer_state,
      coalesce(item -> 'provenance', '{}'::jsonb) || jsonb_build_object('transcriptionId', target_transcription),
      recording_row.created_by
    )
    on conflict (consultation_id, block_key, field_key) do update
    set value = excluded.value,
        source = excluded.source,
        state = excluded.state,
        provenance = excluded.provenance,
        updated_at = now()
    where public.anamnesis_answers.source not in ('professional', 'professional_voice')
      and public.anamnesis_answers.state not in ('edited', 'rejected');

    get diagnostics affected = row_count;
    written := written + affected;
  end loop;

  update public.consultations
  set status = 'awaiting_review',
      transcription_id = target_transcription,
      ai_gaps = case when jsonb_typeof(target_gaps) = 'array' then target_gaps else '[]'::jsonb end
  where id = consultation_row.id;

  update public.recordings
  set status = 'ready',
      transcription_id = target_transcription,
      processing_heartbeat_at = null,
      processing_lease_expires_at = null
  where id = target_recording;

  return jsonb_build_object(
    'ok', true,
    'code', 'ready',
    'recordingId', target_recording,
    'transcriptionId', target_transcription,
    'answers', written,
    'rejectedSkipped', skipped,
    'gaps', jsonb_array_length(case when jsonb_typeof(target_gaps) = 'array' then target_gaps else '[]'::jsonb end)
  );
end;
$$;

revoke all on function public.apply_recording_result_without_usage(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- ---------- Moxibustion never validates without its checklist ----------
-- PRD §10.9 requires the contraindication checklist to be verified BEFORE
-- application, and until now that invariant lived only in the generation path
-- (lib/therapeutic-plan.ts seeds it when the model omits it). A manually
-- created plan, or an edited one whose checklist was emptied, validated and
-- issued a signed PDF without it. The guarantee belongs where nothing can
-- route around it.

create or replace function public.validate_consultation_plan(
  target_plan uuid,
  expected_updated_at timestamptz,
  acknowledge_safety boolean,
  target_validation_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.consultation_plans%rowtype;
  consultation_row public.consultations%rowtype;
  target_consultation_id uuid;
  moxibustion jsonb;
begin
  if expected_updated_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'expectedUpdatedAt');
  end if;
  if acknowledge_safety is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'acknowledgeSafety');
  end if;

  select p.consultation_id into target_consultation_id
  from public.consultation_plans p
  where p.id = target_plan;
  if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

  select p.* into plan_row
  from public.consultation_plans p
  where p.id = target_plan and p.consultation_id = target_consultation_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'clinical_revision_conflict'); end if;

  if not (public.is_org_member(plan_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  if plan_row.updated_at is distinct from expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'clinical_revision_conflict');
  end if;
  if plan_row.stale_at is not null
     or plan_row.input_revision <> consultation_row.clinical_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'plan_stale',
      'planRevision', plan_row.input_revision,
      'clinicalRevision', consultation_row.clinical_revision
    );
  end if;
  if nullif(btrim(plan_row.objective), '') is null
     or not exists (
       select 1 from jsonb_each(plan_row.modalities) modality
       where coalesce((modality.value ->> 'enabled')::boolean, false)
     ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  moxibustion := plan_row.modalities -> 'moxibustion';
  if coalesce((moxibustion ->> 'enabled')::boolean, false) then
    if jsonb_typeof(moxibustion -> 'contraindicationChecklist') is distinct from 'array'
       or not exists (
         select 1
         from jsonb_array_elements_text(moxibustion -> 'contraindicationChecklist') entry
         where nullif(btrim(entry), '') is not null
       ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'moxibustion_checklist_required',
        'modality', 'moxibustion'
      );
    end if;
  end if;

  if jsonb_array_length(plan_row.safety_flags) > 0 and acknowledge_safety is not true then
    return jsonb_build_object('ok', false, 'code', 'safety_acknowledgement_required');
  end if;

  update public.consultation_plans
  set status = 'validated',
      validated_by = auth.uid(),
      validated_at = now(),
      safety_acknowledged_by = case when jsonb_array_length(safety_flags) > 0 then auth.uid() else null end,
      safety_acknowledged_at = case when jsonb_array_length(safety_flags) > 0 then now() else null end,
      validation_context = coalesce(target_validation_context, '{}'::jsonb)
  where id = target_plan;

  return jsonb_build_object('ok', true, 'code', 'validated', 'planId', target_plan);
end;
$$;

revoke all on function public.validate_consultation_plan(uuid, timestamptz, boolean, jsonb) from public, anon;
grant execute on function public.validate_consultation_plan(uuid, timestamptz, boolean, jsonb) to authenticated;
