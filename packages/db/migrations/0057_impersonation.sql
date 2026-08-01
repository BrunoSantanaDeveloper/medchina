-- ============================================================
-- 0057_impersonation: support access to a professional's account
-- ("personificar") without her password and without signing the
-- superadmin out.
--
-- The session itself is created by the app through the auth admin API
-- (generateLink + verifyOtp) into a PARALLEL cookie, so the operator's
-- own session is never overwritten. What lives here is everything the
-- app layer cannot be trusted with:
--
--   1. The record of WHO entered WHOSE account, WHY and FOR HOW LONG —
--      readable by the professional herself, not only by the platform.
--   2. The read-only fence. Clinical writes leave the browser straight
--      for PostgREST, so a middleware guard would never see them. The
--      JWT carries `session_id`; registering the impersonated session id
--      here lets Postgres recognize the session and refuse to let a
--      support operator write clinical content in the professional's
--      name. The database is the boundary — not the UI, not the prompt.
--
-- Scope decision (deliberate): an impersonated session may READ
-- everything (that is the whole point — see the bug where it happens)
-- and may write only non-clinical surfaces: settings, billing and the
-- agenda. Clinical content, consent, AI spend and erasure are refused.
-- ============================================================

-- ---------- The record ----------

create table public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Superadmin who started it.
  actor_id uuid not null references public.profiles (id) on delete restrict,
  -- Account being accessed.
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  -- Workspace context at the time (informational; the session sees whatever
  -- the target user's memberships allow, exactly like she does).
  target_org_id uuid references public.organizations (id) on delete set null,
  -- Why. Free text (ticket, described symptom) — required, so an access can
  -- always be explained afterwards.
  reason text not null check (length(btrim(reason)) >= 8),
  -- auth.sessions.id of the impersonated session = the `session_id` claim in
  -- its JWT. This is what makes the fence below possible.
  session_id uuid not null unique,
  started_at timestamptz not null default now(),
  -- Hard stop. A support access is a visit, not a tenancy.
  expires_at timestamptz not null,
  ended_at timestamptz,
  -- 'operator' (left deliberately) | 'expired' | 'revoked'
  ended_reason text
);

comment on table public.impersonation_sessions is
  'Support access to a user account. Append-only from the app (service role); visible to the impersonated user herself.';
comment on column public.impersonation_sessions.session_id is
  'auth.sessions.id of the impersonated session — matched against the JWT session_id claim by public.is_impersonated().';
comment on column public.impersonation_sessions.expires_at is
  'Hard stop enforced by is_impersonated(): past it the session loses its write fence exemption and the app signs it out.';

-- The hot-path lookup (every clinical write attempt) rides the unique index
-- on session_id, so no extra index is needed for it.
create index impersonation_sessions_target_idx
  on public.impersonation_sessions (target_user_id, started_at desc);
create index impersonation_sessions_actor_idx
  on public.impersonation_sessions (actor_id, started_at desc);

-- ---------- RLS ----------

alter table public.impersonation_sessions enable row level security;

-- Transparency is not optional here: the professional can see every support
-- access to her own account, with the reason given.
create policy "impersonation_sessions_select_own" on public.impersonation_sessions
  for select to authenticated
  using (target_user_id = auth.uid());

create policy "impersonation_sessions_select_superadmin" on public.impersonation_sessions
  for select to authenticated
  using (public.is_superadmin());

-- No insert/update/delete policy: rows are written exclusively by the service
-- role, so an impersonated session can never extend or erase its own record.

-- ---------- Is the current session an impersonation? ----------

-- Deliberately NOT filtered by ended_at/expires_at: once a session was minted
-- for support it is fenced FOREVER. Expiry that lifted the fence would quietly
-- promote a stale support session into a full-privilege session of the user —
-- the exact opposite of what expiring it is for. Ending an impersonation
-- revokes the session; it never upgrades it.
create or replace function public.is_impersonated()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.impersonation_sessions s
    where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  );
$$;

comment on function public.is_impersonated() is
  'True when the calling JWT belongs to a support-impersonation session, live or not. Drives the write fence; never expires.';

-- Whether the visit is still within its window — for the UI and reporting, not
-- for the fence.
create or replace function public.impersonation_active()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.impersonation_sessions s
    where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.ended_at is null
      and s.expires_at > now()
  );
$$;

-- Exposed so the UI can trust the database rather than its own cookie.
grant execute on function public.is_impersonated() to authenticated;
grant execute on function public.impersonation_active() to authenticated;

-- ---------- The read-only fence ----------

