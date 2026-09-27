# MedChina — Funil Comercial: Especificação de Implementação (auditada)

**Objetivo:** deixar a aplicação e o site prontos para iniciar as ondas de captação e vendas.

> **Versão auditada contra o código em 2026-08-09** (branch main, commit c019990). Cada tarefa traz uma linha **Estado** com o que já existe no repositório, citando arquivo/migração. Legenda: ✅ já existe · 🟡 parcial · ⬜ não existe · ⚠️ correção — a versão anterior deste plano afirmava algo que o código desmente.

**Contexto de negócio:** custo médio de IA por consulta ≈ R$ 1,00 é **hipótese não medida** — hoje nenhum custo de transcrição/inferência é registrado (ver T1.6). Capacidade de onboarding: até 30 calls/semana. O gargalo do negócio é **demanda qualificada**, não capacidade de atendimento. Toda decisão de produto abaixo prioriza **gerar e capturar agendamentos**, não cadastros.

**Métrica-mestre do funil:** `Schedule` (call agendada) → `StartTrial` (trial Pro iniciado) → `Purchase`.

⚠️ **Correção da métrica**: desde a migração `0084_trial_any_operational_action.sql`, o trial Pro **não** inicia apenas na "1ª consulta real com IA" — inicia na **primeira ação operacional de qualquer tipo** (gravação, agendamento clínico, importação, biblioteca, cadastro de paciente), com a origem gravada em `pro_trials.started_via` (`recorder|agenda|import|library|patient|other`) e trava de uma promoção por profissional (`started_by`). O evento já existe e dispara server-side com deduplicação (`StartTrial` Meta CAPI + `start_trial` GA4, em `apps/web/src/app/api/billing/start-trial/route.ts`). Para o recorte "consulta com IA", segmentar por `started_via='recorder'`. **Atenção**: `apps/web/CLAUDE.md` e `docs/PRODUCT.md` §5.7 ainda descrevem a mecânica antiga — atualizar junto (ver Riscos, item 7), pois é fonte de erro recorrente.

**Regra permanente:** nenhuma campanha ou automação deve ser otimizada por criação de conta.

---

# PARTE A — Plano de vendas imediatas (operação + prontidão real)

> Auditoria de prontidão de vendas (2026-08-09): jornada de compra, conversão in-app, ferramentas da operação e canais de comunicação verificados no código. Contexto: base antiga de ~500 cadastros (máx. 20 pagantes, encerrou com 5) fora deste banco; conteúdo orgânico já rodando (reputação); ativos humanos = Débora (autoridade entre terapeutas MTC, fechamento) e Hellen (14k seguidores, alcance). Capacidade: 20–30 calls/semana. A venda imediata é **liderada por call**, não self-serve.

## A.1 Veredito de prontidão (o que a plataforma entrega HOJE)

**O que já vende (pronto, zero dev):**
- **Cobrança anual com PIX**: Asaas cria assinatura `YEARLY` com `billingType UNDEFINED` — a fatura hospedada deixa escolher PIX/boleto/cartão, inclusive na 1ª cobrança anual (`asaas.ts:167-215`). Para anual de ~R$2.000 no Brasil, isso é decisivo e está pronto.
- **Plano novo é configuração**: `/admin/billing → New plan` cria o `pro-fundador` anual (period Yearly no select, `limits` JSON com `clinical_reasoning:1` + `audio_minutes:6000`, preço livre) sem deploy.
- **Trial Pro sem cartão como ferramenta de venda**: inicia sozinho na 1ª ação operacional (0084), com drip de 4 e-mails (welcome/ativação/expirando/encerrado → `/settings/billing`) e gates honestos in-app (raciocínio Pro, minutos, biblioteca). "Crie a conta e use agora" é verdade.
- **Pós-pagamento sólido**: webhook ativa o plano em segundos (PIX/cartão), sino + e-mail de confirmação, `PendingCheckoutCard` cobre a janela do boleto.
- **Announcement in-app** (`/admin/announcements`): banner para todo usuário logado, com janela e dismissal — canal imediato para anunciar a oferta aos signups atuais.
- **Pixel opt-out**: Meta Pixel + GA4 disparam no primeiro pageview por padrão (`marketing-trackers.tsx`) — as visitas vindas do conteúdo orgânico JÁ constroem audiência de retargeting, se `NEXT_PUBLIC_META_PIXEL_ID` estiver em produção.
- **Venda manual (caixa de escape)**: `set_org_plan` (0067) coloca qualquer workspace num plano ativo sem checkout, auditado — viabiliza fechar um fundador hoje com PIX manual (ressalvas em A.3).

**O que queima a venda se a operação começar amanhã (bloqueadores reais):**
1. **Sandbox silencioso**: `ASAAS_BASE_URL` vazio = TODA cobrança vai para o sandbox (`asaas.ts:29-33`) — o cliente "paga", o plano ativa e nenhum real entra. Exigir `https://api.asaas.com/v3` explícito + 1 compra de teste real antes da 1ª call.
2. **E-mail silencioso**: sem `RESEND_API_KEY`/`INNGEST_*` em produção, drip de trial, /contato e confirmação de assinatura falham retornando `{sent:false}` sem alarme.
3. **Cupom prometido sem campo**: não existe onde digitar cupom — `startCheckout` nunca envia coupon. Anunciar "use o cupom HELLEN" quebra no caixa (ver A.4-P0).
4. **Plano Fundadores impossível de esconder**: qualquer plano `is_active` aparece em `/planos` (público) e `/settings/billing` (todo assinante); inativo não é assinável nem atribuível. Sem o dev de ocultação, o preço de fundador vaza no minuto em que a linha ativar.
5. **Confirmação de e-mail sem reenvio**: `/auth/get-verification` não tem botão de reenvio — e-mail no spam mata o cadastro no meio da call.
6. **Upgrade sem proration**: assinante mensal que compra o anual no meio do ciclo perde os dias pagos (diálogo avisa). Vender anual para a base atual no fim do ciclo, ou compensar manualmente.
7. **Sem atribuição** (T5.0): nada captura origem/onda/cupom — começar as ondas antes disso = nunca saber o que converteu (não se backfilla).

## A.2 Checklist de configuração de produção (zero dev — condição de partida)

- [ ] `BILLING_PROVIDER=asaas` + `ASAAS_API_KEY` + `ASAAS_WEBHOOK_TOKEN` + **`ASAAS_BASE_URL=https://api.asaas.com/v3` explícito**; webhook apontado para `/api/webhooks/asaas`
- [ ] **Compra de teste real** (plano mensal, PIX de verdade) validando: fatura → webhook → plano ativo → sino → e-mail
- [ ] `RESEND_API_KEY` + `EMAIL_FROM` no domínio real com SPF/DKIM + `CONTACT_FORM_TO` + chaves `INNGEST_*` (drip do trial não roda sem elas) — enviar e-mail de teste
- [ ] `NEXT_PUBLIC_META_PIXEL_ID` + `NEXT_PUBLIC_GA4_ID` + `META_CAPI_TOKEN` + `GA4_API_SECRET` (retargeting do conteúdo orgânico começa a acumular já)
- [ ] `/admin/support`: WhatsApp humano da operação (o widget flutuante fica invisível até isso — com ele, todo visitante tem 1 clique para o WhatsApp da fundadora)
- [ ] Migrações 0075–0084 aplicadas em produção (import + trial)
- [ ] Corrigir o mailto `contato@medchina.com.br` da home → domínio real (EPIC 4, T4.5) ou ao menos confirmar que a caixa existe

## A.3 Fase 0 — esta semana (zero deploy: operação + agendamento)

1. **Decidir D2–D4** (valor da oferta, vagas, prazo) e **criar o plano `pro-fundador` anual** no `/admin/billing`, deixando `is_active=false` até o momento de cada venda.
2. **Débora 1:1 nos ex-pagantes**: WhatsApp pessoal dela para os 5 pagantes finais primeiro, depois os ~15 demais ex-pagantes. É a ação de maior conversão disponível e custa zero dev. Meta: 8–12 calls agendadas. Agendamento via Cal.com/Google Agenda **externo** (link direto na conversa — a rota `/agendar` fica para a Fase 2).
3. **Roteiro da call com fulfillment** (✅ já suportado pelo sistema desde a Etapa 1): cadastro ANTES da call com o link `https://<app>/auth/sign-up?next=%2Fsettings%2Fbilling%3Fplan%3Dpro-fundador` (o `?next=` sobrevive à confirmação de e-mail e leva direto à oferta destacada); CPF/CNPJ preenchido antes de clicar em assinar (evita o vaivém `billing_profile_required`); fechar → ela clica no card destacado → fatura Asaas com PIX → webhook ativa o Pro em segundos. **Não é mais preciso ligar/desligar o plano**: ele fica `is_active=true, is_public=false` o tempo todo — vendável pelo link, invisível no catálogo. Alternativa concierge (só se o checkout falhar): PIX por fora + `set_org_plan` no `/admin/billing → Subscriptions` — funciona e é auditado, mas não gera renovação automática nem fatura no sistema (anotar a renovação na agenda da operação).
4. **Announcement da oferta** para os usuários logados atuais (level info/warning — nunca critical/vermelho), redigido como "vagas fundadoras" **sem comparar preço** (aparece também para quem paga preço cheio; sem segmentação por plano hoje).
5. **Masterclass com Hellen agendada para a semana 3–4** (dá tempo do funil da Fase 1/2 ficar pronto). **Não anunciar "cupom HELLEN" até o cupom funcionar no checkout** — até lá, a parceria opera por link/página dedicada.
6. **LGPD da base antiga**: documentar a base legal (legítimo interesse com LIA, ou consentimento da relação anterior), com opt-out em todo contato — ANTES do primeiro disparo em massa. Os 500 estão fora deste banco: o outreach é 100% externo (WhatsApp manual + ESP externo; o produto não tem broadcast).
7. **Garantia de 7 dias operada manualmente por enquanto**: publicar os termos (página em `/legal`, T1.5) pode esperar a Fase 1; até lá a garantia vale por escrito na conversa e o reembolso é feito no painel do Asaas (o webhook já reconcilia o estorno).
8. **Decisão (2026-09-26) — a onda da China e do ao vivo vende em autosserviço.** A `/china` e o `/lei-15345` levam direto a `/assinar` (e daí ao checkout encurtado de 2026-09-20), sem call e sem `/agendar`: um evento de um-para-muitos com o botão ao lado da sala escala onde a agenda de calls não escala, e o caminho de compra sozinho já existe. A venda assistida (calls, EPIC 2) continua sendo o caminho dos ex-pagantes e das escolas. A compra que vem do evento é medida pela última campanha gravada no checkout (`meta_attribution.campaign_*` → chaves `last_*` do `Purchase`), nunca por cupom.

## A.4 Fase 1 — dev mínimo que destrava venda escalável (~1 semana)

**P0 (destrava a venda pelo sistema):**
- ✅ **Ocultação de plano + deep-link — ENTREGUE (2026-08-10, Etapa 1)**. Migração `0085_plan_visibility.sql` separa `is_active` (pode ser cobrado) de `is_public` (aparece no catálogo). Um plano `ativo + não público` continua 100% vendável por link, atribuível pelo admin e com entitlement vindo do próprio `limits` — só some das duas grades (`packages/billing/src/public.ts` e `use-billing.ts`). `/settings/billing?plan=<slug>` mostra a oferta mesmo não listada, com destaque, chip "Sua condição" e scroll até o card; link de oferta encerrada exibe aviso explícito em vez de cair na grade normal. Checkbox "Listed in the pricing grids" no `/admin/billing` + chip `unlisted`. Contrato fixado em `packages/db/tests/0023_plan_visibility.test.sql` (10 asserções).
  **Como criar a oferta** (`/admin/billing → New plan`): slug `pro-fundador`, period **Yearly**, price **1990,00**, limits `{"audio_minutes": 6000, "clinical_reasoning": 1, "members": 1}`, **Active ✔ / Listed ✘**. O link de venda é `/settings/billing?plan=pro-fundador`.
  **Enquadramento da tela (2026-08-10, após teste real)**: quem chega pelo link vê o título "Sua condição" e a oferta **sozinha em destaque** — não mais sob "Outros planos", ao lado do Pro mensal e de um convite a testar 14 dias grátis, que convidava a reabrir uma decisão já tomada na call. Os planos normais e a explicação do trial continuam a **um clique** ("Ver os outros planos"): nada é escondido, só reordenado pelo trabalho que ela veio fazer.
- ✅ **Cupom no checkout + `?cupom=` — ENTREGUE (2026-08-10, Etapa 2)**. `startCheckout` agora aceita `couponCode`, valida pela RPC `validate_coupon` (que existia sem nenhum caller) e passa o `CheckoutCoupon` ao provedor — Stripe espelha o cupom nativo (`duration: forever`) e Asaas grava o valor já com desconto, então **o desconto vale em todos os ciclos**. O webhook então grava `coupon_id` na assinatura e conta o resgate sem nenhuma mudança: é isso que torna a parceria **mensurável e remunerável**.
  **Captura do link**: o middleware lê `?cupom=` em QUALQUER rota e guarda em cookie de 30 dias, sobrevivendo ao cadastro, à confirmação de e-mail e aos redirects — inclusive o de login. A tela de assinatura valida sozinha e confirma na hora ("Cupom HELLEN aplicado: 20% de desconto"), com o preço riscado e o novo valor calculado pela **mesma função** que os provedores usam para cobrar (`applyDiscount`, exposta em `@flyee/billing/types` para não arrastar o SDK do Stripe para o browser).
  **Regra dura**: um código inválido/expirado **interrompe o checkout** em vez de cobrar o preço cheio em silêncio — o pior desfecho possível para quem veio por uma promessa de desconto. Cupom vindo de link que não vale mais é dito explicitamente e o cookie é limpo, para uma campanha encerrada não perseguir a pessoa em toda visita.
  **`/planos` público também mostra o desconto (corrigido após teste real)**: a primeira versão só tratava o cupom na tela autenticada, então quem seguia `/planos?cupom=HELLEN` via preço cheio e concluía que o código não funcionou — abandonando antes do cadastro. Agora a página pública resolve o cupom no servidor (`resolvePublicCoupon`, service-role) e mostra o selo "Cupom X aplicado", o preço de tabela riscado e o selo de desconto por card. Cupom inexistente/expirado é **nomeado** ("O cupom X não está mais disponível. Os preços abaixo são os vigentes."), nunca silenciado. O `priceAmount` do JSON-LD segue sendo o preço de tabela de propósito — os dados estruturados descrevem a oferta aberta a todos, e crawlers nunca chegam com código de campanha.
  ✅ **Home também (D12 resolvida, 2026-08-10)**: os cards da home leem a mesma fonte e exibem selo de cupom, preço riscado e selo de desconto. Links de campanha podem apontar para `/?cupom=…`, `/planos?cupom=…` ou direto para a oferta — todos chegam ao checkout com o desconto.
