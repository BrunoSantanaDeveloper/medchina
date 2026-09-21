-- ---------------------------------------------------------------------------
-- 0107 — Cadastro da campanha paga: garantia, plano anual e a oferta
-- ---------------------------------------------------------------------------
-- As pendências de DADO que a entrega de 2026-09-17 deixou para o operador
-- (docs/FUNIL.md, "Pendências do operador"). Elas viram migração porque
-- nenhuma delas deveria ser digitada à mão:
--
--   1. `guarantee` não tem console NENHUM — `lib/guarantee.ts` diz isso em
--      letras maiúsculas: "Deliberately has no admin console: extending a legal
--      commitment should be a deliberate act". Um compromisso legal que só
--      existe como SQL avulso é um compromisso que ninguém consegue auditar.
--      Enquanto a chave não existe, TODA página anuncia o piso do CDC (7 dias)
--      em vez dos 30 combinados.
--
--   2. A linha de plano que a campanha vende carrega um JSON de `limits` que
--      precisa bater com o Pro E com o período. Digitar isso à mão já custou
--      caro uma vez: `pro-fundador` nasceu com `audio_minutes: 6000` num plano
--      ANUAL, ou seja um doze avos da franquia anunciada, porque a cota vale
--      por CICLO DE COBRANÇA (migração 0024/0069). Aqui nada é digitado: preço
--      e limites são DERIVADOS da linha `pro` mensal pela mesma aritmética que
--      a decisão D1 registra.
--
--   3. Os slugs da oferta (`plan_slug`, `compare_plan_slug`) precisam casar
--      exatamente com o catálogo, e um slug errado não dá erro em lugar
--      nenhum: a página simplesmente para de mostrar o preço riscado, calada.
--
-- ---------------------------------------------------------------------------
-- DE ONDE VEM CADA NÚMERO (nenhum foi inventado aqui)
-- ---------------------------------------------------------------------------
-- docs/FUNIL.md §0 é explícito: "Estes valores são entradas de configuração. A
-- IA de desenvolvimento não deve inventá-los — deve implementá-los como
-- parâmetros configuráveis e solicitar os valores." Então esta migração só
-- escreve valor já decidido, e diz de onde veio:
--
--   Garantia = 30 dias
--     Decisão sua, registrada como pendência do operador em docs/FUNIL.md
--     ("platform_settings.guarantee = {"days": 30}").
--
--   Plano da campanha = Pro anual, R$ 2.990,00
--     Decisão D1 de docs/FUNIL.md, ratificada em 2026-08-10: "anual = 10× o
--     mensal (2 meses grátis). Assistente R$1.990/ano, Pro R$2.990/ano". Ela
--     nunca foi semeada — o próprio doc registra a lacuna ("nenhuma linha de
--     plano anual seedada; 0024 só cria monthly"). O preço não é escrito como
--     literal: é `pro.price_cents * 10`, para a linha e a decisão não
--     divergirem, e para o "2 meses grátis" ficar visível no próprio SQL.
--
--   Âncora = Pro mensal, R$ 299,00
--     A página anualiza uma âncora mensal e DIZ que fez isso ("12 × R$ 299 por
--     mês"), então o "de/por" é R$ 3.588 → R$ 2.990: 17% de economia, e os dois
--     preços são reais. Nenhum valor anual que ninguém pagou.
--
-- O que isso deixa em pé, e é bom que deixe: a condição de fundadora
-- (R$ 1.990/ano) continua sendo a melhor da casa. Tráfego frio comprando mais
-- barato que a condição limitada vendida pela reputação da fundadora dentro da
-- comunidade seria exatamente o estrago que "Nada de escassez falsa" evita.
--
-- SE VOCÊ QUISER UM PREÇO DE CAMPANHA MAIS AGRESSIVO que o anual de tabela,
-- não mexa nesta linha: crie outra linha oculta em /admin/billing → Planos e
-- troque `plan_slug` na aba Offers. São dois campos, e o preço de tabela anual
-- continua íntegro para quando você publicar o anual em /planos. Lembre que o
-- billing NÃO sabe subir o valor na renovação (não existe troca de plano
-- agendada — docs/BILLING-AUDIT.md A1): o preço que você escolher é o preço
-- dela enquanto ela ficar, não uma promoção de primeiro ciclo.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRAÇÃO NÃO FAZ, de propósito
-- ---------------------------------------------------------------------------
--   Não abre a campanha. `campaign_offer.enabled` entra como `false`, pelo
--   mesmo motivo que a 0087 escreveu para a oferta de fundadoras: "the offer
--   opening is an operator decision with a date, not a side effect of running a
--   migration". Um prazo também não pode ser fixado aqui — `resolveCampaignOffer`
--   compara com `now()`, então uma data escrita hoje nasce vencida se a
--   aplicação atrasar um dia. Depois desta migração, abrir a campanha é marcar
--   UMA caixa em /admin/billing → Offers.
--
--   Não publica o anual em /planos. A linha entra `is_public = false`: vendável
--   por link direto, invisível no catálogo e na grade de quem já assina. Quem
--   paga R$ 299/mês não descobre um anual mais barato por acidente, e o site
--   público não muda. Publicar o anual é outra decisão, de um clique.
--
--   Não muda o ESTADO da oferta `founders`. Ela está `enabled` com prazo
--   vencido em 11/09, o que já fecha a página corretamente ("O prazo desta
--   condição terminou"). Reabrir, estender ou desligar é decisão comercial,
--   não cadastro. O que a migração faz é só semear a LINHA DE PLANO que essa
--   oferta aponta e que nunca existiu em migração nenhuma (item 4).
--
-- ---------------------------------------------------------------------------
-- UMA CONSEQUÊNCIA CONTRAINTUITIVA DE `enabled: false`, para ninguém tropeçar
-- ---------------------------------------------------------------------------
-- `offerBlock` (settings/billing/actions.ts) recusa o checkout de QUALQUER
-- plano nomeado por uma oferta FECHADA. Então, enquanto a caixa estiver
-- desmarcada, `pro-anual` não é comprável nem por link direto — o checkout
-- devolve `offer_closed`. É o estado certo para uma campanha que ainda não
-- abriu, e some no instante em que você marca a caixa.
--
-- Mas guarde isto para depois: se um dia você PUBLICAR o anual em /planos
-- (`is_public = true`) sem abrir a campanha, todo mundo que clicar vai bater
-- em "esta condição não está mais disponível". Publicar o anual como plano de
-- catálogo exige tirar o slug de `campaign_offer.plan_slug` (ou apontar a
-- campanha para outra linha) no mesmo movimento.
-- ---------------------------------------------------------------------------

-- ---------- 1. A garantia anunciada ----------
-- 30 dias, acima do piso legal de 7 (CDC art. 49) que `lib/guarantee.ts`
-- aplica quando esta chave não existe. A página da garantia, as duas páginas
-- de oferta, a FAQ e o futuro `refund_eligible_until` leem daqui — um número
-- só, para a promessa e a contagem nunca divergirem.
insert into public.platform_settings (key, value)
values ('guarantee', jsonb_build_object('days', 30))
on conflict (key) do nothing;

-- ---------- 2. A linha anual que a campanha vende ----------
-- Preço promocional em LINHA PRÓPRIA, nunca em cupom: nos dois provedores o
-- desconto de cupom incide em TODOS os ciclos (Stripe `duration: forever`,
-- Asaas grava o valor já com desconto), então "um ciclo mais barato" viraria
-- preço menor para sempre de um jeito que não aparece no catálogo. Numa linha
-- de plano o valor está à vista, e `compare_plan_slug` aponta para a tabela.
--
-- Tudo é derivado da linha `pro` mensal:
--   price_cents  = 10 × o mensal  (D1: "anual = 10× o mensal, 2 meses grátis")
--   audio_minutes = 12 × o mensal (a cota vale por CICLO, e o ciclo agora é um
--                   ano — é literalmente o defeito que a `pro-fundador`
--                   carregou até ser corrigida para 72.000)
--   o resto dos limites e a descrição vêm do Pro sem tradução
-- Se a linha `pro` não existir, o SELECT não devolve nada e nada é inserido —
-- sem plano órfão com preço zero.
insert into public.plans (
  slug, name, description, kind, period, price_cents, currency,
  is_free, is_addon, is_public, is_active, limits, sort
)
select
  'pro-anual',
  -- O nome aparece no CTA da landing ("Assinar o Pro anual") e no título dos
  -- inclusos ("Tudo o que o Pro anual tem, pelo preço desta condição"), então
  -- ele é o nome do produto para quem compra. Quem administra distingue pelo
  -- slug, que a grade do console mostra embaixo do nome.
  'Pro anual',
  pro.description,
  'recurring',
  'yearly',
  pro.price_cents * 10,
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
  -- Logo depois do Pro mensal, para a lista do console seguir o catálogo.
  3
from public.plans pro
where pro.slug = 'pro'
on conflict (slug) do nothing;

-- ---------- 3. A oferta, cadastrada e fechada ----------
-- Os dois slugs preenchidos e conferidos; falta só a decisão de abrir.
-- `deadline` nulo: sem prazo a página não imprime a linha de prazo e o
-- checkout não recusa nada, o que é o estado correto para uma campanha que
-- ainda não começou. Com um prazo escrito aqui, a página anunciaria o fim de
-- uma campanha que nunca abriu.
insert into public.platform_settings (key, value)
values (
  'campaign_offer',
  jsonb_build_object(
    'enabled', false,
    'plan_slug', 'pro-anual',
    'compare_plan_slug', 'pro',
    'deadline', null
  )
)
on conflict (key) do nothing;

-- ---------- 4. Paridade do catálogo: a linha de fundadora ----------
-- `pro-fundador` existe em PRODUÇÃO e em lugar nenhum do código: foi digitada
-- à mão no console em agosto, e nenhuma migração a cria. Consequências reais:
-- um ambiente novo (local, CI, um restore) sobe sem ela, `platform_settings`
-- 'founders' aponta para um slug que não existe, e a página de fundadoras cai
-- no estado `not_configured` sem que ninguém entenda por quê.
--
-- Em produção este INSERT é um no-op (o slug já está lá, `on conflict do
-- nothing` protege o preço e a franquia que você já ajustou). Em ambiente
-- novo, ele reconstrói a linha com os valores da decisão D2 — Pro pelo preço
-- do Assistente anual, R$ 1.990/ano — e com a franquia ANUAL correta, que é a
-- correção que a linha de produção já recebeu (72.000, não 6.000).
--
-- A reconstrução não é byte a byte igual à linha digitada à mão: ela herda os
-- limites do Pro inteiro (inclusive `mcp_access`) e a descrição do Pro, que a
-- linha de produção não tem. Em produção isso é irrelevante (a linha existente
-- vence); num ambiente novo é a versão mais correta das duas.
insert into public.plans (
  slug, name, description, kind, period, price_cents, currency,
  is_free, is_addon, is_public, is_active, limits, sort
)
select
  'pro-fundador',
  'PRO FUNDADOR',
  pro.description,
  'recurring',
  'yearly',
  -- D2: "acesso Pro pelo preço do Assistente anual". Derivado da linha do
  -- Assistente pela mesma regra da D1 (anual = 10× o mensal), para o preço da
  -- condição não precisar ser redigitado nem envelhecer sozinho.
  assistente.price_cents * 10,
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
  -- Depois do `pro-anual` (3) e antes da faixa 10-12 que a 0055 reservou para
  -- os pacotes avulsos. NÃO zero: `gratuito` já usa 0 (0024), e `sort` não tem
  -- critério de desempate — em ambiente novo o console listaria a linha oculta
  -- de fundadora acima ou abaixo do Gratuito conforme o humor do planner.
  4
from public.plans pro
join public.plans assistente on assistente.slug = 'assistente'
where pro.slug = 'pro'
on conflict (slug) do nothing;

-- ---------- 5. As duas invariantes que ninguém vê quebrar ----------
-- Nenhuma das duas derruba a página: ela carrega, o botão funciona, e a oferta
-- só fica pior do que foi anunciada. São os defeitos mais caros possíveis numa
-- landing cuja tese é o desconto, e os mais difíceis de notar — por isso a
-- migração se recusa a aplicar em vez de entregar uma página muda.
--
--   a) preço da campanha >= âncora anualizada: `savings` fica nulo em
--      app/(funil)/assinar/page.tsx e o preço riscado some.
--   b) franquia anual abaixo de 12× a mensal: a página promete N minutos "por
--      ano" e entrega uma fração do que o Pro mensal dá — o alerta que o
--      console de ofertas mostra, aqui como trava.
--
-- Em aplicação limpa nenhuma dispara: as linhas acima nascem corretas. Elas só
-- acordam se a linha já existisse com outros valores.
do $$
declare
  offer public.plans%rowtype;
  anchor public.plans%rowtype;
  anchor_cents integer;
  offer_minutes integer;
  anchor_minutes integer;
begin
  select * into offer from public.plans where slug = 'pro-anual';
  select * into anchor from public.plans where slug = 'pro';
  if offer.id is null or anchor.id is null then
    return;
  end if;

  -- Mesma normalização da página: âncora mensal contra oferta anual vira 12×.
  anchor_cents := case
    when anchor.period = 'monthly' and offer.period = 'yearly' then anchor.price_cents * 12
    when anchor.period = offer.period then anchor.price_cents
    else 0
  end;

  if anchor_cents <= offer.price_cents then
    raise exception using
      message = format(
        'pro-anual custa %s e a ancora normalizada vale %s: /assinar nao mostraria preco riscado.',
        offer.price_cents, anchor_cents
      ),
      hint = 'Baixe price_cents de pro-anual, ou aponte compare_plan_slug (platform_settings.campaign_offer) para um plano de tabela mais caro.';
  end if;

  offer_minutes := coalesce((offer.limits ->> 'audio_minutes')::integer, 0);
  anchor_minutes := coalesce((anchor.limits ->> 'audio_minutes')::integer, 0);
  if offer.period = 'yearly' and anchor_minutes > 0 and offer_minutes < anchor_minutes * 12 then
    raise exception using
      message = format(
        'pro-anual da %s min por ANO e o pro mensal da %s por mes (%s por ano): a franquia anunciada seria menor que a do plano de tabela.',
        offer_minutes, anchor_minutes, anchor_minutes * 12
      ),
      hint = 'A cota de audio vale por ciclo de cobranca (0024/0069). Ajuste limits.audio_minutes de pro-anual para 12x o valor mensal.';
  end if;
end;
$$;

comment on table public.platform_settings is
  'Configuração de plataforma editada pelo superadmin, legível por anon por design — nunca segredos. As chaves de oferta (''guarantee'', ''campaign_offer'', ''founders'') são promessas comerciais públicas: a página e a trava do checkout leem a MESMA linha, para o que é anunciado e o que é recusado não poderem divergir.';
