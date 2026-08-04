-- ============================================================
-- 0071_ai_summary
--
-- An AI-suggested clinical summary that stays current as the consultation
-- gathers information — WITHOUT ever overwriting what the professional wrote.
--
-- `consultations.summary` is HERS (manual, free text). This adds a SEPARATE
-- `ai_summary` draft she reviews and applies with one click. The AI writes only
-- `ai_summary`; a DB write to `summary` still comes from her edit. So the
-- "never overwrite her words" rule (PRD §10.5-ish) holds by construction.
--
-- Gated on the ai-processing consent (checked here too), editable-only, model +
-- prompt_version recorded (PRD §10.10). It is a draft — nothing is concluded.
-- ============================================================

alter table public.consultations
  add column if not exists ai_summary text,
  add column if not exists ai_summary_model text,
  add column if not exists ai_summary_prompt_version text,
  add column if not exists ai_summary_updated_at timestamptz;

create or replace function public.save_consultation_ai_summary(
  target_consultation uuid,
  target_summary text,
  target_model text,
  target_prompt_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  consultation_row public.consultations%rowtype;
begin
  -- Callable by the professional (on demand) or the service role (the pipeline
  -- refresh after an audio is processed).
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_org_member((select c.org_id from public.consultations c where c.id = target_consultation)) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select c.* into consultation_row from public.consultations c where c.id = target_consultation for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  -- Never touch a frozen record — and a draft summary on a closed consultation
  -- has no purpose.
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  if not public.has_active_consent(consultation_row.org_id, consultation_row.patient_id, 'ai-processing') then
    return jsonb_build_object('ok', false, 'code', 'ai_consent_required');
  end if;

  -- ONLY ai_summary is written here. `summary` (hers) is never touched, and
  -- clinical_revision is not bumped (this is a suggestion, not the record).
  update public.consultations
  set ai_summary = nullif(btrim(target_summary), ''),
      ai_summary_model = nullif(btrim(target_model), ''),
      ai_summary_prompt_version = nullif(btrim(target_prompt_version), ''),
      ai_summary_updated_at = now()
  where id = target_consultation;

  return jsonb_build_object('ok', true, 'code', 'saved', 'consultationId', target_consultation);
end;
$$;

revoke all on function public.save_consultation_ai_summary(uuid, text, text, text) from public;
grant execute on function public.save_consultation_ai_summary(uuid, text, text, text) to authenticated, service_role;
