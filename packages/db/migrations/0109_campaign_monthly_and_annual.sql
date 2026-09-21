-- ---------------------------------------------------------------------------
-- 0109 — A campanha passa a vender mensal E anual
-- ---------------------------------------------------------------------------
-- A 0107 criou uma linha anual de R$ 2.990 e a campanha subiu vendendo só ela.
-- Duas razões para acrescentar o mensal, e a segunda é a que decide:
--
--   1. Ticket. R$ 2.990 à vista, vindo de anúncio, de alguém que nunca ouviu
--      falar da plataforma, com 30 dias de garantia em cima. É a combinação de
--      maior atrito e maior exposição a reembolso que a oferta podia ter.
--
--   2. Fase de aprendizado da Meta. Um conjunto de anúncios precisa de cerca
--      de 50 eventos de otimização por semana para sair do aprendizado. A
--      R$ 2.990 por compra, o orçamento compra pouquíssimos eventos e a
--      campanha pode nunca sair — o algoritmo nunca encontra quem compra.
--      Num ticket mensal o mesmo orçamento produz várias vezes mais eventos.
--      Não é preferência de preço, é o que torna a otimização possível.
--
-- O anual continua na página, ao lado do mensal, porque quem já quer anual
-- converte melhor vendo os dois meses grátis do que sendo empurrado para o
-- mensal. Quem decide é a visitante, e o mensal é o padrão.
--
-- ---------------------------------------------------------------------------
-- DE ONDE VEM CADA NÚMERO
-- ---------------------------------------------------------------------------
--   Mensal da campanha ... R$ 229,00
--     O ÚNICO número escolhido aqui. Decisão sua, confirmada ao escolher o
--     modelo de preço. Ele vive dentro de duas fronteiras duras:
--
--       TETO   abaixo de R$ 299,00 (o Pro de tabela), senão `savings` é nulo
--              em app/(funil)/assinar/page.tsx e o preço riscado some sem
--              aviso — e o riscado é a tese da página inteira.
--       PISO   acima de R$ 165,83/mês, o efetivo mensal da condição de
--              fundadora (R$ 1.990/ano). Tráfego frio comprando mais barato
--              que a condição limitada vendida pela reputação da fundadora
--              dentro da comunidade é o estrago que "Nada de escassez falsa"
--              existe para evitar.
--
--     Para mudar: edite `22900` abaixo antes de aplicar, ou ajuste o preço
--     em /admin/billing → Planos depois, que é um campo só. O anual segue
--     junto por aritmética, não por digitação.
--
--   Anual da campanha .... 10 × o mensal (R$ 2.290,00)
--     Decisão D1 de docs/FUNIL.md: "anual = 10× o mensal (2 meses grátis)".
--     Derivado da linha mensal criada logo acima, na mesma transação.
--
--   Âncora ............... Pro mensal, R$ 299,00, para os dois
--     O mensal compara direto (23% de economia). O anual compara contra doze
--     mensalidades e a página DIZ que fez isso ("12 × R$ 299 por mês"),
--     chegando a R$ 3.588 → R$ 2.290, 36% de economia. Os dois preços são
--     reais; nenhum valor anual que ninguém pagou.
--
-- E o aviso que vale para qualquer valor escolhido: o billing NÃO sabe subir
-- o preço na renovação (não existe troca de plano agendada — BILLING-AUDIT
-- A1). Quem entrar por estas linhas renova nelas. O desconto vale enquanto a
-- assinatura viver, que é exatamente a promessa "enquanto você ficar" — e não
-- é uma promoção de primeiro ciclo, que o sistema não saberia encerrar.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECE COM `pro-anual` (R$ 2.990)
-- ---------------------------------------------------------------------------
-- Fica. Ele é o preço de TABELA anual da decisão D1, e é o que deve aparecer
-- em /planos no dia em que o anual for publicado. Misturar preço de tabela com
-- preço de campanha numa linha só destrói a distinção de que todo o mecanismo
-- do "de/por" depende. Verificado antes de decidir: zero assinaturas nessa
-- linha, então nada é alterado para ninguém.
-- ---------------------------------------------------------------------------

