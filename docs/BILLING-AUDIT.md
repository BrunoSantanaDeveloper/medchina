# Auditoria de billing — jornada de contratação, checkout transparente e webhook Asaas

**Data:** 2026-08-03
**Escopo:** funil de contratação (CTA externo, usuário logado, trial ativo/vencido, upgrade, downgrade, cancelamento, inadimplência, pacotes avulsos), máquina de estados de assinatura, providers de pagamento, root-cause do HTTP 500 no webhook Asaas de 01/08/2026 14:00, e viabilidade de checkout transparente.

**Método:** 83 agentes — 5 mapeadores, 5 analistas de jornada, 1 pesquisa de checkout transparente (com doc atual do Asaas), 1 root-cause de webhook, e um verificador adversarial por achado (instruído a refutar; na dúvida, descartar). Dos achados brutos, **18 sobreviveram à verificação** nas jornadas + **3 causas confirmadas** no webhook. 32 alegações foram refutadas contra o código e não constam aqui.

**Cobertura incompleta — declarado:** 12 verificadores morreram por limite de sessão antes de emitir veredito, nas jornadas B (logado/Gratuito), G (cancelamento/dunning), I (pacotes) e J (cupons). Os achados que dependiam deles foram descartados por precaução. Essas quatro áreas podem ter problemas reais não listados.

**Regra do documento:** só entra o que precisa de decisão ou conserto. O que já está correto — idempotência de checkout via `billing_operations`, gate de allowance no `BEFORE INSERT` de `recordings`, carência configurável, RLS do domínio, trial cardless em `pro_trials` — não é repetido.

---

## Estado da implementação (2026-08-03)

Decisão do dono do produto: **o checkout permanece hospedado no Asaas**; o checkout transparente da §4 não será implementado. A §4 fica como registro da avaliação.

**Implementado e verificado** — migração `0069_billing_reliability.sql` (renumerada de 0067 por colisão com migrações que surgiram durante o trabalho), `packages/billing`, rota de webhook, server actions, telas de billing/uso, jobs Inngest, e-mail transacional e 28 chaves i18n nos 5 locales:

| Achado | Onde |
|---|---|
| C1 webhook 500 permanente | `route.ts` — descarte de cobrança estrangeira com 200, `event_in_progress` → 200, teto de 5 tentativas (`handler_failed_permanent`), `console.error` no catch, bootstrap dentro do try |
| C2 `cpfCnpj` ausente | migração (campos fiscais + `update_billing_profile`), `asaas.ts` (`ensureCustomer` por `externalReference`), `BillingProfileCard`, erro tipado `billing_profile_required` |
| C3 `SUBSCRIPTION_DELETED` | `asaas.ts` — aceita o payload `subscription` |
| C4 cartão recusado / estorno / chargeback | `asaas.ts` + evento `payment_reverted` + RPC `revert_paid_invoice` (zera o saldo do pacote, estorna créditos) |
| A1 troca de plano sem proração | **mitigação apenas**: diálogo de confirmação nomeando a perda. A solução (agendar para o fim do ciclo ou proration) segue como decisão de produto |
| A2 `incomplete` invisível | `use-billing.ts` + `PendingCheckoutCard` (link para pagar + cancelar solicitação) |
| A3 `admin_suspended` não bloqueia | `purchaseBlockedReason` em `startCheckout` e `startPackCheckout` |
| A4 `ensureFreeSubscription` | RPC `ensure_free_subscription` idempotente, usada pelo webhook e pelo job |
| A5 exploit de minutos grátis | `current_period_start` só muda em ativação real ou renovação; Stripe passa `currentPeriodStart` do provedor |
| A6 ativação fora de ordem | ignora linha `canceled`; supersedência limitada a `created_at` anterior |
| M6 `paidAt`/`value` | validados no parser |
| M7 supersedência falha em silêncio | `audit_events` (`billing.superseded_cancel_failed`) |
| M8 checkout abandonado | `abandon_incomplete_subscription` + reaper noturno (24 h) |
| M9 ativação silenciosa | notificação no sino + `sendSubscriptionActiveEmail` |
| M10 Stripe ativa plano errado | `findSubscription` filtra por `plan_id` |
| M11 trial vencido por prazo | `cycle_expired` no SQL — `minutes_remaining` vai a 0, `percent` a 100 |
| M12 Pro sem minutos perde raciocínio | `can_reason` desacoplado de `can_start` para planos pagos |
| M13 saldo de pacote invisível | `AudioUsageCard` (ramo só-pacote) + `MinutePacksCard` (visível por saldo, compra por `packPurchasable`) |
| M3 lease não validado | as três RPCs `complete_*` exigem `lease_expires_at > clock_timestamp()` |
| M2 (metade) | `expire_stale_billing_leases` + job noturno |
| M5 atribuição no pack | `meta_attribution` gravada em `startPackCheckout` |
| H-01 recovery some no `pack_only` | campo `dunning` separado de `reason`; a página monta o card por ele |
| H-04 boleto errado | fatura de recuperação filtrada por `subscription_id` |

**Verificação:** 72 migrações aplicadas em ordem num Postgres limpo + 11 testes funcionais das novas RPCs; `typecheck`, `lint` e `build` passam. Não foi feito walkthrough da UI no app rodando (`product-verify`).

**Deliberadamente diferente do relatório:** no Stripe, `customer.subscription.updated` com `past_due` NÃO emite `payment_failed` — `invoice.payment_failed` é o gatilho canônico e o único que carrega a fatura e a URL de recuperação; um segundo evento criaria uma fatura sem id. Em vez disso, os status terminais (`incomplete_expired`, `unpaid`, `canceled`) passaram a cancelar localmente. Estorno no Stripe cobre compras avulsas (o `Charge` não expõe mais o id da fatura na SDK v18); assinaturas caem em `unknown_invoice` e são ignoradas.

**Não implementado** (segue em aberto): A1 solução definitiva, M1 preços hardcoded na home, M4 cupons, purga de linhas antigas do inbox, console de replay em `/admin/billing`, e os itens 🟢 BAIXO de limpeza.

---

## 1) Mapa da jornada hoje

```
ANÚNCIO / BUSCA
   └─> home "/" (ClinicalSourceHome)  ── preços HARDCODED em JSX
         │  header/footer próprios; o chrome compartilhado é escondido por CSS
         │  (clinical-source-home.css:100-102) → NÃO há link para /planos
         └─> [3 cards] ─────────────────┐
   └─> /planos (preços reais do banco) ─┤ mesmo destino, mesmo label
         └─> [3 cards] ────────────────┘
                                        v
                              /auth/sign-up   (não lê plan/plano; só email e next)
                                        v
                      confirmação e-mail → /auth/callback (CompleteRegistration/sign_up)
                                        v
                      resolvePostAuthDestination → /onboarding (manual | ai)
                                        v
                      /primeiros-passos?trilha=…   → pacientes / consultas / biblioteca
                                        v
                 (shell) PlanIndicator "comparar planos" + Ctrl+K + /settings
                                        v
       ── caminhos REATIVOS de upgrade ────────────────────────────────
        gravador exhausted · AudioUsageCard ≥80% · hypotheses-panel ·
        cota da biblioteca · notificações 80/95/100% · drip de trial
                                        v
                    /settings/billing  →  PlansGrid → startCheckout(planId=UUID)
                                        v
                claim_billing_operation (lease 2min)
                                        v
                provider.createCheckout  → fatura hospedada (redirect)
                                        v
                complete_checkout_billing_operation → subscriptions status='incomplete'
                                        v
                WEBHOOK subscription_activated → aposenta vivas → ativa nova
                                        │
                                        └── (Asaas) 500 permanente em cobranças sem contexto ⚠️
```

