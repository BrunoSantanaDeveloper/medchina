begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ============================================================
-- Migração 0098 — as duas saídas que faltavam, e a cascata que sobrava.
--
-- 1. Confirmar um campo "requer atenção" (ela leu e mantém) registra a revisão
--    SEM reescrever o valor, sem trocar a origem e sem incrementar
--    clinical_revision — logo, sem desatualizar hipóteses e plano.
-- 2. Reafirmar uma hipótese que ela já tinha considerado e que ficou
--    desatualizada é a única saída do beco: review_consultation_hypothesis
--    recusa qualquer decisão em linha stale e replace_draft_hypotheses só
--    troca rascunhos.
-- 3. Dispensar uma pergunta em aberto deixa de incrementar a revisão: gaps não
--    alimentam nenhuma etapa de IA.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'journey-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Journey Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('e2000000-0000-4000-8000-000000000001', 'Journey practice', 'journey-practice',
        'e1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, created_by)
values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Paciente Trilha',
        'e1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, ai_gaps, created_by)
values ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
        'e3000000-0000-4000-8000-000000000001', 'awaiting_review',
        '["Investigar sede?", "Investigar sono?"]'::jsonb,
        'e1000000-0000-4000-8000-000000000001');

-- Um campo rascunhado pela IA e marcado para atenção, com proveniência.
insert into public.anamnesis_answers (
  org_id, consultation_id, block_key, field_key, value, source, state, provenance, created_by
) values (
  'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
  'complaint', 'onset', 'há três semanas, após mudança de turno', 'patient_report', 'attention',
  '{"quote":"começou há umas três semanas","transcriptionId":"e5000000-0000-4000-8000-000000000001"}'::jsonb,
  'e1000000-0000-4000-8000-000000000001'
);
-- Um campo que ela já editou: confirmar não se aplica.
insert into public.anamnesis_answers (
  org_id, consultation_id, block_key, field_key, value, source, state, created_by
) values (
  'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
  'complaint', 'duration', 'três semanas', 'professional', 'edited',
  'e1000000-0000-4000-8000-000000000001'
);

-- h1: considerada por ela e desatualizada (o beco). h2: considerada e atual.
-- h3: rascunho desatualizado (a saída dele é preparar de novo).
insert into public.consultation_hypotheses (
  id, org_id, consultation_id, pattern, correspondence, status, input_revision, stale_at, reviewed_by, reviewed_at
) values
  ('e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
   'e4000000-0000-4000-8000-000000000001', 'Deficiência de Qi do Baço', 'moderate', 'accepted', 0, now(),
   'e1000000-0000-4000-8000-000000000001', now()),
  ('e6000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
   'e4000000-0000-4000-8000-000000000001', 'Estagnação de Qi do Fígado', 'moderate', 'accepted', 0, null,
   'e1000000-0000-4000-8000-000000000001', now()),
  ('e6000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001',
   'e4000000-0000-4000-8000-000000000001', 'Umidade-Calor', 'weak', 'draft', 0, now(), null, null);

create temporary table journey_results (name text primary key, payload jsonb);
create temporary table journey_marks (name text primary key, value bigint);
grant select, insert on table journey_results to authenticated;
grant select, insert on table journey_marks to authenticated;

insert into journey_marks
select 'revision_before', clinical_revision from public.consultations
where id = 'e4000000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

-- ---------- Confirmar o campo em atenção ----------

insert into journey_results
select 'confirmed', public.confirm_anamnesis_answer(
  'e4000000-0000-4000-8000-000000000001', 'complaint', 'onset', 'há três semanas, após mudança de turno'
);

select ok(
  (select payload ->> 'ok' from journey_results where name = 'confirmed')::boolean
    and (select payload ->> 'code' from journey_results where name = 'confirmed') = 'confirmed',
  'confirmar um campo em atenção é aceito'
);

select is(
  (select state::text from public.anamnesis_answers
   where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'onset'),
  'clear',
  'o campo sai de "requer atenção"'
);

select is(
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  (select value from journey_marks where name = 'revision_before'),
  'confirmar NÃO incrementa a revisão clínica'
);

select is(
  (select reviewed_by::text from public.anamnesis_answers
   where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'onset'),
  'e1000000-0000-4000-8000-000000000001',
  'quem revisou fica registrado na linha'
);

select ok(
  (select source::text = 'patient_report' and provenance ? 'transcriptionId'
   from public.anamnesis_answers
   where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'onset'),
  'a origem e a proveniência do rascunho da IA são preservadas'
);

select ok(
  (select stale_at is null from public.consultation_hypotheses
   where id = 'e6000000-0000-4000-8000-000000000002'),
  'uma hipótese atual continua atual depois da confirmação'
);

insert into journey_results
select 'confirm_mismatch', public.confirm_anamnesis_answer(
  'e4000000-0000-4000-8000-000000000001', 'complaint', 'onset', 'outro texto qualquer'
);

select is(
  (select payload ->> 'code' from journey_results where name = 'confirm_mismatch'),
  'revision_conflict',
  'confirmar um texto diferente do que está gravado é recusado'
);

insert into journey_results
select 'confirm_again', public.confirm_anamnesis_answer(
  'e4000000-0000-4000-8000-000000000001', 'complaint', 'onset', 'há três semanas, após mudança de turno'
);

select ok(
  (select payload ->> 'ok' from journey_results where name = 'confirm_again')::boolean
    and (select payload ->> 'code' from journey_results where name = 'confirm_again') = 'unchanged',
  'confirmar duas vezes é idempotente, não um erro'
);