- ✅ **Atribuição — ENTREGUE (2026-08-10, Etapa 3)**. O middleware captura `?origem`, `?onda` e `utm_*` (+ referrer e página de entrada) no **primeiro toque**, em cookie httpOnly de 90 dias — e **nunca sobrescreve**: a campanha que trouxe a pessoa é a que ganhou o cadastro, mesmo que ela volte depois por um favorito. (O cupom é o oposto, último toque, porque digitar um código é ato deliberado.)
  **Persistência**: migração `0086_signup_attribution.sql` cria a tabela por workspace, escrita uma única vez (`on conflict do nothing`) nos dois caminhos de cadastro — confirmação de e-mail (`/auth/callback`) e OAuth (`/auth/complete-profile`, onde o workspace só nasce depois). Leitura só do superadmin; a profissional não vê nem escreve. Apaga junto com o workspace (LGPD).
  **Chega até a venda**: `CompleteRegistration` leva a campanha direto do cookie, e o `Purchase` do webhook leva `origem`/`onda`/`utm_*` + **plano (slug), ciclo e cupom** — antes ele só carregava valor e moeda. Como a oferta Fundadores é uma linha de plano própria, `plan: "pro-fundador"` já responde "foi fundador?" sem campo extra.
  **Aceite verificado por construção**: um cadastro vindo de `/voltar?onda=1&origem=whatsapp` carrega as dimensões até o `Purchase`. Contrato fixado em `packages/db/tests/0024_signup_attribution.test.sql` (8 asserções: primeiro toque vence, valor gigante recusado pelo banco, profissional não lê, operador lê, erasure leva junto).
- ✅ **Reenvio de confirmação de e-mail — ENTREGUE (2026-08-11, Etapa 4)**. `/auth/get-verification` deixou de ser um beco sem saída: o e-mail usado no cadastro viaja por `sessionStorage` (nunca pela URL, que iria parar no histórico e nos logs), vem pré-preenchido e **editável** — porque o erro de digitação no endereço é justamente o caso que traz alguém a essa tela. Botão de reenvio com trava de 60s espelhando o limite do próprio Supabase, e a mensagem de sucesso **não confirma se a conta existe** (a tela é pública). Conforme D13, a confirmação de e-mail permanece ligada.
- ✅ **`Learn more` do announcement → i18n (2026-08-11)**: o CTA do banner e o `aria-label` de dispensar saíam em inglês para uma audiência 100% pt-BR — corrigido nos 5 idiomas. É o botão que leva à oferta Fundadores no anúncio in-app da Fase 0.

**P1 (na sequência, mesma semana ou seguinte):**
- ✅ **Contador de vagas + cerco no checkout — ENTREGUE (2026-08-11, T1.4)**. Migração `0087_founders_offer.sql` cria a RPC `founders_offer()`: **uma única resposta** que alimenta o contador público E o cerco do checkout, para que a página nunca anuncie uma vaga que o pagamento recusaria (nem o contrário, que é como uma oferta de 30 vira 40). Estado calculado de `platform_settings` ('founders': `enabled`, `plan_slug`, `seats`, `deadline`) + contagem viva de assinaturas no plano da oferta.
  **Semântica da vaga**: ocupada por assinatura viva (`trialing/active/past_due`). Consequências deliberadas — checkout abandonado (`incomplete`) **não** queima vaga, e fundador que cancela **libera** a dela. A janela de duas compras simultâneas pela última vaga é aceita, não reservada: as vendas são por call em ritmo humano, e reservar no início do checkout deixaria carrinho abandonado fechar oferta que ainda tinha espaço.
  **Causa nomeada, nunca inferida**: `open | disabled | expired | sold_out | not_configured` — "esgotou" e "o operador ainda não abriu" são idênticos olhando só `seats_left`, e a página precisa dizer coisas diferentes. Quem tenta assinar depois do fim recebe mensagem própria (`billing-offer-closed`), não erro genérico.
  **Console** em `/admin/billing → Founders offer`: abre/fecha, edita vagas e prazo, e mostra a contagem real ao lado — sem deploy e sem SQL. Fechar é **desmarcar "Offer open"**, nunca desativar o plano (isso o tornaria impossível de comprar inclusive para quem está concluindo um checkout). A chave nasce com `enabled: false`: abrir a oferta é decisão datada do operador, não efeito colateral de rodar a migração.
  Contrato em `packages/db/tests/0025_founders_offer.test.sql` (11 asserções percorrendo o ciclo: não aberta → aberta → enchendo → esgotada → cancelamento libera → prazo vencido).
- ✅ **`/fundadores` — ENTREGUE (2026-08-11, T3.1)**. Route group `app/(funil)/` com layout próprio, **sem menu do site**: o header público é uma fileira de saídas da oferta — incluindo a que mata a venda, "Criar conta grátis". Um layout aninhado não consegue REMOVER o que o pai monta, daí o grupo irmão. Traz de volta de propósito `MarketingTrackers`/`MarketingAnalytics` (senão a página de maior intenção do site seria a única sem medição), `CookieConsent` e o widget de suporte — a única saída, para quem precisa perguntar antes de pagar.
  **Contador público — era o buraco que faltava**: `getFoundersOffer()` existia sem nenhum consumidor. O operador via a contagem no admin e o checkout barrava a 31ª venda, mas o visitante nunca via "restam 12 de 30" — a escassez real estava invisível para a plateia. Agora vagas e prazo aparecem, e cada número vem da MESMA função que recusa o checkout.
  **Sem prova fabricada**: o plano pedia 3 depoimentos com nome, foto e cidade. Não existem, e a HOME-SPEC §33.5 proíbe inventar — a página vai ao ar **sem** o bloco, não com um falso. Entra quando as primeiras fundadoras derem depoimentos reais (T4.4).
  **Estados fechados nomeados**: esgotada / prazo vencido / não aberta têm textos diferentes e CTA para contato — nunca um botão morto. `noindex` + fora do sitemap (D10): preço limitado que ranqueia no Google deixa de ser oferta e vira preço. Rota adicionada a `PUBLIC_PREFIXES`.
  **Construída no Landing DS**, não na biblioteca de primitivas — ver a correção de DS abaixo.

- 🔴 **BLOQUEIO COMERCIAL DESCOBERTO NA AUDITORIA (2026-09-10) — franquia de áudio do plano anual**. `pro-fundador` está cadastrado com `limits.audio_minutes = 6000`, copiado do Pro mensal. Mas a franquia é gasta em **um ciclo de cobrança** (`org_audio_allowance`, 0024: a janela é `current_period_start`→`current_period_end`), e o ciclo deste plano é **anual**. Resultado: a fundadora paga R$ 1.990/ano e recebe **6.000 minutos por ANO**, enquanto o Pro mensal entrega 6.000 por MÊS (72.000/ano) e o próprio Assistente entrega 3.000/mês (36.000/ano). Vender isso como "o Pro completo" entrega **um doze avos** do áudio do Pro.
  **Correção (dado, não código)**: em `/admin/billing → Plans`, `pro-fundador.limits.audio_minutes = 72000` — ou revisar a oferta e anunciar a franquia menor. O console de fundadoras agora **alerta** quando um plano anual tem franquia menor que 12× a do Pro, e a landing **imprime** a franquia com o período do plano ("6.000 minutos de áudio por ano"), justamente para que esse erro não volte a ser invisível.
- ✅ **Auditoria da `/fundadores` como LP de oferta e correções (2026-09-10)**. O que mudou, e por quê:
  **Aviso de cookies cobria a oferta**: o `CookieConsent` é `fixed` no rodapé da viewport e, como card alto com botões empilhados, tapava preço e CTA em 375px e o CTA em 1440px — na PRIMEIRA visita, que é a única que um link de campanha produz. Virou barra estreita (uma frase, botões na mesma linha), e a `/fundadores` roda um hero mais curto no mobile (`.offer-page`, escopo próprio, jamais `.clinical-source-home`, que a home também carrega). Medido: em 375×812 o CTA termina em 632px e o aviso começa em 657px.
  **Link sem preview**: a página não emitia nenhuma tag Open Graph e o `<title>` saía com a marca duplicada ("… — MedChina | MedChina", porque o layout raiz aplica o template `%s | MedChina`). Agora há `title: { absolute }`, `openGraph`/`twitter` e um `opengraph-image.tsx` **dentro de `fundadores/`** — no root do grupo `(funil)` a convenção não registra nada, porque não há `page.tsx` ali. `noindex` continua: indexar e compartilhar são decisões diferentes, e mensageiro nenhum lê `robots`.
  **Card OG de todo o site estava azul**: `(marketing)/opengraph-image.tsx` lia `themes.blue`, o padrão do template. Passou a ler `themes.green`, a paleta que a marca de fato usa.
  **Duas respostas da FAQ prometiam o que o sistema não faz**: "parcelamento do seu banco" (o checkout Asaas cria assinatura anual sem `installmentCount` — é cobrança única) e "não há renovação automática indesejada" (a assinatura renova sozinha e os Termos dizem isso). Reescritas para o que o código faz.
  **Prazo sem fuso**: a data era formatada no fuso do servidor (UTC na Vercel), então um corte às 23h59 BRT aparecia como o dia seguinte. Agora `timeZone: "America/Sao_Paulo"`, com hora e a palavra "Brasília" no texto.
  **Console apagava a âncora**: todo Save reescrevia o JSON de `platform_settings.founders` sem `compare_plan_slug`. Agora o campo existe no formulário, o Save faz **merge** sobre o valor atual, e o console mostra o que a página vai renderizar de fato (preço, riscado ou "NO struck price", e a franquia de áudio).
  **Âncora de preço**: a página passou a mostrar sempre o equivalente mensal (aritmética sobre o próprio preço, sem depender de configuração) e, quando há plano de comparação **mensal**, normaliza para o ano dizendo que é isso mesmo ("12 × R$ 299 por mês") — nunca um preço anual que ninguém pagou.
  **Estrutura de oferta que faltava**: bloco de autoridade (Debora Giovanella, com as credenciais já publicadas no deck do congresso — a única prova real disponível enquanto não há depoimentos), "o que acontece depois de clicar" em três passos, CTA intermediário após a garantia, link "já tenho conta" para quem tenta se cadastrar de novo e cai em "confirme seu e-mail" que nunca chega, e a garantia com o **mesmo peso tipográfico do preço** (exigência literal de T3.1 que não estava cumprida: 1,45rem contra 4rem).
  **FAQ ampliada** com as objeções clínicas de HOME-SPEC §4.3 (gravar é opcional; a paciente autoriza; serve para além da acupuntura; o que acontece quando os minutos acabam) e com "já sou assinante" — a troca de plano não credita o período já pago (BILLING-AUDIT A1), e a onda 1a mira justamente os pagantes atuais.
  **Rodapé legal**: a página terminava no CTA final, sem identificação do fornecedor nem termos. Agora há um rodapé mínimo no layout `(funil)` — só termos, privacidade e garantia, cada um em nova aba, para ler os termos não ser uma saída do funil. Pelo mesmo motivo, "Ler os termos da garantia" abre em nova aba.
  **`/contato` passou a ler `?assunto=`** por **allowlist** (nunca o parâmetro cru, que é escrito por quem manda o link): o estado fechado da oferta agora chega com a mensagem já contextualizada.
  **Medição**: `/fundadores` emite `ViewContent` (`content_name: "fundadores"`), o que faltava para montar público de remarketing "viu a oferta e não comprou" — antes só havia `PageView`, igual a qualquer página do site.
  ⬜ **Não corrigido de propósito** (fica para antes da onda 2, volume da masterclass): cerco da vaga N+1 no webhook (hoje a guarda vive só no início do checkout, e PIX/boleto abrem uma janela de dias em que a assinatura fica `incomplete` e não conta vaga); e o `?cupom=` da parceira, que **empilharia** desconto sobre o preço de fundadora — a linha T3.3 abaixo ainda manda `/fundadores?cupom=HELLEN` e contradiz D5; usar `?origem=hellen&onda=2` ou um segundo plano oculto.
  ⬜ **Configuração do operador, bloqueante**: `/admin/support` com WhatsApp humano. Sem isso o `SupportWidget` não renderiza, e ele é a única saída humana do layout `(funil)` e o canal que a página da garantia manda usar.
