# Asaas — checklist de entrada em produção

Auditoria de 17/09/2026, antes da abertura das vendas. Complementa `docs/BILLING-AUDIT.md`
(que cobre o desenho do billing como um todo); aqui o escopo é só a integração Asaas:
criação da cobrança, redirecionamento para a fatura, webhook e reconciliação.

O que está em código foi corrigido nesta rodada. O que está em **configuração** só você
pode executar — e três desses itens, hoje, impedem uma venda real de funcionar.

---

## 1. Bloqueadores de configuração (a conta NÃO vende hoje)

### 1.1 A chave de API é de homologação

`ASAAS_API_KEY` começa com `$aact_hmlg_`. Verificado contra a própria API:

```
GET https://api-sandbox.asaas.com/v3/customers  -> 200  (274 clientes)
GET https://api.asaas.com/v3/customers          -> 401  invalid_environment
                                                   "A chave de API informada não pertence a este ambiente"
```

Com essa chave nenhum dinheiro real se move: toda cobrança nasce no sandbox.

**Ação:** gerar a chave de produção no painel do Asaas e trocar `ASAAS_API_KEY` **na Vercel**
(o `.env` local é só o espelho que o `vercel env pull` escreve).

### 1.2 `ASAAS_BASE_URL` está vazia

`ASAAS_BASE_URL=` (definida, sem valor) faz o código cair no default, que é o **sandbox**.
Hoje isso é coerente com a chave; no momento em que a chave virar produção, essa variável
tem de virar junto ou a chave de produção baterá no host de sandbox e tomará 401.

**Ação (as duas juntas, no mesmo deploy):**

```
ASAAS_API_KEY=<chave de produção>
ASAAS_BASE_URL=https://api.asaas.com/v3
```

### 1.3 O webhook está desativado e com a fila interrompida

```
MedChina - cobranças
url: https://ai.medchinaprontuarios.com.br/api/webhooks/asaas
enabled: false      interrupted: true
```

O Asaas interrompe a fila após **15 falhas consecutivas** — e há exatamente um evento
`payment_failed` no inbox com `attempts = 15`. Enquanto estiver interrompida, os eventos
continuam sendo gerados mas **nada é entregue**: um cliente paga e o plano nunca ativa.

**Ação:** corrigir a causa (feito em código), reativar a fila e marcar `enabled`.
O endpoint em si responde corretamente — probe com token inválido devolve `400`, que é o
comportamento esperado.

> O mesmo vale para a conta de produção: o webhook precisa ser criado lá do zero, com
> a mesma URL e o mesmo `ASAAS_WEBHOOK_TOKEN`.

### 1.4 Faltam cinco eventos no webhook

Registrados hoje: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
`SUBSCRIPTION_DELETED`.

O código já trata — e depende de — cinco eventos que **o Asaas não está mandando**:

| Evento ausente | O que deixa de acontecer |
|---|---|
| `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` | Cartão recusado na **renovação** não marca `past_due`. A janela de tolerância nunca abre e o workspace segue consumindo IA numa assinatura que ninguém está pagando. `PAYMENT_OVERDUE` só cobre boleto/Pix. |
| `PAYMENT_REFUNDED` | Estorno deixa a fatura como `paid` para sempre. |
| `PAYMENT_PARTIALLY_REFUNDED` | Idem. |
| `PAYMENT_CHARGEBACK_REQUESTED` | **O pacote de minutos comprado continua gastável.** Pacote não expira por design, então um chargeback não revertido vira saldo grátis ilimitado. |
| `PAYMENT_CHARGEBACK_DISPUTE` | Idem. |

**Ação:** adicionar os cinco ao webhook, em sandbox e em produção.

### 1.5 Nenhum site cadastrado na conta — BLOQUEIA a venda (confirmado em produção)

O checkout manda `callback.successUrl` para que a cliente volte ao app depois de pagar.
O Asaas recusa **a cobrança inteira** se a conta não tiver um site cadastrado. Ele usa
redações diferentes por ambiente, o que custou caro:

```
sandbox:   invalid_object: É necessário enviar uma URL que use o mesmo domínio
                           cadastrado nas suas Minha Conta na aba Informações.
produção:  invalid_object: Não há nenhum domínio configurado em sua conta.
                           Cadastre um site em Minha Conta na aba Informações.
```

O fallback original casava a prosa da primeira mensagem e **não reconheceu a segunda**:
na primeira venda real de produção o erro subiu como "unavailable" e a assinatura não
foi criada. Corrigido — a repetição sem callback agora é decidida pelo **status 400**,
nunca pelo texto (401/403/5xx continuam subindo como si mesmos). Verificado contra as
duas redações.

**Ação — ainda necessária:** cadastrar `ai.medchinaprontuarios.com.br` em
*Minha Conta → Informações*. Sem isso a venda passa, mas a cliente fica parada na página
do Asaas depois de pagar, em vez de voltar para o app.

