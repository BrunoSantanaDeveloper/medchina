-- ============================================================
-- 0098_consultation_journey_rpcs
--
-- Two dead ends and one spurious cascade, all found while mapping what the
-- consultation screen promises against what the database actually enforces:
--
--  1. A field the extraction marked "requer atenção" had NO way to be closed
--     except rewriting its text. Confirming a value she agrees with went
--     through `save_consultation_answer`, which would stamp it as HER edit
--     (losing the AI provenance) and bump `clinical_revision`, staling every
--     hypothesis. `confirm_anamnesis_answer` records the review instead:
--     state attention → clear, source and provenance untouched, reviewer
--     stamped, and NO revision bump (confirming a value changes no clinical
--     content, so nothing built on it becomes stale).
--
--  2. A hypothesis she had already ACCEPTED and that later went stale was
--     frozen forever: `review_consultation_hypothesis` refuses any decision on
--     a stale row (0031:152-154) and `replace_draft_hypotheses` only replaces
--     drafts. The AI plan, which requires an accepted hypothesis with
--     `stale_at is null` (0031:656-662), could never be prepared again.
--     `reaffirm_consultation_hypothesis` is the missing exit: a NAMED
--     confirmation (she re-states the pattern) that marks the decision current
--     against today's chart.
--
--  3. Dismissing an "Investigar" suggestion bumped `clinical_revision` through
--     `guard_consultation_lifecycle`, which stales hypotheses and un-validates
--     the plan. `ai_gaps` feed NO AI output (hypotheses, plan and summary read
--     answers, chief complaint, alerts, attachments and her summary — never the
--     gaps), so clearing a question she investigated destroyed work for nothing.
--
-- Plus `consultation_plans.retrieval_failed`, so "a biblioteca não pôde ser
-- consultada" survives a reload for the plan exactly as 0094 made it survive
-- for the hypotheses.
-- ============================================================

-- ---------- 1. The review stamp on an answer ----------

alter table public.anamnesis_answers
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

comment on column public.anamnesis_answers.reviewed_at is
  'When the professional confirmed this value as it stands (confirm_anamnesis_answer). Cleared whenever the value or its origin changes: a confirmation is of a specific text.';

create or replace function public.clear_answer_review_on_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A confirmation belongs to the text that was confirmed. The pipeline may
  -- later merge new information into an AI-authored field (0092), and she may
  -- retype it herself; either way the old review no longer describes the value.
  if new.value is distinct from old.value or new.source is distinct from old.source then
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists anamnesis_answers_reset_review on public.anamnesis_answers;
create trigger anamnesis_answers_reset_review
  before update on public.anamnesis_answers
  for each row execute function public.clear_answer_review_on_change();

-- ---------- 2. A review confirmation does not touch the clinical revision ----------
-- Copied verbatim from 0029:163-189, with ONE early return added.

create or replace function public.touch_consultation_revision_from_answer()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target uuid := coalesce(new.consultation_id, old.consultation_id);
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  -- A REVIEW CONFIRMATION changes no clinical content: same field, same value,
  -- same origin and provenance — only the review state moves from "requer
  -- atenção" to "clear". Bumping the revision here would stale every hypothesis
  -- and un-validate the plan for the act of agreeing with what is written,
  -- which is the opposite of what the professional just told us.
  if tg_op = 'UPDATE'
     and new.consultation_id = old.consultation_id
     and new.block_key = old.block_key
     and new.field_key = old.field_key
     and new.value is not distinct from old.value
     and new.source is not distinct from old.source
     and new.provenance is not distinct from old.provenance
     and new.original_value is not distinct from old.original_value
     and old.state = 'attention'
     and new.state = 'clear' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.consultation_id is distinct from old.consultation_id then
    -- Moving an answer changes both clinical records: the destination gains
    -- content and the source loses it. Both optimistic revisions must become
    -- stale in the same transaction.
    update public.consultations
    set clinical_revision = clinical_revision + 1,
        updated_at = now()
    where id in (old.consultation_id, new.consultation_id);
  else
    update public.consultations
    set clinical_revision = clinical_revision + 1,
        updated_at = now()
    where id = target;
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------- 3. Confirming an AI value as it stands ----------

