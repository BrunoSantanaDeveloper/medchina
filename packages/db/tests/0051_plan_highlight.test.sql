begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ============================================================
-- Migração 0124 — o destaque da tabela de preços é uma escolha.
--
-- Antes, o card âncora era aritmética: o plano de índice 1 (o do meio, entre
-- três, ordenados por `sort`). Promover um plano exigia reordenar a grade
-- inteira, "nenhum destaque" era inexprimível, e publicar ou despublicar um
-- plano movia a ênfase sozinho.
--
-- Três coisas que este teste existe para travar:
--
--  * O destaque é ÚNICO e o banco garante — não o console. Dois cards âncora
--    não é defeito cosmético: a grade para de responder "qual eu compro?", e
--    um seed ou um acerto por psql não conhece a regra da tela.
--  * Marcar um plano DESMARCA o anterior sozinho. Se exigisse dois passos,
--    existiria uma janela com dois destaques publicados.
--  * "Nenhum destaque" continua sendo um estado válido — é o que uma campanha
--    de comparação escolhe de propósito, e é por isso que plans.ts não tem
--    fallback posicional nenhum.
-- ============================================================

-- Catálogo próprio do teste: nada aqui depende dos planos semeados, para que
-- mudar o catálogo comercial não quebre a invariante que está sendo medida.
insert into public.plans (id, slug, name, kind, period, price_cents, is_active, is_public, sort)
values
  ('d1000000-0000-4000-8000-000000000001', 'teste-base', 'Base', 'recurring', 'monthly', 0, true, true, 10),
  ('d1000000-0000-4000-8000-000000000002', 'teste-meio', 'Meio', 'recurring', 'monthly', 19900, true, true, 20),
  ('d1000000-0000-4000-8000-000000000003', 'teste-topo', 'Topo', 'recurring', 'monthly', 29900, true, true, 30);

-- 1. A coluna nasce desligada: um plano novo não vira âncora por acidente.
select is(
  (select count(*)::int from public.plans where id in (
     'd1000000-0000-4000-8000-000000000001',
     'd1000000-0000-4000-8000-000000000002',
     'd1000000-0000-4000-8000-000000000003'
   ) and is_highlighted),
  0,
  'plano recem-criado nao nasce em destaque'
);

-- 2. Marcar um plano o coloca em destaque.
update public.plans set is_highlighted = true where slug = 'teste-meio';

select ok(
  (select is_highlighted from public.plans where slug = 'teste-meio'),
  'marcar o plano o coloca em destaque'
);

-- 3. Marcar OUTRO tira o destaque do anterior, sem ninguem desmarcar nada.
update public.plans set is_highlighted = true where slug = 'teste-topo';

select ok(
  not (select is_highlighted from public.plans where slug = 'teste-meio'),
  'marcar outro plano tira o destaque do anterior'
);

-- 4. E o destaque continua unico no catalogo INTEIRO — inclusive contra os
--    planos semeados, que e onde um seed descuidado criaria o segundo.
select is(
  (select count(*)::int from public.plans where is_highlighted),
  1,
  'no maximo um plano em destaque na tabela inteira'
);

-- 5. Inserir ja marcado tambem respeita a regra (o gatilho cobre INSERT).
insert into public.plans (id, slug, name, kind, period, price_cents, is_active, is_public, sort, is_highlighted)
values ('d1000000-0000-4000-8000-000000000004', 'teste-novo', 'Novo', 'recurring', 'monthly', 39900, true, true, 40, true);

select is(
  (select slug from public.plans where is_highlighted),
  'teste-novo',
  'inserir um plano ja marcado transfere o destaque para ele'
);

-- 6. Editar qualquer outra coisa de um plano nao rouba o destaque de quem tem.
update public.plans set price_cents = 24900 where slug = 'teste-meio';

select is(
  (select slug from public.plans where is_highlighted),
  'teste-novo',
  'editar outro campo de outro plano nao mexe no destaque'
);

-- 7. Desmarcar deixa a grade SEM ancora — estado valido, nao um buraco a
--    preencher com regra posicional.
update public.plans set is_highlighted = false where slug = 'teste-novo';

select is(
  (select count(*)::int from public.plans where is_highlighted),
  0,
  'nenhum plano em destaque e um estado valido'
);

select * from finish();
rollback;