- ✅ **Campanha paga: a página, a oferta e o consentimento — ENTREGUE (2026-09-17)**. Decisões do usuário nos pontos da auditoria acima, implementadas:
  **`/assinar`** — landing de tráfego frio no grupo `(funil)` (Landing DS, sem menu, `noindex`, fora do sitemap, em `PUBLIC_PREFIXES`, `opengraph-image` própria, `ViewContent` com `content_name: "assinar"` e o ângulo). Herói variável por `utm_content` (`lib/offer-angles.ts`, allowlist de 5 ângulos derivados das dores do HOME-SPEC §4.2; o nome do anúncio começa com o slug). A ARTE do herói é fixa: o palco teal do DS foi ajustado para a composição retrato e uma captura branca quadrada dentro dele lê como azulejo flutuante — verificado na primeira renderização. As capturas reais ficam na seção "Como funciona", com legenda.
  **Oferta como dado, não como deploy** — `platform_settings.campaign_offer` (`enabled`, `plan_slug`, `compare_plan_slug`, `deadline`) via `lib/campaign-offer.ts`. Sem migração: a tabela já é legível por anon e gravável só pelo superadmin. O prazo impresso na página é o MESMO que o `startCheckout` recusa (`offerBlock`, que agora cobre as duas mecânicas — vagas da fundadora pela RPC 0087, prazo da campanha pela linha de settings). Escassez real por construção.
  **Mecânica de desconto (para não aprender caro)**: o preço promocional vive numa LINHA DE PLANO própria, com `compare_plan_slug` apontando para o plano de tabela — o "de/por" é então um preço realmente praticado. Cupom NÃO é alternativa: nos dois provedores o desconto incide em todos os ciclos, então "um mês mais barato" vira preço menor para sempre. E o billing não sabe subir o preço na renovação (sem troca de plano agendada, BILLING-AUDIT A1), logo a página nunca promete renovação em outro valor.
  **Ofertas centralizadas numa aba** — `/admin/billing` passou de "Founders offer" + "Trial offers" para uma aba **Offers** com os três blocos na ordem do funil (campanha → fundadoras → trial). A leitura "o que a visitante vai ver" saiu do console de fundadoras para `components/offer-preview.tsx`, usado pelos dois: preço, riscado que renderiza ou não, franquia de áudio com o período do plano e o alerta de franquia anual copiada do mensal.
  **Consentimento e medição (decisão do usuário)**: o envio server-side CONTINUA após a recusa, e agora isso está declarado onde precisa estar — aviso de cookies nos 5 idiomas, `privacy-7-*` e `cookies-4-*` (legítimo interesse, o que é enviado, canal de oposição) e `docs/TRACKING.md`. `CONSENT_VERSION` foi para `2` para o aviso reaparecer. Mudar o comportamento no código exige mudar essas três cópias no mesmo commit.
  **Textos legais** — política de privacidade reescrita a partir do anexo de tratamento de dados de 2021 que a fundadora forneceu (`attachments/politica-privacidade.pdf`, texto vetorizado, lido por rasterização): mesma divisão controladora/operadora (os dados das pacientes são da profissional), mais os fornecedores reais e a retenção. Cookies com `_fbp`/`_fbc`/`_ga` nomeados. Termos identificando a empresa. Rodapé do `(funil)` com razão social, CNPJ e e-mail (CDC art. 33, e a Meta analisa o destino). `contato@medchina.com.br` do rodapé da home corrigido para o domínio real. **Revisão jurídica concluída** (2026-09-20): os textos publicados são a redação aprovada, e qualquer alteração além de erro de digitação volta para revisão.
  **Prova real** — a foto da fundadora entrou no repositório com o deck do congresso e substituiu o monograma em `/fundadores` e `/assinar`.
  ✅ **Pendências do operador resolvidas por migração (2026-09-20)** — ver `0107_campaign_offer_seed.sql` abaixo. Resta UMA ação humana: marcar "Oferta aberta" na aba Offers. A oferta `founders` segue `enabled` com prazo vencido em 11/09 (a página fecha corretamente por isso); reabrir, estender ou desligar é decisão comercial.
  ⬜ **Não construído nesta rodada**: `/agendar` + entidade de lead + `Lead`/`Schedule`, cerco da vaga N+1 no webhook, lembrete de PIX/boleto pendente, `utm_content` no `Purchase`, variante 640w do herói.
- ✅ **Dois preços na página e uma tela só de checkout — ENTREGUE (2026-09-21)**. Três pontos levantados pelo usuário depois de ver a campanha no ar:
  🐛 **O modo focado do checkout NUNCA ligou em produção.** A condição era `!subscription`, e toda organização nasce com uma assinatura ATIVA do plano Gratuito criada por gatilho de banco (0001_billing.sql). Para qualquer usuário real a condição era sempre falsa. Quem vinha do anúncio caía na tela de configurações inteira: medidor de uso, pacotes avulsos, histórico de faturas, o menu do app ao lado e um cartão anunciando "Seu plano: Gratuito" — que é justamente o que a oferta não menciona. A verificação local não pegou porque lá não havia workspace criado. Corrigido para `subscription.isFree`.
  **`/assinatura`, rota própria fora do grupo `(dashboard)`** — o conserto de verdade. Sem layout herdado, portanto sem menu, sem cabeçalho e sem widget de suporte: um cartão, dados fiscais, resumo do plano e um botão. Salvar o documento e abrir o pagamento viraram o MESMO clique, e o botão diz para onde vai. Precedente da casa: `/onboarding`, `/gravar`, `/consentir` e `/oauth/authorize` já são rotas autenticadas sem cromo, e o `PUBLIC_PREFIXES` do middleware é allowlist, então a proteção sai de graça e o `?plan=` sobrevive ao desvio. O link do anúncio passa por `/auth/sign-up?next=…` de propósito: o desvio do middleware vai para sign-IN, que é a porta errada para tráfego frio, e o middleware já manda quem JÁ tem sessão direto do sign-up para o destino.
  **Mensal e anual na mesma página** (migração 0109 + `annual_plan_slug`). O mensal lidera e o anual fica a um toque, com a economia no rótulo da aba. Só um preço na tela por vez: duas fichas de preço transformam uma página de tráfego frio em exercício de comparação antes de a visitante saber o que o produto faz. Preços: mensal R$ 229 (único número escolhido, entre o teto de R$ 299 da tabela e o piso de R$ 165,83 da condição de fundadora) e anual por D1 (10× o mensal = R$ 2.290, dois meses grátis), com franquia anual 12×. O "de/por" sai R$ 299→R$ 229 (23%) e R$ 3.588→R$ 2.290 (36%).
  **Por que mensal na campanha fria**: a fase de aprendizado da Meta pede ~50 eventos de otimização por semana. A R$ 2.990 por compra o orçamento compra pouquíssimos eventos e a campanha pode nunca sair do aprendizado. Não é preferência de preço, é o que torna a otimização possível.
  **`offerBlock` passou a travar OS DOIS planos.** Travar só o primeiro deixaria o anual vendendo depois do prazo sob o qual foi anunciado — a escassez falsa que o mecanismo inteiro existe para impedir. A `/assinatura` repete a trava antes de renderizar o formulário, para não gastar o CPF da pessoa numa condição já encerrada.
  **Cinco travas de aplicação na 0109**, todas para defeitos que não derrubam nada: preço acima da âncora (o riscado some calado), anual pior que 12× a âncora, anual pior que 12 meses do próprio mensal, cota anual copiada da mensal, e campanha mais barata que a condição de fundadora.
  ⬜ **Ação do operador**: a 0109 aponta a campanha para as linhas novas preservando `enabled` e `deadline`, mas só se ninguém tiver mudado o plano desde a 0107. Confira a aba Offers depois de aplicar.
- ✅ **Cadastro da campanha vira migração — ENTREGUE (2026-09-20)**. `packages/db/migrations/0107_campaign_offer_seed.sql`. O que era "digite isto no console" virou linha de banco versionada, porque as três pendências eram justamente as que não se deve digitar:
  **`guarantee` = 30 dias.** Esta chave não tem console NENHUM, por decisão de `lib/guarantee.ts` ("extending a legal commitment should be a deliberate act"). Sem a chave, toda página anunciava o piso do CDC de 7 dias. Um compromisso legal que só existe como SQL avulso não é auditável; agora está no histórico de migrações.
  **`pro-anual` = R$ 2.990/ano, oculto, 72.000 min.** Nada foi inventado: `docs/FUNIL.md` §0 proíbe a IA de inventar estes valores, então o preço é a decisão **D1** já ratificada ("anual = 10× o mensal, 2 meses grátis"), escrita como `pro.price_cents * 10` e não como literal, e a franquia é `12 ×` a mensal — que é literalmente o defeito que a `pro-fundador` carregou até ser corrigida. O "de/por" que a página mostra é R$ 3.588 → R$ 2.990 (17%), com a âncora anualizada e declarada ("12 × R$ 299 por mês"). A condição de fundadora (R$ 1.990/ano) continua sendo a melhor da casa, que é o que impede tráfego frio de canibalizar uma condição vendida pela reputação da fundadora.
  **`campaign_offer` com os slugs prefixados e `enabled: false`.** Mesmo motivo escrito na 0087: abrir a oferta é decisão de operador com data, não efeito colateral de rodar migração. E um prazo escrito numa migração nasce vencido — `resolveCampaignOffer` compara com `now()`.
  **Paridade de catálogo**: a linha `pro-fundador` existia só em produção, digitada à mão, e em nenhuma migração — um ambiente novo subia com a oferta de fundadoras apontando para um slug inexistente. A migração a semeia (no-op em produção, `on conflict do nothing`).
  **Duas travas de aplicação**: a migração se RECUSA a aplicar se o preço da campanha ficar acima da âncora normalizada (o riscado sumiria em silêncio) ou se a franquia anual ficar abaixo de 12× a mensal (a página prometeria por ano o que o plano mensal dá por mês). São os dois defeitos que não derrubam nada e por isso ninguém vê.
  🐛 **Defeito encontrado ao verificar a migração, e corrigido junto**: as duas páginas de oferta resolviam a linha de plano ANTES de checar se a oferta estava aberta (`const plan = offer?.planSlug ? ... : null`), e a FAQ, que fica fora do bloco `open && plan`, lia esse plano. Resultado: assim que o cadastro passasse a existir com a oferta ainda fechada, a página diria "não está aberta no momento" no herói e, oito parágrafos abaixo, "a assinatura é renovada a cada ano" e "o plano inclui 72.000 minutos de áudio por ano" — anunciando os termos de uma campanha que não começou. Reproduzido numa renderização real antes de corrigir. Agora `plan` só é resolvido para oferta aberta, e o estado fechado volta ao texto genérico ("a cada ciclo"). O mesmo vazamento existia em `/fundadores`, onde só não aparecia porque a linha já existia em produção.
  ⚠️ **Consequência contraintuitiva de `enabled: false`**: `offerBlock` recusa o checkout de qualquer plano nomeado por oferta fechada, então `pro-anual` é invendável até a caixa ser marcada — inclusive por link direto. É o estado certo agora, mas publicar o anual em `/planos` no futuro exige tirar o slug de `campaign_offer.plan_slug` no mesmo movimento, senão todo clique bate em "esta condição não está mais disponível".
- ✅ **Caminho pós-CTA encurtado e prova social preparada — ENTREGUE (2026-09-20)**. Quatro pontos levantados pelo usuário:
  **Onde os CTAs levam** (a pergunta): não para a tela de pagamento. `/assinar` e `/fundadores` mandam para `/auth/sign-up?next=/settings/billing?plan=<slug>`, e o pagamento é a quarta tela. Não dá para mandar direto ao checkout porque `startCheckout` é uma server action que exige org + membership + CPF/CNPJ: sem conta não existe a quem cobrar. O que dava para encurtar foi encurtado.
  **Cadastro em modo oferta** — quando o `next` aponta para `/settings/billing`, o formulário perde o campo "nome do consultório" (a área de trabalho nasce com o nome dela, renomeável em Configurações; sem isso o gatilho `handle_new_user` não cria organização e ela cairia em `/auth/complete-profile`). Três campos em vez de quatro, título e botão dizendo o que vem depois, e "Passo 1 de 3" — um formulário sem fim visível lê como burocracia mesmo quando é curto.
  **Confirmação de e-mail** — continua sendo a maior perda do caminho e é configuração do projeto Supabase, não código. O que o código passou a fazer: `/auth/get-verification` diz, para quem está comprando, que o link devolve direto à tela de pagamento.
  **Tela de cobrança em modo checkout** — chegando com `?plan=` e sem assinatura, `/settings/billing` mostra só o que conclui a compra (dados fiscais + o plano) e esconde medidores de uso, pacotes avulsos e histórico de faturas, com link para a tela completa. E salvar o CPF/CNPJ **abre o pagamento no mesmo clique** (o botão diz isso): preencher documento nunca foi um passo que ela quis dar, é exigência do provedor — antes, o último passo da compra era apertar de novo um botão que ela já tinha apertado.
  **Cartões "Você reconhece?" reescritos** — os títulos eram rótulos do problema vistos de fora ("Um prontuário emprestado"); agora são frases que a leitora diria ("No meu sistema não existe campo para língua e pulso").
  **Depoimentos** — `lib/testimonials.ts` + `(funil)/components/offer-testimonials.tsx`, nas duas páginas de oferta. Os textos são provisórios e **não vão ao ar**: a entrada só renderiza em produção com `approved: true`, que exige o texto real e a data do consentimento; sem nenhuma aprovada a seção inteira some. Em desenvolvimento aparecem com aviso, para conferir layout. É o interruptor que impede um texto de marcação virar prova social por esquecimento (HOME-SPEC §33.5).