create or replace function public.confirm_anamnesis_answer(
  target_consultation uuid,
  target_block_key text,
  target_field_key text,
  expected_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  answer_row public.anamnesis_answers%rowtype;
  block_key_clean text := btrim(target_block_key);
  field_key_clean text := btrim(target_field_key);
begin
  if target_consultation is null
     or nullif(block_key_clean, '') is null
     or nullif(field_key_clean, '') is null
     or expected_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Same lock order as save_consultation_answer: parent first, then the row.
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

  select a.* into answer_row
  from public.anamnesis_answers a
  where a.consultation_id = target_consultation
    and a.block_key = block_key_clean
    and a.field_key = field_key_clean
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  -- She is confirming what she READ. If the text moved underneath her (another
  -- tab, a second recording), the confirmation is not about this value.
  if btrim(answer_row.value) is distinct from btrim(expected_value) then
    return jsonb_build_object(
      'ok', false,
      'code', 'revision_conflict',
      'revision', consultation_row.clinical_revision
    );
  end if;

  -- Idempotent: a double click on "Manter" is not an error.
  if answer_row.state = 'clear' then
    return jsonb_build_object(
      'ok', true,
      'code', 'unchanged',
      'revision', consultation_row.clinical_revision,
      'state', 'clear'
    );
  end if;
  if answer_row.state <> 'attention' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'state');
  end if;

  update public.anamnesis_answers
  set state = 'clear',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = answer_row.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'confirmed',
    -- Unchanged by design (see the trigger above): the hypotheses and the plan
    -- prepared from this chart stay current.
    'revision', consultation_row.clinical_revision,
    'state', 'clear'
  );
end;
$$;

revoke all on function public.confirm_anamnesis_answer(uuid, text, text, text) from public, anon;
grant execute on function public.confirm_anamnesis_answer(uuid, text, text, text) to authenticated;

comment on function public.confirm_anamnesis_answer(uuid, text, text, text) is
  'Records that the professional reviewed an AI-drafted field and keeps it as written: state attention → clear, source/provenance preserved, reviewer stamped, clinical_revision untouched.';

-- ---------- 4. Reaffirming a decision that went stale ----------

create or replace function public.reaffirm_consultation_hypothesis(
  target_hypothesis uuid,
  expected_updated_at timestamptz,
  confirm_pattern text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hypothesis_row public.consultation_hypotheses%rowtype;
  consultation_row public.consultations%rowtype;
  target_consultation_id uuid;
begin
  if target_hypothesis is null or expected_updated_at is null or nullif(btrim(confirm_pattern), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Discover the parent without taking a child lock, then re-read the child
  -- after the parent lock — the order every clinical decision RPC uses.
  select h.consultation_id into target_consultation_id
  from public.consultation_hypotheses h
  where h.id = target_hypothesis;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select h.* into hypothesis_row
  from public.consultation_hypotheses h
  where h.id = target_hypothesis
    and h.consultation_id = target_consultation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'hypothesis_revision_conflict');
  end if;

  if not (public.is_org_member(hypothesis_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  if hypothesis_row.updated_at is distinct from expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'hypothesis_revision_conflict');
  end if;
  -- Only HER decisions can be reaffirmed. A stale draft is replaced by
  -- preparing again; reaffirming one would launder a suggestion into a decision.
  if hypothesis_row.status not in ('accepted', 'edited') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'status');
  end if;
  -- Named confirmation: the client must send back the pattern it displayed, so
  -- "reaffirm" can never be a batch action over hypotheses she did not read.
  if lower(btrim(confirm_pattern)) is distinct from lower(btrim(hypothesis_row.pattern)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'confirmPattern');
  end if;

  -- Idempotent: reaffirming something already current changes nothing.
  if hypothesis_row.stale_at is null then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'hypothesisId', target_hypothesis);
  end if;

  -- No status/pattern/review_note change, so touch_consultation_revision_from_hypothesis
  -- (0031:61-95) does NOT bump the revision: reaffirming is not a new decision
  -- about the record, it is the same decision re-anchored to the current one.
  update public.consultation_hypotheses
  set stale_at = null,
      input_revision = consultation_row.clinical_revision,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = target_hypothesis;

  return jsonb_build_object(
    'ok', true,
    'code', 'reaffirmed',
    'hypothesisId', target_hypothesis,
    'revision', consultation_row.clinical_revision
  );