-- ---------- 1. O mensal da campanha ----------
-- Limites e descrição copiados do Pro: é o Pro, por construção. Mesmo período
-- (mensal), então a cota de áudio vai sem multiplicador — e é justamente por
-- ser mensal que a cópia direta está certa aqui.
insert into public.plans (
  slug, name, description, kind, period, price_cents, currency,
  is_free, is_addon, is_public, is_active, limits, sort
)
select
  'pro-campanha',
  -- O nome aparece no CTA ("Assinar o Pro") e no bloco de inclusos ("Tudo o
  -- que o Pro tem"), então é o nome do produto, não o da campanha. Quem
  -- administra distingue pelo slug, que a grade do console mostra sob o nome.
  'Pro',
  pro.description,
  'recurring',
  'monthly',
  22900,
  pro.currency,
  false,
  false,
  false,
  true,
  pro.limits,
  5
from public.plans pro
where pro.slug = 'pro'
on conflict (slug) do nothing;

-- ---------- 2. O anual da campanha ----------
-- Preço derivado do mensal recém-criado (D1: 10×), e franquia de áudio 12× —
-- a cota vale por CICLO DE COBRANÇA (0024/0069) e o ciclo aqui é um ano. É
-- literalmente o defeito que a `pro-fundador` carregou até ser corrigida.
insert into public.plans (
  slug, name, description, kind, period, price_cents, currency,
  is_free, is_addon, is_public, is_active, limits, sort
)
select
  'pro-campanha-anual',
  'Pro anual',
  pro.description,
  'recurring',
  'yearly',
  mensal.price_cents * 10,
  pro.currency,
  false,
  false,
  false,
  true,
  jsonb_set(
    pro.limits,
    '{audio_minutes}',
    to_jsonb(coalesce((pro.limits ->> 'audio_minutes')::integer, 0) * 12)
  ),
  6
from public.plans pro
join public.plans mensal on mensal.slug = 'pro-campanha'
where pro.slug = 'pro'
on conflict (slug) do nothing;

-- ---------- 3. Apontar a campanha para as duas linhas ----------
-- `annual_plan_slug` é uma chave NOVA e OPCIONAL ao lado da que já existe:
-- todo leitor que só conhece `plan_slug` continua funcionando quando ela está
-- ausente, e é por isso que a forma foi escolhida assim em vez de trocar
-- `plan_slug` por uma lista.
--
-- O update é CONDICIONAL de propósito. A campanha está no ar e a linha foi
-- editada por quem opera: `enabled` e `deadline` são decisões deles e ficam
-- intactas (`value || …` funde, não substitui). A condição
-- `plan_slug = 'pro-anual'` significa "só mexa se ninguém tiver mudado o plano
-- desde a 0107" — se alguém já apontou a campanha para outro lugar, essa
-- escolha vence e esta migração não tem opinião sobre ela.
--
-- A casa não faz `on conflict do update` em nenhum seed, e isto não é um seed:
-- é a migração de forma que acompanha a mudança de código que passa a ler duas
-- linhas. Sem ela, a página nova subiria sem o mensal que ela existe para
-- vender.
update public.platform_settings
set value = value || jsonb_build_object(
      'plan_slug', 'pro-campanha',
      'annual_plan_slug', 'pro-campanha-anual'
    )
where key = 'campaign_offer'
  and value ->> 'plan_slug' = 'pro-anual';

-- ---------- 4. As invariantes que ninguém vê quebrar ----------
-- As duas falhas abaixo não derrubam nada: a página carrega, os botões
-- funcionam, e a oferta só fica pior do que foi anunciada. São as mais caras e
-- as mais difíceis de notar, por isso a migração se recusa a aplicar.
do $$
declare
  anchor public.plans%rowtype;
  mensal public.plans%rowtype;
  anual public.plans%rowtype;
  anual_anchor integer;
  founder_monthly numeric;
begin
  select * into anchor from public.plans where slug = 'pro';
  select * into mensal from public.plans where slug = 'pro-campanha';
  select * into anual from public.plans where slug = 'pro-campanha-anual';
  if anchor.id is null or mensal.id is null or anual.id is null then
    return;
  end if;

  -- (a) Sem riscado não há oferta: o mensal contra o mensal, o anual contra
  --     doze mensalidades, exatamente como a página normaliza.
  if mensal.price_cents >= anchor.price_cents then
    raise exception using
      message = format('pro-campanha custa %s e a ancora pro custa %s: /assinar nao mostraria preco riscado no mensal.',
        mensal.price_cents, anchor.price_cents),
      hint = 'Baixe price_cents de pro-campanha para abaixo do pro.';
  end if;

  anual_anchor := anchor.price_cents * 12;
  if anual.price_cents >= anual_anchor then
    raise exception using
      message = format('pro-campanha-anual custa %s e doze mensalidades do pro valem %s: o anual nao mostraria economia.',
        anual.price_cents, anual_anchor),
      hint = 'Baixe price_cents de pro-campanha-anual para abaixo de 12x o pro mensal.';
  end if;

  -- (b) O anual precisa ser melhor que pagar mensal doze vezes NA PROPRIA
  --     campanha. Um anual mais caro que 12x o mensal da campanha seria uma
  --     escolha que ninguem deveria fazer, oferecida lado a lado com ela.
  if anual.price_cents >= mensal.price_cents * 12 then
    raise exception using
      message = format('pro-campanha-anual custa %s e doze meses do mensal da campanha custam %s: o anual seria o pior negocio da pagina.',
        anual.price_cents, mensal.price_cents * 12),
      hint = 'D1 manda anual = 10x o mensal. Ajuste price_cents de pro-campanha-anual.';
  end if;

  -- (c) A cota anual precisa valer 12x a mensal: a cota vive num ciclo de
  --     cobranca, e um ano e um ciclo so.
  if coalesce((anual.limits ->> 'audio_minutes')::integer, 0)
     < coalesce((mensal.limits ->> 'audio_minutes')::integer, 0) * 12 then
    raise exception using
      message = 'pro-campanha-anual entregaria menos audio por ANO do que o mensal da campanha entrega em doze meses.',
      hint = 'A cota de audio vale por ciclo de cobranca (0024/0069). Use 12x o valor mensal em limits.audio_minutes.';
  end if;

  -- (d) A condicao de fundadora precisa continuar sendo a melhor da casa.
  --     Ela foi vendida como limitada, pela reputacao da fundadora dentro da
  --     comunidade; trafego frio comprando mais barato quebra essa promessa.
  select price_cents / 12.0 into founder_monthly from public.plans where slug = 'pro-fundador';
  if founder_monthly is not null and mensal.price_cents <= founder_monthly then
    raise exception using
      message = format('pro-campanha custa %s por mes e a condicao de fundadora sai por %s por mes: trafego frio compraria mais barato que a oferta limitada.',
        mensal.price_cents, round(founder_monthly)),
      hint = 'Suba price_cents de pro-campanha acima do efetivo mensal da linha pro-fundador.';
  end if;
end;
$$;