insert into journey_results
select 'confirm_edited', public.confirm_anamnesis_answer(
  'e4000000-0000-4000-8000-000000000001', 'complaint', 'duration', 'três semanas'
);

select is(
  (select payload ->> 'code' from journey_results where name = 'confirm_edited'),
  'invalid_request',
  'não há o que confirmar num campo que ela mesma escreveu'
);

-- ---------- Uma edição de verdade continua sendo uma edição ----------

insert into journey_results
select 'saved', public.save_consultation_answer(
  'e4000000-0000-4000-8000-000000000001',
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  'complaint', 'onset', 'há quatro semanas', 'professional', 'clear'
);

select ok(
  (select reviewed_at is null from public.anamnesis_answers
   where consultation_id = 'e4000000-0000-4000-8000-000000000001' and field_key = 'onset'),
  'trocar o valor apaga a confirmação anterior'
);

select ok(
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001')
    > (select value from journey_marks where name = 'revision_before'),
  'trocar o valor incrementa a revisão, como sempre'
);

insert into journey_marks
select 'revision_after_edit', clinical_revision from public.consultations
where id = 'e4000000-0000-4000-8000-000000000001';

-- ---------- Reafirmar a hipótese considerada que ficou desatualizada ----------

insert into journey_results
select 'reaffirm_wrong_pattern', public.reaffirm_consultation_hypothesis(
  'e6000000-0000-4000-8000-000000000001',
  (select updated_at from public.consultation_hypotheses where id = 'e6000000-0000-4000-8000-000000000001'),
  'Outro padrão'
);

select is(
  (select payload ->> 'field' from journey_results where name = 'reaffirm_wrong_pattern'),
  'confirmPattern',
  'reafirmar exige repetir o padrão que estava na tela'
);

insert into journey_results
select 'reaffirm_draft', public.reaffirm_consultation_hypothesis(
  'e6000000-0000-4000-8000-000000000003',
  (select updated_at from public.consultation_hypotheses where id = 'e6000000-0000-4000-8000-000000000003'),
  'Umidade-Calor'
);

select is(
  (select payload ->> 'field' from journey_results where name = 'reaffirm_draft'),
  'status',
  'um rascunho não é reafirmado: a saída dele é preparar de novo'
);

insert into journey_results
select 'reaffirm_conflict', public.reaffirm_consultation_hypothesis(
  'e6000000-0000-4000-8000-000000000001', '2020-01-01T00:00:00Z'::timestamptz, 'Deficiência de Qi do Baço'
);

select is(
  (select payload ->> 'code' from journey_results where name = 'reaffirm_conflict'),
  'hypothesis_revision_conflict',
  'uma hipótese alterada em outra aba não é reafirmada às cegas'
);

insert into journey_results
select 'reaffirmed', public.reaffirm_consultation_hypothesis(
  'e6000000-0000-4000-8000-000000000001',
  (select updated_at from public.consultation_hypotheses where id = 'e6000000-0000-4000-8000-000000000001'),
  '  deficiência de qi do baço  '
);

select is(
  (select payload ->> 'code' from journey_results where name = 'reaffirmed'),
  'reaffirmed',
  'a confirmação nomeada ignora espaços e caixa, não o conteúdo'
);

select ok(
  (select stale_at is null
     and input_revision = (select clinical_revision from public.consultations
                           where id = 'e4000000-0000-4000-8000-000000000001')
   from public.consultation_hypotheses where id = 'e6000000-0000-4000-8000-000000000001'),
  'a hipótese volta a valer contra a ficha atual'
);

select is(
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  (select value from journey_marks where name = 'revision_after_edit'),
  'reafirmar não incrementa a revisão nem desvalida o plano'
);

select ok(
  exists (
    select 1 from public.consultation_hypotheses h
    where h.consultation_id = 'e4000000-0000-4000-8000-000000000001'
      and h.status in ('accepted', 'edited')
      and h.stale_at is null
  ),
  'a pré-condição do plano com IA (0031:656-662) volta a ser satisfeita'
);

insert into journey_results
select 'reaffirm_again', public.reaffirm_consultation_hypothesis(
  'e6000000-0000-4000-8000-000000000001',
  (select updated_at from public.consultation_hypotheses where id = 'e6000000-0000-4000-8000-000000000001'),
  'Deficiência de Qi do Baço'
);

select is(
  (select payload ->> 'code' from journey_results where name = 'reaffirm_again'),
  'unchanged',
  'reafirmar o que já está atual não faz nada'
);

-- ---------- Dispensar uma pergunta não é edição clínica ----------

insert into journey_results
select 'gap', public.dismiss_consultation_gap(
  'e4000000-0000-4000-8000-000000000001', 'Investigar sede?'
);

select is(
  (select clinical_revision from public.consultations where id = 'e4000000-0000-4000-8000-000000000001'),
  (select value from journey_marks where name = 'revision_after_edit'),
  'dispensar uma pergunta em aberto não desatualiza hipóteses nem plano'
);

select ok(
  not (select ai_gaps @> '["Investigar sede?"]'::jsonb from public.consultations
       where id = 'e4000000-0000-4000-8000-000000000001'),
  'e a pergunta dispensada sai da lista'
);

-- ---------- O plano lembra se a biblioteca respondeu ----------

reset role;

select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'consultation_plans' and column_name = 'retrieval_failed'),
  'false',
  'consultation_plans.retrieval_failed nasce falso'
);

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'consultation_plans' and column_name = 'retrieval_failed'),
  'NO',
  'e nunca fica indefinido — "sem fontes" e "biblioteca fora" são fatos distintos'
);

select * from finish();
rollback;