end;
$$;

revoke all on function public.reaffirm_consultation_hypothesis(uuid, timestamptz, text) from public, anon;
grant execute on function public.reaffirm_consultation_hypothesis(uuid, timestamptz, text) to authenticated;

comment on function public.reaffirm_consultation_hypothesis(uuid, timestamptz, text) is
  'Marks a hypothesis the professional had accepted/edited as current against today''s chart, after a named confirmation. The only exit from an accepted-then-stale hypothesis, which review_consultation_hypothesis refuses and replace_draft_hypotheses never touches.';

-- ---------- 5. The plan remembers whether the library answered ----------

alter table public.consultation_plans
  add column if not exists retrieval_failed boolean not null default false;

comment on column public.consultation_plans.retrieval_failed is
  'True when this plan was generated with the clinical library UNREACHABLE. "No source supports it" and "the library was never consulted" are different facts and the panel must be able to say which — the same distinction 0094 added to the hypotheses.';

-- ---------- 6. Clearing an investigated question is not a clinical edit ----------
-- Copied verbatim from 0029:20-88, removing `ai_gaps` from the REVISION BUMP
-- only. It stays in the cancelled-record guard above it: a cancelled chart is
-- immutable, gaps included.

create or replace function public.guard_consultation_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  valid_transition boolean := false;
begin
  -- Cascading housekeeping must remain possible for account/patient erasure.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is distinct from old.status then
    valid_transition :=
      (old.status = 'scheduled' and new.status in ('in_progress', 'cancelled'))
      or (old.status = 'draft' and new.status in ('in_progress', 'awaiting_review', 'finalized', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('awaiting_review', 'finalized', 'cancelled'))
      or (old.status = 'awaiting_review' and new.status in ('in_progress', 'finalized', 'cancelled'))
      -- 0028 deliberately supports restoring a cancelled appointment. A
      -- cancelled clinical draft (no scheduled_for) remains terminal.
      or (old.status = 'cancelled' and new.status = 'scheduled' and old.scheduled_for is not null);

    if not valid_transition then
      raise exception 'invalid_consultation_transition'
        using errcode = 'check_violation',
              detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
    end if;
  end if;

  if old.status = 'cancelled' and new.status = 'cancelled' then
    if new.patient_id is distinct from old.patient_id
       or new.summary is distinct from old.summary
       or new.chief_complaint is distinct from old.chief_complaint
       or new.transcription_id is distinct from old.transcription_id
       or new.ai_gaps is distinct from old.ai_gaps then
      raise exception 'consultation_cancelled' using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'finalized' and old.status <> 'finalized' then
    if exists (
      select 1
      from public.recordings r
      where r.consultation_id = old.id
        and r.status in ('recording', 'local', 'uploading', 'uploaded', 'processing', 'failed')
    ) then
      raise exception 'recording_pending' using errcode = 'check_violation';
    end if;

    new.finalized_at := coalesce(new.finalized_at, now());
    new.finalized_by := coalesce(new.finalized_by, auth.uid());
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
  elsif old.status = 'cancelled' and new.status = 'scheduled' then
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
  end if;

  -- `ai_gaps` deliberately absent: the gaps are QUESTIONS the extraction raised
  -- (PRD §10.7) and no AI step reads them, so dismissing one must not stale the
  -- hypotheses or un-validate the plan. Everything else here IS an input the
  -- hypotheses/plan/summary prompts read, so changing it must.
  if new.patient_id is distinct from old.patient_id
     or new.summary is distinct from old.summary
     or new.chief_complaint is distinct from old.chief_complaint
     or new.transcription_id is distinct from old.transcription_id then
    new.clinical_revision := old.clinical_revision + 1;
  end if;

  return new;
end;
$$;
