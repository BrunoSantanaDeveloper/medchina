-- ---------------------------------------------------------------------------
-- 0126 — Preço em fases, e a Black Friday 2026 que precisa dele
-- ---------------------------------------------------------------------------
-- A oferta da Black Friday, decidida pela dona do produto (outubro, ratificada
-- em 2026-11-17): o Pro a R$ 99 por mês nos 3 primeiros meses, R$ 197 por mês
-- do 4º ao 12º e, a partir do 13º, o preço de tabela do Pro (hoje R$ 299).
--
-- O billing não sabia fazer isso. Os comentários da 0107 e da 0109 avisam com
-- todas as letras: o cupom incide em TODOS os ciclos (Stripe `forever`, Asaas
-- grava o valor já com desconto) e não existe troca de preço agendada
-- (BILLING-AUDIT A1). Vender "R$ 99 nos 3 primeiros meses" com o que existia
-- daria uma de duas coisas: R$ 99 para sempre, ou R$ 197 desde o primeiro mês,
-- que é a página prometendo um preço que a cobrança não cumpre (CDC art. 30).
--
-- O QUE ESTA MIGRAÇÃO CRIA
-- ------------------------
--   1. `plans.price_phases`: a escada de preço de um plano. `price_cents`
--      continua sendo o preço do PRIMEIRO ciclo (é o que o checkout cobra e o
--      que toda tela já lê); cada degrau diz "depois de N ciclos pagos, passa a
--      custar X". Nulo = preço único, como sempre foi.
--
--   2. `subscriptions.price_phases`: a MESMA escada, copiada no instante em que
--      a assinatura nasce. É o contrato dela. Um superadmin que mude o plano
--      amanhã muda o preço de quem ainda vai comprar, nunca o de quem já
--      comprou: o preço anunciado obriga (CDC art. 30) e entra no contrato.
--
--   3. `subscriptions.price_phase_index`: quantos degraus já foram aplicados na
--      operadora. Só sobe. Quem sobe é o webhook de pagamento (apps/web,
--      `api/webhooks/[provider]`): a cada fatura paga ele conta as faturas pagas
--      daquela assinatura e, quando a conta alcança um degrau, pede à operadora
--      o valor novo (Asaas: PUT /subscriptions/{id} com `updatePendingPayments`)
--      e só então grava o índice. Se a operadora recusar, o índice fica onde
--      está e a próxima fatura paga tenta de novo; a equipe é avisada.
--
--   4. O plano `pro-black` e a chave `promotion` em `platform_settings`, com as
--      datas da Black.
--
-- DE ONDE VEM CADA NÚMERO (docs/FUNIL.md §0: a IA não inventa valor comercial)
-- ----------------------------------------------------------------------------
--   R$ 99,00 (ciclos 1 a 3) e R$ 197,00 (ciclos 4 a 12)
--     Decisão da dona do produto, a oferta "combinada em outubro", confirmada
--     por escrito em 2026-11-17. Escritos como literais porque são o preço da
--     promoção, não uma conta sobre outro preço.
--
--   A partir do ciclo 13: o preço de tabela do Pro
--     Decisão da dona em 2026-11-17 ("volta a R$ 299/mês"). Escrito como
--     `pro.price_cents`, não como literal: "volta ao preço de tabela" é a
--     promessa, e a linha `pro` é a tabela.
--
--   Início 18/11/2026 às 0h, fim 27/11/2026 às 23h59 (horário de Brasília)
--     "Início amanhã, 18/11, até a data da Black Friday" — a Black Friday de
--     2026 é sexta-feira, 27/11. O fim às 23h59 do dia é a leitura literal de
--     "até a data", confirmada com a dona ao planejar.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ, de propósito
-- -----------------------------------------
--   Não publica o `pro-black` no catálogo (`is_public = false`): ele só se vende
--   pelo link da campanha, e o checkout recusa o slug fora da janela da
--   promoção (`offerBlock`), igual à campanha de outubro.
--
--   Não mexe na `campaign_offer` (o Pro a R$ 197 da /assinar). As duas
--   convivem: a Black tem página própria, /black-friday, e quando ela termina
--   a /assinar continua exatamente como estava.
--
--   Não dá desconto por cupom. Um cupom gravaria o valor com desconto na
--   assinatura do Asaas e o primeiro degrau o apagaria em silêncio; o checkout
--   recusa a combinação de cupom com plano em fases.
-- ---------------------------------------------------------------------------