### 1.6 E-mail transacional desligado

`RESEND_API_KEY` e `EMAIL_FROM` estão vazias. Com Pix e boleto a confirmação chega horas
depois, quando ela já fechou o app: o e-mail "seu plano está ativo" é o **único** aviso que
a alcança. Hoje ele não sai.

**Ação:** configurar `RESEND_API_KEY` e `EMAIL_FROM` na Vercel.

### 1.7 Uma migração pendente em produção

`0103_fertility_care.sql`. Não é de billing, mas é um gate de deploy: `npm run db:migrate:remote`.

---

## 2. O que foi corrigido em código nesta rodada

### 2.1 A janela de consumo congelava na renovação (vazamento de receita)

`org_audio_allowance` mede consumo dentro de `[current_period_start, current_period_end)`.
O Asaas **não informa período nenhum** — só a data de vencimento da cobrança paga. O handler
decidia "isto é uma renovação?" comparando `event.currentPeriodEnd` com o valor guardado, e
como o Asaas nunca mandava esse campo, **nenhuma renovação Asaas era reconhecida como tal**.

Consequência: a janela ficava presa no primeiro mês. Passado esse `current_period_end`, todo
consumo novo caía fora da janela e `minutes_used` voltava a **zero permanente** — a assinante
ganhava IA ilimitada no segundo mês. Já comprovei esse mecanismo antes, num plano cortesia:
5.000 minutos consumidos reportados como 0 usados, `can_start = true`.

Correção: o provider passa a emitir `currentPeriodStart` a partir do `dueDate` da cobrança
(confirmado no payload real: `dueDate: "2026-09-17"`), e a regra de janela virou uma função
pura e testada, `apps/web/src/lib/billing-window.ts`, com 8 testes cobrindo os dois lados do
erro — avançar quando não devia (cancelar+desfazer no Stripe devolvia um ciclo inteiro de
minutos) e não avançar quando devia (toda renovação Asaas).

### 2.2 O webhook corria contra o relógio do Asaas

O Asaas espera **10 segundos** por um `200`; qualquer coisa diferente conta como falha, e
15 falhas seguidas interrompem a fila. Um único `payment_succeeded` fazia mais de uma dezena
de round trips sequenciais ao Postgres, mais Meta CAPI, GA4, e-mail Resend e uma consulta
admin ao GoTrue por titular — tudo **antes** de responder.

Correção: a rota processa inline até um orçamento de 6 s e passa o resto para `after()`, que
continua rodando depois da resposta. O claim do evento é o que torna isso seguro: um reenvio
cai em `event_in_progress` e é ignorado, nunca duplicado. `maxDuration = 120` dá folga para o
trabalho diferido terminar.

### 2.3 A fatura podia não existir ainda

O checkout criava a assinatura e lia a primeira cobrança numa única tentativa; se ela ainda
não estivesse lá, lançava — **depois** de a assinatura já existir no Asaas, deixando uma
cobrança mensal viva sem nada no produto apontando para ela. Medi a latência real no sandbox:
~140 ms, então na prática sempre existe. Mas "na prática" não é garantia documentada, e o
custo de errar é uma cobrança órfã. Agora são até 6 tentativas com espera crescente.

### 2.4 Retorno para o app depois do pagamento

`callback.successUrl` passou a ser enviado na assinatura e na cobrança avulsa, com o fallback
do item 1.5. A chave de idempotência do retry é diferente da original, porque a primeira já
foi gasta na requisição recusada.

### 2.5 `externalReference` estourava o limite — nenhuma venda Asaas jamais passou

Descoberto em 21/09, com o erro real do `pro-anual`. O Asaas recusa um
`externalReference` acima de **100 caracteres** (medido contra a API: 100 passa,
101 devolve `invalid_externalReference`; a documentação não menciona o limite).
A metadata ia como `JSON.stringify` e dava **177** caracteres — três UUIDs mais os
nomes longos das chaves.

Ou seja: **todo** checkout Asaas era recusado antes de a cliente ver qualquer
tela de pagamento — assinatura e pacote de minutos, mensal e anual. O `billing_operations`
de produção confirma: zero operações concluídas, só `provider_unavailable`.

Correção: a referência virou `<org>.<plano>[.<cupom>]`, UUIDs sem hífen, **98 caracteres
no pior caso** (com cupom). O que foi descartado é o que ninguém lia — `billing_operation_key`
(nunca consumido pelo webhook) e `module_ids` (o MedChina não tem módulos de order bump).
O Stripe continua mandando a metadata completa: lá o limite é 500 por valor.

O parser aceita as duas formas, então uma cobrança criada antes disso ainda reconcilia.
O teste `billing-reference.test.ts` fixa o comprimento em 98 — uma quarta chave não entra
sem o teste recusar.

### 2.6 A causa da falha passou a ficar no banco