- ✅ **Preços da home religados ao banco (T7.2/D12)** — entregue em 2026-08-10.
- ⚠️ **Correção de design system (2026-08-11, decisão do usuário)**: landing pages e páginas externas seguem o **mesmo DS da home** (`clinical-source-home.tsx` + seu CSS), não a biblioteca genérica de `components/marketing/*`. O `docs/DESIGN.md` dizia o oposto — tratava a home como "exceção nomeada, não um precedente" e mandava não estendê-la. Corrigido em `docs/DESIGN.md` (nota de escopo + seção "The Landing DS"), `.claude/rules/marketing.md`, `apps/web/CLAUDE.md` e no hook `marketing-lint.mjs`, cuja allowlist deixou de ser dois nomes de arquivo e virou **regra de caminho** (`app/(funil)/**` + os dois `clinical-source-home.*`) — antes, cada página de campanha nova exigia editar o hook antes de poder existir. A biblioteca continua governando as páginas institucionais.
- ✅ **Termos da garantia publicados — ENTREGUE (2026-08-11, T1.5 — metade "página")**. `/legal/garantia`, ligada no rodapé e no sitemap. O prazo vem de `platform_settings` ('guarantee') via `lib/guarantee.ts`, **com piso legal de 7 dias** (CDC art. 49 — um valor configurado abaixo disso seria nulo, então é travado por construção, não confiado). Página e futuro `refund_eligible_until` leem o mesmo número: página prometendo 7 e sistema contando 5 é exatamente o tipo de divergência que transforma reversão de risco em reclamação.
  **A cláusula que mais importa é a clínica** (§4): pedir reembolso não apaga nada — a conta volta ao Gratuito, todo o histórico continua legível e editável, e a exportação completa existe em qualquer plano. Isso é **verdade verificada**, não promessa de marketing: o prontuário permanece legível quando o plano acaba (0024) e o export não tem gate de plano (0081). A objeção real a um reembolso neste produto nunca é "recebo meu dinheiro de volta", é "perco os prontuários das minhas pacientes".
  Também explicitado: não descontamos minutos de IA já usados (descontar seria multa por ter testado, não garantia), o estorno depende do meio de pagamento (honesto sobre prazos fora do nosso controle), e a garantia **soma-se** ao direito legal, nunca o reduz.
  ⬜ **Falta a outra metade de T1.5**: campo `refund_eligible_until`, solicitação no painel e ação de reembolso no admin chamando a API do provider. Depende de T1.7 (C1–C4 do BILLING-AUDIT — estorno Asaas está fora do domínio hoje).

- ✅ **Página de autoridade `/china`, evento ao vivo `/lei-15345` e console `/admin/leads` — ENTREGUE no código (2026-09-26; deploy pendente)**. Specs canônicas: `docs/PAGINA-CHINA.md` e `docs/PAGINA-EVENTO.md` (referenciar, não redescrever). O congresso foi em 19/09; os termos de consentimento e a política de privacidade saíram do provisório e estão definitivos nos seis idiomas.
  **`/china`** — indexada, no grupo novo `(autoridade)` com o cabeçalho e o rodapé da home (extraídos para `home-header`/`home-footer`/`home-brand`), `Article` em JSON-LD, fontes oficiais da Lei 15.345, o deck público em `/palestra/publica` (mesmos slides do palco, sem roteiro nem notas — removidos no servidor) e três CTAs por `getSellableCampaign()` medidos por `CtaClick`.
  **`/lei-15345`** — `noindex`, em `(funil)`; os quatro estados na mesma URL; inscrição com nome + WhatsApp (celular normalizado, fixo recusado) + e-mail opcional, dois termos versionados, link pessoal com QR, grupo e conversa por redirecionamento que nunca expõe o convite nem o número, sala que se abre sozinha na página aberta antes da hora, presença medida pela própria página (só durante o ao vivo), gravação com captura curta e e-mails em lote com descadastro de um clique.
  **Verificado de ponta a ponta contra o banco local** (2026-09-26): cada estado fotografado em 375/1440, validações e mensagens, repetição de número, honeypot, redirecionamentos (`no-store`, `no-referrer`), virada automática para a sala, captura pós-evento, e o console gravando e auditando cada ação. **Defeitos encontrados e corrigidos na verificação:** presença gravada fora do ao vivo (e durante a gravação) — agora recusada no banco; a confirmação da captura pós-evento sumia com o `refresh`; os textos do pós-evento prometiam "seu lugar está garantido" para um evento que já tinha passado; QR e link pessoal perdidos ao recarregar; o pôster do vídeo em faixas brancas e o player com divergência de hidratação; data em Title Case ("Quinta-Feira, 8 De Outubro"); o deck público invisível no celular (o canvas ia para fora da tela abaixo de 1280 px); o telefone do público de anúncio exportado como `'+55…` (inutilizável na Meta); as ações por linha do console fora da tela num notebook; `updated_by` nunca preenchido.
  **Antes de ir ao ar:** aplicar a `0112` em produção; `CHINA.publishedAt` com a data real; abrir o evento em `/admin/leads` (data, número dono, convite); SPF/DKIM do Resend; opcional `LEAD_HASH_SALT`.

## A.4.1 Ofertas de conversão no trial — ENTREGUE (2026-08-11)

⚠️ **Defeito encontrado ao avaliar a ideia**: o drip do trial (`lib/trial-jobs.ts`) é 100% ancorado no **calendário** — welcome, T+2d, `ends_at−3d`, `ends_at`. O próprio comentário do código admite a lacuna ("the minutes dimension is handled in-app by the allowance"). Consequência: quem adota de verdade queima os 300 minutos (~6 consultas) em 2-3 dias, é bloqueada no dia 3, ouve silêncio até o dia 11 — e então recebe um e-mail dizendo que o trial "está expirando", **oito dias depois de ter acabado**. O texto é falso para ela. A melhor prospect era a pior servida.

**Solução (migração `0088_conversion_offers.sql`)**: a oferta passa a ser disparada por **momento de intenção**, não por data. Dois gatilhos, escolhidos por razões diferentes:

| Gatilho | Quando | Por quê |
|---|---|---|
| `first_consultation` | 1º prontuário finalizado (`api/consultations/[id]/finalize`, mesmo instante do evento `Activated`) | **Pico emocional** — ela acabou de ver a consulta virar anamnese estruturada. O produto deixou de ser promessa. |
| `usage_80` | 80% dos minutos do trial (`lib/usage.ts`, junto do alerta que já existia) | **Pico de necessidade**, e deliberadamente **antes da parede**: para ferramenta clínica, bloquear no meio do trabalho e então vender é a troca errada — há paciente na sala. |

**O que separa isso de um cronômetro fake** (tudo fixado em `packages/db/tests/0026_conversion_offers.test.sql`, 12 asserções):
- `expires_at` é carimbado **uma vez**, no servidor. A UI lê aquele instante — recarregar a página não compra tempo.
- `unique (org_id, trigger)`: cada momento acontece **uma vez por workspace, para sempre**. Oferta que reaparece depois de expirar não é oferta, é o preço com um relógio desenhado em cima.
- Nunca duas ao mesmo tempo: cruzar os 80% com a oferta de ativação ainda viva não empilha um segundo prazo sobre a mesma decisão.
- Quem já paga **nunca** vê — dar desconto a quem comprou a preço cheio é como um lançamento perde os clientes que já tem.
- Dispensar é definitivo (`dismissed_at`), não some-até-recarregar.
- O benefício é **congelado na linha** ao abrir: mudar a campanha depois não reescreve promessa já feita.

**Surface**: cartão em `/inicio` com contagem regressiva real + a data-hora exata (ela confere no próprio relógio), CTA para `/settings/billing?cupom=<code>` — reaproveitando integralmente a máquina da Etapa 2, que aplica e confirma o cupom visualmente. Sino toca só no gatilho de ativação; o de 80% já tinha alerta próprio e dois avisos seguidos viram nagware.

**Console** em `/admin/billing → Trial offers`: liga/desliga a campanha e cada gatilho, define janela e cupom, e mostra **abertas × convertidas por gatilho** — poucas aberturas é problema de gatilho, muitas aberturas com pouca conversão é problema de oferta, e são consertos diferentes. `converted_at` é carimbado pelo webhook só se a assinatura ativou **com a oferta ainda viva**.

⚠️ **Armadilha de margem, avisada no console**: os dois provedores aplicam cupom em **todos os ciclos** (Stripe `duration: forever`, Asaas grava o valor já com desconto). Um código de 20% aqui é 20% enquanto ela ficar, não "desconto no primeiro mês". Dimensione o percentual sabendo disso, ou use `valid_until` no cupom.

**Não implementado (recomendação de margem)**: o benefício ideal para MTC seria **minutos bônus** em vez de desconto — custa ~R$1/consulta de COGS contra R$40/mês eternos de um desconto de 20% sobre R$199, e é exatamente o que ela precisa no momento do gatilho. Exige conceder via `grant_audio_minute_pack()` no webhook. Fica como próximo passo natural.

## A.5 Fase 2 — para a onda Hellen e a base antiga (semanas 2–4)

- `/voltar` + redirect de `/migracao` (T3.2) — o copy atual ("migração avaliada caso a caso") **contradiz a capacidade real** do produto (pipeline de import entregue) e deve morrer antes do disparo à base.
- Página de captação da masterclass + evento `Lead` (T3.3; call site é o que falta — o tipo já existe). Grupo de WhatsApp gerido manualmente.
- Vídeo `/demonstracao` (T3.5, vidstack já é dependência; self-host ou click-to-load por causa do consent).
- Evento `Schedule` + `/agendar` próprio (T2.x) — até lá, Cal.com externo resolve.
- Painel semanal: começar com perguntas salvas no `/admin/insights` (T5.2 depois).

## A.6 Sequência comercial recomendada (quem, quando, meta)

| Onda | Quem | Quando | Mecanismo | Meta realista |
|---|---|---|---|---|
| 1a | 5 pagantes finais + 15 ex-pagantes | Semana 1–2 | WhatsApp pessoal da Débora → call → fechar | 5–8 fundadores; **cada um gera depoimento com consentimento** (destrava T4.4/T3.1) |
| 1b | ~480 cadastros antigos | Semana 3+ (após `/voltar` + atribuição) | ESP externo + WhatsApp manual → `/voltar` → call | 10–25 calls; 3–8 fundadores |
| 2 | Audiência da Hellen (14k) | Semana 3–4 | Masterclass (Instagram + grupo WhatsApp) → replay → `/fundadores` com link/cupom da parceira | 100–300 leads; 10–20 fundadores |
| 3 | Escolas de MTC | Mês 2 | `/escolas` + reunião com coordenação | pipeline recorrente, não vendas imediatas |

Racional: a base antiga já converteu a ~4% no histórico e foi queimada uma vez — ela sozinha não enche 30 vagas; a audiência da Hellen é o único ativo com alcance para isso. Os ex-pagantes vêm primeiro porque têm a maior probabilidade de fechar E são a fonte dos depoimentos que a landing da onda 2 precisa. O conteúdo orgânico em curso alimenta retargeting (pixel opt-out já coleta) e aquece a onda 2 — não interrompê-lo.

---

## 0. Decisões de negócio necessárias ANTES do desenvolvimento

Estes valores são entradas de configuração. A IA de desenvolvimento **não deve inventá-los** — deve implementá-los como parâmetros configuráveis e solicitar os valores. No padrão deste repo, "configurável" significa **linha de banco**: catálogo em `plans` (editável em `/admin/billing`) e parâmetros operacionais em `platform_settings` (migração 0018; chaves existentes: `trial`, `dunning`, `support`, `imports`, `recording`, `account_exports`, `impersonation`).

| # | Decisão | Valor | Onde vive |
|---|---|---|---|
| D1 | ✅ **Preço anual (2026-08-10)**: anual = 10× o mensal (2 meses grátis). **Assistente R$1.990/ano** (`199000` cents), **Pro R$2.990/ano** (`299000` cents) | decidido | novas linhas em `plans` (period `yearly`) — enum e providers já suportam (T1.1) |
| D2 | ✅ **Oferta Fundadores (2026-08-10)**: acesso **Pro pelo preço do Assistente anual = R$1.990/ano** (R$166/mês), 12 meses, preço travado enquanto a assinatura viver. Mecânica escolhida: **plano dedicado oculto**, não cupom | decidido | linha `pro-fundador` (period yearly, `price_cents` 199000, limits do Pro, `is_public=false`) — T1.3 |
| D3 | ✅ **30 vagas** (2026-08-10) | decidido | `platform_settings` key `founders` |
| D4 | ✅ **30 dias** a partir da abertura da oferta; encerra no que vier primeiro (vagas ou data) | decidido | `platform_settings` key `founders` |
| D5 | Percentual/valor do cupom da parceira | ex.: `HELLEN` = mesmo benefício + atribuição. **Nota**: com D2 = plano oculto, a oferta da Hellen pode ser um **segundo plano oculto** (`pro-fundador-hellen`, mesmo preço) — o cupom fica para desconto/atribuição em campanhas futuras | `coupons` (entidade já existe; T1.2) |
| D6 | Capacidade semanal de calls | inteiro (base: 20; pico: 30) | `platform_settings` OU limites do Cal.com — decidir em T2.1 |
| D7 | ✅ **Substituída (2026-09-26) por `live_events`**: tema, data, hora, convite da Comunidade, número dono, transmissão e gravação de cada evento vivem na **linha do evento** (migração `0112_leads.sql`), editada em `/admin/leads` — um evento é uma entidade com estado (`rascunho → inscricoes → ao_vivo → encerrado`), não uma chave de configuração. A chave `masterclass` não será criada; a masterclass (T3.3) é outra linha dessa tabela | decidido | `live_events` |
| D8 | Política do plano Gratuito | ver EPIC 7 — ⚠️ reformulado: **não há divergência jurídica**; a decisão é manter o ilimitado real ou introduzir limites (exige construir grandfathering) | `plans.limits` |
| D9 | WhatsApp automático nas confirmações/lembretes | **ativar Meta Cloud API** (código pronto em `packages/whatsapp`; exige verificação de negócio + templates aprovados + custo/msg — prazo de semanas) OU **handoff `wa.me`** (padrão atual da agenda clínica, envio manual) | env vars + decisão operacional (T2.2) |
| D10 | Indexação das landings de funil | /fundadores, /voltar, /masterclass: entrar no sitemap ou `noindex`? (recomendação: noindex + fora do sitemap; registrar a exceção para o lint de marketing não "corrigir") | metadata das páginas |
| D11 | Equivalência minutos→consultas | PRD e código usam consulta de referência de **50 min** → 3.000 min ≈ **60 consultas** (`plans.ts:40`, PRD §5.2). Confirmar 60 ou mudar o PRD junto | `plans.ts` + i18n + PRD |
| D12 | ✅ **Home religada ao banco (2026-08-10)**: os cards de preço passaram a ler `getDisplayPlans()` — a mesma fonte de `/planos` e do checkout. Preço, período, nome, descrição e o que está incluído vêm de `plans`; no código ficou só a apresentação (ícone, kicker, selo, texto do botão), mapeada por slug com fallback para slugs desconhecidos. O restante do componente segue hardcoded em pt-BR — isso é dívida separada, não bloqueia venda | decidido | `app/(marketing)/page.tsx` + `clinical-source-home.tsx` |
| D13 | ✅ **Confirmação de e-mail (2026-08-10)**: **manter ligada** no Supabase e implementar o **botão de reenvio** em `/auth/get-verification` (hoje quem não recebe o e-mail fica sem saída). Protege a validade do e-mail, de que dependem o drip do trial e a confirmação de assinatura | decidido | Etapa 4 (T4-P0) |

