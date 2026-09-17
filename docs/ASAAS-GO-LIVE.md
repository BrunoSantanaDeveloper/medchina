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

### 1.5 O domínio de retorno não está registrado

O checkout agora manda `callback.successUrl` para que a cliente volte ao app depois de pagar.
O Asaas recusa a cobrança se o domínio não estiver cadastrado:

```
invalid_object: É necessário enviar uma URL que use o mesmo domínio cadastrado
                nas suas Minha Conta na aba Informações.
```

O código trata isso: detecta essa recusa específica e recria a cobrança **sem** o callback,
registrando `asaas_callback_domain_not_registered`. Ou seja, a venda nunca quebra por
causa disso — mas sem o cadastro a cliente fica parada na página do Asaas depois de pagar.

**Ação:** cadastrar `ai.medchinaprontuarios.com.br` em *Minha Conta → Informações*.

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
