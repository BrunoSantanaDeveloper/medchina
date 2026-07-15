-- ============================================================
-- 0024_trial_minutes: audio minutes as the billable unit (PRD §5.4/§5.5/§5.8)
-- and the Pro trial (PRD §5.7) — 14 days OR 300 minutes, whichever comes first,
-- started only by a deliberate act, without a card.
--
-- The rule the whole design follows (PRD §5.8):
--   "Uma gravação em andamento não deve ser interrompida silenciosamente ao
--    atingir o limite. O tratamento financeiro ocorrerá após preservação do
--    áudio."
-- So the limit is checked when something STARTS, never while it runs. A
-- recording that was allowed to begin always finishes, is always stored and is
-- always processable, even if it overruns the allowance; the overrun is
-- recorded honestly and the NEXT recording is the one that gets refused. The
-- database is what enforces that: the insert guard below is why the existence
-- of a `recordings` row is itself the authorization to process it.
--
-- Nothing here charges anyone. Exceeding the allowance stops new AI work and
-- invites an upgrade; it never bills an overage (PRD §5.8: "Nenhuma cobrança
-- excedente será realizada sem autorização prévia").
-- ============================================================

-- ---------- Plan catalog ----------
-- Prices and limits are launch HYPOTHESES: they live here as superadmin-
-- editable rows (/admin/billing), never as constants in code.

update public.plans
set slug = 'gratuito',
    name = 'Gratuito',
    description = 'Prontuário, pacientes e consultas manuais sem limite. Sem gravação ou IA.',
    limits = '{"members": 1, "audio_minutes": 0}'::jsonb,
    sort = 0
where is_free;

insert into public.plans (slug, name, description, kind, period, price_cents, currency, is_free, limits, sort)
values
  (
    'assistente',
    'Assistente',
    'Documentação automatizada: gravação, transcrição e anamnese preenchida para sua revisão.',
    'recurring',
    'monthly',
    19900,
    'BRL',
    false,
    '{"members": 1, "audio_minutes": 3000}'::jsonb,
    1
  ),
  (
    'pro',
    'Pro',
    'Tudo do Assistente mais a preparação do raciocínio terapêutico para sua validação.',
    'recurring',
    'monthly',
    29900,
    'BRL',
    false,
    '{"members": 1, "audio_minutes": 6000}'::jsonb,
    2
  )
on conflict (slug) do nothing;

-- Trial parameters are configurable too (superadmin-managed, anon-readable —
-- they are a public commercial promise, not a secret).
insert into public.platform_settings (key, value)
values ('trial', '{"days": 14, "minutes": 300}'::jsonb)
on conflict (key) do nothing;

-- ---------- Consumption ledger ----------
-- Append-only, like every other ledger in this schema: usage is evidence, and
-- evidence is not editable. There is no insert policy for `authenticated` on
-- purpose — only the service role (the pipeline job) writes usage. A browser
-- can never tell the platform how much it consumed.

create table public.audio_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  recording_id uuid references public.recordings (id) on delete set null,
  transcription_id uuid references public.transcriptions (id) on delete set null,
  -- Billable audio, measured server-side (see lib/usage.ts).
  seconds integer not null check (seconds > 0),
  kind text not null default 'transcription' check (kind in ('transcription', 'adjustment')),
  description text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index audio_usage_org_created_idx on public.audio_usage (org_id, created_at);

-- ---------- Pro trial ----------
-- Primary key on org_id: one trial per workspace, ever. No insert/update policy
-- for users — the only way in is start_pro_trial(), so a trial can never begin
-- as a side effect of browsing (PRD §5.7: exploring and the fictional demo do
-- not consume the trial).

create table public.pro_trials (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  minutes_limit integer not null check (minutes_limit > 0),
  started_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Consumption alerts (PRD §5.8: 80%, 95%, 100%) ----------
-- The unique constraint is the idempotency: an alert fires once per window per
-- threshold, however many times the pipeline runs or retries.

create table public.usage_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The allowance window the alert belongs to (billing cycle or trial start).
  window_start timestamptz not null,
  threshold integer not null check (threshold in (80, 95, 100)),
  created_at timestamptz not null default now(),
  unique (org_id, window_start, threshold)
);

-- ---------- RLS ----------

alter table public.audio_usage enable row level security;
alter table public.pro_trials enable row level security;
alter table public.usage_alerts enable row level security;

-- Members see their own consumption; nobody but the service role writes it.
create policy "audio_usage_select_member" on public.audio_usage for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

create policy "pro_trials_select_member" on public.pro_trials for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

create policy "usage_alerts_select_member" on public.usage_alerts for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

-- ---------- Allowance: the single answer to "may this org use AI, and how much
-- is left?" ----------
-- One source of truth, in SQL, because both the app and the DB guard need it.

create or replace function public.org_audio_allowance(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  trial public.pro_trials%rowtype;
  window_start timestamptz;
  window_end timestamptz;
  limit_minutes integer := 0;
  used_seconds bigint := 0;
  used_minutes integer := 0;
  percent integer := 0;
  src text := 'none';
  plan_minutes integer := 0;
  trial_available boolean := false;
  can_start boolean := false;
begin
  -- The service role (the pipeline job) has no JWT and no membership; every
  -- other caller must be a member of the organization it is asking about.
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if sub.id is not null then
    select * into plan from public.plans where id = sub.plan_id;
    plan_minutes := coalesce((plan.limits ->> 'audio_minutes')::int, 0);
  end if;

  select * into trial from public.pro_trials where org_id = target_org;

  -- A paid audio plan DECIDES, whether or not it is currently usable: an org
  -- that bought minutes must never silently fall back to an old trial pool.
  -- That fallback would let a suspended workspace keep processing on leftover
  -- trial days, quietly defeating the superadmin kill-switch.
  if plan_minutes > 0 then
    if not sub.admin_suspended and sub.status in ('trialing', 'active') then
      src := 'plan';
      limit_minutes := plan_minutes;
      window_start := coalesce(sub.current_period_start, date_trunc('month', now()));
      window_end := coalesce(sub.current_period_end, window_start + interval '1 month');
    end if;
    -- Suspended or past_due: no allowance at all (src stays 'none'), matching
    -- what org_entitlements() already reports for those states.
  elsif trial.org_id is not null then
    src := 'trial';
    limit_minutes := trial.minutes_limit;
    -- The trial pool is the whole trial, not a monthly cycle.
    window_start := trial.started_at;
    window_end := trial.ends_at;
  end if;

  -- Eligible for a trial: never had one, and no paid plan that already
  -- includes minutes (PRD §5.7 "novas contas gratuitas elegíveis").
  trial_available := trial.org_id is null and plan_minutes = 0;

  if src <> 'none' then
    select coalesce(sum(seconds), 0) into used_seconds
    from public.audio_usage
    where org_id = target_org
      and created_at >= window_start
      and (window_end is null or created_at < window_end);
  end if;

  -- Round the TOTAL up once, never each recording: per-item rounding would
  -- silently inflate consumption.
  used_minutes := ceil(used_seconds / 60.0);

  if limit_minutes > 0 then
    percent := least(floor(used_minutes * 100.0 / limit_minutes)::int, 999);
    can_start := used_minutes < limit_minutes;
  end if;

  -- The trial ends on days OR minutes, whichever comes first (PRD §5.7).
  if src = 'trial' and now() >= trial.ends_at then
    can_start := false;
  end if;

  return jsonb_build_object(
    'source', src,
    'plan_slug', plan.slug,
    'plan_name', plan.name,
    'suspended', coalesce(sub.admin_suspended, false),
    'minutes_limit', limit_minutes,
    'minutes_used', used_minutes,
    'minutes_remaining', greatest(limit_minutes - used_minutes, 0),
    'percent', percent,
    'window_start', window_start,
    'window_end', window_end,
    'trial_active', src = 'trial' and can_start,
    'trial_ends_at', trial.ends_at,
    'trial_available', trial_available,
    -- May a NEW recording or a NEW processing run begin right now?
    'can_start', can_start
  );
end;
$$;

grant execute on function public.org_audio_allowance(uuid) to authenticated;

-- ---------- Starting the trial ----------
-- Deliberate, explicit, idempotent. The clock starts HERE and nowhere else
-- (PRD §5.7: "A contagem começa apenas quando a profissional inicia
-- conscientemente a primeira consulta real com IA").

create or replace function public.start_pro_trial(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  params jsonb;
  trial_days integer;
  trial_minutes integer;
begin
  if not public.is_org_member(target_org) then
    raise exception 'not a member of this organization';
  end if;

  -- Already started (or already used): return the current picture, don't reset.
  if exists (select 1 from public.pro_trials where org_id = target_org) then
    return public.org_audio_allowance(target_org);
  end if;

  select value into params from public.platform_settings where key = 'trial';
  trial_days := coalesce((params ->> 'days')::int, 14);
  trial_minutes := coalesce((params ->> 'minutes')::int, 300);

  insert into public.pro_trials (org_id, started_at, ends_at, minutes_limit, started_by)
  values (
    target_org,
    now(),
    now() + make_interval(days => trial_days),
    trial_minutes,
    auth.uid()
  );

  return public.org_audio_allowance(target_org);
end;
$$;

grant execute on function public.start_pro_trial(uuid) to authenticated;

-- ---------- The guard: nothing starts without allowance ----------
-- This is what makes "you may always finish what you legitimately started"
-- true: because a row cannot be created without allowance, the mere existence
-- of a recording authorizes its processing — no second check can strand an
-- already-captured consultation.
--
-- It deliberately does NOT fire on update: a recording in flight must always
-- reach 'uploaded', even if it overran the limit while it was running.

create or replace function public.guard_recording_allowance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowance jsonb;
begin
  -- Housekeeping cascades are not new work.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  allowance := public.org_audio_allowance(new.org_id);

  if not (allowance ->> 'can_start')::boolean then
    if (allowance ->> 'trial_available')::boolean then
      raise exception 'trial_not_started'
        using hint = 'Start the Pro trial before the first AI consultation (PRD §5.7).';
    end if;
    raise exception 'audio_allowance_exhausted'
      using hint = 'No audio minutes left: the plan limit or the Pro trial is over (PRD §5.7/§5.8).';
  end if;

  return new;
end;
$$;

create trigger recordings_allowance_guard
  before insert on public.recordings
  for each row execute function public.guard_recording_allowance();