Duas verdades operacionais que decorrem do mapa:

- **Todo checkout depende do webhook.** `complete_checkout_billing_operation` só grava `incomplete` (`packages/db/migrations/0035_billing_idempotency.sql:239-266`). Se a fila do Asaas está penalizada, **o cliente paga e nunca é ativado**.
- **Não existe troca de plano.** A interface tem apenas `createCheckout`, `scheduleCancellation`, `resumeSubscription`, `cancelSubscription`, `billingPortalUrl`, `parseWebhook` (`packages/billing/src/types.ts:110-134`). Upgrade e downgrade são checkout novo + supersedência.

**Não é bug (registrado para não voltar à pauta):** o CTA de marketing não carregar o slug do plano até o sign-up é decisão coerente — o trial é cardless e começa na primeira consulta com IA (`start_pro_trial` recebe só `target_org`, `0061:82`), e `startCheckout` exige org + membership owner/admin, que não existem no clique de marketing. O residual é rótulo ("Conhecer o Pro" apontando para cadastro genérico), não fluxo.

---

## 2) Achados por severidade

### 🔴 CRÍTICO

#### C1 — Webhook Asaas devolve 500 permanente para qualquer cobrança sem `externalReference` nosso; isso trava a fila e bloqueia ativações reais

**O que acontece.** `packages/billing/src/providers/asaas.ts:203-208` inicializa `metadata = {}` e engole o erro quando `payment.externalReference` não é o JSON de `CheckoutMetadata`. `asaas.ts:211-224` empurra `payment_succeeded` mesmo assim. No handler, `findSubscription` (`route.ts:20-46`) só resolve por `provider_subscription_id` ou por `metadata.org_id` — sem os dois, retorna `null` → `throw new Error("billing_context_not_ready")` (`route.ts:273`). O catch (`route.ts:553`) seta `failed = true` e a rota responde `status: failed ? 500 : 200` (`route.ts:571`).

O 500 **não é transitório**: `claim_billing_webhook_event` só curto-circuita em `status='completed'` (`0035:317-319`); uma linha `failed` cai no update de `0035:326-335` e é re-reivindicada infinitamente, sem teto de tentativas.

Três variantes do mesmo buraco, todas confirmadas:
- `payment_succeeded` sem org (`route.ts:271-273`)
- `payment_failed` via `PAYMENT_OVERDUE` sem org (`route.ts:459-462`)
- `subscription_activated` derivado do MESMO payload (`asaas.ts:227-237`) → `subscription_not_ready` (`route.ts:169-172`). Como a unique do inbox é `(provider, provider_event_id, event_type)` (`0035:60`), os dois eventos derivados do mesmo `providerEventId` (`asaas.ts:201`) viram **duas linhas independentes**: uma pode passar e a outra estourar eternamente.

**Amplificadores no mesmo arquivo:**
- `failed` é flag **global do lote** (`route.ts:525,571`) — um pagamento estrangeiro contamina payloads que contenham eventos legítimos.
- `event_in_progress` (`0035:320-325`) vira 500 sem nenhum trabalho (`route.ts:539-542`) — depois de um crash, 5 minutos de 500 gratuitos.
- Um evento **processado com sucesso** vira 500 se `complete_billing_webhook_event` devolver `claim_lost` (`route.ts:545-552`).

**Impacto.** O Asaas suspende a fila após falhas consecutivas. Enquanto a penalização está ativa, `PAYMENT_CONFIRMED` de assinaturas reais não chega: **o cliente paga, a `subscriptions` fica em `incomplete`, e `use-billing.ts:174` (que só lê `trialing|active|past_due`) mostra "Nenhum plano ativo"**. Suporte manual por cliente.

**Correção:** patch completo na §3.

---

#### C2 — `ensureCustomer` cria cliente no Asaas sem `cpfCnpj` (campo obrigatório em `POST /v3/customers`)

**O que acontece.** `packages/billing/src/providers/asaas.ts:56-66` faz `POST /customers` com apenas `{ name, email }`. A API v3 exige `name` **e** `cpfCnpj`. Pior: a busca é `GET /customers?email=...&limit=1` — reuso **global por e-mail na conta Asaas**, não por org.

E o MedChina não coleta o dado em lugar nenhum: `organizations` tem name/slug/timezone/audio_retention (`packages/db/src/schema/organizations.ts:7-17`), `profiles` tem display_name/avatar_url/practice_modalities, e `update_practice_settings` (`0050_product_ux_optimization.sql:12-16`) aceita só (org, name, timezone). Grep de `cpf` em `apps/web/src` só bate em **pacientes**.

**Impacto.** Se o deployment estiver em `BILLING_PROVIDER=asaas`, **o checkout Asaas pode estar quebrado em produção agora** — `asaasFetch` lança Error em qualquer não-ok (`asaas.ts:47-50`), `startCheckout` colapsa tudo em `{error:'unavailable'}` (`actions.ts:58-64`) e o usuário vê "contratação temporariamente indisponível", com a causa real só no log.

**Ação imediata (antes de qualquer código):**
```sql
select error_code, count(*), max(created_at)
from public.billing_operations
where kind='checkout' and status='failed' and created_at >= now() - interval '60 days'
group by 1 order by 2 desc;
```
E conferir `BILLING_PROVIDER` no ambiente de produção.

**Correção.** (a) Migração acrescentando `cpf_cnpj`, `postal_code`, `address_number`, `phone` em `organizations`; (b) estender `update_practice_settings` e a tela `settings/organization/components/org-general.tsx:80-95`; (c) `ensureCustomer` passa a buscar/gravar por `externalReference = org_id` e enviar `cpfCnpj`. O ferramental de validação já existe e está sem uso nesse contexto: `isValidCpfCnpj` (`packages/fields/src/index.ts:46`), `isValidCep` (`:99`), `isValidPhoneBr` (`:80`), `viaCep` (`:130`) + `document-field.tsx` / `cep-field.tsx` / `phone-field.tsx` em `apps/web/src/components/product/fields/`.

---

#### C3 — `SUBSCRIPTION_DELETED` do Asaas nunca chega ao handler: org fica ativa localmente sem cobrança no provedor

**O que acontece.** O parser tipa o payload como `{id?, event, payment?}` (`asaas.ts:184-196`) e retorna array vazio se `event.payment` for undefined (`asaas.ts:199-200`) — **antes de olhar o nome do evento**. Os webhooks do grupo Subscription entregam o objeto `subscription`, não `payment`. O case (`asaas.ts:256-266`) ainda lê `payment.subscription`, campo que só existe em payload de cobrança.

**Impacto.** Cancelar a assinatura pelo painel do Asaas (ação de suporte comum) nunca chega a `subscription_canceled` (`route.ts:251-268`) nem a `ensureFreeSubscription` (`route.ts:266`). A org **continua com plano pago ativo, consumindo minutos de IA, sem nenhuma cobrança**. Silencioso: HTTP 200, zero log.