---

## 0.5 Convenções obrigatórias do repo (valem para TODAS as tarefas)

1. **Toda tabela nova**: migração em `packages/db/migrations` com RLS + `select public.enable_row_versioning('public.<tabela>')`; **testes pgtap** em `packages/db/tests` para RPCs/policies novas (padrão do commit 3996a02 — os testes pinam funções por `regprocedure`).
2. **Toda mutação server-side**: `recordAudit` (`apps/web/src/lib/audit.ts`).
3. **Toda rota pública nova**: adicionar a `PUBLIC_PREFIXES` em `apps/web/src/middleware.ts` (senão redireciona para login) + `apps/web/src/app/sitemap.ts` (ou exceção noindex — D10); copy no namespace `marketing` nos **6 locales** de `packages/content/messages/` (só pt-BR é indexado); `generateMetadata` com canonical; exatamente um `<h1>`; JsonLd via componente. Os hooks `marketing-guard`/`marketing-lint` impõem a skill e o contrato automaticamente.
4. **Direção visual**: `docs/DESIGN.md` é ESTRITA e herdada por toda página nova. Se /fundadores exigir estética de resposta direta divergente, pedir explicitamente "redesign" dessa página — senão a skill construirá no padrão comprometido. Depoimentos/métricas fabricados são proibidos (`docs/DESIGN.md` + HOME-SPEC §33.5) — publicar exige material real E atualizar esses contratos junto.
5. **Preços/limites/vagas/datas**: linhas de banco, nunca constantes. `platform_settings` é o mecanismo de flag sem deploy — leitura **pública por design** (nunca segredos); cada flag de campanha precisa de card de edição num console admin (hoje só a key `support` tem UI — ver T6.6).
6. **`sendEvent` (Inngest) nunca lança**: todo caller precisa de fallback inline; drip/cron **não roda sem chaves Inngest** configuradas.
7. **Vermelho apenas para risco/falha** (PRD §10) — contador de vagas e urgência de oferta não usam vermelho.
8. **Mobile**: por política de loja (PRD §4.4), NENHUMA oferta/checkout/CTA de compra nas telas do app. Campanhas por WhatsApp levam à web. O trial pode iniciar por ação no mobile (0084) — verificar que o fluxo mobile também dispara `StartTrial`.

---

## EPIC 1 — Billing: plano anual, cupom e oferta Fundadores
**Bloqueia:** todas as ondas. Sem isto não existe oferta.

### T1.1 — Criar ciclo de cobrança anual
**Estado: 🟡** — a infraestrutura anual existe de ponta a ponta: enum `billing_period` já tem `yearly` (0001_billing.sql:30), Stripe usa `interval: year`, Asaas usa `cycle: YEARLY`, o webhook calcula `period_end` de 12 meses e o `admin_metrics` já normaliza MRR anual. O que **não** existe: nenhuma linha de plano anual seedada (0024 só cria monthly) e nenhum toggle na UI.
- O modelo é **1 preço por linha** de `plans` — criar novas linhas (`assistente-anual`, `pro-anual`) via `/admin/billing` ou migração; nada do engine de billing muda.
- Toggle mensal/anual agrupando planos por família no `PricingSection` (`/planos`) e no `plans-grid` (`/settings/billing`), com anual pré-selecionado.
- Exibir valor total e o equivalente mensal ("R$ X/ano · equivale a R$ Y/mês").
- Cards da home dependem da decisão D12 (hoje hardcoded).
- **Aceite:** é possível assinar Assistente anual e Pro anual em produção, com recibo correto e renovação agendada para 12 meses.

### T1.2 — Ligar o sistema de cupons ao checkout
**Estado: ✅ ENTREGUE (2026-08-10)** — ver o registro na Fase 1 (A.4). O que segue descreve o ponto de partida.
~~**Estado: 🟡**~~ — ⚠️ a entidade `coupons` JÁ existe (code, percent|fixed, valor, validade, `max_redemptions`, `redeemed_count`, ativo — 0001_billing.sql:86-98) com console CRUD em `/admin/billing`, aplicação nos dois providers e **atribuição permanente já implementada**: o webhook grava `coupon_id` na assinatura e incrementa redemption (`api/webhooks/[provider]/route.ts:370-391`). Porém está **inerte**: `startCheckout` não aceita cupom, não há campo na UI do cliente, nenhum handler de `?cupom=`, e o RPC `validate_coupon` (0001:323) não tem nenhum caller.
- Aceitar `coupon` em `startCheckout` (`settings/billing/actions.ts`), validando via `validate_coupon` e passando `CheckoutCoupon` ao provider (já suportado) — o webhook então faz a atribuição sem mudança.
- Campo de cupom no checkout com confirmação visual ("Cupom HELLEN aplicado").
- `?cupom=CODIGO`: persistir em cookie de primeiro toque (sobrevive a navegação e ao redirect de auth — mesmo requisito da atribuição T5.0) e pré-preencher no checkout.
- Gravar também o **código legível** junto da atribuição (hoje só o FK `coupon_id`; revenue share da parceira precisa do code — join resolve, mas explicitar no relatório).
- `grant_de_tier`/`ciclos_aplicaveis` **não existem** — só criar se a decisão de T1.3 for por cupom (a recomendação abaixo dispensa).
- **Aceite:** cupom aplicado por URL persiste durante toda a sessão de checkout, mesmo com navegação intermediária, e fica gravado na assinatura.

### T1.3 — Mecânica da oferta Fundadores
**Estado: ⬜** — nada existe (nenhum campo `is_founder`/`price_locked` no schema; grep no repo = zero). O adjacente mais próximo é `set_org_plan` (0067 — plano comped pelo superadmin, sem cobrança).
**Recomendação revista (menor atrito no modelo atual): linha de plano dedicada, não cupom.** Criar plano `pro-fundador`: `price_cents` do Assistente anual + `limits` do Pro (`clinical_reasoning:1`, `audio_minutes:6000`). `org_entitlements` e `org_audio_allowance` leem `plans.limits`, então o entitlement Pro e o preço travado saem **de graça** da própria linha — a renovação mantém o preço enquanto a assinatura viver, e `is_active=false` fecha a oferta para novos sem afetar quem já assinou.
- Migração em `subscriptions` apenas se relatórios/eventos precisarem do flag explícito: `is_founder` (bool) e `grant_expires_at` — alternativa: derivar de `plan_id`.
- Se o fundador cancelar e voltar depois, o plano não está mais em catálogo → o preço travado se perde automaticamente (regra do documento atendida por construção).
- **Aceite:** conta fundadora tem acesso a todas as features Pro, é cobrada pelo valor do Assistente, e a simulação de renovação em 12 meses mantém o valor travado.

### T1.4 — Contador de vagas real + cerco na compra
**Estado: ⬜** — nenhum endpoint/contador/waitlist existe.
- Endpoint que retorna `vagas_totais`, `vagas_usadas`, `vagas_restantes`, calculado no servidor da contagem real de assinaturas do plano fundador. Cache de até 60s. **Não** implementar contador falso, decrescente por tempo ou aleatório.
- Teto e data em `platform_settings` key `founders` (`{enabled, seats, deadline}`) — leitura pública por design, a página lê via anon client; edição via console (T6.6).
- **Cerco na compra (novo — o contador sozinho não impede a 31ª venda):** `startCheckout` do plano fundador recusa quando contagem ≥ teto, e o webhook aplica a defesa final (checkouts em voo + cache de 60s tornam o contador apenas indicativo).
- Quando `vagas_restantes = 0`: substituir CTA por captura de lista de espera (entidade de lead T2.0, segmento `waitlist`).
- **Aceite:** o número na página corresponde à contagem de assinaturas fundadoras no banco, e é impossível assinar a vaga N+1.

### T1.5 — Garantia de 7 dias e fluxo de reembolso
**Estado: ⬜ (lado ativo)** — a metade **passiva** já existe: refund/chargeback iniciado no provider é reconciliado pelo webhook (`payment_reverted` → `revert_paid_invoice`, com estorno de pack de minutos — 0069_billing_reliability.sql). Não existem: página de termos, `refund_eligible_until`, solicitação no painel, ação de refund no admin.
- Página de termos da garantia em `app/(marketing)/legal/`, **versionada via `consent_terms`** (packages/audit — mecanismo de versionamento pronto; não inventar outro).
- Campo `refund_eligible_until` = data da compra + 7 dias, na assinatura (migração).
- Fluxo de solicitação no painel do usuário (não só por e-mail) + ação de reembolso no admin que **chama a API de refund do provider**, com registro de motivo e `recordAudit`.
- Dependência: os achados C1–C4 do `docs/BILLING-AUDIT.md` (T1.7) — estorno Asaas está fora do domínio hoje.
- **Aceite:** solicitação dentro da janela gera ticket no admin; fora da janela, mensagem clara e canal de contato.

### T1.6 — Telemetria de custo por tier
**Estado: ⬜** — nenhum custo de IA é registrado em lugar nenhum. As colunas `messages.tokens_in/tokens_out` existem desde 0002 e **nunca são escritas**; `packages/ai` e `packages/transcribe` descartam o `usageMetadata` dos providers. O proxy mais próximo é `audio_usage` (minutos consumidos por org — unidade de cobrança, não custo).
- Passo 1 (barato): capturar o usage dos providers e preencher `tokens_in/tokens_out`.
- Passo 2: ledger `ai_costs` (consultation_id, etapa `transcricao|inferencia`, provider, model, tokens, custo estimado, tier) escrito nos pontos únicos do pipeline (`lib/clinical-pipeline.ts`, `lib/clinical-reasoning.ts`, job de transcrição).
- Relatório no admin: custo médio por consulta, por tier, por mês.
- **Justificativa:** o custo de R$ 1,00 refere-se ao fluxo de documentação. O Pro executa inferência adicional e o custo real precisa ser medido antes de escalar a oferta Fundadores, que concentra volume no Pro.
- **Aceite:** o relatório mostra custo médio por tier com base em dados reais de produção.

### T1.7 — Resolver pendências críticas do billing (NOVA)
**Estado: ⬜** — `docs/BILLING-AUDIT.md` (C1–C4) documenta: webhook Asaas com 500 permanente, cliente sem cpfCnpj, `SUBSCRIPTION_DELETED` não tratado, estorno/chargeback fora do domínio Asaas. A oferta Fundadores (anual + cupom + garantia de 7 dias) atravessa exatamente esse caminho.
- **Aceite:** C1–C4 resolvidos e verificados; entra no portão de largada da Onda 1.

---

## EPIC 2 — Agendamento (`/agendar`)
**Bloqueia:** Ondas 1, 2 e 3. É o mecanismo central de todo o plano.

> **Fora deste EPIC (decisão de 2026-09-26, A.3 item 8):** a onda da China e do ao vivo sobre a Lei 15.345 vende em autosserviço — `/china` e `/lei-15345` → `/assinar` → checkout —, sem call nem `/agendar`. Este EPIC continua valendo para a venda assistida (ex-pagantes, escolas).

⚠️ **Colisão de nomes a registrar**: já existe `/agenda` — a agenda **clínica** autenticada da profissional (consultas de pacientes; uma consulta agendada é uma linha de `consultations` com status `scheduled` — 0027_agenda.sql, com conflito de horário, séries e briefing). `/agendar` (comercial, público) é outra coisa: copy, menus e eventos de analytics devem mantê-las separadas.

### T2.0 — Entidade de lead/agendamento (NOVA — pré-requisito comum)
**Estado: 🟡 em andamento (2026-09-26)** — a entidade existe: `leads` (migração `0112_leads.sql`), platform-level e sem `org_id`, um registro por WhatsApp (11 dígitos), com nome, e-mail, `segmento` (hoje `live`), `onda`, `cupom`, o primeiro toque completo (`origem`, `utm_*`, referrer, página de entrada) e o termo opcional de novidades fixado na linha (id + versão + texto — T2.4 opção b). É o primeiro formulário público do repo escrevendo em banco: escrita só pela RPC `submit_live_event_registration` (service role) atrás de honeypot e janela por rede (`sha256(sal + IP)`), com um lead por telefone e repetição que nunca reescreve os dados. RLS superadmin, versionamento, retenção (`purge_expired_leads`) e exclusão LGPD (`purge_lead`), fixados em `packages/db/tests/0042_leads.test.sql`. A inscrição por evento vive em `live_event_registrations`. **Falta para fechar T2.0**: os campos da call (já usou a versão anterior, faixa de pacientes/semana), `status` e histórico de contato — entram com T2.1/T6.4, na mesma tabela.

