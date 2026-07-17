-- ============================================================
-- 0031_clinical_decisions_documents
--
-- Stale-safe hypothesis/plan decisions, a real manual plan path, and
-- idempotent atomic document version publication.
-- ============================================================

-- ---------- Hypotheses ----------

alter table public.consultation_hypotheses
  add column if not exists input_revision bigint,
  add column if not exists stale_at timestamptz;

update public.consultation_hypotheses h
set input_revision = c.clinical_revision
from public.consultations c
where c.id = h.consultation_id and h.input_revision is null;

alter table public.consultation_hypotheses
  alter column input_revision set default 0,
  alter column input_revision set not null;

-- Repair pre-contract rows before validating the invariant. The actor UUID is
-- deliberately not reconstructed: reviewed_by is ON DELETE SET NULL for LGPD
-- erasure, while reviewed_at remains the durable evidence that a decision was
-- made. Legacy text is explicit about the source omission instead of inventing
-- a clinical rationale.
alter table public.consultation_hypotheses disable trigger consultation_hypotheses_finalized_guard;
update public.consultation_hypotheses
set pattern = '[Descrição ausente em registro legado]'
where nullif(btrim(pattern), '') is null;

update public.consultation_hypotheses
set reviewed_at = coalesce(reviewed_at, updated_at, created_at)
where status <> 'draft' and reviewed_at is null;

update public.consultation_hypotheses
set review_note = 'Rejeição registrada antes da obrigatoriedade de justificativa; motivo original não informado.'
where status = 'rejected' and nullif(btrim(review_note), '') is null;
alter table public.consultation_hypotheses enable trigger consultation_hypotheses_finalized_guard;

alter table public.consultation_hypotheses
  add constraint consultation_hypotheses_pattern_nonempty_check
    check (nullif(btrim(pattern), '') is not null) not valid,
  add constraint consultation_hypotheses_decision_authorship_check
    check (
      status = 'draft'
      or reviewed_at is not null
    ) not valid,
  add constraint consultation_hypotheses_rejection_note_check
    check (status <> 'rejected' or nullif(btrim(review_note), '') is not null) not valid;

alter table public.consultation_hypotheses
  validate constraint consultation_hypotheses_pattern_nonempty_check,
  validate constraint consultation_hypotheses_decision_authorship_check,
  validate constraint consultation_hypotheses_rejection_note_check;

comment on column public.consultation_hypotheses.input_revision is
  'Clinical revision whose recorded case the generated hypothesis used.';

create or replace function public.touch_consultation_revision_from_hypothesis()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target uuid := coalesce(new.consultation_id, old.consultation_id);
  touches_decision boolean := false;
begin
  if tg_op = 'UPDATE' then
    touches_decision :=
      new.status is distinct from old.status
      or new.pattern is distinct from old.pattern
      or new.review_note is distinct from old.review_note;
  elsif tg_op = 'DELETE' then
    touches_decision := old.status <> 'draft';
  end if;

  if touches_decision then
    perform set_config('medchina.clinical_revision_source', 'hypothesis_decision', true);
    update public.consultations
    set clinical_revision = clinical_revision + 1,
        updated_at = now()
    where id = target;
    perform set_config('medchina.clinical_revision_source', '', true);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists consultation_hypotheses_touch_consultation on public.consultation_hypotheses;
create trigger consultation_hypotheses_touch_consultation
  after update or delete on public.consultation_hypotheses
  for each row execute function public.touch_consultation_revision_from_hypothesis();