**Correção:** patch na §3 (aceitar `event.subscription`).

---

#### C4 — Falha de cartão, estorno e chargeback não existem no domínio Asaas

**O que acontece.** O switch entende 4 nomes (`asaas.ts:210-267`): `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `SUBSCRIPTION_DELETED`. Como `billingType: "UNDEFINED"` (`asaas.ts:99`) deixa o cliente escolher **cartão**, a recorrência já pode ser por cartão hoje.

- `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` → descartado (200, sem log). O único gatilho de `payment_failed` é `PAYMENT_OVERDUE`, que é do mundo boleto/Pix. Resultado: **assinatura segue `active`, `past_due_since` nunca é setado, a carência de 7 dias nunca abre, o dunning nunca sai, e a profissional usa minutos de IA sem pagar.**
- `PAYMENT_REFUNDED` / `PAYMENT_PARTIALLY_REFUNDED` / `PAYMENT_CHARGEBACK_*` → descartados. A invoice fica `paid` para sempre (`route.ts:289-303`), o pacote de minutos concedido (`route.ts:322-336`) e os créditos (`route.ts:347-358`) **nunca são revertidos**.

**No Stripe existe o análogo:** `customer.subscription.updated` com status `past_due`/`unpaid`/`incomplete_expired` é silenciosamente descartado (`stripe.ts:181`); `invoice.payment_action_required` (3DS/SCA) e `charge.refunded` / `charge.dispute.created` também não são tratados (`stripe.ts:239-241`).

**Impacto.** Receita perdida sem sinal nenhum. É o buraco que mais cresce com adoção de cartão.

**Correção:** patch na §3 + no Stripe, tratar `customer.subscription.updated` com `past_due` como `payment_failed` e `charge.refunded`/`dispute` como reversão.

---

### 🟠 ALTO

#### A1 — Downgrade/upgrade descarta o tempo já pago (sem proration, sem agendamento)

`plans-grid.tsx:46,79,142` trata qualquer plano pago não-atual como "Escolher plano" → `startCheckout` completo. Na ativação, `route.ts:178-215` marca as vivas como `canceled` e `cancelSupersededAtProvider` (`route.ts:138-155`) cancela **imediatamente** no provedor. Não há `proration_behavior` em lugar nenhum do repo, nem `subscriptions.update` de item no Stripe (`stripe.ts:47,119`).

**Consequência exata:** Pro → Assistente no dia 5 do ciclo joga fora 25 dias de Pro já pagos, sem crédito. Assistente → Pro cobra o mês cheio do Pro sobre um mês de Assistente já pago.

**Impacto.** Reclamação de cobrança / risco de CDC, e desincentivo real ao upgrade. É a decisão de produto mais importante desta auditoria depois do webhook.

**Correção (escolher uma):**
1. **Curto prazo, zero código de provedor:** na `PlansGrid`, distinguir upgrade de downgrade e, no downgrade, oferecer "agendar troca para {current_period_end}" — reaproveitando `scheduleSubscriptionCancellation` + um registro de plano-alvo, liquidado por `settleDueBillingCancellations` (`lib/billing-cancellation.ts:31-66`).
2. **Médio prazo, Stripe:** acrescentar `changePlan` à `PaymentProvider` com `subscriptions.update({items:[…], proration_behavior:'create_prorations'})`. No Asaas não há equivalente — só `PUT /subscriptions/{id}` de valor, sem crédito proporcional.

Enquanto nenhuma das duas existir, **no mínimo** exibir o aviso no diálogo de confirmação ("Ao trocar agora, o período restante do plano atual não é creditado").

---

#### A2 — Assinatura `incomplete` é invisível: quem pagou por boleto/Pix vê "Nenhum plano ativo"

`use-billing.ts:174` filtra `.in('status', ['trialing','active','past_due'])`. Um checkout recém-criado grava `incomplete` (`0035:239-266`). Existem os rótulos i18n `billing-status-incomplete` = "Aguardando confirmação" (`pt-BR.json:1317`) e `billing-status-canceled`, **inalcançáveis**.

**Impacto.** Boleto/Pix têm compensação de horas a dias. Nesse intervalo o cliente vê que "não tem plano", o que gera segundo checkout (nova operação, nova cobrança no provedor — a proteção passa a ser só os unique indexes de `subscriptions`) e ticket de suporte.

**Correção.** Carregar `incomplete` na query, renderizar o chip "Aguardando confirmação" com a data e o `invoice_url`, e adicionar realtime do Supabase em `invoices`/`subscriptions` para a tela fechar sozinha quando o webhook confirmar. Pré-requisito obrigatório do Pix transparente (§4).

---

#### A3 — `admin_suspended` não bloqueia checkout

`current-subscription.tsx:85` mostra um Alert de erro, mas **nenhum componente checa `adminSuspended` para desabilitar a grade**: `plans-grid.tsx:43,142` só olha `canManage` e `checkoutAvailable`. No SQL a suspensão é absoluta (`0055_audio_minute_packs.sql:265`, `reason='suspended'` sobrepõe grace, trial e pacotes).

**Impacto.** Uma org suspensa por kill-switch (fraude, inadimplência crônica, decisão jurídica) consegue **pagar um plano novo** e ficar suspensa mesmo assim — cobrança sem entrega, estorno garantido.

**Correção.** `requireOrgManager` → acrescentar checagem de `admin_suspended` em `startCheckout` (`actions.ts:85`) e `startPackCheckout` (`actions.ts:258`) com código próprio (`{error:'suspended'}`), e desabilitar a `PlansGrid` na UI.

---

#### A4 — `ensureFreeSubscription` insere sem `on conflict`, contra o índice parcial de assinatura viva

`route.ts:49-75`. O insert do plano free depende de a checagem prévia de "existe viva?" não correr em paralelo com outro caminho. O índice `subscriptions_org_live_unique` (`0001_billing.sql:122-124`) rejeitaria a segunda inserção → erro cru do PostgREST propagado (`route.ts:59,68,74`) → 500 → reentrega.

**Cenário real:** `SUBSCRIPTION_DELETED` (quando C3 for corrigido) chegando junto do job `settleDueBillingCancellations` (`lib/billing-cancellation.ts:31-66`), que faz o mesmo trabalho.

**Correção.** Transformar `ensureFreeSubscription` em RPC `SECURITY DEFINER` com `insert ... on conflict do nothing` sobre o índice parcial, ou tratar o código de unique violation como sucesso idempotente.

---

#### A5 — Cancelar e desfazer o cancelamento **zera a cota de minutos do ciclo** (exploit de minutos grátis)

> Recuperado da jornada upgrade/downgrade — confirmado na verificação, ausente da síntese automática.

Todo `customer.subscription.updated` com status `active` é traduzido em `subscription_activated` (`stripe.ts:178-195`), e o handler grava **incondicionalmente** `current_period_start: new Date()` (`route.ts:208`). Mas `org_audio_allowance` usa exatamente esse campo como início da janela de consumo: `window_start := coalesce(sub.current_period_start, ...)`, somando `audio_usage.cycle_seconds` a partir dele (`0055:204-206, 219-231`).

O Stripe emite `customer.subscription.updated` a cada alteração — inclusive nas duas que o próprio produto dispara: `scheduleCancellation` faz `subscriptions.update(cancel_at_period_end:true)` (`stripe.ts:119-125`, chamado em `actions.ts:513-518`) e `resumeSubscription` faz `cancel_at_period_end:false` (`stripe.ts:127-129`, `actions.ts:587-589`). O `current_period_end` continua o real, então a assinatura não é renovada — **só a janela de consumo é reiniciada**.

**Impacto.** Uma profissional no Pro que gastou 5.900 dos 6.000 minutos clica em "Cancelar assinatura" e em seguida "Desfazer cancelamento" (ambos botões normais da tela, `current-subscription.tsx:119` e `:131`): cada ciclo de clique devolve 6.000 minutos no mesmo mês pago, **repetível indefinidamente**. É vazamento direto da unidade cobrável do produto, descoberto por acidente por qualquer pessoa que cancele e se arrependa. Efeito colateral: `usage_alerts` é idempotente por `window_start` (`usage.ts:71-77`), então os avisos de 80/95/100% também reiniciam.

**Correção.** Só mover a janela quando o período realmente mudar: gravar `current_period_start` apenas se a assinatura estava fora de (`active`,`trialing`) — primeira ativação / recuperação de past_due — OU se `event.currentPeriodEnd` for maior que o armazenado (renovação real). Alternativa melhor: usar o `current_period_start` **vindo do provedor** (`sub.items.data[0].current_period_start` no Stripe), que é a data verdadeira do ciclo e não muda em updates cosméticos.

---

#### A6 — Evento de ativação fora de ordem reativa a assinatura cancelada e **cancela a nova no provedor**

> Recuperado da jornada upgrade/downgrade — confirmado na verificação, ausente da síntese automática.

O handler de `subscription_activated` não tem guarda de ordem nem de estado. `findSubscription` busca por `provider_subscription_id` **sem filtro de status** (`route.ts:20-32`), então encontra também assinaturas já `canceled`. Encontrada a linha, o handler (a) marca como `canceled` todas as outras vivas da org (`route.ts:186-192`), (b) manda o provedor cancelar essas outras (`route.ts:194-197`) e (c) reativa a linha encontrada (`route.ts:199-215`). Não há comparação de timestamps nem checagem de que a linha não foi superada por outra mais nova.

O Stripe não garante ordem de entrega, e a rota devolve 500 quando qualquer evento do lote falha (`route.ts:571`), forçando reentrega — enquanto eventos já concluídos são pulados por `already_processed` (`route.ts:538`), os que falharam voltam depois, potencialmente **atrás** de eventos mais novos.

**Impacto.** Um `customer.subscription.updated` (active) da assinatura ANTIGA processado depois da ativação da nova **inverte o upgrade**: a Pro recém-paga é marcada `canceled` localmente **e cancelada de verdade no Stripe** pela supersedência, enquanto a Assistente (já cancelada no provedor) volta a `active` no banco. A cliente pagou R$299, não tem assinatura nenhuma no provedor, e o sistema mostra o plano antigo. Não existe job de reconciliação — o estado só é corrigido manualmente.

**Correção.** (1) Em `findSubscription`, no ramo por `provider_subscription_id`, ignorar linhas `canceled` — ou tratar o evento como obsoleto e retornar sem efeito; (2) na supersedência, só cancelar linhas com `created_at` **anterior** ao da assinatura sendo ativada, nunca posteriores; (3) idealmente, guarda de versão: recusar evento mais antigo que o `updated_at` da linha.

---

### 🟡 MÉDIO

| # | Achado | Evidência | Ação |
|---|---|---|---|
| M1 | **Preços da home hardcoded em JSX** (`R$ 0` / `R$ 199` / `R$ 299`) e limites idem ("Até 3.000 minutos"), enquanto `/planos` lê `listPublicPlans()`. Viola a regra do CLAUDE.md e do `docs/HOME-SPEC.md:943`. Hoje batem com o seed (`0024:42,54`), então o defeito é **latente**: qualquer ajuste em `/admin/billing` (`plans-admin.tsx:120` grava `price_cents`) cria divergência entre a landing de tráfego pago e o preço cobrado. | `clinical-source-home.tsx:215-265` (`:222,:238,:255,:246,:262`); `plans.ts:13-30` | `page.tsx` chama `getDisplayPlans()` (já é server) e passa por prop; a seção `#planos` mapeia sobre esses dados, indexando a copy por `slug`. |
| M2 | **Sem retenção nem reaper** em `billing_operations` e `billing_webhook_events`. Operação abandonada fica `processing` com lease vencido para sempre (o CHECK `0035:25-27` exige só NÃO-NULO); o inbox cresce indefinidamente. | `0035:7-63`; único cron de billing é `settleDueBillingCancellations` | Job Inngest noturno: marcar `processing` com `lease_expires_at < now() - 1h` como `failed('lease_expired')`; purgar `completed` com > 90 dias. |
| M3 | **`complete_billing_operation` e `complete_checkout_billing_operation` não validam `lease_expires_at`** — só o `claim_token`. Um worker zumbi ainda conclui o checkout. `commit_billing_subscription_change` (`0037:486-493`) é a única que valida. | `0035:171-187`, `0035:192-280` | Alinhar as três: acrescentar `lease_expires_at > clock_timestamp()` ao predicado do update. |
| M4 | **`validate_coupon` não tem nenhum chamador** no repo; o `redeemed_count` é incrementado em TypeScript com read-then-write **sem lock** (corrida sob eventos concorrentes → cupom de 100 usos resgatado 105 vezes). Cupom também não tem campo na UI: `startCheckout` sempre envia `modules: []` e nunca `coupon`. | `0001_billing.sql:323-336`; `route.ts:227-247`; `actions.ts:157` | Ou remover o cupom do escopo (e do console), ou: campo de cupom no checkout + `update coupons set redeemed_count = redeemed_count + 1 where id = … and (max_redemptions is null or redeemed_count < max_redemptions)` retornando linha afetada. |
| M5 | **`startPackCheckout` não persiste `meta_attribution`** (diferente de `startCheckout`, `actions.ts:195-212`). Compra de pacote por Pix/boleto que confirme depois chega ao webhook sem sinais de match. | `actions.ts:365-385` vs `:195-212` | Copiar o upsert condicional (`if (fbp \|\| fbc \|\| gaClientId)`) para `startPackCheckout`. |
| M6 | **`paidAt` e `value` do Asaas sem validação.** `new Date(payment.paymentDate)` inválido → `Invalid Date` → `RangeError` em `event.paidAt.toISOString()` (`route.ts:299`) e em `periodEnd(...)` (`route.ts:345`) → 500 eterno. `Math.round(payment.value*100)` → `NaN` → viola `amount_cents not null`. Não é a causa do 500 atual, mas é hardening barato. | `asaas.ts:220,223`; `route.ts:299,345` | Validar no parser: `let paidAt = payment.paymentDate ? new Date(payment.paymentDate) : new Date(); if (Number.isNaN(paidAt.getTime())) paidAt = new Date();` idem para `value`. |
| M7 | **`cancelSupersededAtProvider` engole a falha** (`route.ts:148-155`, só `console.warn`). Assinatura antiga fica viva no Asaas cobrando, sem dono local — e alimenta o `subscription_not_ready` de C1. **O cliente é cobrado 2×.** | `route.ts:138-155` | Manter o não-relance (o comentário `130-137` está certo), mas gravar `audit_events` + notificação para superadmin. |
| M8 | **Checkout Asaas abandonado deixa assinatura recorrente viva no provedor, sem caminho de cancelamento.** `createCheckout` cria a assinatura ANTES de qualquer pagamento (`POST /subscriptions`, cycle MONTHLY, `nextDueDate` = hoje). Fechar a aba deixa a cobrança mensal rodando no Asaas; localmente a linha fica `incomplete` para sempre (sem reaper/TTL). `scheduleSubscriptionCancellation` só enxerga `trialing\|active\|past_due`, e o console de superadmin só suspende e concede minutos. Quando vence, `PAYMENT_OVERDUE` grava fatura `failed` — e como o status é `incomplete`, `route.ts:479` não marca past_due nem notifica: ela vê cobrança falhada sem explicação e sem botão. | `asaas.ts:95-106`; `actions.ts:473-483`; `lib/billing-cancellation.ts:36-45`; `route.ts:463-479`; `subscriptions-admin.tsx:82-120` | (1) Não criar a assinatura antes do pagamento — usar link de pagamento e materializar no webhook; (2) enquanto isso, job Inngest que expire `incomplete` após N horas (`DELETE /subscriptions/{id}` + `canceled` local + auditoria) e expor "Cancelar solicitação" no card. **Exposição CDC direta.** |
| M9 | **Ativação da assinatura é completamente silenciosa** — nem sino, nem e-mail. Não há `notifyOrg` no case `subscription_activated`, embora exista para pacote de minutos (`:337-341`), recuperação de past_due (`:371-375`) e falha (`:492-499`). Não há template de e-mail de billing (`packages/email/src/templates/` tem contact-form, org-invite, patient-document, trial-lifecycle). Com boleto/Pix, o produto **nunca avisa** que o plano foi liberado. | `route.ts:168-249`; `packages/email/src/templates/` | `notifyOrg` no fim do case ("Plano {nome} ativo — seus {minutos} minutos já estão disponíveis", href `/inicio`) + template de e-mail no mesmo ponto. Best-effort, como os demais. |
| M10 | **No Stripe, o webhook pode ativar o plano ERRADO.** `createCheckout` devolve só `{url}` (`stripe.ts:110-111`), sem `providerSubscriptionId` → a linha nasce com `provider_subscription_id = null` (`0035:254-265`). Em `customer.subscription.created`, `findSubscription` cai no fallback: a `incomplete` **mais recente** da org, **sem conferir `plan_id`** (`route.ts:33-45`), embora `event.metadata.plan_id` esteja disponível. Abrir checkout do Assistente, depois do Pro, e pagar na aba antiga → o webhook ativa o Pro. | `stripe.ts:55-61,98-99,110-111`; `route.ts:33-45`; `0035:254-265` | Filtrar também por `plan_id = event.metadata.plan_id`; melhor ainda, casar por `billing_operation_key` → `billing_operations.idempotency_key` → `subscriptions.billing_operation_id` (chave exata). |
| M11 | **Trial que vence por DIAS anuncia minutos que não podem ser usados.** O SQL zera só `cycle_can_start`; `minutes_remaining` segue positivo e `percent` baixo (`0055:234-235,300`). O `AudioUsageCard` decide tudo por `percent`: mostra "180 de 300 min restantes", sem alerta (exige `percent >= 100`, `:193`) e sem CTA de upgrade (exige `>= 80`, `:209`), com o gravador bloqueado. | `0055:234-235,300`; `audio-usage-card.tsx:106-108,118,193,209` | Ramificar por `allowance.canStart`/`reason`, não por `percent`. Complementar no SQL: zerar `minutes_remaining` (ou expor `cycle_expired`) quando `src='trial' and now() >= trial.ends_at`. |
| M12 | **Assinante Pro que esgota minutos perde o raciocínio clínico e recebe o CTA "Conhecer o Pro".** `can_reason := can_start and clinical_reasoning > 0` (`0055:255-257`) — acabar os minutos de áudio derruba também o raciocínio, que não consome minuto. A UI classifica como `locked` (`hypotheses-access.ts:15`) e mostra o bloco de venda do Pro para quem **já é Pro** (`hypotheses-panel.tsx:348-364`), levando a uma grade onde o botão dele está desabilitado como "Plano atual". | `0055:255-257`; `hypotheses-access.ts:15`; `hypotheses-panel.tsx:348-364`; `pt-BR.json:1981`; `billing/page.tsx:119-123` | Desacoplar `can_reason` de `can_start` para planos pagos; no mínimo, ramificar por `reason === 'cycle_exhausted' && planSlug` → "Seus minutos do ciclo acabaram" com CTA de **pacote avulso** (`?feature=audio_pack`), nunca "Conhecer o Pro". |
| M13 | **Minutos avulsos sobrevivem ao downgrade mas somem da interface — e a copy afirma que não há minutos.** O banco preserva o pacote (`0055:238-251`), mas `AudioUsageCard` usa `hasAllowance = minutesLimit > 0` (`:40`) e imprime "Este consultório não tem minutos de IA" (`:84-88`); o `MinutePacksCard`, único lugar que renderiza o saldo (`:93-97`), esconde-se inteiro quando `packPurchasable` é falso (`:48-49`), o que ocorre sem plano pago (`0055:263`). Enquanto isso o gravador grava, porque `canStart` é true. | `0055:238-251,263`; `audio-usage-card.tsx:40,84-88`; `minute-packs-card.tsx:48-49,93-97`; `consultation-recorder.tsx:829-830` | `hasAllowance = minutesLimit > 0 \|\| packMinutesRemaining > 0`; separar visibilidade do card (saldo) da condição de **compra** (`packPurchasable`). |