Antes (registro do ponto de partida): não existia nenhuma tabela de lead, contato comercial ou lista de espera no schema (o formulário `/contato` é fire-and-forget por e-mail, nada vai ao banco). Esta entidade é o ponto único de persistência de T2.1 + T2.3 + T2.4 + T1.4-waitlist e a base de T6.4.
- Tabela **platform-level, sem `org_id`** (lead pré-conta): nome, WhatsApp, e-mail, flag "já usou a versão anterior", faixa de pacientes/semana, `origem`, `onda`, `cupom`, `segmento`, `status`, histórico de contato, consentimentos (ver T2.4).
- Leitura superadmin-only (RLS); escrita via service role em server action pública **com anti-abuso** (rate limit + honeypot — não há precedente no repo de formulário público escrevendo em banco).
- RLS + row versioning + pgtap (convenções §0.5).
- **Aceite:** criar/listar/filtrar leads com origem persistida; abuso de bot não polui a tabela.

### T2.1 — Página e motor de agendamento
**Estado: ⬜** — nenhuma rota `/agendar`, nenhum motor de slots, nenhuma integração Cal.com/Google Calendar em lugar algum do repo.
- Rota `/agendar` com calendário real, slots de 30 min. Integração com Cal.com ou Google Calendar (não construir agenda própria). Timezone explícito `America/Sao_Paulo`.
- Formulário mínimo: nome, WhatsApp, e-mail, "você já usou a versão anterior do MedChina?" (sim/não), "quantos pacientes atende por semana?" (faixas) → persiste em T2.0.
- Bloqueio de capacidade (D6): decidir onde vive o teto — limites de disponibilidade no próprio Cal.com OU verificação no backend ao receber o webhook de booking. Ao esgotar, exibir próxima semana — nunca abrir slots além do limite.
- LGPD: Cal.com processa PII de leads → avaliar como operador (DPA) antes de escolher.
- Requisitos de rota pública (§0.5 item 3) + decisão D10 sobre indexação.
- **Aceite:** agendamento cria evento no calendário, envia confirmação e respeita o teto semanal configurado.

### T2.2 — Confirmação e redução de no-show
**Estado: ⬜ (disparos) / 🟡 (transporte)** — nenhum disparo automático existe (nem para as consultas clínicas, onde o lembrete é handoff manual `wa.me` por decisão — 0066). Mas o transporte está pronto:
- **E-mail**: Resend ativo com 5 templates reais e contrato de degradação (`packages/email`) — criar templates de confirmação + lembrete (não existem).
- **Agendamento temporal**: padrão provado no drip do trial (`lib/trial-jobs.ts` com `step.sleepUntil`) — adicionar evento `medchina/booking.created` ao event map de `packages/jobs` + função Inngest que dorme até T-24h e T-1h.
- **WhatsApp**: ⚠️ o pipeline de código está COMPLETO em `packages/whatsapp` (envio manual/agendado, templates Meta com fallback, webhook de status servido no app, tabela `wa_messages`) — "inerte" significa **não configurado e sem callers**, não "sem código". Pré-requisitos são operacionais: env vars do provider, **verificação de negócio Meta + aprovação de templates (prazo de semanas — risco de cronograma)**. Decisão D9: ativar Meta Cloud API ou operar com handoff `wa.me`. Iniciar a verificação Meta no Sprint 1 se D9 = automático.
- **Entregabilidade**: validar SPF/DKIM do domínio de envio (`EMAIL_FROM`) em `medchinaprontuarios.com.br` antes da onda — confirmação caindo em spam anula a tarefa (conectado ao achado de e-mail divergente em T4.5).
- Link de reagendamento e cancelamento no lembrete.
- **Aceite:** os três disparos ocorrem para um agendamento de teste.

### T2.3 — Pré-preenchimento por origem
**Estado: ⬜** — nenhum parâmetro `origem/onda/cupom` é lido ou persistido hoje (grep utm/origem = zero no app). A atribuição existente (`meta_attribution`/`ga_attribution`, 0051/0052) é adjacente: sinais de anúncio por org no checkout, não lead pré-conta.
- Aceitar `?origem=`, `?onda=`, `?cupom=` e persistir na entidade de lead (T2.0). Integra com a captura de primeiro toque de T5.0.
- Disparo server-side do `Schedule` na criação do agendamento, com esses campos (fundação pronta: `lib/meta-capi.ts` + `lib/ga4-mp.ts` com `event_id`).
- **Aceite:** o admin mostra, para cada call, de qual onda/canal ela veio.

### T2.4 — Consentimento de gravação da call
**Estado: 🟡** — o mecanismo pedido existe pronto e cumpre o aceite ao pé da letra: `consent_terms` (texto versionado) + `consent_acceptances` (aceite pina versão, com data e revogação sem delete) + `recordConsent` (packages/audit). **Bloqueio**: `consent_acceptances.org_id` é NOT NULL e a RLS de insert exige membro da org — lead não tem conta.
- Decidir o modelo: (a) migração tornando `org_id` nullable para `subject_type='lead'` (reaproveita tudo — recomendado) ou (b) colunas de consentimento na entidade de lead pinando `slug+version` de `consent_terms`.
- Dois termos: autorização de gravação da call (finalidade explícita: treinamento interno e melhoria de produto) e, separada e opcional, autorização de uso de depoimento (pré-requisito do T4.4).
- **Aceite:** as duas autorizações ficam registradas com data e versão do texto.

---

## EPIC 3 — Landing pages

**Estado geral: confirmado** — nenhuma das 6 páginas existe; o site é 100% orientado a tráfego frio/auto-cadastro (todos os CTAs do chrome → `/auth/sign-up`). As páginas novas seguem as convenções §0.5 (PUBLIC_PREFIXES, i18n 6 locales, canonical, DESIGN.md estrita).

### T3.1 — `/fundadores` (prioridade máxima)
**Estado: ⬜**. Destino final de todas as ondas.
- **Sem menu de navegação. Sem nenhum link para o plano gratuito ou para `/auth/sign-up`.** Se o visitante consegue chegar ao grátis a partir desta página, a página falhou.
- **Mecanismo de layout (obrigatório saber antes):** nested layout NÃO remove chrome no App Router — dentro de `(marketing)` a página herda header/footer. Criar route group irmão (ex.: `app/(funil)/fundadores/`) com layout próprio **remontando** `MarketingTrackers` + `MarketingAnalytics` + `CookieConsent` (hoje só o layout de marketing os monta — sem eles o Pixel não dispara). Não repetir o hack CSS `body:has()` da home (exceção nomeada em DESIGN.md, não padrão).
- Blocos, nesta ordem: promessa em uma linha → o que é a condição de fundador e por que existe → contador de vagas (T1.4) → oferta anual com valor de tabela riscado → **garantia de 7 dias com o mesmo peso visual do preço** → 3 depoimentos com nome, foto e cidade → o que só o fundador recebe (migração assistida, onboarding 1:1, canal direto com a fundadora, preço travado) → FAQ de objeção (cartão, cancelamento, migração, LGPD) → CTA único.
- **Depoimentos:** o componente `Testimonials` atual não tem foto/cidade (avatar por iniciais) e o repo **proíbe depoimento fabricado** (DESIGN.md + HOME-SPEC §33.5) — exige estender o componente, material real com consentimento (T2.4) e atualização dos contratos de design (dependência dura com T4.4).
- Se a página exigir estética de resposta direta divergente de "Cuidado Sereno", pedir explicitamente redesign desta página (§0.5 item 4).
- Aceita `?cupom=` pré-aplicado (T1.2). Indexação: D10.
- **Aceite:** auditoria de links confirma zero rotas de saída para cadastro gratuito.

### T3.2 — `/voltar` (reescrita da `/migracao`) — Onda 1
**Estado: ⬜ (página nova) / crítica à atual CONFIRMADA** — o copy publicado diz literalmente "crie uma nova conta; a migração de dados é avaliada caso a caso pelo suporte" (chaves `mig-*` em `packages/content/messages/*.json`), com CTA "Falar com o suporte". ⚠️ E está **defasado para trás**: o produto JÁ tem pipeline real de importação de pacientes (`/pacientes/importar`, migrações 0076-0083, `docs/IMPORT-EXPORT.md`) — a promessa central da página tem lastro técnico entregue, não futuro.
- Nova narrativa, nesta ordem:
  1. Reconhecimento explícito de que a versão anterior não estava pronta.
  2. O que mudou, concreto: IA supervisionada, mobile, rastreabilidade de origem, consentimento versionado.
  3. **"Você não vai recadastrar nada — a migração dos seus pacientes é feita com você na call de 30 minutos."** A maior objeção da onda passa a ser o motivo de agendar.
  4. Vídeo de demonstração (T3.5).
  5. CTA único: `/agendar`. Não "criar conta", não "falar com o suporte".
- Duas variantes por parâmetro `?v=pagante` / `?v=cadastro`. **Sem problema de cache**: as páginas de marketing são dinâmicas por request (cookies de consent/locale no layout) — basta ler `searchParams` (Promise no Next 15). Canonical único em `/voltar` para as duas variantes.
- **Redirect**: `async redirects()` em `apps/web/next.config.mjs` (`{source:'/migracao', destination:'/voltar', permanent:true}` — query preservada por padrão; `permanent:true` responde 308, equivalente a 301 para SEO; usar `statusCode:301` se o literal importar). Atualizar `PUBLIC_PREFIXES` (+`/voltar`), `sitemap.ts` (trocar a rota) e o link do footer (`marketing-footer.tsx`). Aposentar as 16 chaves `mig-*` nos 6 locales juntas.
- **Aceite:** as duas variantes renderizam textos distintos e o redirect preserva parâmetros de URL.

### T3.3 — `/masterclass` e `/masterclass/replay` — Onda 2
**Estado: ⬜ — com o modelo pronto (2026-09-26)**: `/lei-15345` (`docs/PAGINA-EVENTO.md`) já é a página de evento completa — convite, inscrição com `Lead`, sala ao vivo, gravação e captura pós-evento na MESMA URL, dirigidas por `live_events.state`. A masterclass é outra linha de `live_events` (D7) e uma cópia da página com o texto dela; o "replay" é o estado `encerrado`, não uma segunda rota. O que segue é o registro do ponto de partida: nem página, nem countdown (nada regressivo existe em marketing; `CountUp` só anima para cima), nem captura de inscrição.
- Página de **evento**, não de produto: tema clínico, data/hora (D7, de `platform_settings` — não hardcoded), fotos e credenciais das duas especialistas, o que a participante sai sabendo, CTA único = entrar no grupo de WhatsApp.
- **Nenhuma menção a preço ou plano antes da live.**
- Contador de tempo até o evento: componente client novo, reduced-motion-safe, timezone explícito.
- Inscrição persiste na entidade de lead (T2.0) com origem/onda e dispara `Lead` (tipo já declarado nos vocabulários — falta só o call site; par browser+server com `event_id` compartilhado).
- `/masterclass/replay`: vídeo + prazo da oferta visível (de config) + CTA para `/fundadores?cupom=HELLEN`.
- **Aceite:** inscrição dispara evento `Lead` e adiciona o contato à lista da onda com origem identificada.

### T3.4 — `/escolas` — Onda 3
**Estado: ⬜** — página inteiramente nova, sem bloqueio arquitetural (compõe primitivas existentes). Antecipada para o Sprint 2: é o único canal capaz de encher a agenda de forma repetível.
- Público: coordenador de curso de formação em MTC, não aluno.
- Conteúdo: licença institucional gratuita durante a formação, como integra o currículo, o que o egresso recebe ao se formar, casos, CTA = agendar reunião.
- **Aceite:** página publicada com CTA para `/agendar?origem=escolas` (depende do EPIC 2).

### T3.5 — `/demonstracao`
**Estado: ⬜ (página/vídeo/eventos)** — mas o player está mais perto do que parece: `@vidstack/react` **já é dependência** do apps/web (hoje usado só no showcase `/ui`, bloqueado em produção) e expõe eventos de tempo.
- Página com o vídeo de 10–12 min percorrendo **um caso clínico completo**: primeira consulta → anamnese estruturada → retorno com histórico. Não é tour de features. Capítulos/marcadores por etapa.
- Eventos de progresso 25/50/75/100% via `track()` (fbq trackCustom) + espelho server-side, para retargeting.
- **Consentimento**: embed YouTube/Vimeo injeta cookies antes do consent — preferir MP4 self-hosted via vidstack, ou click-to-load atrás do `CookieConsent`.
- "Visíveis no painel": definir = Meta Events Manager/GA4 (padrão). Painel admin exigiria armazenamento próprio (a tabela `product_events` tem allowlist fechada; estender é migração).
- CTA ao final: `/agendar`.
- **Aceite:** eventos de progresso disparam corretamente e são verificáveis (Events Manager com `META_CAPI_TEST_EVENT_CODE`).

---

## EPIC 4 — Ajustes na home (`/`)

⚠️ **Decisão D12 primeiro**: a home é um componente monolítico hardcoded (`components/marketing/clinical-source-home.tsx`, ~1.250 linhas, pt-BR fixo, fora de i18n/primitivas/banco). Preços "R$ 199/299" e "Até 3.000 minutos" estão em constantes TSX — **uma mudança de preço no `/admin/billing` atualizaria `/planos` e o checkout, deixando a home mentindo**. Recomendação: religar os cards de plano a `getDisplayPlans()`/`listPublicPlans()` (mesma fonte de `/planos`) como parte deste EPIC.

### T4.1 — CTA duplo
**Estado: ⬜ / afirmação CONFIRMADA** — 100% dos CTAs de conversão da home apontam para `/auth/sign-up` (header desktop/mobile, hero, 3 cards de plano, FAQ, CTA final, rodapé — `clinical-source-home.tsx`); os secundários são âncoras internas. Nenhum caminho de conversa/agendamento existe.
- CTA primário passa a ser duplo em todos os blocos principais: **"Criar conta grátis"** e **"Agendar demonstração de 30 min"**.
- Incluir também o header mobile e os cards de plano, não só header/hero/CTA final.
- Depende de T2.1 (/agendar publicado).
- **Aceite:** header, hero e CTA final oferecem as duas opções.