create or replace function public.review_consultation_hypothesis(
  target_hypothesis uuid,
  target_status public.hypothesis_status,
  target_pattern text default null,
  target_note text default null,
  expected_updated_at timestamptz default null
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
  if expected_updated_at is null or target_status is null or target_status = 'draft' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- Discover the parent without taking a child lock, then re-read the child
  -- after the parent lock. Every clinical decision RPC uses this order.
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
  if hypothesis_row.stale_at is not null then
    return jsonb_build_object('ok', false, 'code', 'hypothesis_stale');
  end if;
  if target_status = 'edited' and nullif(btrim(target_pattern), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if target_status = 'rejected' and nullif(btrim(target_note), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'reviewNote');
  end if;

  update public.consultation_hypotheses
  set status = target_status,
      pattern = case when target_status = 'edited' then btrim(target_pattern) else pattern end,
      review_note = nullif(btrim(target_note), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = target_hypothesis;

  return jsonb_build_object(
    'ok', true,
    'code', 'reviewed',
    'hypothesisId', target_hypothesis,
    'status', target_status
  );
end;
$$;

create or replace function public.replace_draft_hypotheses(
  target_consultation uuid,
  expected_revision bigint,
  target_hypotheses jsonb,
  target_model text,
  target_prompt_version text,
  target_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  item jsonb;
  inserted_count integer := 0;
  correspondence public.hypothesis_correspondence;
begin
  if expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'expectedRevision');
  end if;
  if jsonb_typeof(target_hypotheses) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'hypotheses');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if coalesce(auth.role(), '') = 'service_role' then
    if not exists (
      select 1 from public.memberships m
      where m.org_id = consultation_row.org_id and m.user_id = target_actor
    ) then return jsonb_build_object('ok', false, 'code', 'not_authorized'); end if;
  elsif not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  if consultation_row.clinical_revision <> expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'clinical_revision_conflict',
      'revision', consultation_row.clinical_revision
    );
  end if;

  delete from public.consultation_hypotheses
  where consultation_id = target_consultation and status = 'draft';

  for item in select value from jsonb_array_elements(coalesce(target_hypotheses, '[]'::jsonb)) loop
    if nullif(btrim(item ->> 'pattern'), '') is null then continue; end if;
    if exists (
      select 1 from public.consultation_hypotheses h
      where h.consultation_id = target_consultation
        and h.status <> 'draft'
        and lower(btrim(h.pattern)) = lower(btrim(item ->> 'pattern'))
    ) then
      continue;
    end if;

    correspondence := case
      when item ->> 'correspondence' in ('weak', 'moderate', 'strong')
        then (item ->> 'correspondence')::public.hypothesis_correspondence
      else 'weak'::public.hypothesis_correspondence
    end;

    insert into public.consultation_hypotheses (
      org_id,
      consultation_id,
      pattern,
      rationale,
      correspondence,
      supporting_signs,
      contradicting_signs,
      missing_data,
      sources,
      limitation,
      status,
      model,
      prompt_version,
      input_revision,
      created_by
    ) values (
      consultation_row.org_id,
      consultation_row.id,
      btrim(item ->> 'pattern'),
      nullif(btrim(item ->> 'rationale'), ''),
      correspondence,
      coalesce(item -> 'supportingSigns', '[]'::jsonb),
      coalesce(item -> 'contradictingSigns', '[]'::jsonb),
      coalesce(item -> 'missingData', '[]'::jsonb),
      coalesce(item -> 'sources', '[]'::jsonb),
      nullif(btrim(item ->> 'limitation'), ''),
      'draft',
      target_model,
      target_prompt_version,
      expected_revision,
      target_actor
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'code', 'prepared', 'count', inserted_count, 'revision', expected_revision);
end;
$$;

revoke all on function public.review_consultation_hypothesis(uuid, public.hypothesis_status, text, text, timestamptz) from public;
revoke all on function public.replace_draft_hypotheses(uuid, bigint, jsonb, text, text, uuid) from public;
grant execute on function public.review_consultation_hypothesis(uuid, public.hypothesis_status, text, text, timestamptz) to authenticated;
grant execute on function public.replace_draft_hypotheses(uuid, bigint, jsonb, text, text, uuid) to service_role;

-- ---------- Manual and AI therapeutic plans ----------

alter table public.consultation_plans
  add column if not exists origin text not null default 'ai',
  add column if not exists input_revision bigint,
  add column if not exists basis_hypotheses jsonb not null default '[]'::jsonb,
  add column if not exists safety_acknowledged_at timestamptz,
  add column if not exists safety_acknowledged_by uuid references public.profiles (id) on delete set null,
  add column if not exists validation_context jsonb not null default '{}'::jsonb,
  add column if not exists stale_at timestamptz;

update public.consultation_plans p
set input_revision = c.clinical_revision
from public.consultations c
where c.id = p.consultation_id and p.input_revision is null;

alter table public.consultation_plans
  alter column input_revision set default 0,
  alter column input_revision set not null;

-- The former free-form "plan" anamnesis block remains in the chart as
-- consultation conduct/notes. Copy it once into the canonical manual plan
-- without deleting or rewriting the source answers, including finalized
-- historical charts (migration authority only).
alter table public.consultation_plans disable trigger consultation_plans_finalized_guard;
with legacy as (
  select
    c.id as consultation_id,
    c.org_id,
    c.clinical_revision,
    c.created_by,
    max(a.value) filter (where a.field_key = 'goal') as goal,
    max(a.value) filter (where a.field_key = 'points') as points,
    max(a.value) filter (where a.field_key = 'techniques') as techniques,
    max(a.value) filter (where a.field_key = 'guidance') as guidance,
    max(a.value) filter (where a.field_key = 'frequency') as frequency
  from public.consultations c
  join public.anamnesis_answers a
    on a.consultation_id = c.id and a.block_key = 'plan'
  where nullif(btrim(a.value), '') is not null
  group by c.id, c.org_id, c.clinical_revision, c.created_by
)
insert into public.consultation_plans (
  org_id, consultation_id, objective, modalities, safety_flags, status,
  origin, input_revision, validation_context, created_by
)
select
  l.org_id,
  l.consultation_id,
  nullif(btrim(l.goal), ''),
  jsonb_build_object(
    'acupuncture',
    jsonb_strip_nulls(jsonb_build_object(
      'enabled', true,
      'objective', nullif(concat_ws(E'\n\n',
        nullif(btrim(l.goal), ''),
        case when nullif(btrim(l.techniques), '') is not null then 'Técnicas: ' || btrim(l.techniques) end,
        case when nullif(btrim(l.guidance), '') is not null then 'Orientações: ' || btrim(l.guidance) end
      ), ''),
      'mainPoints', case
        when nullif(btrim(l.points), '') is null then '[]'::jsonb
        else to_jsonb(regexp_split_to_array(btrim(l.points), E'\\s*(?:\\r?\\n|,|;)\\s*'))
      end,
      'frequency', nullif(btrim(l.frequency), ''),
      'legacyTechniques', nullif(btrim(l.techniques), ''),
      'legacyGuidance', nullif(btrim(l.guidance), '')
    ))
  ),
  '[]'::jsonb,
  'draft',
  'manual',
  l.clinical_revision,
  '{"migratedFrom":"anamnesis.plan"}'::jsonb,
  l.created_by
from legacy l
where not exists (
  select 1 from public.consultation_plans p where p.consultation_id = l.consultation_id
);

-- Never coerce malformed safety data to an empty array: doing so would hide a
-- contraindication. Stop the migration with a clear repair target instead.
do $repair_safety_flags$
begin
  if exists (
    select 1
    from public.consultation_plans p
    where jsonb_typeof(p.safety_flags) is distinct from 'array'
  ) then
    raise exception 'consultation_plans.safety_flags contains a non-array legacy value';
  end if;
end;
$repair_safety_flags$;

-- A legacy validation with safety flags but no acknowledgement cannot be
-- upgraded by fabricating consent. Return it to draft and preserve why.
update public.consultation_plans
set status = 'draft',
    validated_by = null,
    validated_at = null,
    safety_acknowledged_by = null,
    safety_acknowledged_at = null,
    validation_context = coalesce(validation_context, '{}'::jsonb)
      || jsonb_build_object('migrationRepair', 'missingSafetyAcknowledgement')
where status <> 'draft'
  and jsonb_array_length(safety_flags) > 0
  and safety_acknowledged_at is null;

-- As with hypothesis reviewers, validated_by may legitimately become NULL
-- when a profile is erased; the immutable validation timestamp is the durable
-- evidence used by the constraint.
update public.consultation_plans
set validated_at = coalesce(validated_at, updated_at, created_at)
where status <> 'draft' and validated_at is null;
alter table public.consultation_plans enable trigger consultation_plans_finalized_guard;

alter table public.consultation_plans
  add constraint consultation_plans_origin_check
    check (origin in ('manual', 'ai')) not valid,
  add constraint consultation_plans_safety_flags_array_check
    check (jsonb_typeof(safety_flags) = 'array') not valid,
  add constraint consultation_plans_validation_authorship_check
    check (status = 'draft' or validated_at is not null) not valid,
  add constraint consultation_plans_safety_acknowledgement_check
    check (
      status = 'draft'
      or case
        when jsonb_typeof(safety_flags) = 'array'
          then jsonb_array_length(safety_flags) = 0 or safety_acknowledged_at is not null
        else false
      end
    ) not valid;

alter table public.consultation_plans
  validate constraint consultation_plans_origin_check,
  validate constraint consultation_plans_safety_flags_array_check,
  validate constraint consultation_plans_validation_authorship_check,
  validate constraint consultation_plans_safety_acknowledgement_check;

create or replace function public.reset_plan_validation_on_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.objective is distinct from old.objective
     or new.modalities is distinct from old.modalities
     or new.safety_flags is distinct from old.safety_flags
     or new.basis_hypotheses is distinct from old.basis_hypotheses then
    new.status := 'draft';
    new.validated_by := null;
    new.validated_at := null;
    new.safety_acknowledged_at := null;
    new.safety_acknowledged_by := null;
    new.validation_context := '{}'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists consultation_plans_reset_validation on public.consultation_plans;
create trigger consultation_plans_reset_validation
  before update on public.consultation_plans
  for each row execute function public.reset_plan_validation_on_edit();

create or replace function public.create_manual_consultation_plan(
  target_consultation uuid,
  target_safety_flags jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  plan_row public.consultation_plans%rowtype;
begin
  if jsonb_typeof(target_safety_flags) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'safetyFlags');
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
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;

  select p.* into plan_row
  from public.consultation_plans p
  where p.consultation_id = target_consultation
  for update;

  if found then
    return jsonb_build_object('ok', true, 'code', 'existing', 'planId', plan_row.id, 'origin', plan_row.origin);
  end if;

  insert into public.consultation_plans (
    org_id,
    consultation_id,
    objective,
    modalities,
    safety_flags,
    status,
    origin,
    input_revision,
    created_by
  ) values (
    consultation_row.org_id,
    consultation_row.id,
    null,
    '{}'::jsonb,
    case when jsonb_typeof(target_safety_flags) = 'array' then target_safety_flags else '[]'::jsonb end,
    'draft',
    'manual',
    consultation_row.clinical_revision,
    auth.uid()
  )
  returning * into plan_row;

  return jsonb_build_object('ok', true, 'code', 'created', 'planId', plan_row.id, 'origin', plan_row.origin);
end;
$$;

create or replace function public.save_consultation_plan(
  target_plan uuid,
  target_objective text,
  target_modalities jsonb,
  target_safety_flags jsonb default null,
  expected_updated_at timestamptz default null
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
begin
  if expected_updated_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'expectedUpdatedAt');
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

  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(plan_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  if plan_row.updated_at is distinct from expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'clinical_revision_conflict');
  end if;
  if target_safety_flags is not null and jsonb_typeof(target_safety_flags) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'safetyFlags');
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and target_safety_flags is not null
     and target_safety_flags is distinct from plan_row.safety_flags then
    return jsonb_build_object('ok', false, 'code', 'derived_safety_flags_immutable');
  end if;

  update public.consultation_plans
  set objective = nullif(btrim(target_objective), ''),
      modalities = case when jsonb_typeof(target_modalities) = 'object' then target_modalities else '{}'::jsonb end,
      safety_flags = case
        when target_safety_flags is null then safety_flags
        else target_safety_flags
      end,
      input_revision = consultation_row.clinical_revision,
      stale_at = null
  where id = target_plan;

  return jsonb_build_object('ok', true, 'code', 'saved', 'planId', target_plan, 'revision', consultation_row.clinical_revision);