---

### 🟢 BAIXO

- **Inadimplente com pacote perde a superfície de regularização.** A precedência do `reason` testa `can_start` antes de past_due-fora-de-carência (`0055:251,265-285`), então uma org past_due com pacote recebe `pack_only`/`ok`, nunca `past_due_blocked`. O `PaymentRecoveryCard` só monta para `past_due_grace|past_due_blocked` (`billing/page.tsx:176`) → some. Junto com M13, ela lê "não tem minutos de IA" enquanto grava, e não tem onde pagar. → Montar o card por `allowance.pastDue` (`audio-allowance.ts:128`), não por `reason`.
- **"Atualizar pagamento" pode abrir o boleto errado.** A busca pega a última fatura `failed` do **org**, sem filtrar por `subscription_id` (`actions.ts:437-446`) — e `PAYMENT_OVERDUE` de um pacote avulso abandonado também grava fatura `failed` (`route.ts:460-478`; `asaas.ts:240-253`). Ela paga a coisa errada e a assinatura segue past_due. → `.eq("subscription_id", sub.id)` quando houver sub; senão `unavailable`.
- **Footer da home aponta para âncoras, não para as páginas reais**: "Privacidade" → `#seguranca`, "Sobre" → `#inicio`, "Central de ajuda" → `#duvidas`, "Contato" → `mailto:` (`clinical-source-home.tsx:1240,1244,1245,1246`). Numa página que trata dado clínico, "Privacidade" não leva à política. → reaproveitar `COLUMNS` de `marketing-footer.tsx:31-35`.
- **`GET /api/billing/providers` é órfão e sem auth** (`route.ts:6-8`) — a UI só usa o booleano de `checkoutAvailability()`. Vaza qual gateway está configurado. → remover.
- **`trial_days` editável em `/admin/billing`** (`plans-admin.tsx:219`) mas o checkout força `trialDays: 0` (`actions.ts:115-118`). Campo morto que só cria copy pública inconsistente. → esconder no console MedChina.
- **`/contato?assunto=planos`** (`plans-grid.tsx:160`) — param nunca lido (`contato/page.tsx:14`, `contact-form.tsx:33`). → pré-preencher a mensagem ou remover.
- **CTA circular:** "Conhecer os planos" na página de billing aponta para a própria página.
- **Gravador diz "Seus minutos de IA acabaram"** para trial que expirou por **prazo** — causa errada nomeada (mesmo tronco de M11).
- **O menu diz "Teste Pro" para sempre**, mesmo anos após o fim do teste.
- **`trial_active` ignora pacote avulso**: `trial_active = (src='trial' and cycle_can_start)` enquanto `can_start = (cycle_can_start or pack_seconds_left>0)` (`0055:304,251`). Só ocorre via `grant_audio_minute_pack`.
- **Fallback de janela sem `current_period_start`** → `date_trunc('month', now())` (`0055:204`). Só afeta assinaturas criadas fora do webhook (seed/manual), que somariam o consumo do trial ao ciclo pago.

