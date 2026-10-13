begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ============================================================
-- Migração 0120 — o preparo do consultório passa a ser medido por passo.
--
-- A disciplina da 0034 continua inteira: a função reconstrói as propriedades a
-- partir de chaves E valores permitidos. O que se ganha é saber qual passo ela
-- viu, concluiu, pulou ou de onde saiu — nunca o que ela digitou nele.
-- ============================================================

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'prep@medchina.invalid', '',
  '{}'::jsonb, '{"display_name":"Prep Owner"}'::jsonb, now(), now()
);
insert into public.organizations (id, name, slug, created_by)
values ('c4000000-0000-4000-8000-000000000001', 'Prep practice', 'prep-practice',
        'c3000000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role)
values ('c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'owner')
on conflict do nothing;

select set_config(
  'request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select public.track_product_event('onboarding.step_viewed', '{"prep_step":"scope","origin":"onboarding","platform":"web"}'::jsonb);
select public.track_product_event('onboarding.step_completed', '{"prep_step":"signature","origin":"onboarding"}'::jsonb);
select public.track_product_event('onboarding.step_skipped', '{"prep_step":"recording","origin":"onboarding"}'::jsonb);
select public.track_product_event('onboarding.exited', '{"prep_step":"next","origin":"onboarding"}'::jsonb);
select public.track_product_event('onboarding.completed', '{"origin":"onboarding"}'::jsonb);

reset role;

select is(
  (select count(*)::int from public.product_events
   where actor_id = 'c3000000-0000-4000-8000-000000000001'
     and event_name in (
       'onboarding.step_viewed', 'onboarding.step_completed', 'onboarding.step_skipped',
       'onboarding.exited', 'onboarding.completed'
     )),
  5,
  'os cinco eventos do preparo são aceitos pela função e pela tabela'
);

select is(
  (select properties ->> 'prep_step' from public.product_events
   where actor_id = 'c3000000-0000-4000-8000-000000000001' and event_name = 'onboarding.step_completed'),
  'signature',
  'o passo é gravado'
);

select is(
  (select org_id from public.product_events
   where actor_id = 'c3000000-0000-4000-8000-000000000001' and event_name = 'onboarding.completed'),
  'c4000000-0000-4000-8000-000000000001'::uuid,
  'o evento fica no workspace de quem agiu'
);

-- Um passo que não existe no preparo não atravessa a fronteira.
set local role authenticated;
select public.track_product_event('onboarding.step_skipped', '{"prep_step":"consulta-guiada"}'::jsonb);
reset role;

select is(
  (select count(*)::int from public.product_events
   where actor_id = 'c3000000-0000-4000-8000-000000000001'
     and event_name = 'onboarding.step_skipped'
     and not (properties ? 'prep_step')),
  1,
  'um passo fora da lista é descartado, e o evento fica sem a propriedade'
);

-- O que ela digitou no passo não vem junto: a função só remonta o que conhece.
set local role authenticated;
select public.track_product_event(
  'onboarding.exited',
  '{"prep_step":"scope","modality":"Tui Na","registration":"CNAA 3086"}'::jsonb
);
reset role;

select ok(
  not exists(
    select 1 from public.product_events
    where actor_id = 'c3000000-0000-4000-8000-000000000001'
      and (properties ? 'modality' or properties ? 'registration')
  ),
  'modalidade digitada e registro profissional não atravessam a fronteira'
);

-- As chaves do preparo não vazam para `step`, que continua sendo a jornada da
-- consulta: `scope` lá não significa nada e não pode passar a significar.
set local role authenticated;
select public.track_product_event('consultation.step_jump', '{"step":"scope"}'::jsonb);
reset role;

select ok(
  not exists(
    select 1 from public.product_events
    where actor_id = 'c3000000-0000-4000-8000-000000000001'
      and event_name = 'consultation.step_jump'
      and properties ? 'step'
  ),
  'as chaves do preparo não são aceitas como passo da consulta'
);

select * from finish();
rollback;