-- Statement-level: the guard needs no row data, so one check per statement
-- instead of one per row.
create or replace function public.guard_impersonation_readonly()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_impersonated() then
    raise exception 'impersonation_read_only: support sessions cannot write % (clinical content, consent, AI usage and erasure are refused)', tg_table_name
      using errcode = '42501',
            hint = 'Leave the support session and ask the professional to perform this action.';
  end if;
  return null;
end;
$$;

do $$
declare
  guarded text;
begin
  foreach guarded in array array[
    -- Clinical content and its provenance.
    'anamnesis_answers',
    'consultation_addenda',
    'consultation_hypotheses',
    'consultation_plans',
    'recordings',
    'transcriptions',
    -- Signed/issued artifacts.
    'documents',
    -- Consent is an act of the professional and the patient, never of support.
    'consent_acceptances',
    'patient_consent_sessions',
    'patient_consent_session_items',
    -- Capture authorization (QR / mobile) starts a clinical recording.
    'mobile_capture_authorizations',
    'capture_link_sessions',
    -- The patient registry itself: creating or erasing a third party's record
    -- is never support work.
    'patients',
    -- AI spend in her name (library chat, case review over a real chart).
    'conversations',
    'messages'
  ]
  loop
    if to_regclass('public.' || guarded) is null then
      continue;
    end if;
    execute format(
      'drop trigger if exists guard_impersonation_%1$s on public.%1$I',
      guarded
    );
    execute format(
      'create trigger guard_impersonation_%1$s
         after insert or update or delete on public.%1$I
         for each statement execute function public.guard_impersonation_readonly()',
      guarded
    );
  end loop;
end;
$$;

-- ---------- Consultations: the agenda is allowed, the record is not ----------

-- A scheduled appointment IS a consultation row (0027), so this table cannot
-- be fenced wholesale without taking the agenda with it. Row-level, because
-- the decision depends on which columns moved.
create or replace function public.guard_impersonation_consultation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_impersonated() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'impersonation_read_only: support sessions cannot delete consultations'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- Booking a slot is fine; opening a clinical record is not.
    if new.status <> 'scheduled' then
      raise exception 'impersonation_read_only: support sessions may only create scheduled appointments'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: only the scheduling columns may move, and only while the
  -- consultation has not become a clinical record.
  if old.status not in ('scheduled', 'cancelled') then
    raise exception 'impersonation_read_only: support sessions cannot change a consultation in progress or finalized'
      using errcode = '42501';
  end if;

  if new.status not in ('scheduled', 'cancelled') then
    raise exception 'impersonation_read_only: support sessions cannot start or finalize a consultation'
      using errcode = '42501';
  end if;

  if new.patient_id is distinct from old.patient_id
     or new.summary is distinct from old.summary
     or new.chief_complaint is distinct from old.chief_complaint
     or new.transcription_id is distinct from old.transcription_id
     or new.finalized_at is distinct from old.finalized_at
     or new.finalized_by is distinct from old.finalized_by
  then
    raise exception 'impersonation_read_only: support sessions cannot change clinical fields of a consultation'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_impersonation_consultations on public.consultations;
create trigger guard_impersonation_consultations
  before insert or update or delete on public.consultations
  for each row execute function public.guard_impersonation_consultation();

-- ---------- Telemetry: drop, don't fail ----------

-- Product analytics must not count a support visit as the professional using
-- the product. Silent skip (return null in a BEFORE trigger) rather than an
-- exception, because trackProductEvent is fire-and-forget and an error here
-- would surface as noise in a session that is otherwise working correctly.
create or replace function public.guard_impersonation_silent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_impersonated() then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_impersonation_product_events on public.product_events;
create trigger guard_impersonation_product_events
  before insert on public.product_events
  for each row execute function public.guard_impersonation_silent();

-- ---------- The professional's own access log tells the truth ----------

-- Without this an impersonation shows up in /settings/security as an
-- unexplained sign-in from an unknown IP. It is labelled instead.
alter table public.access_events
  add column if not exists session_id uuid,
  add column if not exists impersonated_by uuid references public.profiles (id) on delete set null;

comment on column public.access_events.impersonated_by is
  'Set when this session was opened by platform support impersonating the user — rendered as a support access, never as her own sign-in.';

create index if not exists access_events_session_idx on public.access_events (session_id);

-- Same body as 0016 plus the session id, which is what lets the app stamp
-- impersonated_by on the row the trigger just wrote.
create or replace function public.log_access_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
begin
  insert into public.access_events (user_id, ip, user_agent, aal, session_id)
  values (
    (payload ->> 'user_id')::uuid,
    nullif(payload ->> 'ip', ''),
    nullif(payload ->> 'user_agent', ''),
    coalesce(payload ->> 'aal', 'aal1'),
    (payload ->> 'id')::uuid
  );
  return new;
exception when others then
  return new;
end;
$$;