---

## 3) Webhook Asaas 500 — diagnóstico e patch

### Diagnóstico

O 500 é uma **resposta projetada** desta rota, não exceção não tratada: `route.ts:571` retorna `status: failed ? 500 : 200`. `failed` liga em três lugares (`route.ts:539-542` claim, `:543-553` handler, `:545-552` complete).

**Causa raiz única, três portas de entrada:** o handler trata "cobrança que não é do MedChina" como falha retryable em vez de descarte. Portas: `payment_succeeded` sem org (`route.ts:273`), `payment_failed` sem org (`route.ts:462`), `subscription_activated` sem linha local (`route.ts:172`).

**Por que é permanente:** `claim_billing_webhook_event` só bloqueia `completed` (`0035:317-319`); `failed` é sempre re-reivindicável (`0035:326-335`), sem teto de `attempts`.

### Rodar ANTES do deploy (decide entre as portas)

```sql
select provider, event_type, status, error_code, attempts,
       count(*), min(created_at), max(updated_at)
from public.billing_webhook_events
where provider = 'asaas' and created_at >= '2026-07-25'
group by 1,2,3,4,5
order by max(updated_at) desc;
```
- Linhas `failed` com `error_code='handler_failed'` → confirma C1.
- **Nenhuma linha** → o problema está antes do claim (grants da `0035`/`0039` ou `createServiceClient()` fora do try em `route.ts:524`).
- Muitas `processing` com `lease_expires_at` no passado → M2 + `event_in_progress` virando 500.

