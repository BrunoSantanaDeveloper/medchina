begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ============================================================
-- Migração 0101 — células que dizem "nada aqui".
--
-- O sistema anterior escreve NULL, N/A ou "não informado" onde não havia valor.
-- Guardadas, elas viram afirmação: a ficha passa a dizer NULL onde deveria
-- dizer "não informado" (PRD §10.5). A função espelha a lista do TypeScript
-- (apps/web/src/lib/import/placeholders.ts) e casa o VALOR INTEIRO — conteúdo
-- de verdade nunca é engolido.
-- ============================================================

select ok(public.import_placeholder_cell('NULL'), 'NULL é ausência escrita');
select ok(public.import_placeholder_cell('  n/a  '), 'N/A com espaços é ausência');
select ok(public.import_placeholder_cell('--'), 'só pontuação é ausência');
select ok(public.import_placeholder_cell('Não informado'), 'com acento é ausência');

select ok(not public.import_placeholder_cell('Nenhuma'), 'resposta de verdade não é ausência');
select ok(not public.import_placeholder_cell('N/A de rotina'), 'casa o valor inteiro, nunca um pedaço');
select ok(not public.import_placeholder_cell('0'), 'zero é valor');

-- Célula vazia já é ausência: não há nada escrito para reinterpretar.
select ok(not public.import_placeholder_cell(''), 'vazio não é ausência escrita');

select * from finish();
rollback;
