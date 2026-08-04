-- ============================================================
-- 0070_attachment_analysis  (Fase B)
--
-- AI reads an attached document/photo to ENRICH the professional's review —
-- never to conclude. Same disciplines as the rest of the AI layer (PRD §10):
--   * the output is a DRAFT the professional reads and uses; it NEVER
--     auto-fills an anamnesis field and NEVER lands as her observation
--     (tongue/pulse stay hers, PRD §10.3);
--   * it never diagnoses (PRD §16) — for a document it extracts observable
--     values, for a photo it describes observable features, with limitations;
--   * Pro-gated (clinical reasoning) and gated on the patient's ai-processing
--     consent, checked again here so a revoked consent stops storage too.
--
-- The analysis is attached to the row; the model + prompt_version are recorded
-- (PRD §10.10). Re-analysing overwrites the prior draft (it is not her edit).
-- ============================================================

alter table public.consultation_attachments
  add column if not exists analysis jsonb,
  add column if not exists analysis_status text not null default 'none'
    check (analysis_status in ('none', 'ready', 'failed')),
  add column if not exists analysis_model text,
  add column if not exists analysis_prompt_version text,
  add column if not exists analyzed_at timestamptz;

create or replace function public.save_attachment_analysis(
  target_attachment uuid,
  target_analysis jsonb,
  target_model text,
  target_prompt_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  attachment_row public.consultation_attachments%rowtype;
  consultation_row public.consultations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member((select a.org_id from public.consultation_attachments a where a.id = target_attachment))) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select a.* into attachment_row from public.consultation_attachments a where a.id = target_attachment for update;
  if not found or attachment_row.deleted_at is not null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if attachment_row.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select c.* into consultation_row from public.consultations c where c.id = attachment_row.consultation_id;
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'consultation_finalized');
  end if;
  -- The AI may read this only under an active ai-processing consent — the same
  -- gate as the recording pipeline (recording consent alone is never enough).
  if not public.has_active_consent(attachment_row.org_id, attachment_row.patient_id, 'ai-processing') then
    return jsonb_build_object('ok', false, 'code', 'ai_consent_required');
  end if;

  update public.consultation_attachments
  set analysis = target_analysis,
      analysis_status = 'ready',
      analysis_model = nullif(btrim(target_model), ''),
      analysis_prompt_version = nullif(btrim(target_prompt_version), ''),
      analyzed_at = now(),
      updated_at = now()
  where id = target_attachment;

  return jsonb_build_object('ok', true, 'code', 'ready', 'attachmentId', target_attachment);
end;
$$;

revoke all on function public.save_attachment_analysis(uuid, jsonb, text, text) from public;
grant execute on function public.save_attachment_analysis(uuid, jsonb, text, text) to authenticated, service_role;