### Patch

**(a) `apps/web/src/app/api/webhooks/[provider]/route.ts` — descartar cobrança estrangeira com 200**

```ts
// helper novo, topo do arquivo
function skipForeign(event: BillingEvent, why: string) {
  console.warn("billing_webhook_foreign_event", {
    provider: event.provider,
    providerEventId: event.providerEventId,
    type: event.type,
    why,
  });
}

// case "subscription_activated" — substitui route.ts:169-172
const sub = await findSubscription(supabase, event);
if (!sub) {
  // Sem org_id no externalReference a assinatura NÃO é do MedChina:
  // reprocessar nunca resolve. Só é retry legítimo quando o pagamento é nosso
  // e a reconciliação local ainda não completou.
  if (!event.metadata.org_id) {
    skipForeign(event, "unknown_subscription");
    return;
  }
  throw new Error("subscription_not_ready");
}

// case "payment_succeeded" — substitui route.ts:271-273
const orgId = sub?.org_id ?? event.metadata.org_id;
if (!orgId) {
  skipForeign(event, "no_billing_context");
  return;
}

// case "payment_failed" — substitui route.ts:459-462 (mesmo bloco)
```

**(b) `event_in_progress` não é falha nossa (substitui `route.ts:539-542`)**

```ts
if (claim?.code === "already_processed") continue;
if (claim?.code === "event_in_progress") {
  // Outra invocação é dona do evento dentro do lease de 5 min.
  // Responder 500 aqui só penaliza a fila do provedor sem trabalho nenhum.
  continue;
}
if (claimError || !claim?.ok || !claim.eventId || !claim.claimToken) { failed = true; continue; }
```

**(c) Teto de tentativas — para o 500 nunca ser eterno**

SQL (nova migração `0067_webhook_attempt_cap.sql`), acrescentar `attempts` ao retorno do claim em `0035:336-341`:
```sql
return jsonb_build_object(
  'ok', true, 'code', 'claimed',
  'eventId', event_row.id, 'claimToken', claimed_token,
  'attempts', event_row.attempts        -- <— novo
);
```
TS, no catch de `route.ts:553-560`:
```ts
const attempts = Number((claim as { attempts?: number }).attempts ?? 1);
const permanent = attempts >= 5;
await supabase.rpc("complete_billing_webhook_event", {
  target_event: claim.eventId,
  target_claim_token: claim.claimToken,
  target_success: false,
  target_error_code: permanent ? "handler_failed_permanent" : "handler_failed",
});
console.error("billing_webhook_handler_failed", {
  providerEventId: event.providerEventId, type: event.type, attempts,
  message: error instanceof Error ? error.message : String(error),
});
// Depois do teto, o replay passa a ser NOSSO (console/job), não do provedor.
if (!permanent) failed = true;
```
> Hoje o catch (`route.ts:553-560`) **não tem `console.error`** e grava `"handler_failed"` fixo — daí a cegueira do incidente. O `console.error` é obrigatório mesmo que o resto seja adiado.

**(d) `packages/billing/src/providers/asaas.ts` — aceitar payload de assinatura e os eventos que faltam**

```ts
type AsaasWebhook = {
  id?: string;
  event: string;
  payment?: { id: string; customer: string; subscription?: string; value?: number;
              paymentDate?: string; invoiceUrl?: string; externalReference?: string };
  subscription?: { id: string; externalReference?: string };
};

const payment = body.payment;
const subscription = body.subscription;
if (!payment && !subscription) return events;              // substitui asaas.ts:199-200

const providerEventId =
  body.id ?? `${body.event}:${payment?.id ?? subscription?.id}`;

switch (body.event) {
  // ... PAYMENT_CONFIRMED / PAYMENT_RECEIVED / PAYMENT_OVERDUE como hoje ...

  // NOVO: recorrência de cartão recusada — hoje descartada com 200 (C4)
  case "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED": {
    if (!payment) break;
    events.push({
      providerEventId, type: "payment_failed", provider: "asaas", metadata,
      providerSubscriptionId: payment.subscription,
      providerInvoiceId: payment.id,
      amountCents: Math.round((payment.value ?? 0) * 100),
      currency: "BRL",
      invoiceUrl: payment.invoiceUrl,   // indispensável: é o caminho de recuperação
    });
    break;
  }

  // CORRIGIDO: o grupo Subscription entrega `subscription`, nunca `payment` (C3)
  case "SUBSCRIPTION_DELETED": {
    const subId = subscription?.id ?? payment?.subscription;
    if (subId) events.push({ providerEventId, type: "subscription_canceled",
                             provider: "asaas", providerSubscriptionId: subId });
    break;
  }

  default:
    // Sem evento derivado: a rota responde 200. Mas agora deixa rastro,
    // em vez de sumir silenciosamente (INVOICE_*, TRANSFER_*, CHECKOUT_*…).
    console.info("asaas_webhook_ignored", { event: body.event, providerEventId });
}
```

