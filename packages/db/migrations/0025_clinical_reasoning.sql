-- ============================================================
-- 0025_clinical_reasoning: disharmony-pattern hypotheses (PRD §10.8) — the Pro
-- reasoning layer.
--
-- What this stores is NOT a diagnosis and the schema says so out loud:
--   - `correspondence` is how well the pattern matches the RECORDED DATA
--     (weak/moderate/strong), never a confidence score. PRD §10.8 rejects
--     "confiança alta" precisely because it reads as clinical precision;
--   - `contradicting_signs` and `missing_data` are first-class columns, not
--     optional extras: a hypothesis that cannot show what argues AGAINST it is
--     not a hypothesis, it is a suggestion wearing a lab coat;
--   - `limitation` is mandatory when essential data is absent (PRD §10.8: never
--     conclude without highlighting the limitation);
--   - `model`, `prompt_version` and `sources` record what produced it
--     (PRD §10.10: "Registrar versão do modelo, prompt e fontes utilizadas").
--
-- Everything lands as a draft the professional accepts, edits, rejects or
-- reports (PRD §10.10) — and it freezes with the consultation (PRD §8.5).
-- ============================================================

create type public.hypothesis_correspondence as enum ('weak', 'moderate', 'strong');
create type public.hypothesis_status as enum ('draft', 'accepted', 'edited', 'rejected');

create table public.consultation_hypotheses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,

  -- The disharmony pattern, in the consultation's language.
  pattern text not null,
  rationale text,

  -- How well it matches the RECORDED data — never a confidence in the finding.
  correspondence public.hypothesis_correspondence not null,

  -- [{ "text": "...", "fieldKey": "complaint.onset" }]
  supporting_signs jsonb not null default '[]'::jsonb,
  contradicting_signs jsonb not null default '[]'::jsonb,
  -- What the case would need but does not have — questions, never answers.
  missing_data jsonb not null default '[]'::jsonb,
  -- [{ "title": "...", "source": "...", "kind": "traditional|protocol|evidence",
  --    "documentId": "...", "chunkId": "..." }] — only real retrieved chunks.
  sources jsonb not null default '[]'::jsonb,

  -- Set when essential data is missing (PRD §10.8). The UI must show it.
  limitation text,

  -- The professional's decision. Nothing here is clinical until she acts.
  status public.hypothesis_status not null default 'draft',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  -- Why she rejected it / what she reported about it (PRD §10.10).
  review_note text,

  -- Provenance of the generation itself (PRD §10.10).
  model text,
  prompt_version text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index consultation_hypotheses_consultation_idx
  on public.consultation_hypotheses (consultation_id, created_at desc);
create index consultation_hypotheses_org_idx on public.consultation_hypotheses (org_id);

-- ---------- RLS ----------

alter table public.consultation_hypotheses enable row level security;

create policy "consultation_hypotheses_select_member" on public.consultation_hypotheses for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

create policy "consultation_hypotheses_insert_member" on public.consultation_hypotheses for insert to authenticated
  with check (public.is_org_member(org_id));

-- She may review (accept/edit/reject/report); the pipeline writes the draft.
create policy "consultation_hypotheses_update_member" on public.consultation_hypotheses for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create policy "consultation_hypotheses_delete_member" on public.consultation_hypotheses for delete to authenticated
  using (public.is_org_member(org_id));

create trigger consultation_hypotheses_updated_at
  before update on public.consultation_hypotheses
  for each row execute function public.set_updated_at();

-- Clinical rows are versioned like every other one (packages/audit).
select public.enable_row_versioning('public.consultation_hypotheses');

-- ---------- Frozen with the consultation (PRD §8.5) ----------
-- Same shape as the answers guard (0021): housekeeping cascades pass, clinical
-- edits do not.

create or replace function public.guard_finalized_hypotheses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  target := coalesce(new.consultation_id, old.consultation_id);

  if exists (select 1 from public.consultations c where c.id = target and c.status = 'finalized') then
    raise exception 'consultation is finalized: hypotheses are frozen (PRD §8.5)'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger consultation_hypotheses_finalized_guard
  before insert or update or delete on public.consultation_hypotheses
  for each row execute function public.guard_finalized_hypotheses();

-- ---------- The clinical library (PRD §9.9) ----------
-- Kind (traditional / internal protocol / scientific evidence) is the
-- COLLECTION, because the PRD requires them classified separately and they are
-- different KINDS of source, not a ranking of one over another. `trust_level`
-- stays what it is in the template — reliability WITHIN a kind. Conflating the
-- two would force a stance ("a classic outranks a trial") the product has no
-- business taking on the practitioner's behalf.

insert into public.knowledge_collections (slug, name, description, org_id)
values
  (
    'mtc-fontes-tradicionais',
    'Fontes tradicionais',
    'Clássicos e autores consagrados da Medicina Tradicional Chinesa. Referência junto à sugestão, sem reproduzir capítulos ou trechos extensos protegidos (PRD §9.9).',
    null
  ),
  (
    'mtc-protocolos-internos',
    'Protocolos internos',
    'Protocolos validados internamente, com responsável editorial e histórico de revisão (PRD §9.9).',
    null
  ),
  (
    'mtc-evidencia-cientifica',
    'Evidência científica',
    'Evidência científica revisada, classificada separadamente das fontes tradicionais (PRD §9.9).',
    null
  )
on conflict (org_id, slug) do nothing;

-- ---------- Pro entitlement ----------
-- The reasoning layer is what separates Pro from Assistente (PRD §5.5/§5.6).
-- A configurable row, like every other limit.

update public.plans
set limits = limits || '{"clinical_reasoning": 1}'::jsonb
where slug = 'pro';

-- The allowance is already the single answer to "what may this workspace do";
-- reasoning joins it rather than becoming a second, drifting opinion.
-- The Pro TRIAL grants Pro features — that is what makes it a Pro trial.
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
  can_reason boolean := false;
begin
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

  if plan_minutes > 0 then
    if not sub.admin_suspended and sub.status in ('trialing', 'active') then
      src := 'plan';
      limit_minutes := plan_minutes;
      window_start := coalesce(sub.current_period_start, date_trunc('month', now()));
      window_end := coalesce(sub.current_period_end, window_start + interval '1 month');
    end if;
  elsif trial.org_id is not null then
    src := 'trial';
    limit_minutes := trial.minutes_limit;
    window_start := trial.started_at;
    window_end := trial.ends_at;
  end if;

  trial_available := trial.org_id is null and plan_minutes = 0;

  if src <> 'none' then
    select coalesce(sum(seconds), 0) into used_seconds
    from public.audio_usage
    where org_id = target_org
      and created_at >= window_start
      and (window_end is null or created_at < window_end);
  end if;

  used_minutes := ceil(used_seconds / 60.0);

  if limit_minutes > 0 then
    percent := least(floor(used_minutes * 100.0 / limit_minutes)::int, 999);
    can_start := used_minutes < limit_minutes;
  end if;

  if src = 'trial' and now() >= trial.ends_at then
    can_start := false;
  end if;

  -- Reasoning rides on the same allowance: the trial IS Pro, a paid plan gets
  -- it only if its limits say so, and an exhausted/suspended workspace gets
  -- nothing new.
  if src = 'trial' then
    can_reason := can_start;
  elsif src = 'plan' then
    can_reason := can_start and coalesce((plan.limits ->> 'clinical_reasoning')::int, 0) > 0;
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
    'can_start', can_start,
    -- May this workspace use the Pro reasoning layer (PRD §10.8)?
    'clinical_reasoning', can_reason
  );
end;
$$;

grant execute on function public.org_audio_allowance(uuid) to authenticated;
