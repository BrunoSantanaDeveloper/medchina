-- ============================================================
-- 0027_agenda: scheduling on top of the existing consultation (PRD §9.3).
--
-- A scheduled consultation is just a consultation with status 'scheduled' and
-- its `started_at` read as the appointment time — no separate appointments
-- table, so "abrir Modo Consulta a partir do evento" is simply opening the
-- consultation that already exists. This adds the two things scheduling needs:
-- a duration, and a way to detect a simple time conflict (PRD §9.3).
-- ============================================================

alter table public.consultations
  add column if not exists duration_minutes integer not null default 50
    check (duration_minutes > 0 and duration_minutes <= 1440);

-- Agenda queries a day/week window for one workspace, ordered by time.
create index if not exists consultations_org_started_idx
  on public.consultations (org_id, started_at);

-- ---------- Simple time-conflict check (PRD §9.3) ----------
-- True when a candidate [start, start+duration) overlaps any OTHER consultation
-- that still occupies the calendar (scheduled or in progress) for the same
-- workspace. Finalized/cancelled/draft rows never block a slot. Security
-- definer so the app and any future surface (mobile) get the same answer;
-- membership is enforced, so it cannot probe another org's calendar.

create or replace function public.consultation_schedule_conflict(
  target_org uuid,
  start_at timestamptz,
  duration_minutes integer,
  exclude_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  candidate_end timestamptz := start_at + make_interval(mins => greatest(duration_minutes, 1));
  conflict boolean;
begin
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select exists (
    select 1
    from public.consultations c
    where c.org_id = target_org
      and c.status in ('scheduled', 'in_progress')
      and (exclude_id is null or c.id <> exclude_id)
      -- overlap: a_start < b_end and b_start < a_end
      and c.started_at < candidate_end
      and start_at < c.started_at + make_interval(mins => greatest(c.duration_minutes, 1))
  ) into conflict;

  return conflict;
end;
$$;

grant execute on function public.consultation_schedule_conflict(uuid, timestamptz, integer, uuid) to authenticated;