**(e) Estorno/chargeback — evento novo na união** (`packages/billing/src/types.ts:67-108`)

```ts
| { type: "payment_reverted"; providerEventId: string;
    provider: "stripe" | "asaas";
    metadata: Partial<CheckoutMetadata>;
    providerInvoiceId: string; kind: "refund" | "chargeback" }
```
Handler: `invoices.status = 'refunded'`, reverter `audio_minute_packs` da `invoice_key` correspondente (`0055:80-136`) e lançar `credit_transactions` negativa com `kind='adjustment'`. Mapear `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED` (Asaas) e `charge.refunded`, `charge.dispute.created` (Stripe).

**(f) Fora do escopo do 500, mesma linha:** envolver `createServiceClient()` (`route.ts:524`) e `await request.text()` (`route.ts:512`) no try — hoje ambos fora, geram 500 sem log nenhum.

**Mitigação operacional imediata (5 min, sem deploy):** no painel do Asaas, restringir o webhook aos eventos tratados. **Não substitui o patch** — cobranças avulsas da mesma conta continuam gerando `PAYMENT_CONFIRMED`/`RECEIVED`/`OVERDUE`.

---

## 4) Checkout transparente — veredito, gaps, esforço, fases

### Veredito

**Pix transparente: SIM, vale a pena, ~2 semanas.**
**Cartão transparente via Asaas: NÃO recomendo hoje** — e o bloqueio não é código.

No Asaas, o PAN passa pelo **seu** backend (`POST /v3/creditCard/tokenizeCreditCard` exige o número do cartão no corpo, com `access_token` de servidor). A documentação do próprio Asaas é explícita: *"Os dados passam pelo back-end da sua aplicação antes de serem enviados ao Asaas"*, *"Sua infraestrutura permanece no escopo"*, e **recomenda certificação SAQ-D**. Num Next.js na Vercel + Supabase isso significa auditoria QSA, ASV scan trimestral, pentest anual, log centralizado com retenção e segmentação — dezenas de milhares de reais/ano recorrentes.

Some-se: (a) a tokenização em produção depende de liberação do gerente de contas Asaas com análise de risco, que **pode ser negada**; (b) a doc pública da API **não expõe nenhum campo de 3DS** (challenge/redirect/next-action) — você pode montar o formulário e descobrir que não há como conduzir o desafio do emissor; (c) mensagens de recusa são genéricas por design (anti card-testing), então a UX de erro do transparente será **pior** que a da fatura hospedada, que ao menos oferece Pix e boleto na mesma tela.

**Agravante específico deste produto:** é prontuário clínico. Trazer PAN para o mesmo perímetro que hospeda dado de saúde (LGPD Art. 11) cria um cenário de vazamento combinado muito pior que qualquer um isolado, e fura a fronteira que o repo hoje mantém limpa e documentada (`docs/TRACKING.md`: nenhum tracker de browser no app clínico).

**Alternativa que entrega o objetivo real** ("a pessoa não sai do MedChina para pagar com cartão"): **Stripe Payment Element embutido** — 2 a 3 semanas, 3DS tratado automaticamente pelo Stripe.js, PAN nunca toca seu servidor (iframe), **elegibilidade SAQ A preservada, custo de compliance zero**. O `packages/billing/src/providers/stripe.ts` já tem createCheckout/cancel/resume/portal funcionando e `BILLING_PROVIDER` (`index.ts:19-24`) já seleciona provedor por deployment. O bloqueio ali é comercial/fiscal (taxas, Pix/boleto, nota fiscal no BR), não técnico.

### O que falta no código (gaps concretos)

| Gap | Onde | Nota |
|---|---|---|
| `CheckoutResult` é redirect-only (`{url}`) | `types.ts:51-56` | Virar união discriminada: `{kind:'redirect'}` \| `{kind:'pix', providerPaymentId, qrCodeBase64, copyPaste, expiresAt}` \| `{kind:'confirmed'}` \| `{kind:'declined', reason}` \| `{kind:'action_required'}` |
| **A RPC rejeita checkout sem URL** — bloqueador não óbvio, no SQL | `0035:192-280` (`invalid_result` se `target_checkout_url` vazia) e `0055:468-526` | Nova `complete_transparent_checkout_billing_operation` que aceite `null` |
| `CheckoutInput` não diz COMO nem QUEM paga | `types.ts:37-49` | `paymentMethod`, `instrument?.token`, `remoteIp`, `payer{name,email,cpfCnpj,postalCode,addressNumber,phone}` |
| `PaymentProvider` não comporta os dois modelos | `types.ts:110-134` | **Não mexer nela**: criar `TransparentCheckoutProvider` opcional (`createPixCharge?`, `getPixQrCode?`, `tokenizeCard?`, `updateSubscriptionCard?`, `createIntent?`) detectada por capability |
| Nenhum dos 6 campos de `creditCardHolderInfo` é coletado | `organizations.ts:7-17`, `profiles.ts:7-15` | Ver C2 — é o mesmo trabalho |
| `asaasFetch` transforma HTTP 400 (recusa) em Error, sem timeout | `asaas.ts:35-52` | 400 de cartão é **resultado de negócio**, não exceção; Asaas recomenda timeout ≥60s e Server Action na Vercel tem limite próprio → **risco de cobrança duplicada** |
| `startCheckout` colapsa tudo em `{error:'unavailable'}` | `actions.ts:58-64` | Códigos tipados: `declined`, `pix_pending`, `action_required`, `unavailable` |
| Corrida webhook-antes-do-commit vira o caso comum | `route.ts:20-46,172`; `asaas.ts:92-93` (`nextDueDate = hoje`) | Gravar a subscription **antes** de chamar o provedor, ou tornar `subscription_not_ready` reagendamento silencioso (já coberto pelo patch §3) |
| `incomplete` invisível na UI | `use-billing.ts:174` | Ver A2 — **pré-requisito** do Pix |
| `remoteIp` do cliente | `meta-capi-context.ts:18-19` já extrai `x-forwarded-for` | Promover a helper compartilhado (IP do CLIENTE, nunca do servidor) |
| CSP só tem `frame-ancestors 'none'` | `next.config.mjs:57` | Suficiente para Stripe Element. Para cartão no Asaas, PCI DSS v4.0 6.4.3/11.6.1 exige inventário + integridade de script na página que toca o PAN — trabalho permanente, não pontual |

### Fases

**Fase 0 — dívidas que já são risco hoje (3-5 dias).** C2 (cpfCnpj + campos fiscais na org) + C3/C4 (parser Asaas). **Paga por si mesma mesmo que o transparente seja cancelado.**

