begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- ============================================================
-- Migração 0100 — plano manual só depois de haver algo registrado.
--
-- Numa ficha vazia a tela oferecia "Criar plano manual" e o banco criava um
-- plano vazio, à frente do próprio registro. A regra passa a ser a mesma das
-- etapas de IA: ao menos uma resposta não rejeitada, ou a queixa principal.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'manual-plan@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Manual Plan Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('d2000000-0000-4000-8000-000000000001', 'Manual plan practice', 'manual-plan-practice',
        'd1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, created_by)
values ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Paciente Plano',
        'd1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001', 'in_progress', 'd1000000-0000-4000-8000-000000000001');

create temporary table plan_results (name text primary key, payload jsonb);
grant select, insert on table plan_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

insert into plan_results
select 'empty', public.create_manual_consultation_plan('d4000000-0000-4000-8000-000000000001', '[]'::jsonb);

select is(
  (select payload ->> 'code' from plan_results where name = 'empty'),
  'nothing_recorded',
  'numa ficha vazia o plano manual é recusado'
);

select is(
  (select count(*)::int from public.consultation_plans where consultation_id = 'd4000000-0000-4000-8000-000000000001'),
  0,
  'e nenhum plano vazio é criado'
);

reset role;
insert into public.anamnesis_answers (org_id, consultation_id, block_key, field_key, value, source, state, created_by)
values ('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
        'complaint', 'onset', 'há duas semanas', 'professional', 'clear', 'd1000000-0000-4000-8000-000000000001');
set local role authenticated;

insert into plan_results
select 'recorded', public.create_manual_consultation_plan('d4000000-0000-4000-8000-000000000001', '[]'::jsonb);

select is(
  (select payload ->> 'code' from plan_results where name = 'recorded'),
  'created',
  'com algo registrado o plano manual é criado'
);

insert into plan_results
select 'again', public.create_manual_consultation_plan('d4000000-0000-4000-8000-000000000001', '[]'::jsonb);

select is(
  (select payload ->> 'code' from plan_results where name = 'again'),
  'existing',
  'e a chamada continua idempotente'
);

select * from finish();
rollback;
