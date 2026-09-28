begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- ============================================================
-- Migração 0104 — a tela de consulta passa a ser medida.
--
-- A disciplina da 0034 continua inteira: a função reconstrói as propriedades
-- a partir de chaves E valores permitidos. O que se ganha aqui é saber que a
-- consulta foi aberta e para onde a profissional pulou — nunca de qual
-- paciente, nunca texto livre.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'rail@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Rail Owner"}'::jsonb, now(), now()
);
insert into public.organizations (id, name, slug, created_by)
values ('c2000000-0000-4000-8000-000000000001', 'Rail practice', 'rail-practice',
        'c1000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select public.track_product_event('consultation.opened', '{"origin":"consultation","platform":"web"}'::jsonb);
select public.track_product_event('consultation.step_jump', '{"step":"hypotheses","platform":"web"}'::jsonb);
select public.track_product_event('consultation.next_action', '{"step":"review","platform":"web"}'::jsonb);

reset role;

select is(
  (select count(*)::int from public.product_events
   where actor_id = 'c1000000-0000-4000-8000-000000000001'
     and event_name in ('consultation.opened', 'consultation.step_jump', 'consultation.next_action')),
  3,
  'os três eventos da tela de consulta são aceitos'
);

select is(
  (select properties ->> 'step' from public.product_events
   where actor_id = 'c1000000-0000-4000-8000-000000000001' and event_name = 'consultation.step_jump'),
  'hypotheses',
  'o passo de destino é gravado'
);

select is(
  (select org_id from public.product_events
   where actor_id = 'c1000000-0000-4000-8000-000000000001' and event_name = 'consultation.opened'),
  'c2000000-0000-4000-8000-000000000001'::uuid,
  'o evento fica no workspace de quem agiu'
);

-- Um passo que não existe na jornada não atravessa a fronteira.
set local role authenticated;
select public.track_product_event('consultation.step_jump', '{"step":"prontuario-da-paciente"}'::jsonb);
reset role;

-- Contado, e não "o mais recente": as duas linhas nascem na mesma transação,
-- logo compartilham created_at e não há "última".
select is(
  (select count(*)::int from public.product_events
   where actor_id = 'c1000000-0000-4000-8000-000000000001'
     and event_name = 'consultation.step_jump'
     and not (properties ? 'step')),
  1,
  'um passo fora da lista é descartado, e o evento fica sem a propriedade'
);

-- Conteúdo clínico continua sem passagem: a função só remonta o que conhece.
set local role authenticated;
select public.track_product_event(
  'consultation.opened',
  '{"step":"record","patient_name":"Maria","chief_complaint":"dor lombar"}'::jsonb
);
reset role;

select ok(
  (select not (properties ? 'patient_name') and not (properties ? 'chief_complaint')
   from public.product_events
   where actor_id = 'c1000000-0000-4000-8000-000000000001' and event_name = 'consultation.opened'
   order by created_at desc limit 1),
  'nome da paciente e queixa não atravessam a fronteira'
);

select * from finish();
rollback;