**Fase 1 — Pix transparente no pacote de minutos (8-12 dias).** Comece por `startPackCheckout` (`actions.ts:258-397`), **não** pela assinatura: é pagamento único, já é deliberadamente separado, não escreve em `subscriptions`, e o crédito de minutos já é idempotente por `invoice_key`. Trocar `billingType: "UNDEFINED"` por `"PIX"` (`asaas.ts:99,113,140`), capturar o `id` do pagamento em `asaas.ts:126-131` e chamar `GET /v3/payments/{id}/pixQrCode` → `{encodedImage, payload, expirationDate}`. UI de QR + copia-e-cola + realtime. **Blast radius mínimo, PCI inalterado.**

**Fase 2 — Pix na 1ª cobrança da assinatura (+5-8 dias).** Depende da nova RPC de complete e de A2 (carregar `incomplete`). **Atenção comercial:** Pix não é recorrência automática — cada ciclo vira cobrança manual. Ou o cartão continua sendo o método recomendado para assinatura, ou é preciso um fluxo explícito de lembrete de renovação.

**Fase 3 — decisão de cartão.** Pergunta a responder **antes** de escrever código: *"vamos certificar SAQ-D?"*
- **Não** → Stripe Payment Element (2-3 semanas), decisão comercial/fiscal.
- **Sim** → Asaas cartão: 4-8 semanas de engenharia + habilitação externa + auditoria. Confirmar por escrito com o gerente Asaas antes de comprometer prazo: contrato de 3DS, liberação de tokenização em produção, e liberação de mensagens de erro reais.

**Não verificado (declarado):** contrato exato de 3DS na API Asaas; se Pix do Stripe no Brasil suporta recorrência automática; se a conta Asaas do MedChina já tem cartão/tokenização liberados em produção.

---

## 5) Plano de ação priorizado

### P0 — esta semana (~1,5 dia)

| # | Item | Est. | Por quê |
|---|---|---|---|
| 0.1 | Rodar as 2 queries de diagnóstico (`billing_webhook_events` e `billing_operations`) e confirmar `BILLING_PROVIDER` de produção | 30 min | Decide se C2 já está quebrando checkout hoje e qual porta do 500 disparou |
| 0.2 | `console.error` no catch do webhook (`route.ts:553-560`) + envolver `createServiceClient()`/`request.text()` no try | 1 h | Sem isso, o próximo incidente é igualmente cego |
| 0.3 | **Patch §3(a)+(b)** — descartar cobrança estrangeira com 200; `event_in_progress` → 200 | 3 h | Destrava a fila do Asaas. Clientes que pagaram e estão em `incomplete` passam a ativar |
| 0.4 | **C3** — `SUBSCRIPTION_DELETED` aceitar `event.subscription` (§3d) | 2 h | Org ativa sem cobrança é perda de receita direta |
| 0.5 | **C4a** — `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` → `payment_failed` (§3d) | 2 h | Único caminho hoje que abre a carência é `PAYMENT_OVERDUE`; cartão recusado é invisível |
| 0.6 | **A5** — não resetar `current_period_start` em update cosmético | 2 h | Exploit de minutos grátis por cancelar/desfazer, acionável por qualquer cliente |
| 0.7 | Restringir eventos no painel Asaas aos tratados | 15 min | Mitigação, não correção |
| 0.8 | Reprocessar manualmente os `billing_webhook_events` com `status='failed'` da janela do incidente | 1 h | Recuperar assinaturas presas em `incomplete` |

### P1 — próximas 2-3 semanas (~15-18 dias)

| # | Item | Est. |
|---|---|---|
| 1.1 | **C2** — campos fiscais na org (migração + RPC + tela) e `ensureCustomer` com `cpfCnpj` + `externalReference=org_id` | 3-5 d |
| 1.2 | **A6** — guarda de ordem/estado na ativação (ignorar `canceled`, só superar `created_at` anterior) | 1 d |
| 1.3 | **A2** — carregar `incomplete` em `use-billing.ts:174`, chip "Aguardando confirmação", link da fatura, realtime | 2 d |
| 1.4 | **M8** — reaper de checkout abandonado + "Cancelar solicitação" no card | 2 d |
| 1.5 | **A3** — `admin_suspended` bloqueia `startCheckout`/`startPackCheckout` e desabilita a `PlansGrid` | 0,5 d |
| 1.6 | **A1 (mitigação)** — aviso explícito no diálogo de troca: período restante não é creditado | 0,5 d |
| 1.7 | **M9** — notificação + e-mail de assinatura ativada | 1 d |
| 1.8 | **M11 + M12 + M13** — `AudioUsageCard`/`hypotheses-panel` ramificando por `reason`, não por `percent`; saldo de pacote visível | 2 d |
| 1.9 | **C4b** — evento `payment_reverted` (refund/chargeback) revertendo invoice + pacote + créditos, Asaas e Stripe | 3 d |
| 1.10 | **M10** — fallback do Stripe casando por `plan_id`/`billing_operation_key` | 0,5 d |
| 1.11 | Stripe: `customer.subscription.updated` com `past_due` → `payment_failed`; tratar `invoice.payment_action_required` | 1 d |
| 1.12 | **§3(c)** — teto de `attempts` no inbox + migração expondo `attempts` no claim | 1 d |
| 1.13 | **A4** — `ensureFreeSubscription` idempotente (RPC com `on conflict`) | 0,5 d |
| 1.14 | **M6** — validar `paidAt`/`value` no parser Asaas | 0,5 d |

### P2 — trimestre

| # | Item | Est. |
|---|---|---|
| 2.1 | **A1 (solução)** — downgrade agendado para fim de ciclo (reaproveitando `settleDueBillingCancellations`) **ou** `changePlan` com proration no Stripe | 5-8 d + decisão |
| 2.2 | **M1** — home consumindo `getDisplayPlans()` por prop | 1 d |
| 2.3 | **M2** — job de reaper/retenção para `billing_operations` e `billing_webhook_events` | 2 d |
| 2.4 | **M3** — alinhar validação de lease nas 3 RPCs de complete | 1 d |
| 2.5 | **M4** — decidir sobre cupons: remover do escopo OU campo no checkout + incremento atômico | 1-3 d |
| 2.6 | **Fase 1 do Pix transparente** (após P1.1, pré-requisito) | 8-12 d |
| 2.7 | **M5, M7** + itens baixos (recovery card por `pastDue`, fatura certa em "Atualizar pagamento", `/api/billing/providers`, footer da home, `trial_days` no admin, `?assunto=planos`) | 2 d |
| 2.8 | Console de replay de webhooks failed em `/admin/billing` | 2 d |
| 2.9 | **Decisão executiva:** Stripe Payment Element vs SAQ-D no Asaas vs manter fatura hospedada para cartão | — |
| 2.10 | Reauditar as jornadas B/G/I/J (cobertura incompleta desta rodada) | 1 d |

---

## Três decisões que só o dono do produto pode tomar

1. **Cartão dentro do app vale um SAQ-D?** Se não, a única forma honesta é Stripe Payment Element — e isso é decisão comercial/fiscal (taxas, Pix/boleto, NF no Brasil), não técnica.
2. **Upgrade/downgrade: agendar para o fim do ciclo ou implementar proration?** Hoje o cliente perde o tempo pago, sem aviso.
3. **Cupons existem no produto?** O código tem catálogo, RPC de validação e contagem de resgate — sem nenhuma superfície de uso e com uma corrida no incremento. É feature morta ou feature não terminada.
