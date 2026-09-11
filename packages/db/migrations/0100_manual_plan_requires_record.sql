-- ============================================================
-- 0100_manual_plan_requires_record
--
-- A therapeutic plan answers a RECORDED case. `create_manual_consultation_plan`
-- accepted a consultation with nothing written in it, so on an empty chart the
-- screen offered "Criar plano manual", the database created an empty plan, and
-- the professional was one step ahead of her own record — the opposite of the
-- guided order the consultation screen now follows (record → reason → plan).
--
-- The rule is the same one every AI step already applies (hypotheses/route.ts,
-- plan/route.ts, summary/route.ts): at least one answer that is not rejected,
-- or the chief complaint. The screen mirrors it (`deriveConsultationJourney`,
-- gate `createManualPlan`) and shows the reason under the disabled button.
--
-- An existing plan is still returned as-is (`existing`), so the call stays
-- idempotent and a chart cleared AFTER a plan was created keeps its plan.
--
-- Copied verbatim from 0031, with that one check added.
-- ============================================================

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

  -- Nothing recorded, nothing to plan: the same predicate as the AI routes'
  -- `nothing_recorded` (a rejected draft is not part of the record).
  if nullif(btrim(consultation_row.chief_complaint), '') is null
     and not exists (
       select 1 from public.anamnesis_answers a
       where a.consultation_id = target_consultation
         and a.state <> 'rejected'
     ) then
    return jsonb_build_object('ok', false, 'code', 'nothing_recorded');
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

revoke all on function public.create_manual_consultation_plan(uuid, jsonb) from public, anon;
grant execute on function public.create_manual_consultation_plan(uuid, jsonb) to authenticated;

comment on function public.create_manual_consultation_plan(uuid, jsonb) is
  'Creates the manual plan draft for a consultation that already has something recorded (an answer that is not rejected, or the chief complaint); returns the existing plan when there is one.';
