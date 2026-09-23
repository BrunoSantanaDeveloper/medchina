-- ---------------------------------------------------------------------------
-- 0110 — A janela da oferta pós-onboarding passa a ser de 24 horas
-- ---------------------------------------------------------------------------
-- A oferta de conversão (migração 0088) já existe inteira: abre sozinha no
-- PRIMEIRO prontuário finalizado do workspace, carimba `expires_at` UMA vez e
-- congela o cupom na linha. O cartão em /inicio lê esse `expires_at`, então a
-- contagem só pode correr para baixo — recarregar a página não compra tempo.
--
-- O que muda aqui é UM parâmetro: a janela, que nasceu 48h.
--
-- DE ONDE VEM O NÚMERO
-- --------------------
-- docs/FUNIL.md §0 é explícito: "Estes valores são entradas de configuração. A
-- IA de desenvolvimento não deve inventá-los — deve implementá-los como
-- parâmetros configuráveis e solicitar os valores." Então esta migração só
-- escreve valor já decidido, e diz de onde veio:
--
--   Janela = 24 horas
--     Decisão do operador, registrada em 2026-09-22: a oferta mostrada ao fim
--     do onboarding vale "apenas para as próximas 24h".
--
-- O QUE ESTA MIGRAÇÃO DELIBERADAMENTE **NÃO** FAZ
-- -----------------------------------------------
-- Não liga a oferta (`enabled` continua como está) e não escreve `coupon_code`.
--
-- O desconto é valor comercial e não foi decidido — e sem cupom a oferta não
-- teria o que expirar. Uma contagem regressiva sobre uma condição que não muda
-- preço nenhum é exatamente o cronômetro falso que a 0088 foi escrita para
-- evitar, e "depois volta ao valor normal" seria mentira. Por isso o cartão
-- (`components/product/conversion-offer-card.tsx`) se recusa a renderizar
-- quando a oferta não carrega cupom: ligar a campanha sem configurar desconto
-- não mostra nada, em vez de mostrar um prazo que não significa nada.
--
-- PARA LIGAR (console do superadmin, /admin/billing → Offers):
--   1. crie o cupom de verdade em billing (código, tipo e valor do desconto);
--   2. escreva esse código em `conversion_offers.coupon_code`;
--   3. marque `enabled = true`.
-- A partir daí a janela pessoal é EXIGIDA no checkout: `startCheckout` recusa
-- o cupom da oferta quando o workspace já está fora da sua janela
-- (`conversionOfferWindowOpen`), que é o que torna o "volta ao valor normal"
-- verdadeiro em vez de decorativo.
-- ---------------------------------------------------------------------------

update public.platform_settings
set value = jsonb_set(value, '{window_hours}', to_jsonb(24))
where key = 'conversion_offers';

-- Um ambiente novo (local, CI, um restore) pode subir sem a linha da 0088.
insert into public.platform_settings (key, value)
select
  'conversion_offers',
  jsonb_build_object(
    'enabled', false,
    'first_consultation', true,
    'usage_80', true,
    'window_hours', 24,
    'coupon_code', ''
  )
where not exists (select 1 from public.platform_settings where key = 'conversion_offers');
