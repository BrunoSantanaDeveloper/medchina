-- ============================================================
-- 0021_finalized_guard_fix: the immutability guards must protect the
-- CLINICAL CONTENT, not block housekeeping.
--
-- Bug found while deleting a test account: `anamnesis_answers.created_by`
-- is ON DELETE SET NULL, so removing a user issues an UPDATE on the
-- answers — which the 0020 guard rejected whenever the consultation was
-- finalized. Result: an account with a finalized record could never be
-- deleted, breaking data erasure (LGPD / PRD §14.5) and every legitimate
-- cascade (delete patient, delete organization).
--
-- Fix, two parts:
--  1. Referential actions and cascades run at pg_trigger_depth() > 1 —
--     let them through (they are the database maintaining its own
--     integrity, never a professional editing a closed chart).
--  2. On a direct UPDATE, only reject changes to the clinical payload;
--     bookkeeping columns (created_by, updated_at) may change.
--
-- What stays enforced: a professional cannot rewrite or delete the
-- content of a finalized consultation from the app. Corrections remain
-- append-only addenda.
-- ============================================================

create or replace function public.guard_finalized_answers()
returns trigger
language plpgsql
as $$
declare
  current_status public.consultation_status;
  target uuid;
begin
  -- Cascades / referential actions (FK triggers) run nested: never block them.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  target := coalesce(new.consultation_id, old.consultation_id);
  select status into current_status from public.consultations where id = target;

  if current_status is distinct from 'finalized' then
    return coalesce(new, old);
  end if;

  -- Finalized: the clinical payload is frozen.
  if tg_op = 'UPDATE' then
    if new.value is distinct from old.value
       or new.state is distinct from old.state
       or new.source is distinct from old.source
       or new.provenance is distinct from old.provenance
       or new.block_key is distinct from old.block_key
       or new.field_key is distinct from old.field_key
       or new.consultation_id is distinct from old.consultation_id then
      raise exception 'consultation % is finalized: its anamnesis can no longer change', target
        using errcode = 'check_violation';
    end if;
    -- Only bookkeeping changed (created_by set null, updated_at) — allow it.
    return new;
  end if;

  raise exception 'consultation % is finalized: its anamnesis can no longer change', target
    using errcode = 'check_violation';
end;
$$;

create or replace function public.guard_finalized_consultation()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.status = 'finalized' then
    -- Reopening or rewriting the clinical payload of a closed record is not
    -- allowed; corrections go to consultation_addenda. Bookkeeping columns
    -- (created_by/finalized_by set null on user deletion, updated_at) may change.
    if new.status is distinct from old.status
       or new.summary is distinct from old.summary
       or new.chief_complaint is distinct from old.chief_complaint
       or new.patient_id is distinct from old.patient_id
       or new.transcription_id is distinct from old.transcription_id then
      raise exception 'consultation % is finalized: append an addendum instead of editing it', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