-- ---------- 1. A forma de uma escada válida ----------
-- Uma lista de degraus em ordem, cada um com o número de ciclos pagos a partir
-- do qual vale e o preço em centavos. A ordem é exigida, não reconstruída:
-- quem lê a escada (o webhook, as páginas) pode confiar que o último degrau
-- alcançado é o último da lista com `after_cycles <= pagos`.
create or replace function public.price_phases_valid(phases jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  step jsonb;
  previous integer := 0;
  cycles integer;
  cents integer;
begin
  if phases is null then
    return true;
  end if;
  if jsonb_typeof(phases) <> 'array' or jsonb_array_length(phases) = 0 or jsonb_array_length(phases) > 12 then
    return false;
  end if;
  for step in select value from jsonb_array_elements(phases)
  loop
    if jsonb_typeof(step) <> 'object'
       or jsonb_typeof(step -> 'after_cycles') <> 'number'
       or jsonb_typeof(step -> 'price_cents') <> 'number' then
      return false;
    end if;
    -- Inteiros de verdade: 3.5 ciclos ou 99.5 centavos não existem.
    if (step ->> 'after_cycles') !~ '^[0-9]+$' or (step ->> 'price_cents') !~ '^[0-9]+$' then
      return false;
    end if;
    cycles := (step ->> 'after_cycles')::integer;
    cents := (step ->> 'price_cents')::integer;
    if cycles <= previous or cycles > 120 or cents < 0 then
      return false;
    end if;
    previous := cycles;
  end loop;
  return true;
end;
$$;

comment on function public.price_phases_valid(jsonb) is
  'Whether a price ladder is well formed: null, or 1-12 steps of {after_cycles, price_cents} with strictly increasing whole after_cycles (1-120) and whole non-negative cents.';

-- ---------- 2. A escada no plano ----------
alter table public.plans
  add column if not exists price_phases jsonb;

alter table public.plans
  drop constraint if exists plans_price_phases_valid;
alter table public.plans
  add constraint plans_price_phases_valid check (public.price_phases_valid(price_phases));

comment on column public.plans.price_phases is
  'Price ladder of a recurring plan: [{"after_cycles": N, "price_cents": X}, ...]. price_cents (the column) is what the FIRST cycles cost; each step says that after N PAID cycles the plan costs X. Null = a single price. Copied onto each subscription at creation (subscriptions.price_phases), which is the contract — editing this changes only future sales.';

-- ---------- 3. O contrato de cada assinatura ----------
alter table public.subscriptions
  add column if not exists price_phases jsonb,
  add column if not exists price_phase_index integer not null default 0;

alter table public.subscriptions
  drop constraint if exists subscriptions_price_phases_valid;
alter table public.subscriptions
  add constraint subscriptions_price_phases_valid check (
    public.price_phases_valid(price_phases)
    and price_phase_index >= 0
    and price_phase_index <= coalesce(jsonb_array_length(price_phases), 0)
  );

comment on column public.subscriptions.price_phases is
  'The price ladder this subscription was SOLD with — a copy of plans.price_phases taken when the row was created (trigger subscriptions_snapshot_price_phases). Never follows later edits of the plan.';
comment on column public.subscriptions.price_phase_index is
  'How many steps of price_phases have been applied AT THE PROVIDER. 0 = still on plans.price_cents. Only the billing webhook raises it, after the provider accepted the new value, and it never goes down.';

-- A cópia é feita pelo banco, e não pelo checkout, porque assinaturas nascem
-- por vários caminhos (o checkout, o plano de cortesia da 0067, o retorno ao
-- gratuito) e só um deles precisaria esquecer para uma escada se perder.
-- Trocar o PLANO de uma assinatura existente (só o set_org_plan faz isso)
-- troca o contrato junto, e a contagem recomeça do zero.
create or replace function public.subscriptions_snapshot_price_phases()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.price_phases is null then
      select p.price_phases into new.price_phases from public.plans p where p.id = new.plan_id;
    end if;
    new.price_phase_index := coalesce(new.price_phase_index, 0);
  elsif new.plan_id is distinct from old.plan_id then
    select p.price_phases into new.price_phases from public.plans p where p.id = new.plan_id;
    new.price_phase_index := 0;
  elsif new.price_phase_index < old.price_phase_index then
    -- O índice diz o que a OPERADORA já cobra. Descer não desfaz a cobrança,
    -- só faria o webhook pedir de novo um valor que ela já tem e esconder do
    -- console o degrau em que a assinante está.
    raise exception 'price_phase_index_never_decreases' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_snapshot_price_phases on public.subscriptions;
create trigger subscriptions_snapshot_price_phases
  before insert or update of plan_id, price_phase_index on public.subscriptions
  for each row execute function public.subscriptions_snapshot_price_phases();

-- ---------- 4. O plano da Black ----------
-- É o Pro, por construção: descrição e limites copiados da linha `pro`, mensal
-- como ela, então a franquia de áudio vai sem multiplicador. O nome é o do
-- produto ("Assinar o Pro"); quem administra distingue pelo slug.
insert into public.plans (
  slug, name, description, kind, period, price_cents, currency,
  is_free, is_addon, is_public, is_active, limits, sort, price_phases
)
select
  'pro-black',
  'Pro',
  pro.description,
  'recurring',
  'monthly',
  9900,
  pro.currency,
  false,
  false,
  false,
  true,
  pro.limits,
  pro.sort + 5,
  jsonb_build_array(
    jsonb_build_object('after_cycles', 3, 'price_cents', 19700),
    jsonb_build_object('after_cycles', 12, 'price_cents', pro.price_cents)
  )
from public.plans pro
where pro.slug = 'pro'
on conflict (slug) do nothing;

-- ---------- 5. A janela da Black ----------
-- Uma chave própria, e não a `campaign_offer`: a campanha de outubro continua
-- valendo na /assinar durante e depois da Black, e trocar o plano dela por dez
-- dias apagaria o "de/por" que os anúncios de lá prometem.
--
-- `enabled: true` aqui é decisão, não efeito colateral (a 0107 explica por que
-- uma oferta normalmente nasce fechada): a data de abertura foi escolhida pela
-- dona e está escrita em `starts_at`, então a migração aplicada antes de 18/11
-- não abre nada antes da hora, e aplicada depois de 27/11 não abre nada.
-- Desligar antes do prazo é desmarcar a caixa em /admin/billing → Ofertas.
insert into public.platform_settings (key, value)
values (
  'promotion',
  jsonb_build_object(
    'enabled', true,
    'label', 'Black Friday',
    'plan_slug', 'pro-black',
    'compare_plan_slug', 'pro',
    'starts_at', '2026-11-18T00:00:00-03:00',
    'ends_at', '2026-11-27T23:59:59-03:00',
    'show_on_home', true
  )
)
on conflict (key) do nothing;
