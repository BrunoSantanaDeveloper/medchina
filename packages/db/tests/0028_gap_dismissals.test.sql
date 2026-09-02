begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ============================================================
-- Migration 0094 — dispensar uma pergunta é uma decisão, não um estado de tela.
--
-- As perguntas em aberto viviam só no array consultations.ai_gaps, e o apply de
-- uma gravação substitui esse array por inteiro: reprocessar — que virou rotina
-- — trazia de volta o checklist que ela já tinha limpado, sobrescrevendo uma
-- decisão dela com um retry. A decisão passa a ter linha própria, como já
-- acontece com uma resposta rejeitada.
--
-- O FILTRO em si é aplicado pelo pipeline antes de gravar (é ele quem monta
-- ai_gaps); o que se fixa aqui é o que o banco garante: a decisão é registrada,
-- pertence à organização e nenhum cliente a forja.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'gaps-owner@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Gaps Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('f2000000-0000-4000-8000-000000000001', 'Gaps practice', 'gaps-practice',
        'f1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, created_by)
values ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Paciente Gaps',
        'f1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, ai_gaps, created_by)
values ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001', 'awaiting_review',
        '["Investigar sede e boca seca?", "Investigar qualidade do sono?"]'::jsonb,
        'f1000000-0000-4000-8000-000000000001');

create temporary table gap_results (name text primary key, payload jsonb);
grant select, insert on table gap_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

insert into gap_results
select 'dismissed', public.dismiss_consultation_gap(
  'f4000000-0000-4000-8000-000000000001', 'Investigar sede e boca seca?'
);

select ok(
  coalesce(((select payload from gap_results where name = 'dismissed') ->> 'ok')::boolean, false),
  'she can clear a question she has already worked through'
);

select is(
  (select jsonb_array_length(ai_gaps) from public.consultations
   where id = 'f4000000-0000-4000-8000-000000000001'),
  1,
  'and it leaves the open list immediately'
);

select is(
  (select count(*)::int from public.consultation_gap_dismissals
   where consultation_id = 'f4000000-0000-4000-8000-000000000001'
     and gap = 'Investigar sede e boca seca?'),
  1,
  'the decision itself is recorded, so a reprocess cannot ask it again'
);

select is(
  (select org_id from public.consultation_gap_dismissals
   where consultation_id = 'f4000000-0000-4000-8000-000000000001'),
  'f2000000-0000-4000-8000-000000000001'::uuid,
  'scoped to the workspace, like every other clinical row'
);

-- Dismissing the same question twice is what a double click or a retry looks
-- like; it must be idempotent rather than an error in her face.
insert into gap_results
select 'again', public.dismiss_consultation_gap(
  'f4000000-0000-4000-8000-000000000001', 'Investigar sede e boca seca?'
);

select ok(
  coalesce(((select payload from gap_results where name = 'again') ->> 'ok')::boolean, false),
  'dismissing the same question twice is harmless'
);

select throws_ok(
  $$insert into public.consultation_gap_dismissals (consultation_id, gap, org_id)
    values ('f4000000-0000-4000-8000-000000000001', 'forjada', 'f2000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'a client cannot forge a dismissal outside the audited RPC'
);

reset role;

select * from finish();
rollback;
