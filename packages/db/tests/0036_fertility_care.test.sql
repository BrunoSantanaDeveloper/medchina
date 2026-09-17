begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ============================================================
-- Migração 0103 — o bloco "Ciclo menstrual e fertilidade" só se aplica
-- quando a profissional atende fertilidade E a paciente está marcada.
--
-- A regra mora numa função só, porque a tela e o pipeline de gravação (que
-- roda sem usuário) precisam chegar à mesma resposta.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'fertility@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Fertility Owner"}'::jsonb, now(), now()
);

insert into public.organizations (id, name, slug, created_by)
values ('f2000000-0000-4000-8000-000000000001', 'Fertility practice', 'fertility-practice',
        'f1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

insert into public.patients (id, org_id, full_name, fertility_care, created_by)
values
  ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'Paciente Marcada', true,
   'f1000000-0000-4000-8000-000000000001'),
  ('f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'Paciente Sem Marca', false,
   'f1000000-0000-4000-8000-000000000001');

insert into public.consultations (id, org_id, patient_id, status, created_by)
values ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001', 'in_progress', 'f1000000-0000-4000-8000-000000000001');

select throws_ok(
  $$update public.profiles set practice_areas = array['pediatrics'] where id = 'f1000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'o banco recusa uma área que o produto não conhece'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  not public.fertility_care_applies('f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001'),
  'paciente marcada, mas a profissional não declarou a área: o bloco não se aplica'
);

select is(
  public.update_practice_areas(array['invalida']) ->> 'code',
  'invalid_area',
  'a função recusa área desconhecida sem gravar nada'
);

select is(
  public.update_practice_areas(array[' Fertility ', 'fertility']) -> 'practice_areas',
  '["fertility"]'::jsonb,
  'a profissional declara fertilidade (normalizado, sem repetição)'
);

select ok(
  public.fertility_care_applies('f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001'),
  'com a área declarada e a paciente marcada, o bloco se aplica'
);

select ok(
  not public.fertility_care_applies('f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002'),
  'paciente sem marca: o bloco não se aplica'
);

select is(
  (public.get_consultation_context('f4000000-0000-4000-8000-000000000001') -> 'patient' ->> 'fertilityCare')::boolean,
  true,
  'o contexto da consulta leva a resposta para a tela'
);

select ok(
  (select count(*) = 1 from public.audit_events
   where action = 'practice.areas.updated' and actor_id = 'f1000000-0000-4000-8000-000000000001'),
  'declarar a área fica na trilha de auditoria (só a gravação que valeu)'
);

-- O pipeline de gravação roda como service role, sem usuário, e chega à mesma resposta.
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select ok(
  public.fertility_care_applies('f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001'),
  'o pipeline (service role) enxerga a mesma regra'
);

reset role;
select * from finish();
rollback;