`billing_operations.error_code` gravava o literal `provider_unavailable` para um payload
recusado, uma chave no ambiente errado e uma conta em análise — três problemas com três
soluções. Duas vezes seguidas, diagnosticar uma venda perdida exigiu reproduzir a chamada
à mão. Agora o erro do Asaas é tipado (`AsaasApiError`, com status, code e description) e
a falha se nomeia sozinha: `provider_400_invalid_object`, `provider_401_invalid_environment`,
`provider_403_account_disabled`. Sem dado de cliente, legível numa query.

### 2.7 Boleto removido: a forma de pagamento passou a ser escolhida por nós

O pedido era "só Pix e crédito". Não dá para fazer isso na fatura do Asaas: uma assinatura
aceita **um** `billingType` ou `UNDEFINED` (todos, boleto incluído) — não existe subconjunto.
Medido contra a API. Então a escolha saiu da página do Asaas e veio para a nossa.

`/assinatura` ganhou um seletor antes de gerar a fatura. O método escolhido vira o
`billingType` da cobrança, e boleto simplesmente nunca é uma das opções.

**Parcelamento (até 5x, só cartão, só em plano não-mensal).** Assinaturas do Asaas não têm
parcelamento de espécie alguma — nem `installmentCount`, nem `maxInstallmentCount`. Um plano
parcelado é uma **cobrança única** que o emissor divide, e portanto **não renova sozinho**.
A UI diz isso na tela, porque é a consequência que a cliente não consegue ver.

A regra vive em `apps/web/src/lib/payment-choice.ts`, pura e testada (7 testes), e o servidor
a reaplica: uma requisição forjada pedindo 12x num plano mensal sai como 1x à vista.

Verificado contra a API: assinatura `CREDIT_CARD` gera primeira cobrança `CREDIT_CARD`
(boleto? não); anual em 5x gera 5 parcelas somando exatamente o total.

**Pix está atrás de `BILLING_PIX_ENABLED`.** A opção só aparece quando a variável for `true`.
Oferecer um método que a conta não consegue cobrar falha no último passo do funil, que é o
pior lugar possível — então ele fica desligado até o teste de `billingType: PIX` confirmar.

---

## 3. Verificado e correto (não mexer)

- **Autenticação do webhook** — header `asaas-access-token` comparado com `ASAAS_WEBHOOK_TOKEN`;
  token errado devolve `400`. Confere com a documentação.
- **`/api/webhooks` está em `PUBLIC_PREFIXES`** — o middleware não intercepta o callback.
- **Idempotência de entrega** — `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` chegam para a mesma
  cobrança; a reconciliação deduplica por `provider_invoice_id`, e o Purchase de analytics
  só dispara na primeira (GA4 não deduplica sozinho).
- **Eventos de terceiros** — cobranças criadas à mão no painel Asaas não têm o nosso
  `externalReference`; são puladas com log em vez de falharem para sempre. Foi o que
  derrubou a fila antes.
- **Cliente Asaas resolvido por `externalReference` (org id)**, não por e-mail — duas
  workspaces da mesma pessoa não se misturam.
- **`cpfCnpj` obrigatório** — validado antes da chamada, com erro nomeado
  (`billing_profile_required`) que leva ao formulário em vez de "tente mais tarde".
- **A cobrança herda o `externalReference` da assinatura** — confirmado no sandbox, que é o
  que permite reconciliar as renovações.
- **`POST` e `PUT` em `/customers/{id}`** funcionam; o código usa `POST`, aceito.
- **Checkout abandonado** — o reaper cancela no provider depois de 24 h, e a cliente tem o
  card "continuar pagando / desistir". Sem isso, fechar a aba deixava uma mensalidade viva.
- **Cancelamento** — `endDate` na assinatura para o fim do período pago; `endDate: null`
  reverte (testado: `200`).

---

## 4. Ordem de execução para abrir as vendas

1. Registrar `ai.medchinaprontuarios.com.br` em *Minha Conta → Informações* (conta de produção).
2. Criar o webhook na conta de produção: URL `https://ai.medchinaprontuarios.com.br/api/webhooks/asaas`,
   com `ASAAS_WEBHOOK_TOKEN` e os **nove** eventos (os quatro atuais + os cinco do item 1.4).
3. Na Vercel: `ASAAS_API_KEY` de produção, `ASAAS_BASE_URL=https://api.asaas.com/v3`,
   `RESEND_API_KEY`, `EMAIL_FROM`.
4. `npm run db:migrate:remote` (0103 pendente).
5. Deploy.
6. **Venda de fumaça**: assinar o Assistente com um CPF real, pagar por Pix, e conferir na ordem —
   fatura abre; após pagar volta para `/settings/billing?checkout=success`; o plano fica ativo;
   chega o e-mail; `invoices` tem a linha `paid`; `subscriptions.current_period_end` está um mês à frente.
7. Reembolsar essa cobrança pelo painel e confirmar que a fatura sai de `paid` (valida o item 1.4).