end;
$$;

create or replace function public.save_generated_consultation_plan(
  target_consultation uuid,
  expected_revision bigint,
  target_objective text,
  target_modalities jsonb,
  target_safety_flags jsonb,
  target_sources jsonb,
  target_basis_hypotheses jsonb,
  target_model text,
  target_prompt_version text,
  target_actor uuid,
  replace_manual boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  plan_row public.consultation_plans%rowtype;
begin
  if expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'expectedRevision');
  end if;
  if replace_manual is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'replaceManual');
  end if;
  if jsonb_typeof(target_basis_hypotheses) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'accepted_hypothesis_required');
  end if;
  if jsonb_array_length(target_basis_hypotheses) = 0 then
    return jsonb_build_object('ok', false, 'code', 'accepted_hypothesis_required');
  end if;
  if jsonb_typeof(target_safety_flags) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'field', 'safetyFlags');
  end if;

  select c.* into consultation_row
  from public.consultations c
  where c.id = target_consultation
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if coalesce(auth.role(), '') = 'service_role' then
    if not exists (
      select 1 from public.memberships m
      where m.org_id = consultation_row.org_id and m.user_id = target_actor
    ) then return jsonb_build_object('ok', false, 'code', 'not_authorized'); end if;
  elsif not (public.is_org_member(consultation_row.org_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  if consultation_row.clinical_revision <> expected_revision then
    return jsonb_build_object('ok', false, 'code', 'clinical_revision_conflict', 'revision', consultation_row.clinical_revision);
  end if;
  if not exists (
    select 1 from public.consultation_hypotheses h
    where h.consultation_id = target_consultation
      and h.status in ('accepted', 'edited')
      and h.stale_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'accepted_hypothesis_required');
  end if;
  if exists (
    select 1
    from jsonb_array_elements(target_basis_hypotheses) basis
    where not exists (
      select 1
      from public.consultation_hypotheses h
      where h.id::text = basis ->> 'id'
        and h.consultation_id = target_consultation
        and h.status in ('accepted', 'edited')
        and h.stale_at is null
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'plan_stale');
  end if;

  select p.* into plan_row
  from public.consultation_plans p
  where p.consultation_id = target_consultation
  for update;

  if found and plan_row.status = 'validated' then
    return jsonb_build_object('ok', false, 'code', 'plan_validated');
  end if;
  if found and plan_row.origin = 'manual' and replace_manual is not true then
    return jsonb_build_object('ok', false, 'code', 'manual_plan_exists');
  end if;

  insert into public.consultation_plans (
    org_id,
    consultation_id,
    objective,
    modalities,
    safety_flags,
    sources,
    status,
    origin,
    input_revision,
    basis_hypotheses,
    model,
    prompt_version,
    created_by
  ) values (
    consultation_row.org_id,
    consultation_row.id,
    nullif(btrim(target_objective), ''),
    case when jsonb_typeof(target_modalities) = 'object' then target_modalities else '{}'::jsonb end,
    case when jsonb_typeof(target_safety_flags) = 'array' then target_safety_flags else '[]'::jsonb end,
    case when jsonb_typeof(target_sources) = 'array' then target_sources else '[]'::jsonb end,
    'draft',
    'ai',
    expected_revision,
    case when jsonb_typeof(target_basis_hypotheses) = 'array' then target_basis_hypotheses else '[]'::jsonb end,
    target_model,
    target_prompt_version,
    target_actor
  )
  on conflict (consultation_id) do update
  set objective = excluded.objective,
      modalities = excluded.modalities,
      safety_flags = excluded.safety_flags,
      sources = excluded.sources,
      status = 'draft',
      origin = 'ai',
      input_revision = excluded.input_revision,
      basis_hypotheses = excluded.basis_hypotheses,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      validated_by = null,
      validated_at = null,
      safety_acknowledged_at = null,
      safety_acknowledged_by = null,
      validation_context = '{}'::jsonb,
      stale_at = null;

  select p.* into plan_row from public.consultation_plans p where p.consultation_id = target_consultation;
  return jsonb_build_object('ok', true, 'code', 'prepared', 'planId', plan_row.id, 'revision', expected_revision);
end;
$$;

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

revoke all on function public.create_manual_consultation_plan(uuid, jsonb) from public;
revoke all on function public.save_consultation_plan(uuid, text, jsonb, jsonb, timestamptz) from public;
revoke all on function public.save_generated_consultation_plan(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, text, text, uuid, boolean) from public;
revoke all on function public.validate_consultation_plan(uuid, timestamptz, boolean, jsonb) from public;
grant execute on function public.create_manual_consultation_plan(uuid, jsonb) to authenticated;
grant execute on function public.save_consultation_plan(uuid, text, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.save_consultation_plan(uuid, text, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.save_generated_consultation_plan(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb, text, text, uuid, boolean) to service_role;

create or replace function public.mark_clinical_outputs_stale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clinical_revision is not distinct from old.clinical_revision then return new; end if;

  if current_setting('medchina.clinical_revision_source', true) is distinct from 'hypothesis_decision' then
    update public.consultation_hypotheses
    set stale_at = coalesce(stale_at, now())
    where consultation_id = new.id and input_revision <> new.clinical_revision;
  end if;

  update public.consultation_plans
  set stale_at = coalesce(stale_at, now()),
      status = 'draft',
      validated_by = null,
      validated_at = null,
      safety_acknowledged_by = null,
      safety_acknowledged_at = null,
      validation_context = '{}'::jsonb
  where consultation_id = new.id and input_revision <> new.clinical_revision;
  return new;
end;
$$;

drop trigger if exists consultations_mark_outputs_stale on public.consultations;
create trigger consultations_mark_outputs_stale
  after update of clinical_revision on public.consultations
  for each row execute function public.mark_clinical_outputs_stale();
grant execute on function public.validate_consultation_plan(uuid, timestamptz, boolean, jsonb) to authenticated;

-- ---------- Atomic, idempotent document versions ----------

alter table public.documents
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists subject_type text,
  add column if not exists subject_id text,
  add column if not exists idempotency_key uuid,
  add column if not exists source_revision bigint,
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_validated_at timestamptz,
  add column if not exists source_snapshot jsonb;

comment on column public.documents.source_snapshot is
  'Immutable clinical source snapshot reserved for this document version; publication rejects a source that changed after reservation.';
comment on column public.documents.source_revision is
  'Clinical input revision of the validated source snapshot reserved for this version.';

update public.documents
set source_type = 'consultation_plan',
    source_id = (payload ->> 'planId')::uuid
where kind = 'therapeutic-plan'
  and source_id is null
  and payload ->> 'planId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

update public.documents d
set source_revision = p.input_revision,
    source_updated_at = p.updated_at,
    source_validated_at = p.validated_at,
    source_snapshot = jsonb_build_object(
      'planId', p.id,
      'consultationId', p.consultation_id,
      'inputRevision', p.input_revision,
      'objective', p.objective,
      'modalities', p.modalities,
      'safetyFlags', p.safety_flags,
      'basisHypotheses', p.basis_hypotheses,
      'sources', p.sources,
      'origin', p.origin,
      'model', p.model,
      'promptVersion', p.prompt_version,
      'validatedBy', p.validated_by,
      'validatedAt', p.validated_at
    )
from public.consultation_plans p
where d.source_type = 'consultation_plan'
  and d.source_id = p.id
  and (
    d.source_revision is null
    or d.source_updated_at is null
    or d.source_validated_at is null
    or d.source_snapshot is null
  );

-- Normalize legacy source versions before adding uniqueness. Content, hashes
-- and issue timestamps are untouched; only the source-local sequence/parent
-- chain is repaired deterministically.
with ordered as (
  select
    id,
    row_number() over (
      partition by org_id, kind, source_type, source_id
      order by coalesce(issued_at, created_at), created_at, id
    )::integer as normalized_version,
    lag(id) over (
      partition by org_id, kind, source_type, source_id
      order by coalesce(issued_at, created_at), created_at, id
    ) as normalized_parent
  from public.documents
  where source_type is not null and source_id is not null
)
update public.documents d
set version = o.normalized_version,
    parent_id = o.normalized_parent
from ordered o
where d.id = o.id;

create unique index if not exists documents_source_version_unique_idx
  on public.documents (org_id, kind, source_type, source_id, version)
  where source_type is not null and source_id is not null;

create unique index if not exists documents_idempotency_unique_idx
  on public.documents (org_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists documents_subject_timeline_idx
  on public.documents (org_id, subject_type, subject_id, created_at desc)
  where subject_type is not null and subject_id is not null;

create or replace function public.reserve_document_version(
  target_org uuid,
  target_kind text,
  target_title text,
  target_payload jsonb,
  target_source_type text,
  target_source_id uuid,
  target_subject_type text,
  target_subject_id text,
  target_idempotency_key uuid,
  target_verify_code text,
  target_issued_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_row public.documents%rowtype;
  prior_row public.documents%rowtype;
  created_row public.documents%rowtype;
  source_plan public.consultation_plans%rowtype;
  source_consultation public.consultations%rowtype;
  source_consultation_id uuid;
  reserved_source_snapshot jsonb;
  next_version integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_source_type is null or target_source_id is null or target_idempotency_key is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and target_issued_by is distinct from auth.uid()
     and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  -- All reserve/publish operations for one source share this lock. Take it
  -- before row locks so a retry cannot deadlock publication.
  perform pg_advisory_xact_lock(hashtextextended(target_org::text || ':' || target_source_id::text, 0));

  select d.* into existing_row
  from public.documents d
  where d.org_id = target_org and d.idempotency_key = target_idempotency_key
  limit 1
  for update;

  if found then
    if existing_row.kind is distinct from target_kind
       or existing_row.source_type is distinct from target_source_type
       or existing_row.source_id is distinct from target_source_id
       or existing_row.subject_type is distinct from target_subject_type
       or existing_row.subject_id is distinct from target_subject_id
       or existing_row.issued_by is distinct from target_issued_by then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    if existing_row.status = 'issued' then
      return jsonb_build_object(
        'ok', true,
        'code', 'existing',
        'documentId', existing_row.id,
        'verifyCode', existing_row.verify_code,
        'version', existing_row.version,
        'sourceSnapshot', existing_row.source_snapshot,
        'status', existing_row.status
      );
    elsif existing_row.status <> 'draft' then
      return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
    end if;
  end if;

  if target_source_type = 'consultation_plan' then
    if target_kind is distinct from 'therapeutic-plan' then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;

    -- Discover the parent without locking the child, then lock and re-read in
    -- the same consultation -> plan order used by the plan RPCs.
    select p.consultation_id into source_consultation_id
    from public.consultation_plans p
    where p.id = target_source_id and p.org_id = target_org;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select c.* into source_consultation
    from public.consultations c
    where c.id = source_consultation_id and c.org_id = target_org
    for update;

    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select p.* into source_plan
    from public.consultation_plans p
    where p.id = target_source_id
      and p.org_id = target_org
      and p.consultation_id = source_consultation_id
    for update;

    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;
    if source_plan.status <> 'validated' or source_plan.validated_at is null then
      return jsonb_build_object('ok', false, 'code', 'plan_not_validated');
    end if;
    if target_subject_type is distinct from 'patient'
       or target_subject_id is distinct from source_consultation.patient_id::text then
      return jsonb_build_object('ok', false, 'code', 'invalid_request');
    end if;
    if source_plan.stale_at is not null
       or source_plan.input_revision <> source_consultation.clinical_revision then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;

    reserved_source_snapshot := jsonb_build_object(
      'planId', source_plan.id,
      'consultationId', source_plan.consultation_id,
      'inputRevision', source_plan.input_revision,
      'objective', source_plan.objective,
      'modalities', source_plan.modalities,
      'safetyFlags', source_plan.safety_flags,
      'basisHypotheses', source_plan.basis_hypotheses,
      'sources', source_plan.sources,
      'origin', source_plan.origin,
      'model', source_plan.model,
      'promptVersion', source_plan.prompt_version,
      'validatedBy', source_plan.validated_by,
      'validatedAt', source_plan.validated_at
    );

    if existing_row.id is not null then
      if existing_row.source_revision is distinct from source_plan.input_revision
         or existing_row.source_updated_at is distinct from source_plan.updated_at
         or existing_row.source_validated_at is distinct from source_plan.validated_at
         or existing_row.source_snapshot is distinct from reserved_source_snapshot then
        return jsonb_build_object('ok', false, 'code', 'plan_stale');
      end if;
      return jsonb_build_object(
        'ok', true,
        'code', 'existing',
        'documentId', existing_row.id,
        'verifyCode', existing_row.verify_code,
        'version', existing_row.version,
        'sourceSnapshot', existing_row.source_snapshot,
        'status', existing_row.status
      );
    end if;
  elsif existing_row.id is not null then
    return jsonb_build_object(
      'ok', true,
      'code', 'existing',
      'documentId', existing_row.id,
      'verifyCode', existing_row.verify_code,
      'version', existing_row.version,
      'sourceSnapshot', existing_row.source_snapshot,
      'status', existing_row.status
    );
  end if;

  select d.* into prior_row
  from public.documents d
  where d.org_id = target_org
    and d.kind = target_kind
    and d.source_type = target_source_type
    and d.source_id = target_source_id
  order by d.version desc
  limit 1
  for update;

  next_version := coalesce(prior_row.version, 0) + 1;

  insert into public.documents (
    org_id,
    kind,
    title,
    payload,
    version,
    parent_id,
    status,
    verify_code,
    issued_by,
    source_type,
    source_id,
    subject_type,
    subject_id,
    idempotency_key,
    source_revision,
    source_updated_at,
    source_validated_at,
    source_snapshot
  ) values (
    target_org,
    target_kind,
    target_title,
    coalesce(target_payload, '{}'::jsonb),
    next_version,
    prior_row.id,
    'draft',
    target_verify_code,
    target_issued_by,
    target_source_type,
    target_source_id,
    target_subject_type,
    target_subject_id,
    target_idempotency_key,
    case when target_source_type = 'consultation_plan' then source_plan.input_revision else null end,
    case when target_source_type = 'consultation_plan' then source_plan.updated_at else null end,
    case when target_source_type = 'consultation_plan' then source_plan.validated_at else null end,
    reserved_source_snapshot
  )
  returning * into created_row;

  return jsonb_build_object(
    'ok', true,
    'code', 'reserved',
    'documentId', created_row.id,
    'verifyCode', created_row.verify_code,
    'version', created_row.version,
    'parentId', created_row.parent_id,
    'sourceSnapshot', created_row.source_snapshot,
    'status', created_row.status
  );
exception
  when unique_violation then
    select d.* into existing_row
    from public.documents d
    where d.org_id = target_org and d.idempotency_key = target_idempotency_key
    limit 1;
    if found then
      if existing_row.kind is distinct from target_kind
         or existing_row.source_type is distinct from target_source_type
         or existing_row.source_id is distinct from target_source_id
         or existing_row.subject_type is distinct from target_subject_type
         or existing_row.subject_id is distinct from target_subject_id
         or existing_row.issued_by is distinct from target_issued_by then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'ok', true,
        'code', 'existing',
        'documentId', existing_row.id,
        'verifyCode', existing_row.verify_code,
        'version', existing_row.version,
        'sourceSnapshot', existing_row.source_snapshot,
        'status', existing_row.status
      );
    end if;
    raise;
end;
$$;

create or replace function public.publish_document_version(
  target_document uuid,
  target_content_hash text,
  target_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  document_row public.documents%rowtype;
  source_plan public.consultation_plans%rowtype;
  source_consultation public.consultations%rowtype;
  source_consultation_id uuid;
  document_org uuid;
  document_source uuid;
  current_source_snapshot jsonb;
  expected_storage_path text;
begin
  -- Read only enough to acquire the source-wide advisory lock. Re-read the
  -- document under a row lock afterwards.
  select d.org_id, d.source_id into document_org, document_source
  from public.documents d
  where d.id = target_document;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if document_source is null then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(document_org::text || ':' || document_source::text, 0));

  select d.* into document_row
  from public.documents d
  where d.id = target_document
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_org_role(document_row.org_id, array['owner', 'admin']::public.org_role[]) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  expected_storage_path := format(
    '%s/%s-v%s.pdf',
    document_row.org_id,
    document_row.id,
    document_row.version
  );
  if target_content_hash is null
     or target_content_hash !~ '^[0-9a-f]{64}$'
     or target_storage_path is distinct from expected_storage_path then
    return jsonb_build_object('ok', false, 'code', 'invalid_document_artifact');
  end if;

  if document_row.status = 'issued' then
    if document_row.content_hash is distinct from target_content_hash
       or document_row.storage_path is distinct from target_storage_path then
      return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'issued',
      'documentId', document_row.id,
      'version', document_row.version,
      'verifyCode', document_row.verify_code
    );
  end if;
  if document_row.status <> 'draft' or document_row.source_id is null then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  if exists (
    select 1 from public.documents newer
    where newer.org_id = document_row.org_id
      and newer.kind = document_row.kind
      and newer.source_type = document_row.source_type
      and newer.source_id = document_row.source_id
      and newer.version > document_row.version
  ) then
    return jsonb_build_object('ok', false, 'code', 'document_issue_conflict');
  end if;

  if document_row.source_type = 'consultation_plan' then
    select p.consultation_id into source_consultation_id
    from public.consultation_plans p
    where p.id = document_row.source_id
      and p.org_id = document_row.org_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select c.* into source_consultation
    from public.consultations c
    where c.id = source_consultation_id
      and c.org_id = document_row.org_id
    for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    select p.* into source_plan
    from public.consultation_plans p
    where p.id = document_row.source_id
      and p.org_id = document_row.org_id
      and p.consultation_id = source_consultation_id
    for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'plan_not_found'); end if;

    current_source_snapshot := jsonb_build_object(
      'planId', source_plan.id,
      'consultationId', source_plan.consultation_id,
      'inputRevision', source_plan.input_revision,
      'objective', source_plan.objective,
      'modalities', source_plan.modalities,
      'safetyFlags', source_plan.safety_flags,
      'basisHypotheses', source_plan.basis_hypotheses,
      'sources', source_plan.sources,
      'origin', source_plan.origin,
      'model', source_plan.model,
      'promptVersion', source_plan.prompt_version,
      'validatedBy', source_plan.validated_by,
      'validatedAt', source_plan.validated_at
    );

    if source_plan.status <> 'validated'
       or source_plan.validated_at is null
       or source_plan.stale_at is not null
       or source_plan.input_revision <> source_consultation.clinical_revision
       or document_row.subject_type is distinct from 'patient'
       or document_row.subject_id is distinct from source_consultation.patient_id::text
       or document_row.source_revision is distinct from source_plan.input_revision
       or document_row.source_updated_at is distinct from source_plan.updated_at
       or document_row.source_validated_at is distinct from source_plan.validated_at
       or document_row.source_snapshot is distinct from current_source_snapshot then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'documents'
      and o.name = target_storage_path
  ) then
    return jsonb_build_object('ok', false, 'code', 'document_storage_missing');
  end if;

  update public.documents
  set status = 'revoked'
  where org_id = document_row.org_id
    and kind = document_row.kind
    and source_type = document_row.source_type
    and source_id = document_row.source_id
    and id <> document_row.id
    and version < document_row.version
    and status = 'issued';

  update public.documents
  set status = 'issued',
      content_hash = target_content_hash,
      storage_path = target_storage_path,
      issued_at = now()
  where id = document_row.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'issued',
    'documentId', document_row.id,
    'version', document_row.version,
    'verifyCode', document_row.verify_code
  );
end;
$$;

with ranked_issued as (
  select
    id,
    row_number() over (
      partition by org_id, kind, source_type, source_id
      order by version desc, issued_at desc nulls last, created_at desc, id desc
    ) as position
  from public.documents
  where status = 'issued' and source_type is not null and source_id is not null
)
update public.documents d
set status = 'revoked'
from ranked_issued r
where d.id = r.id and r.position > 1;

create unique index if not exists documents_one_issued_source_idx
  on public.documents (org_id, kind, source_type, source_id)
  where status = 'issued' and source_type is not null and source_id is not null;

revoke all on function public.reserve_document_version(uuid, text, text, jsonb, text, uuid, text, text, uuid, text, uuid) from public;
revoke all on function public.publish_document_version(uuid, text, text) from public;
grant execute on function public.reserve_document_version(uuid, text, text, jsonb, text, uuid, text, text, uuid, text, uuid) to service_role;
grant execute on function public.publish_document_version(uuid, text, text) to service_role;

-- PDF bytes are written by the service-only issuance path. Remove the legacy
-- authenticated storage write policies along with direct table writes below.
drop policy if exists "documents_bucket_insert_manager" on storage.objects;
drop policy if exists "documents_bucket_update_manager" on storage.objects;

-- Clinical AI outputs and issued-document rows are readable by members but
-- writable only through the reviewed RPC/API paths above.
drop policy if exists "consultation_hypotheses_insert_member" on public.consultation_hypotheses;
drop policy if exists "consultation_hypotheses_update_member" on public.consultation_hypotheses;
drop policy if exists "consultation_hypotheses_delete_member" on public.consultation_hypotheses;
revoke insert, update, delete on table public.consultation_hypotheses from authenticated;
grant select on table public.consultation_hypotheses to authenticated;

drop policy if exists "consultation_plans_insert_member" on public.consultation_plans;
drop policy if exists "consultation_plans_update_member" on public.consultation_plans;
drop policy if exists "consultation_plans_delete_member" on public.consultation_plans;
revoke insert, update, delete on table public.consultation_plans from authenticated;
grant select on table public.consultation_plans to authenticated;

drop policy if exists "documents_insert_manager" on public.documents;
drop policy if exists "documents_update_manager" on public.documents;
drop policy if exists "documents_delete_draft" on public.documents;
revoke insert, update, delete on table public.documents from authenticated;
grant select on table public.documents to authenticated;
