-- ============================================================
-- 0023_ai_gaps: the gaps the AI flags for investigation (PRD §10.7).
--
-- They are SUGGESTIONS ("ask about thirst, tongue, pulse"), never answers,
-- so they live on the consultation rather than in anamnesis_answers — an
-- unanswered topic must not become a stored value of any kind.
-- ============================================================

alter table public.consultations
  add column if not exists ai_gaps jsonb not null default '[]'::jsonb;

comment on column public.consultations.ai_gaps is
  'AI-suggested topics not covered in the consultation (PRD §10.7). Questions to investigate, never answers.';

-- A finalized record takes no AI draft either — extend the guard (0021).
create or replace function public.guard_finalized_consultation()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.status = 'finalized' then
    if new.status is distinct from old.status
       or new.summary is distinct from old.summary
       or new.chief_complaint is distinct from old.chief_complaint
       or new.patient_id is distinct from old.patient_id
       or new.transcription_id is distinct from old.transcription_id
       or new.ai_gaps is distinct from old.ai_gaps then
      raise exception 'consultation % is finalized: append an addendum instead of editing it', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
