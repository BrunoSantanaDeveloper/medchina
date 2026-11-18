begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ============================================================
-- Migração 0126 — preço em fases, e a Black Friday que precisa dele.
--
-- O que este teste trava:
--
--  * A escada tem uma forma só, e o banco recusa as outras: um degrau fora
--    de ordem, um ciclo quebrado ou uma lista vazia faria o webhook cobrar
--    o degrau errado.
--  * A assinatura leva uma CÓPIA da escada no instante em que nasce. Mudar o
--    plano depois muda o preço de quem ainda vai comprar, nunca o de quem já
--    comprou — o preço anunciado obriga (CDC art. 30).
--  * O índice do degrau aplicado só sobe e nunca passa do tamanho da escada:
--    ele diz o que a operadora JÁ cobra.
--  * Trocar o plano da assinatura troca o contrato e zera a contagem.
--  * O que foi semeado é o que a dona decidiu: R$ 99 por 3 ciclos, R$ 197 até
--    o 12º, depois o preço de tabela do Pro; janela de 18/11 0h a 27/11 23h59.
-- ============================================================

-- 1-5. A forma da escada.
select ok(public.price_phases_valid(null), 'escada nula vale: preço único');
select ok(
  public.price_phases_valid('[{"after_cycles": 3, "price_cents": 19700}, {"after_cycles": 12, "price_cents": 29900}]'),
  'escada em ordem vale'
);
select ok(
  not public.price_phases_valid('[{"after_cycles": 12, "price_cents": 1}, {"after_cycles": 3, "price_cents": 2}]'),
  'degraus fora de ordem nao valem'
);
select ok(
  not public.price_phases_valid('[{"after_cycles": 3.5, "price_cents": 19700}]'),
  'ciclo quebrado nao vale'
);
select ok(not public.price_phases_valid('[]'), 'lista vazia nao vale: sem escada e nulo, nao vazio');

-- 6. A coluna do plano recusa uma escada malformada.
select throws_ok(
  $$insert into public.plans (slug, name, kind, period, price_cents, is_active, is_public, price_phases)
    values ('teste-escada-ruim', 'Ruim', 'recurring', 'monthly', 100, true, false,
            '[{"after_cycles": 0, "price_cents": 1}]')$$,
  '23514',
  null,
  'o plano recusa uma escada malformada'
);

-- Catálogo e consultório próprios do teste.
insert into public.plans (id, slug, name, kind, period, price_cents, is_active, is_public, price_phases)
values
  ('e1000000-0000-4000-8000-000000000001', 'teste-fases', 'Fases', 'recurring', 'monthly', 9900, true, false,
   '[{"after_cycles": 3, "price_cents": 19700}, {"after_cycles": 12, "price_cents": 29900}]'),
  ('e1000000-0000-4000-8000-000000000002', 'teste-unico', 'Único', 'recurring', 'monthly', 19900, true, false, null);

insert into public.organizations (id, name, slug)
values ('e1100000-0000-4000-8000-000000000001', 'Consultório das Fases', 'fases-e1');

insert into public.subscriptions (id, org_id, plan_id, status, period, provider)
values ('e1200000-0000-4000-8000-000000000001', 'e1100000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000001', 'incomplete', 'monthly', 'asaas');

-- 7. A assinatura nasce com a cópia da escada e no degrau zero.
select is(
  (select price_phases from public.subscriptions where id = 'e1200000-0000-4000-8000-000000000001'),
  '[{"after_cycles": 3, "price_cents": 19700}, {"after_cycles": 12, "price_cents": 29900}]'::jsonb,
  'a assinatura copia a escada do plano ao nascer'
);
select is(
  (select price_phase_index from public.subscriptions where id = 'e1200000-0000-4000-8000-000000000001'),
  0,
  'a assinatura nasce no preco base'
);

-- 8. Mudar o plano depois não toca o contrato de quem já comprou.
update public.plans
   set price_phases = '[{"after_cycles": 1, "price_cents": 50000}]'
 where id = 'e1000000-0000-4000-8000-000000000001';

select is(
  (select price_phases -> 0 ->> 'price_cents' from public.subscriptions where id = 'e1200000-0000-4000-8000-000000000001'),
  '19700',
  'editar o plano nao muda a escada de quem ja assinou'
);

-- 9. O degrau sobe.
update public.subscriptions set price_phase_index = 1 where id = 'e1200000-0000-4000-8000-000000000001';
select is(
  (select price_phase_index from public.subscriptions where id = 'e1200000-0000-4000-8000-000000000001'),
  1,
  'o webhook pode subir o degrau'
);

-- 10. E nunca desce.
select throws_ok(
  $$update public.subscriptions set price_phase_index = 0 where id = 'e1200000-0000-4000-8000-000000000001'$$,
  '23514',
  'price_phase_index_never_decreases',
  'o degrau aplicado nunca desce'
);

-- 11. Nem passa do tamanho da escada.
select throws_ok(
  $$update public.subscriptions set price_phase_index = 3 where id = 'e1200000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'o degrau nao passa do tamanho da escada'
);

-- 12. Trocar o plano troca o contrato e zera a contagem.
update public.subscriptions
   set plan_id = 'e1000000-0000-4000-8000-000000000002'
 where id = 'e1200000-0000-4000-8000-000000000001';

select ok(
  (select price_phases is null and price_phase_index = 0
     from public.subscriptions where id = 'e1200000-0000-4000-8000-000000000001'),
  'trocar o plano troca a escada e zera o degrau'
);

-- 13-14. O plano da Black, como a dona decidiu.
select is(
  (select price_cents from public.plans where slug = 'pro-black'),
  9900,
  'pro-black custa R$ 99 nos primeiros ciclos'
);
select is(
  (select price_phases from public.plans where slug = 'pro-black'),
  jsonb_build_array(
    jsonb_build_object('after_cycles', 3, 'price_cents', 19700),
    jsonb_build_object('after_cycles', 12, 'price_cents', (select price_cents from public.plans where slug = 'pro'))
  ),
  'pro-black: R$ 197 do 4o ao 12o, depois o preco de tabela do Pro'
);

-- 15-16. A janela da Black.
select is(
  (select (value ->> 'starts_at')::timestamptz from public.platform_settings where key = 'promotion'),
  '2026-11-18T00:00:00-03:00'::timestamptz,
  'a Black abre em 18/11 a 0h de Brasilia'
);
select is(
  (select (value ->> 'ends_at')::timestamptz from public.platform_settings where key = 'promotion'),
  '2026-11-27T23:59:59-03:00'::timestamptz,
  'a Black fecha em 27/11 as 23h59 de Brasilia'
);

select * from finish();
rollback;
