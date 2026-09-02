-- ============================================================
-- 0094_gap_dismissals_retrieval_flag: duas memórias que faltavam.
--
-- (1) O CHECKLIST QUE SE DESFAZIA SOZINHO. As perguntas em aberto ("Investigar
--     sede e boca seca?") vivem num array em consultations.ai_gaps, e descartar
--     uma apenas a remove do array. Mas o apply de uma gravação SUBSTITUI o
--     array inteiro — a própria 0072 já documentava que "re-processing a
--     recording repopulates them". Como reprocessar virou rotina (era o desfecho
--     de toda falha por conflito de revisão, corrigida na 0092), a profissional
--     limpava o checklist e o via voltar inteiro. Isso sobrescreve uma decisão
--     dela, que é exatamente o que o produto promete nunca fazer.
--
--     Diferente de uma resposta rejeitada, um gap descartado não deixava rastro
--     nenhum. Agora deixa, na mesma forma de ai_answer_decisions: uma linha por
--     pergunta dispensada, que o pipeline consulta antes de gravar as novas.
--
-- (2) "BIBLIOTECA INDISPONÍVEL" VIRAVA "NENHUMA FONTE SUSTENTA". O aviso de que
--     as hipóteses foram preparadas SEM a biblioteca existia apenas como estado
--     local do painel: depois de um reload ele sumia e a tela passava a afirmar
--     que nada na biblioteca cobria o caso. São fatos opostos — um diz "não
--     verifiquei", o outro "verifiquei e não achou" — e clinical-reasoning.ts
--     documenta essa ambiguidade como perigosa ("she would be reading an
--     ungrounded answer believing it was checked"). A marca passa a viver na
--     linha, onde sobrevive ao reload e a outro dispositivo.
-- ============================================================

-- ---------- (1) Uma pergunta dispensada continua dispensada ----------

create table if not exists public.consultation_gap_dismissals (
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  gap text not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  dismissed_by uuid references public.profiles (id) on delete set null,
  dismissed_at timestamptz not null default now(),
  primary key (consultation_id, gap)
);

comment on table public.consultation_gap_dismissals is
  'Questions the professional cleared from the gap checklist. Consulted when a recording is (re)processed so her decision is not undone by a retry.';

alter table public.consultation_gap_dismissals enable row level security;

drop policy if exists "gap_dismissals_select" on public.consultation_gap_dismissals;
create policy "gap_dismissals_select" on public.consultation_gap_dismissals
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

-- Written only through the RPC below (security definer), like every other
-- clinical decision: no direct client insert, so the row always carries the
-- org and the actor the guard checked.
drop policy if exists "gap_dismissals_insert" on public.consultation_gap_dismissals;
create policy "gap_dismissals_insert" on public.consultation_gap_dismissals
  for insert to authenticated
  with check (false);

create index if not exists consultation_gap_dismissals_consultation_idx
  on public.consultation_gap_dismissals (consultation_id);

-- Corpo de 0072 recriado verbatim, com o registro da decisão acrescentado.
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

  -- The decision itself, so a later recording cannot ask it again.
  insert into public.consultation_gap_dismissals (consultation_id, gap, org_id, dismissed_by)
  values (target_consultation, btrim(target_gap), consultation_row.org_id, auth.uid())
  on conflict (consultation_id, gap) do nothing;

  select c.clinical_revision into next_revision
  from public.consultations c
  where c.id = target_consultation;

  return jsonb_build_object('ok', true, 'code', 'dismissed', 'revision', next_revision, 'gaps', next_gaps);
end;
$$;

revoke all on function public.dismiss_consultation_gap(uuid, text) from public, anon;
grant execute on function public.dismiss_consultation_gap(uuid, text) to authenticated;

-- ---------- (2) Se a biblioteca não respondeu, a linha lembra ----------

alter table public.consultation_hypotheses
  add column if not exists retrieval_failed boolean not null default false;

comment on column public.consultation_hypotheses.retrieval_failed is
  'This hypothesis was prepared while the clinical library could not be reached. "Not checked" and "checked, nothing matched" must never read the same after a reload.';