> ✅ **Pré-requisito de T4.2/T4.3 resolvido (2026-08-10)**: com a home lendo `plans`, a **ordem** dos cards passou a ser o campo `sort` do banco e o destaque segue o mesmo critério de `/planos`. Reordenar (Assistente → Pro → Gratuito) e trocar o rótulo "Comece aqui" viraram edições em `/admin/billing`, **sem deploy** — o que resta de T4.2 é a decisão comercial e o toggle anual (T1.1). A home também deixou de omitir a cota de 20 perguntas/mês da biblioteca, que `/planos` já publicava.

### T4.2 — Reordenar e reposicionar planos
**Estado: ⬜ (posição/rótulo/toggle)** — ⚠️ correção: o card **destacado** já é o Assistente nas duas grades (`featured` + "Mais escolhido" na home; `highlightIndex=1` em `/planos`). O que procede: o Gratuito é o **primeiro** card nas duas grades e carrega "Comece aqui".
- Ordem: Assistente (centro, recomendado) → Pro → Gratuito (último, visualmente discreto). Em `/planos` é o campo `sort` no banco; na home depende de D12.
- Remover o rótulo "Comece aqui" do plano Gratuito.
- Adicionar toggle anual/mensal (depende de T1.1).
- **Aceite:** o plano Gratuito não é mais o primeiro elemento nem o mais destacado.

### T4.3 — Linguagem clínica nos planos
**Estado: 🟡** — `/planos` (via banco) já publica a equivalência ("Até {minutes} minutos de áudio por mês (~{sessions} consultas)", derivada dos MESMOS `limits` que o runtime aplica) e a fronteira já existe no subtítulo ("O Assistente automatiza a documentação. O Pro também prepara o raciocínio terapêutico."). A home hardcoded traz minutos secos.
- ⚠️ **Aritmética**: a consulta de referência do código e do PRD é de **50 minutos** → 3.000 min ≈ **60 consultas** (não 50). Resolver D11 antes de escrever copy; padronizar a duração de referência num único lugar.
- Reescrever a fronteira nos cards: **Assistente documenta; Pro raciocina** (hipóteses, padrões explicados, contradições, dados ausentes, protocolos preparados) — a prop `footnote` do `PricingSection` existe e está sem uso em `/planos`.
- **Aceite:** nenhum card de plano descreve o diferencial principal em unidade de minuto.

### T4.4 — Bloco de prova social e autoridade
**Estado: ⬜ integral** — nenhuma página menciona a fundadora; zero depoimentos; nenhuma tabela/console. Lacuna de maior impacto do site: o ativo principal do negócio é a reputação da fundadora na comunidade de MTC.
- Bloco da fundadora: nome, foto, formação, por que construiu o MedChina.
- Bloco de 3 a 5 depoimentos com nome, foto, cidade e tipo de prática.
- **Estrutura de dados**: reaproveitar o padrão DB-managed de `/ajuda` e `/blog` (migração + console admin + `lib/public-content.ts`) — não inventar mecanismo novo. Estender `Testimonials` com foto/cidade/prática.
- **Pré-requisitos**: consentimento de uso de depoimento (T2.4) e atualização de `docs/DESIGN.md` + `docs/HOME-SPEC.md` §33.5 (hoje proíbem depoimentos sem evidência — sem atualizar, futuras edições assistidas removerão os blocos).
- **Aceite:** blocos publicados na home e reutilizáveis em `/fundadores`.

### T4.5 — Correções de integridade
**Estado: afirmações CONFIRMADAS ✅ / correções ⬜**:
- **Âncoras**: confirmado âncora por âncora no rodapé da home (`Sobre`→`#inicio`, `Privacidade`→`#seguranca`, `Central de ajuda`→`#duvidas`) — e **também no header da home** (`#como-funciona`/`#recursos`/`#seguranca`/`#planos`), com as páginas reais existindo e ignoradas. O rodapé compartilhado das demais páginas já está correto.
- **Rodapé duplo**: confirmado — o chrome compartilhado é montado na home e escondido via CSS `display:none`, **permanecendo no DOM servido** (visível a crawlers). Correção estrutural no layout (não montar o chrome na home, ou adotá-lo), não mais CSS.
- **E-mail**: confirmado — único e-mail público é `mailto:contato@medchina.com.br` hardcoded no rodapé da home; o domínio canônico é `ai.medchinaprontuarios.com.br` e `BRAND.support.email` está vazio. Trocar por canal configurável (`BRAND.support`/`platform_settings` 'support') com o domínio correto e **conferir que a caixa existe** (conecta com SPF/DKIM de T2.2).
- **WhatsApp visível**: 🟡 o mecanismo está pronto (SupportWidget lê `platform_settings` 'support'; console `/admin/support`; renderiza null sem canal). Configurar o canal é **dado, não código**; decidir presença adicional no rodapé e em `/contato`.
- **Aceite:** varredura de links sem âncoras órfãs e sem destinos duplicados conflitantes.

---

## EPIC 5 — Instrumentação e eventos

⚠️ **Cabeçalho reescrito** — a premissa "falta evento de produto" está desatualizada. Já existem, server-side, com `event_id` determinístico e espelho GA4 (Measurement Protocol): `CompleteRegistration` (auth callback), `StartTrial` (start-trial route), `Activated` (1ª consulta finalizada da org), `InitiateCheckout`, `Purchase` (por fatura paga, com enriquecimento via `meta_attribution` 0051/0052), `Subscribe` (1ª fatura da assinatura) e `TrialExpiring` (drip). **`docs/TRACKING.md` é a fonte canônica do event map — referenciar, não recriar.** Stack dupla: todo evento novo entra nos dois lados (Meta + GA4). O PostHog do `.env.example` é resíduo do template, sem integração — ignorar.

### T5.0 — Captura de atribuição origem/onda/cupom (NOVA — bloqueia a largada)
**Estado: ⬜** — **o maior gap do funil**: nenhuma captura de `utm_*`/`origem`/`onda` existe no código. A atribuição existente (`meta_attribution`: fbp/fbc/ga_client_id por org no checkout) resolve o match de anúncio, não a dimensão de campanha.
- Capturar `?origem/?onda/?cupom/utm_*` no primeiro toque do site, persistir em cookie, sobreviver ao redirect de auth e checkout (padrão análogo a `lib/meta-capi-context.ts`), gravar no signup (coluna na org ou extensão de `meta_attribution`) e propagar até assinatura e eventos.
- **Sem isso, a segmentação de T5.2 e a comparação de ondas de T5.3 são inimplementáveis — e coorte não se backfilla.** Precisa estar em produção ANTES da Onda 1.
- **Aceite:** um cadastro vindo de `/voltar?onda=1&origem=whatsapp` carrega essas dimensões até o evento `Purchase`.

### T5.1 — Eventos de produto (delta sobre o que existe)
| Evento | Estado | Ação |
|---|---|---|
| `Lead` | 🟡 disparado pelo navegador na primeira inscrição de um número em `/lei-15345` (2026-09-26), `eventID` = id da inscrição, GA4 `generate_lead` | o par de servidor fica para depois: exige estender a postura de interesse legítimo aos inscritos (três textos + `CONSENT_VERSION`) e a chave `ph` no CAPI — `docs/TRACKING.md` |
| `Schedule` | ⬜ nem consta nos vocabulários | adicionar aos TRÊS unions (`meta-capi.ts:40-52`, `analytics.ts:32-43`, `ga4-mp.ts:36-43`) + disparo na criação do agendamento (T2.3), payload origem/onda/cupom |
| `CompleteRegistration` | ✅ existe (dedup por user.id) | adicionar `origem` ao payload (T5.0). Atenção: depende da confirmação de e-mail ligada no Supabase — se desligarem, o callback não roda |
| `primeira_anamnese_completa` | ✅ como **`Activated`** (1ª consulta FINALIZADA da org) | **mapear, não renomear** (renomear quebra histórico no Events Manager). Completar payload "dias desde cadastro" e **documentar no código que é o evento de otimização de campanha** |
| `trial_pro_iniciado` | ✅ como **`StartTrial`** | ⚠️ semântica 0084: primeira ação operacional de QUALQUER tipo; segmentar por `pro_trials.started_via` |
| `ativo_d7` | ⬜ | job novo (passo no drip existente ou cron Inngest), fonte `access_events`/`product_events` após a 1ª consulta finalizada; **definir "sessão"** no aceite (o conceito não existe no schema) |
| `Purchase` | ✅ existe (por fatura paga; `Subscribe` separado na 1ª — melhor que o pedido) | enriquecer `custom_data` com plano/ciclo/cupom (dados já no banco: `plans.period`, `subscriptions.coupon_id`); `is_founder` após T1.3 |

- Regra LGPD mantida (já implementada): eventos do app clínico são **server-only** — nenhum tracker monta no app autenticado. Só `Lead`/`Schedule` (páginas públicas) ganham o par browser+server.
- **Aceite:** todos os eventos aparecem no Gerenciador de Eventos sem duplicação (`META_CAPI_TEST_EVENT_CODE` já existe para o teste).

### T5.2 — Painel semanal
**Estado: ⬜** — `admin_metrics()` (0010) não serve como dado (agregados de 30 dias, nada semanal), mas serve como **padrão**: RPC `SECURITY DEFINER` + gate `is_superadmin()`.
- Novo RPC irmão (ex.: `admin_weekly_funnel()`): calls agendadas na semana (bloqueia em T2.0), trials iniciados (`pro_trials.started_at` + `started_via`), pagantes novos (1ª fatura paga por assinatura — padrão já usado no webhook), cancelamentos (`canceled_at`).
- Segmentação por origem/onda (depende de T5.0). Quatro números, sem nada além.
- **Aceite:** painel acessível no admin, atualizado diariamente (RPC live já resolve).

### T5.3 — Funil de coorte
**Estado: ⬜** — todas as etapas já têm timestamp confiável em tabelas existentes (`organizations.created_at`, consultas finalizadas, `pro_trials.started_at`, faturas pagas, `product_events`/`access_events` para D30). O único bloqueio é a dimensão onda/origem (T5.0).
- Visão por coorte de entrada (semana): cadastro → 1ª anamnese → trial → pagante → ativo D30.
- Atalho: entregar a primeira versão como pergunta salva no `/admin/insights` (SQL read-only já existente) antes de construir tela dedicada.
- **Aceite:** é possível comparar a coorte da Onda 1 com a da Onda 2.

---

## EPIC 6 — Ferramentas internas (admin)

Referência: os 12 consoles existentes (`/admin`, `/admin/organizations`, `/admin/billing`, `/admin/ai`, `/admin/knowledge`, `/admin/audit`, `/admin/insights`, `/admin/backups`, `/admin/announcements`, `/admin/help`, `/admin/blog`, `/admin/support`). Ferramentas novas seguem o mesmo padrão: gate `is_superadmin` + RLS real + `recordAudit` + console EN-only.

### T6.1 — Lista de contas gratuitas paradas
**Estado: ⬜ (console)** — o `/admin/organizations` atual mostra plano/status/membros/suspensão, sem coluna de trial nem exportação.
- ⚠️ **Query corrigida** (a premissa antiga era a mecânica pré-0084): "conta parada" = organização **sem linha em `pro_trials`** E ainda **elegível** — o trial é 1 por profissional e 1 por org PARA SEMPRE (0084 + 0024). Quem já consumiu o trial é outra lista, com abordagem de venda diferente.
- ⚠️ **Bloqueio de dado**: o cadastro da profissional **não coleta telefone** (profiles só tem display_name/company) — "exportação com WhatsApp" exige antes coletar o dado (signup ou perfil); sem isso a lista entrega só e-mail.
- Exportação com e-mail (e WhatsApp quando existir), campo de status de contato (na entidade T2.0/T6.4).
- Validação imediata: `/admin/insights` já responde "quantas contas sem trial?" ad hoc, antes do console dedicado.
- **Aceite:** lista exportável e filtrável por faixa de dias desde o cadastro.

### T6.2 — Migração assistida (reescopo)
**Estado: ✅ núcleo / ⬜ modo assistido** — ⚠️ o pipeline self-service está **entregue e verificado**, além do que este plano pedia: importação de 3 tipos (cadastro de pacientes, histórico legado congelado, agenda futura), pré-visualização obrigatória, log permanente (`import_batches` nunca deletado), desfazer com janela de 30 dias, idempotência por `external_ref`, recusa de .xlsx/.pdf com instrução de conversão, limite por plano. Migrações 0076–0083; spec canônica: **`docs/IMPORT-EXPORT.md`** (referenciar, não redescrever). Aceite de 30 pacientes < 5 min: já verificado lá (§11).
- **Escopo restante = Fase D** (IMPORT-EXport §6, item 8): superfície em `/admin/organizations` chamando os RPCs existentes com **service role** (já aceitam), exigindo justificativa + referência da autorização da titular, gravando `import.assisted` em `audit_events` e notificando a profissional no sino.
- **Restrição de projeto**: importação NUNCA acontece via impersonation — a cerca de 0057 recusa escrita clínica em sessão impersonada. Na call, a alternativa imediata é a profissional dirigir o import logada (tela compartilhada).
- **Pré-requisito de lançamento**: confirmar que as migrações 0075–0084 estão aplicadas em produção (IMPORT-EXPORT §11 registrava pendência em ago/2026 — reverificar contra o banco real).
- **Aceite:** importação assistida de uma base de teste de 30 pacientes, auditada, com notificação à titular.

