-- ============================================================
-- 0072_dismiss_consultation_gap: let the professional clear an investigated
-- gap (PRD §10.7).
--
-- The "Investigar" suggestions were read-only text — easy to glance at and
-- ignore. Dismissing one turns the list into a checklist she works through: a
-- topic she has asked about (or judged irrelevant) leaves the list, and when
-- the list empties the card is done. Gaps are AI SUGGESTIONS, never answers, so
-- removing one changes no clinical value; re-processing a recording repopulates
-- them.
--
-- ai_gaps lives on consultations and the lifecycle trigger (0029) bumps
-- clinical_revision whenever it changes, so this returns the NEW revision for
-- the open editor to stay in sync — the same contract as save_consultation_header.
-- ============================================================

create or replace function public.dismiss_consultation_gap(
  target_consultation uuid,
  target_gap text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  consultation_row public.consultations%rowtype;
  next_gaps jsonb;
  next_revision bigint;
begin
  if target_consultation is null or nullif(btrim(coalesce(target_gap, '')), '') is null then
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
  -- Only an editable record: a finalized/cancelled one is frozen, and the
  -- lifecycle guard would reject the ai_gaps write anyway.
  if consultation_row.status not in ('draft', 'in_progress', 'awaiting_review') then
    return jsonb_build_object('ok', false, 'code', 'invalid_consultation_transition');
  end if;

  -- Drop every element equal to the dismissed question (gaps are unique
  -- strings). jsonb_agg over an empty set is NULL — coalesce back to [].
  next_gaps := coalesce((
    select jsonb_agg(elem)
    from jsonb_array_elements(consultation_row.ai_gaps) elem
    where elem is distinct from to_jsonb(target_gap)
  ), '[]'::jsonb);

  update public.consultations
  set ai_gaps = next_gaps
  where id = target_consultation;

  select c.clinical_revision into next_revision
  from public.consultations c
  where c.id = target_consultation;

  return jsonb_build_object('ok', true, 'code', 'dismissed', 'revision', next_revision, 'gaps', next_gaps);
end;
$$;

revoke all on function public.dismiss_consultation_gap(uuid, text) from public, anon;
grant execute on function public.dismiss_consultation_gap(uuid, text) to authenticated;