### T6.3 — Fluxo da call de onboarding
**Estado: ⬜** — nenhuma estrutura de checklist/call no admin. Depende de T2.0 (entidade de call).
- Checklist no admin, por call: dados migrados → primeiro paciente real cadastrado → **primeira ação com IA executada durante a call** → plano apresentado → resultado (fechou / follow-up / perdeu, com motivo).
- Os itens "primeiro paciente" e "primeira ação com IA" devem ser **predicados automáticos lidos do banco** (padrão live-predicate de `lib/onboarding.ts`; `pro_trials`/`started_via`), não checkboxes manuais.
- Campo de objeções em texto livre, alimentando relatório (insumo para conteúdo e discurso).
- **Aceite:** relatório de objeções agrupadas disponível.

### T6.4 — Gestão de contatos por onda
**Estado: 🟡 em andamento (2026-09-26)** — `/admin/leads` lista as inscrições com filtros prontos (todas · elegíveis para anúncio · sem clique no grupo), abre conversa no WhatsApp **uma por vez**, descadastra com motivo, exclui por LGPD e exporta **só** o recorte com o termo de novidades ativo e sem descadastro, no formato de lista de clientes da Meta. Falta: `status` e histórico de contato, filtro por segmento/onda na tela, e a carga dos ~500 contatos da versão anterior (base legal em rascunho: `docs/LGPD-BASE-LEGADA.md`).

Antes (registro do ponto de partida): não existia CRM/contato de funil (as únicas entidades de pessoa são `profiles`, `patients` — dado clínico tenant-scoped, **jamais** reutilizável como lista de marketing — e `meta_attribution`).
- Evolução da entidade T2.0: `onda`, `segmento` (ex_pagante | cadastro_v1 | live | escola | indicacao | gratuito_parado | waitlist), `status`, `historico_de_contato`. Platform-level, superadmin-only.
- A carga dos ~500 contatos da versão anterior precisa de caminho próprio (o pipeline de import escreve pacientes de um workspace, não contatos de funil). Base legal LGPD: ver Riscos, item 1.
- **Aceite:** possível filtrar e exportar por segmento.

### T6.5 — Programa de indicação
**Estado: ⬜** — nada existe (o `invite` do schema é convite de MEMBRO de organização — RBAC, outra coisa; irrelevante no MVP de workspace único).
- Peças reaproveitáveis: cupons do billing (código persistido na assinatura) para o benefício; o webhook de billing como gatilho observável de "o indicado pagou"; `platform_settings` para a flag.
- Link de convite por usuário, atribuição do indicado, bônus liberado **somente quando o indicado paga**.
- **Aceite:** cadeia indicador → indicado → pagamento → crédito rastreável de ponta a ponta.
- **Ativar apenas após 25–30 pagantes satisfeitos.** Implementar agora, manter desligado por flag.

### T6.6 — Console de flags de campanha (NOVA)
**Estado: ⬜** — `platform_settings` é o mecanismo certo, mas hoje só a key `support` tem UI (`/admin/support`); as demais são editadas por SQL. Sem console, a operação NÃO liga/desliga campanha sem deploy.
- Cards de edição para as keys de campanha: `founders` (enabled/seats/deadline), `masterclass` (D7), `referral` (flag T6.5).
- **Aceite:** superadmin liga/desliga a oferta Fundadores e edita vagas/data sem deploy.

---

## EPIC 7 — Plano Gratuito (reformulado)

⚠️ **A auditoria (T7.1) foi executada e a divergência temida NÃO existe.** O código não limita pacientes, prontuários ou consultas manuais em nenhum plano — "Pacientes e prontuários ilimitados" é **verdadeiro**, e o PRD §5.2/§5.3 especifica o ilimitado clínico como intencional. "Limitação de armazenamento" **não existe no produto** (únicos tetos: globais por arquivo de gravação, iguais para todos os planos — e o Gratuito nem grava). Não há risco jurídico na promessa principal.

**Limites reais do Gratuito hoje** (todos em `plans.limits`, editáveis em `/admin/billing`): `audio_minutes: 0` · `library_messages: 20`/mês · `import_rows: 200`/lote (por lote — não é teto cumulativo) · `members: 1` · export **livre** em todos os planos (portabilidade LGPD, por decisão).

**Divergências menores reais** (direção: código limita mais que o texto): o teto de import não é publicado em nenhuma página; o card hardcoded da home omite a cota de 20 msgs/mês da biblioteca, que `/planos` (via banco) publica corretamente.

### T7.1 — Registro da auditoria (residual)
- Formalizar a tabela código × texto acima em `docs/` (seção em `docs/BILLING-AUDIT.md` ou arquivo próprio), citando as migrações 0024, 0042, 0076, 0081.
- **Aceite:** documento comparando limite em código × texto publicado. ✔ conteúdo levantado; falta commitar.

### T7.2 — Alinhamento (redefinido)
- **(a) Decisão D8**: manter o grátis genuinamente ilimitado (estado atual, verdadeiro) OU introduzir limites — o que exige construir **grandfathering do zero** (`plans.limits` é global por plano; nada no schema versiona limites por data de criação de conta).
- **(b) Alinhar superfícies**: religar o card da home ao banco (D12); publicar o teto de import ("importação em lotes de até 200 linhas no Gratuito") OU removê-lo via `/admin/billing` se não for diferencial intencional; incluir a cota da biblioteca no card da home.
- **(c)** Se D8 evoluir, implementar a política de uso justo de armazenamento/anexos prevista no PRD §5.3 (hoje inexistente).
- **Aceite:** texto publicado e comportamento do sistema idênticos em todas as superfícies (incluindo a home).

---

## Riscos e considerações transversais

1. **LGPD da base da Onda 1**: abordar ~500 contatos da versão anterior por WhatsApp/e-mail exige base legal documentada (consentimento da relação anterior? legítimo interesse com LIA?), política de retenção/eliminação e direitos do titular sobre a nova entidade de contato. Opt-out obrigatório (PRD §18.3) — a infra já existe (`lifecycle_email_opt_out` + token de unsubscribe, 0056). Cal.com/terceiros que processem PII de leads = operador → avaliar DPA.
2. **Mobile**: nenhuma oferta/checkout no app (política de loja). O trial pode iniciar por ação no mobile (0084) — verificar que o fluxo mobile dispara `StartTrial`; planejar deep links de campanha (abrir no app vs web).
3. **Entregabilidade de e-mail**: SPF/DKIM do domínio de envio do Resend no domínio real (`medchinaprontuarios.com.br`); unificar o e-mail de contato (T4.5). Confirmações caindo em spam anulam T2.2.
4. **Anti-abuso**: `/agendar`, captura da masterclass, waitlist e `?cupom=` são endpoints públicos escrevendo em banco via service role — rate limit + honeypot desde o primeiro deploy (T2.0).
5. **Timezone**: slots, lembretes 24h/1h e countdown com `America/Sao_Paulo` explícito e renderização client/server consistente (o repo já teve correção de TZ no import — 0083).
6. **Vídeo × consentimento**: player de terceiro injeta cookies antes do consent — self-host ou click-to-load (T3.5, T3.3).
7. ✅ **Promessa falsa sobre o início do trial — CORRIGIDO (2026-08-10)**. Não era só documentação interna: a frase *"o trial começa somente na primeira consulta real com IA"* estava publicada na home, no FAQ, na `/planos`, no onboarding e na própria tela de assinatura, nos 5 idiomas. Desde a `0084` o trial começa em **qualquer primeira ação de trabalho** — gravar ([use-audio-allowance.ts](apps/web/src/hooks/use-audio-allowance.ts)), agendar ([agenda](apps/web/src/app/(dashboard)/agenda/page.tsx)), importar ([importar](apps/web/src/app/(dashboard)/pacientes/importar/page.tsx)) ou usar a biblioteca ([biblioteca](apps/web/src/app/(dashboard)/biblioteca/page.tsx)). O risco concreto era a promessa central da Onda 1: quem migra e passa a primeira semana **importando prontuários** queimava dias do trial acreditando que não havia começado. Corrigido em todas as superfícies + `PRODUCT.md`, `HOME-SPEC.md`, `DESIGN.md`, `CLAUDE.md` (raiz e web) e no mirror `AGENTS.md` — que era a fonte que reintroduzia o erro a cada edição assistida.
8. **Ativos existentes a aproveitar** (o plano anterior ignorava): drip de e-mail do trial com unsubscribe (0056 + `lib/trial-jobs.ts`) — a "educação durante o trial" já existe; `notifications` (0012) + `announcements` (0011) para comunicação in-app; `/admin/insights` para perguntas de coorte ad hoc; `packages/documents` (hash + `/verify/[code]`) caso a garantia gere documento; SupportWidget + `platform_settings` 'support' para o WhatsApp visível.

---

## Sprints e critério de largada (re-escalonados pelo estado real)

### Sprint 1 — Semana 1 (bloqueia tudo)
`T5.0` (atribuição — **antes de qualquer onda**; coorte não se backfilla) · `T1.1` (linhas anuais + toggle) · `T1.2` (ligar cupom ao checkout + `?cupom=`) · `T1.3` `T1.4` (com cerco na compra) · `T1.7` (BILLING-AUDIT C1–C4) · `T2.0` `T2.1` `T2.2` (e-mail; D9 decide WhatsApp) · decisões D8–D12.
Em paralelo, fora do desenvolvimento: gravar o vídeo de demonstração; fechar termos com a parceira e habilitar a parceria de contas no Meta Business; **iniciar a verificação de negócio Meta imediatamente se D9 = automático** (prazo de semanas); validar SPF/DKIM e caixa de e-mail do domínio real.

### Sprint 2 — Semana 2
`T1.5` · `T3.1` `T3.2` `T3.5` · `T4.1` `T4.2` `T4.3` `T4.4` `T4.5` (com D12) · `T6.1` `T6.2` (Fase D) `T6.3` · `T7.1` `T7.2` · `T2.3` `T2.4` · `T3.4` · `T5.1` (delta)

### Sprint 3 — Semana 3 (em paralelo à Onda 1 já rodando)
`T3.3` · `T5.2` `T5.3` · `T6.4` `T6.5` (desligado) `T6.6` · `T1.6`

### Portão de largada da Onda 1
Não iniciar a Onda 1 sem **todos** os itens abaixo verificados em produção:

- [ ] Assinatura anual funcionando com cupom aplicado no checkout (T1.1, T1.2)
- [ ] Mecânica Fundadores concedendo entitlement Pro e cobrando o preço travado (T1.3)
- [ ] Contador de vagas refletindo o banco E cerco na compra ativo (T1.4)
- [ ] Garantia de 7 dias publicada e fluxo de reembolso operante (T1.5)
- [ ] Pendências críticas do billing Asaas resolvidas — C1–C4 do BILLING-AUDIT (T1.7)
- [ ] `/agendar` recebendo agendamento real, com lembretes disparando (T2.1, T2.2) e e-mail entregando do domínio correto (SPF/DKIM)
- [ ] `/fundadores` publicada, sem nenhuma rota de saída para o plano gratuito (T3.1)
- [ ] `/voltar` publicada nas duas variantes, com redirect de `/migracao` preservando parâmetros (T3.2)
- [ ] Vídeo de demonstração no ar (T3.5)
- [x] ✅ **Atribuição origem/onda/cupom capturada e persistida de ponta a ponta (T5.0)** — entregue em 2026-08-10. Falta apenas aplicar a migração `0086` em produção e conferir um cadastro real de teste chegando com `onda`/`origem` no Events Manager
- [ ] `Schedule` disparando; `StartTrial` e `Purchase` verificados em produção com dedup (`META_CAPI_TEST_EVENT_CODE`) (T5.1)
- [ ] Migrações 0075–0084 aplicadas em produção (pipeline de import + trial 0084) (T6.2)
- [ ] Superfícies do plano Gratuito alinhadas (T7.2) e base legal da lista de ~500 contatos documentada (Riscos 1)

**Faltando qualquer item, adiar a onda.** A base é de ~500 contatos e existe uma única oportunidade de reconquista — queimá-la com funil incompleto repete exatamente o erro da versão anterior.

---

## Notas de arquitetura para quem implementa

- **Nada de escassez falsa.** Contador de vagas, prazos e "restam X" derivam SEMPRE de estado real no servidor.
- **Atribuição é requisito de negócio, não relatório.** `origem`, `onda` e `cupom` precisam sobreviver a toda a jornada, incluindo redirects de autenticação e checkout (T5.0). A sobrevivência dos sinais de ANÚNCIO (fbp/fbc/ga) já está resolvida (`meta_attribution` 0051/0052) — faltam as dimensões de campanha.
- **Idempotência nos eventos.** `event_id` compartilhado entre Pixel e CAPI; eventos de produto no servidor (padrão já vigente em todos os call sites). Eventos do app clínico: server-only, sem exceção (LGPD).
- **Feature flags** em `platform_settings` com console de edição (T6.6): indicação, oferta Fundadores, contador de vagas, masterclass. Leitura pública por design — nunca segredos.
- **Não refazer a home.** O posicionamento profissional e o vocabulário de MTC estão corretos. As tarefas do EPIC 4 são ajustes cirúrgicos de conversão — a única mudança estrutural recomendada é religar os cards de plano ao banco (D12), que é dívida do próprio repo, não redesign.
- **Onde vive cada entidade nova**: lead/agendamento e contatos → `packages/db` (migração + RLS superadmin) + consoles em `apps/web/.../admin`; extensões de cupom/plano → `packages/db/src/schema/billing.ts` + `packages/billing` + console `/admin/billing` existente; termos de garantia e consentimentos → `consent_terms`/`recordConsent` (packages/audit) + página em `(marketing)/legal`; lembretes → `packages/jobs` (event map) + `packages/email` (templates novos) + `packages/whatsapp` (se D9); depoimentos → padrão DB-managed de help/blog; custo de IA → ledger service-role alimentado por `packages/ai`/`packages/transcribe`.
