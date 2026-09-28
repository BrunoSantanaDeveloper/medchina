# LP do evento — especificação de implementação

**Status:** pronta para construir · **Escrita em:** 2026-09-26 · **Revisada em:** 2026-09-26 após
auditoria de viabilidade contra o código e as decisões da mesma data (título, número dono,
e-mail mantido, base legal documentada) · **Irmã de:** `docs/PAGINA-CHINA.md`

A landing do evento ao vivo. Ela captura inscrição, entrega o link pelo canal que o público realmente
usa, e depois do evento vira gravação mais oferta.

**A decisão que governa tudo aqui:** o lead vale mais que o evento. Uma noite de transmissão pode
render algumas assinaturas; a lista de WhatsApp de acupunturistas que essa campanha constrói é
reutilizável em todas as campanhas seguintes, e hoje vocês não têm nenhuma. Toda escolha abaixo
favorece **capturar e reter o contato** em vez de economizar uma hora de desenvolvimento — e é por
isso mesmo que a lista precisa nascer com consentimento limpo: uma base que não pode ser reutilizada
não é ativo.

---

## 0. Decisões fechadas

| Decisão | Escolha |
|---|---|
| Título do evento | **O que muda para o acupunturista brasileiro depois da Lei 15.345 — e o que eu vi na China.** A lei é a isca; a China é a razão de ser ela a dizer isso |
| Rota | `src/app/(funil)/lei-15345/page.tsx` — grupo `(funil)`, sem menu, `noindex`, fora do sitemap. O slug antigo `/delegacao` saiu: sugeria delegação oficial, da mesma família de "congresso oficial" que a `/china` proíbe |
| Design system | Landing DS, como `/assinar` e `/fundadores` |
| Voz | Primeira pessoa da Debora — a página é dela e leva a assinatura "com Debora Giovanella, fundadora do MedChina". Textos legais nomeiam o MedChina como controlador |
| Público | Dentro e fora da base. A base antiga (~500) **só depois** da base legal documentada e assinada (§9.1) |
| Campos | **Nome + WhatsApp** obrigatórios. **E-mail opcional, mantido** (decisão de 2026-09-26) |
| Entrega do link | Comunidade do WhatsApp (grupo de avisos) + a própria página + e-mail para quem informou |
| Dados do evento | Tabela privada `live_events`, editada no console. **Nunca** em `platform_settings`, que qualquer visitante anônimo lê |
| Número dono da Comunidade | **Parametrizável no superadmin**, campo do evento no console (§7). Nunca hardcoded |
| Leads | A entidade única `leads` do `docs/FUNIL.md` T2.0, com a inscrição por evento em tabela própria. Nada de uma tabela de lead por evento |
| Console | `/admin/leads` — leads e eventos no mesmo lugar |
| CTA ao vivo e pós-evento | Assinar, via `getSellableCampaign()`, nunca agendar call. **Escondido para quem já paga** (§10) |

---

## 0.1 Por que não há ferramenta externa, nem "adicionar à agenda", nem e-mail obrigatório

O público é de acupunturistas com dificuldade declarada no digital. Cada exigência do fluxo é um
ponto de abandono, e todas estas foram descartadas por isso:

| Descartado | Por quê |
|---|---|
| Sympla, Google Forms, Zoom webinar | Exigem conta numa ferramenta que a pessoa não tem, e quebram a marca no meio do funil |
| Botão "adicionar à agenda" (.ics) | Exige app de calendário configurado e logado; em celular Android sem conta Google sincronizada, não faz nada visível |
| E-mail **obrigatório** | Metade desse público usa e-mail raramente, erra a digitação e não confere spam. O link morreria na caixa. Como campo **opcional**, o e-mail fica: é o canal redundante e o único que carrega o link pessoal para outro aparelho |
| Senha / criar conta para se inscrever | Recuperação de senha é onde esse público desiste |
| Confirmação em dois passos ("verifique seu e-mail") | Interrompe o fluxo no momento de maior intenção |

O que sobra é o denominador comum real: **todo mundo tem WhatsApp aberto no celular.**

---

## 0.2 Como o WhatsApp funciona neste produto (e por que não haverá disparo automático)

`packages/whatsapp` existe e está **inerte por decisão**: a Meta Cloud API exige verificação de
empresa, aprovação de template e cobra por mensagem; a Evolution API viola o ToS e arrisca banir o
número. O produto inteiro usa **handoff** — `apps/web/src/lib/whatsapp-link.ts` monta um `wa.me` com
a mensagem já escrita e uma pessoa aperta enviar.

Consequência direta para esta campanha: **não existe lembrete automático por WhatsApp.** Não invente
um. O substituto é melhor para este público:

### A Comunidade é a sala de espera — com grupo de avisos, não grupo comum

Depois de se inscrever, a pessoa entra numa **Comunidade do WhatsApp do evento**, no **grupo de
avisos** dela. Não num grupo comum, por dois motivos verificados:

- **Num grupo comum, cada membro vê o número de todos os outros.** São centenas de acupunturistas,
  concorrentes entre si, com o telefone exposto sem que o consentimento cubra isso. No grupo de avisos
  de uma Comunidade, os membros não veem o número uns dos outros (só os admins veem).
- Grupo comum tem teto de membros; o grupo de avisos da Comunidade comporta a campanha inteira.

Isso resolve de uma vez:

- **Lembrete com entrega real** — mensagem no grupo de avisos chega a todos, sem API, sem custo, sem
  lista de transmissão (que só entrega a quem tem o número salvo).
- **O aviso de que a sala abriu** — publicado no grupo, na página e por e-mail.
- **Zero fricção** — entrar é um toque, e é um gesto que esse público já faz todo dia.
- **Um ativo que sobra** — depois do evento a Comunidade vira canal de relacionamento, ou é encerrada
  com a mensagem final da oferta.

**Quem é dono da Comunidade:** o número cadastrado no console (campo `owner_phone` do evento, §7) —
o WhatsApp Business do MedChina, não só o pessoal da Debora. Pelo menos dois admins, "somente
administradores podem enviar mensagens" ligado, e um procedimento escrito para **redefinir o link de
convite** se ele vazar (o link novo é trocado no console na mesma hora; a página nunca o expõe, §6).

O formulário continua existindo **antes** do grupo, porque é ele que põe o lead no seu banco. Um
grupo de WhatsApp não é base de dados: você não consegue segmentar, exportar com consentimento, nem
medir atribuição a partir dele.

### A lead inicia a conversa, não o contrário

Mensagem 1:1 em volume, de um número para quem não o tem salvo, é exatamente o padrão que o WhatsApp
restringe — o mesmo risco que descartou a Evolution API. E nada prova que o número digitado é de quem
digitou. Por isso a confirmação traz um segundo botão, **Receber o link no meu WhatsApp**, que abre
`wa.me/<owner_phone>` com uma mensagem pronta ("Oi, me inscrevi no ao vivo sobre a Lei 15.345 e
quero receber o link"). Quem toca:

- prova que o número é dela, e
- abre a conversa — a partir daí, a resposta da equipe é resposta, não mensagem não solicitada.

O 1:1 do console (§7) prioriza quem iniciou conversa. Para quem consentiu e não iniciou, o contato é
**um por vez, nunca em lote**, e a primeira mensagem diz de onde veio e como sair ("Se não foi você
que se inscreveu, responda SAIR").

---

## 1. O fluxo, do clique ao lembrete

1. A pessoa chega em `/lei-15345` por um link com `origem` e `utm_*` (§14): WhatsApp da equipe,
   aviso in-app, orgânico, anúncio e, depois do §9.1, a base antiga.
2. Lê a página e toca em **Quero participar**. O formulário está visível na primeira tela do celular.
3. Preenche **nome e WhatsApp** — e, se quiser, o e-mail. A autorização do evento está escrita junto
   ao botão; a de novidades é uma caixa **desmarcada**, opcional.
4. A server action grava o lead e a inscrição numa única chamada ao banco (§3) e devolve a
   confirmação, sem recarregar (e funcionando também sem JavaScript, §5).
5. A tela troca para a confirmação: data e horário de Brasília, **Entrar no grupo de avisos**,
   **Receber o link no meu WhatsApp**, e o link pessoal (§6).
6. Um cookie opaco marca aquele navegador como inscrito; o link pessoal recria esse cookie em
   qualquer outro navegador ou aparelho.
7. Quem informou e-mail recebe a confirmação por e-mail, com o link pessoal.
8. Lembretes: no grupo de avisos e por e-mail — na véspera, uma hora antes e quando a sala abre (§8).
9. No dia, a própria `/lei-15345` vira a sala: a transmissão roda embutida, com o botão de assinar ao
   lado para quem ainda não assina (§10). Páginas abertas antes da hora viram sala sozinhas.
10. Depois: a mesma rota vira gravação + condição, e continua capturando quem chega atrasado (§11).

Nenhum passo depende de e-mail, de calendário ou de conta em ferramenta alguma. O e-mail é
redundância, nunca o caminho principal.

---

## 2. Arquivos

| Arquivo | Ação |
|---|---|
| `src/app/(funil)/lei-15345/page.tsx` | criar — a landing, a sala e a gravação, por estado |
| `src/app/(funil)/lei-15345/actions.ts` | criar — `"use server"`: honeypot, normalização do telefone, termos resolvidos no servidor, RPC de inscrição, cookie, evento `Lead` |
| `src/app/(funil)/lei-15345/opengraph-image.tsx` | criar — cartão de texto **sem data** (§4), cópia do padrão de `(funil)/fundadores/opengraph-image.tsx` |
| `src/app/(funil)/lei-15345/lei-15345.css` | criar — só o que é exclusivo: formulário, sala (vídeo + CTA lado a lado), QR do grupo. O card da fundadora já vem de `funil.css` (ou de `landing-shared.css`, quando a `/china` o mover) |
| `src/app/(funil)/components/event-signup-form.tsx` | criar — client component com `useActionState`, `<form action>` nativo |
| `src/app/(funil)/components/live-room.tsx` | criar — client: player vidstack, consulta do estado, batimento de presença |
| `src/app/api/public/evento/entrar/route.ts` | criar — `GET ?i=<token>`: grava o cookie e redireciona para a página sem o token na URL |
| `src/app/api/public/evento/grupo/route.ts` | criar — `GET`: marca o clique pelo cookie e redireciona para o convite da Comunidade. O convite nunca aparece no HTML |
| `src/app/api/public/evento/whatsapp/route.ts` | criar — `GET`: marca "iniciou conversa" e redireciona para `wa.me/<owner_phone>` com a mensagem pronta |
| `src/app/api/public/evento/presenca/route.ts` | criar — `POST` de batimento (`keepalive`), com `hasSameOrigin` e corpo limitado |
| `src/app/api/public/evento/estado/route.ts` | criar — `GET`: só o estado do evento, sem dado pessoal, cache curto |
| `src/app/api/public/evento/descadastrar/route.ts` | criar — descadastro de e-mail do lead em um clique, pelo token do lead (o de `/api/public/unsubscribe` é de `profiles`) |
| `src/lib/live-event.ts` | criar — lê `live_events` com service role e resolve o estado com motivo nomeado, espelhando `lib/campaign-offer.ts` |
| `src/lib/live-event-jobs.ts` | criar — função Inngest de envio de e-mails em lote, com fallback inline; registrar em `src/app/api/inngest/route.ts` |
| `packages/fields/src/index.ts` | editar — `normalizeMobileBr()` (§5) |
| `packages/email/src/templates/live-event.tsx` + senders em `index.ts` | criar — confirmação, lembrete, "começou", gravação |
| `packages/db/migrations/0112_leads.sql` | criar — §3 |
| `packages/db/tests/0042_leads.test.sql` | criar — pgTAP: privilégios, unicidade, exclusão LGPD (§3) |
| `src/app/(dashboard)/admin/leads/page.tsx` + `components/` | criar — console (§7) |
| `src/menu-items.ts` + `packages/content/messages/*.json` | editar — `menu-admin-leads` e `menu-admin-leads-description` nos seis idiomas |
| `packages/content/messages/*.json` | editar — política de privacidade: `privacy-3`, `privacy-4`, `privacy-6`, `privacy-7`, `privacy-8` e `legal-updated`, nos seis idiomas (§9) |
| `src/lib/analytics.ts` | editar — `track(event, props, { eventId, ga4Name })` (§14) |
| `src/constants.ts` | editar — `COOKIE_KEYS.liveEvent` |
| `src/middleware.ts` | editar — `"/lei-15345"` e `"/api/public/evento"` em `PUBLIC_PREFIXES`, sob o comentário das páginas do `(funil)` |
| `src/app/(funil)/assinar/page.tsx` + `settings/billing/actions.ts` + `0112` | editar — repassar `origem`/`utm_*` até o checkout e gravar a última campanha em `meta_attribution` (§11) |
| `docs/LGPD-BASE-LEGADA.md` | criado como rascunho em 2026-09-26 — preencher e assinar antes de convidar a base antiga (§9.1) |
| `docs/FUNIL.md` · `docs/TRACKING.md` · `docs/PAGINA-CHINA.md` | editar — §16 |

Fora do sitemap, como as demais páginas do `(funil)`.

---

## 3. Modelo de dados — `0112_leads.sql`

Uma pessoa, várias inscrições: o lead é da plataforma (T2.0 do FUNIL); a inscrição é do evento.

```sql
-- O evento. Privado: o convite da Comunidade e o vídeo não podem estar numa
-- tabela que o anônimo lê (platform_settings é `select … to anon using (true)`,
-- 0018:21-23). Substitui a chave `masterclass` que o D7 do FUNIL reservava:
-- a masterclass vira outra linha desta tabela.
create table public.live_events (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,60}$'),
  title text not null check (char_length(title) <= 200),
  starts_at timestamptz not null,          -- exibido sempre em horário de Brasília
  duration_minutes integer check (duration_minutes between 15 and 480),
  state text not null default 'rascunho'
    check (state in ('rascunho', 'inscricoes', 'ao_vivo', 'encerrado')),
  owner_phone text check (owner_phone ~ '^55[1-9][0-9]9[0-9]{8}$'),  -- número dono da Comunidade
  group_invite_url text check (group_invite_url ~ '^https://chat\.whatsapp\.com/'),
  stream_url text,                          -- YouTube não listado da transmissão
  recording_url text,
  -- Inscrições por hash de IP por hora (§5). O 20 é só ponto de partida, sem
  -- medição por trás: calibrar no ensaio e ajustar no console, nunca por deploy.
  ip_window_limit integer not null default 20,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- O lead (T2.0): uma linha por pessoa. Vocabulário de campanha do repo
-- (origem, onda, segmento), como signup_attribution (0086).
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  -- Celular BR normalizado: 11 dígitos, sem 55, sem máscara (packages/fields).
  phone text not null unique check (phone ~ '^[1-9][0-9]9[0-9]{8}$'),
  email text check (email is null or char_length(email) <= 254),
  segmento text not null check (segmento in ('live', 'waitlist', 'ex_pagante', 'cadastro_v1', 'escola', 'indicacao', 'gratuito_parado')),
  onda text check (onda is null or char_length(onda) <= 60),
  -- First-touch, do cookie do middleware: os MESMOS nove campos que
  -- persistSignupAttribution grava, com o mesmo CHECK de tamanho da 0086.
  origem text, utm_source text, utm_medium text, utm_campaign text,
  utm_content text, utm_term text, referrer text, landing_path text,
  -- Novidades e anúncios: consentimento OPCIONAL e separado do evento (§9).
  marketing_term_id uuid references public.consent_terms (id),
  marketing_term_text text,
  marketing_accepted_at timestamptz,
  marketing_revoked_at timestamptz,
  opted_out_at timestamptz,                 -- saiu de tudo (SAIR, descadastro, pedido)
  email_unsubscribe_token uuid not null unique default gen_random_uuid(),
  email_opt_out_at timestamptz
  -- + CHECK de tamanho em origem/utm_*/referrer/landing_path, copiado da 0086:44-55
);

-- A inscrição num evento.
create table public.live_event_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_slug text not null references public.live_events (slug),
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- O termo do evento, fixado: id + versão + o texto que ela viu (padrão 0102:273-275).
  contact_term_id uuid not null references public.consent_terms (id),
  contact_term_version integer not null,
  contact_term_text text not null,
  contact_accepted_at timestamptz not null default now(),
  -- Last-touch DESTA inscrição, lido da URL da página (qual canal trouxe a inscrição).
  origem text, utm_source text, utm_medium text, utm_campaign text, utm_content text,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),  -- sha256(IP + sal); nunca o IP
  after_event boolean not null default false,  -- inscrição feita com o evento já encerrado
  group_clicked_at timestamptz,
  whatsapp_started_at timestamptz,          -- tocou em "Receber o link no meu WhatsApp"
  last_whatsapp_opened_at timestamptz,      -- a equipe abriu 1:1 pelo console
  email_confirmation_sent_at timestamptz,
  email_day_before_sent_at timestamptz,
  email_hour_before_sent_at timestamptz,
  email_live_sent_at timestamptz,
  email_recording_sent_at timestamptz,
  unique (event_slug, lead_id)
);

-- Tokens do cookie e do link pessoal. Vários por inscrição: um por aparelho em
-- que ela se inscreveu, e todos continuam valendo (rotacionar invalidaria o link
-- já enviado por e-mail). Só o hash chega ao banco (padrão 0040/0053).
create table public.live_event_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  registration_id uuid not null references public.live_event_registrations (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Presença. Separada da inscrição porque o batimento grava a cada minuto por
-- espectador: numa tabela versionada, isso seria uma versão por minuto por
-- pessoa em record_versions.
create table public.live_event_presence (
  registration_id uuid primary key references public.live_event_registrations (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  watched_seconds integer not null default 0 check (watched_seconds between 0 and 86400)
);

create index live_event_registrations_event_idx on public.live_event_registrations (event_slug, created_at desc);
create index live_event_registrations_ip_idx on public.live_event_registrations (ip_hash, created_at desc);

-- RLS: tudo ligado, leitura e escrita superadmin; anônimo e autenticado comum
-- não leem nada (revoke all … from anon, padrão 0086:70-74). A escrita pública
-- passa por RPC service-role-only, nunca por insert direto.
-- Versionamento: `leads`, `live_event_registrations` e `live_events`
--   (select public.enable_row_versioning('public.<tabela>')), como o §0.5 do FUNIL exige.
--   `live_event_tokens` e `live_event_presence` ficam fora, como as tabelas de token
--   e sessão da 0040/0053 e a 0086: são operacionais, sem conteúdo de consentimento.
```

**Termos** (seed com `insert … where not exists`, padrão 0102:45-57). **Texto definitivo**, revisado
em 2026-09-26 — a íntegra está na migração, e é ela que a página mostra e que fica fixada na linha:

| slug | versão | Para quê |
|---|---|---|
| `evento-contato` | 1 | Obrigatório para se inscrever: link, lembretes e gravação deste evento, por WhatsApp e, se informado, por e-mail; entrada no grupo de avisos |
| `medchina-novidades` | 1 | Opcional, caixa desmarcada: novidades e condições do MedChina por WhatsApp e e-mail, e uso do contato em públicos de anúncio nas redes sociais |

Por que não `consent_acceptances`: `org_id` é obrigatório lá (0005:137) e a tabela só aceita escrita
por RPC própria (0040:154-157) — um lead ainda não tem organização. É a opção (b) do T2.4 do FUNIL:
fixar termo e versão na linha do lead. `consent_terms` não tem leitura anônima, então a página lê o
texto do termo no servidor.

**RPCs**, todas `security definer`, com `revoke all … from anon, authenticated` e `grant execute …
to service_role` (padrão 0111:80, 115-117):

- `submit_live_event_registration(...)` — numa transação: recusa evento que não está em
  `inscricoes`/`ao_vivo`/`encerrado`; conta inscrições do mesmo `ip_hash` na última hora contra
  `ip_window_limit`; cria o lead **ou encontra o existente pelo telefone sem alterar nada nele**; cria a
  inscrição ou encontra a existente; grava o hash do token novo. Devolve
  `{ ok, code: 'created' | 'existing' | 'too_many' | 'not_open', registration_id }`.
- `touch_live_event_registration(token_hash, kind, seconds)` — marca `group`, `whatsapp` ou
  `presence` (esta soma segundos com teto) a partir do token do cookie.
- `purge_lead(lead_id)` — só superadmin: apaga lead, inscrições, tokens e presença **e as versões
  dessas linhas em `record_versions`** (padrão 0099:309). Sem isso, o telefone sobrevive inteiro no
  versionamento depois da "exclusão".
- `purge_expired_leads()` — só `service_role`, chamada pelo job diário: aplica a retenção do §9
  (sem consentimento de novidades e com o último evento há mais de seis meses) pelo mesmo caminho de
  `purge_lead`, e devolve quantos apagou.

**pgTAP `0042_leads.test.sql`:** anônimo e autenticado não leem as tabelas nem executam as RPCs;
`service_role` executa; telefone é único; uma segunda inscrição não altera o lead; `purge_lead`
deixa zero linhas em `record_versions` para os ids apagados.

---

## 4. A página — seções e copy

| # | Seção | Conteúdo |
|---|---|---|
| 1 | Herói | Data e hora de Brasília, título, assinatura, o formulário visível na primeira tela do celular |
| 2 | O que você vai ver | Três linhas, não um índice de aula |
| 3 | Quem apresenta | Debora Giovanella · Fundadora do MedChina, no bloco `.offer-founder` que as outras páginas do funil já usam, com `public/images/palestra/fundadora-debora.jpg`. A foto do palco entra quando existir e estiver autorizada (asset compartilhado com a `/china`) |
| 4 | Para quem é | Duas linhas de qualificação honesta |
| 5 | Formulário de novo | Repetição do bloco 1, no fim da rolagem |

### Copy

**Por que o título está nessa ordem:** a Lei 15.345 é o assunto que o público já quer entender — é a
isca. A China é o que dá autoridade à pessoa que explica: quem acabou de apresentar o prontuário
brasileiro de MTC num congresso na China é quem tem motivo para falar sobre o que muda no
consultório brasileiro.

**Herói**
- Eyebrow: `Ao vivo · [dia] de [mês], às [hora] (horário de Brasília)` — sempre de `live_events.starts_at`, formatado com `timeZone: "America/Sao_Paulo"`.
- Título: **O que muda para o acupunturista brasileiro depois da Lei 15.345**
- Acento: *e o que eu vi na China.*
- Assinatura: com Debora Giovanella, fundadora do MedChina
- Lead: Em janeiro, a acupuntura virou profissão regulamentada no Brasil. Em setembro, eu levei o MedChina ao Congresso de MTC em Xinjiang, na China. Nesta noite eu conto as duas coisas, e o que elas mudam no seu consultório.
  *(A palestra foi em 19 de setembro de 2026. No celular, o lead desce para baixo do formulário se não couber na primeira tela.)*
- Botão: **Quero participar**

**O que você vai ver**
- Quem pode exercer a acupuntura segundo a Lei 15.345, e o que muda na prática do consultório depois dela
- O que eu apresentei no Congresso de MTC em Xinjiang, e o que vi por lá
- Uma consulta simulada, com paciente e diálogo fictícios, registrada do começo ao fim sem ninguém digitar durante o atendimento

> **Precisão obrigatória** (mesmas regras da `/china`, §5.2 e §8): a lei define quem pode exercer e
> **não** cria obrigação de prontuário — nada na página, na fala ou nos lembretes diz "a lei exige
> registro". Por isso a primeira linha fala de "o que muda na prática", e não de "o que a
> regulamentação cobra". O congresso é "Congresso de MTC em Xinjiang, na China" — nunca "oficial",
> nunca "internacional". A segunda linha só promete o que ela viu e apresentou. A demonstração usa
> paciente e diálogo fictícios, como o `docs/PRODUCT.md` §7.4 manda para qualquer demonstração.

**Para quem é**
> Para quem atende com acupuntura ou MTC e registra as consultas — em papel, em caderno, em qualquer
> sistema. Se você nunca registrou nada e não pretende começar, esta noite não vai te servir.

**Microcopy do formulário**
- Campo 1: `Seu nome`
- Campo 2: `Seu WhatsApp` — placeholder `(00) 00000-0000`, `inputMode="numeric"`, `autoComplete="tel"`
- Campo 3: `E-mail (opcional)` — com a linha `Para receber o link também por e-mail.`
- Junto ao botão (termo `evento-contato`): `Ao se inscrever, você autoriza o MedChina a enviar o link, os lembretes e a gravação deste evento pelo WhatsApp e, se informou, por e-mail. O grupo de avisos só recebe mensagens da equipe e não mostra o seu número aos outros participantes.`
- Caixa **desmarcada** (termo `medchina-novidades`): `Quero receber novidades e condições do MedChina por WhatsApp e e-mail, e autorizo o uso do meu contato em anúncios do MedChina nas redes sociais. Posso sair quando quiser.`
- Abaixo da caixa: `Sem essa opção marcada, seu contato serve só para este evento.`

A frase antiga "Não mandamos mensagem de propaganda" saiu: ela era desmentida pela mensagem final
da oferta no grupo e pelo reaproveitamento da lista. A caixa opcional é o que torna o reaproveitamento
verdadeiro.

**Cartão de link (OG):** "Ao vivo com Debora Giovanella" · "O que muda para o acupunturista
brasileiro depois da Lei 15.345" · "e o que eu vi na China". **Sem data:** a imagem de metadado é
gerada no build e o WhatsApp guarda o preview em cache por URL — uma data impressa ficaria errada no
primeiro reagendamento. É a regra que o OG da `/fundadores` já segue. A data vai no texto da mensagem
que leva o link, e na página.

---

## 5. O formulário — regras de fricção mínima

- **Nome + WhatsApp, e-mail opcional, visível na primeira tela.** Critério verificável: a 360×640, o
  botão aparece sem rolar.
- **Server action com `useActionState` e `<form action>` nativo**, campos lidos de `FormData`. Com
  JavaScript, o bloco troca no lugar; sem JavaScript, o POST re-renderiza a página já com a
  confirmação. Não há `redirect()` na action (descartaria o estado). É padrão novo no repo — o único
  formulário público hoje, o de `/contato`, é só cliente —, e o FUNIL T2.0 já pedia server action.
- **Telefone normalizado no servidor** por `normalizeMobileBr()` em `packages/fields`: tira tudo que
  não é dígito; com 12 ou 13 dígitos começando em 55, tira o 55 (é o formato que o próprio WhatsApp
  copia); exige 11 dígitos com o terceiro igual a 9. `isValidPhoneBr` sozinho recusa o `+55` colado e
  aceita fixo, que não tem WhatsApp. Máscara `formatPhoneBr` enquanto digita; dígitos puros no banco.
- **Erro abaixo do campo, em palavras:** "Faltou um dígito no número." · "Esse número parece de
  telefone fixo. Use o número do seu WhatsApp." — nunca "formato inválido".
- **Honeypot:** um campo `site` fora da tela (`tabIndex={-1}`, `autoComplete="off"`, `aria-hidden`),
  escondido por classe do DS. Preenchido → a mesma tela de confirmação, sem gravar nada, sem cookie,
  sem evento. Um bot não aprende nada com isso.
- **Limite por rede no banco**, não em memória (a Vercel não compartilha memória entre funções, e não
  há limitador no repo): `ip_hash` = sha256 do IP com sal de servidor, contado na RPC contra
  `live_events.ip_window_limit`. O limite é **folgado** — operadora móvel põe muita gente atrás do
  mesmo IP (CGNAT) no pico da abertura. Estourou → `Muita gente se inscrevendo pela mesma rede agora.
  Tente de novo em alguns minutos.` Aqui a mensagem é honesta de propósito: quem esbarra nisso é quase
  sempre uma pessoa, e o honeypot já cuida do bot.
- **Por telefone, o limite é o índice único:** a segunda inscrição do mesmo número vê a confirmação,
  não um erro — e **não altera nada no lead** (nome, e-mail), para ninguém reescrever os dados de
  outra pessoa digitando o número dela.
- **A confirmação mostra o nome digitado, nunca o nome guardado.** Mostrar o guardado revelaria o nome
  de quem é dono de qualquer número que alguém digitar.
- **Sem captcha.** Nesse público, captcha derruba conversão de verdade.
- Botão com estado de envio (`pending` do `useActionState`); duplo toque não cria duas inscrições.
- Usuária logada: nome e e-mail pré-preenchidos do perfil.

---

## 6. A tela de confirmação — onde o comparecimento se decide

Não é uma página nova: é o mesmo bloco trocando de conteúdo.

1. **Confirmação nomeada**, com o nome que ela acabou de digitar: "Pronto, [primeiro nome]. Seu lugar está garantido."
2. **Data e hora repetidas**, grandes, com "horário de Brasília".
3. **Botão principal: Entrar no grupo de avisos** → `GET /api/public/evento/grupo`, que marca o clique e redireciona para o convite. Abaixo: `É no grupo que você recebe os lembretes e o aviso de que a sala abriu.`
4. **Botão secundário: Receber o link no meu WhatsApp** → `GET /api/public/evento/whatsapp` (§0.2).
5. **No computador**, ao lado do botão do grupo, o QR code da rota do grupo — quem se inscreve pelo
   e-mail no desktop, sem WhatsApp Desktop, cairia numa página de download.
6. **O link pessoal**: `Guarde este link. Ele abre a sala em qualquer celular:` → `/api/public/evento/entrar?i=<token>`.
7. **A frase que explica o dia:** `No dia, a sala abre nesta mesma página. O aviso sai no grupo.`

**Não há "link da sala" para reter — a sala é esta página.** O que fica guardado até o dia é o
**estado** ao vivo: o id do vídeo só é renderizado quando `state = 'ao_vivo'`. O que de fato não pode
circular é o **convite da Comunidade**, e ele nunca está no HTML — só na resposta de redirecionamento
de quem tem o cookie de inscrita. Os botões são `<a className="button">` simples, nunca `next/link`,
para nada pré-carregar a rota.

**Cookie de inscrita:** token aleatório de 32 bytes, só o hash vai ao banco; `httpOnly`, `secure`,
`sameSite: "lax"`, `path: "/"` — as flags do cookie de **atribuição**, não as do de cupom (que o
cliente lê). Duração do cookie como a da atribuição (90 dias); quem decide a validade é
`live_event_tokens.expires_at`, na linha. O link pessoal existe porque o navegador embutido do
Instagram não compartilha cookies com o Chrome, e o iPhone abre links do WhatsApp num navegador que
também não compartilha: sem ele, a inscrita cairia no formulário de novo no dia.

---

## 7. O console em `/admin/leads`

Superadmin, mesmo padrão dos outros consoles (gate no layout + RLS). Slug em inglês como os demais;
`menu-admin-leads` e `menu-admin-leads-description` nos seis idiomas. Os contadores e a grade seguem o
catálogo de componentes do produto (`product-screen`): contador é componente, não frase de números.
**Toda mutação chama `recordAudit`, com o id do lead e nunca nome ou telefone no metadado.**

### Aba Eventos

Um card por evento, editando `live_events`:

- título, data e hora (exibida e digitada em horário de Brasília), duração;
- estado: `rascunho` → `inscricoes` → `ao_vivo` → `encerrado`;
- **número dono da Comunidade** (`owner_phone`) — é daqui que saem o botão "Receber o link no meu
  WhatsApp" e as conversas 1:1;
- link de convite da Comunidade (trocar aqui se vazar), vídeo da transmissão, gravação;
- limite de inscrições por rede por hora;
- botões de e-mail: **Enviar lembrete da véspera · Enviar lembrete de 1 hora · Enviar "começou" ·
  Enviar gravação**, cada um mostrando quantos já saíram.

### Aba Leads

- Grade em `components/data-grid/data-table.tsx`: nome, WhatsApp, e-mail, evento, quando se
  inscreveu, canal da inscrição, clicou no grupo, iniciou conversa, presença e tempo assistido,
  consentimento de novidades, descadastro.
- Contadores no topo: inscritas, cliques no grupo, conversas iniciadas, presentes.
- **Abrir conversa**, uma por clique — `whatsappDeepLink(phone, mensagem)` com a mensagem que diz de
  onde veio e como sair. Marca `last_whatsapp_opened_at` e mostra quantas foram abertas hoje. **Nunca
  em lote.**
- **Exportar:** o botão de CSV que a DataTable já tem. Um filtro pronto "Elegíveis para anúncio"
  (consentimento de novidades, sem descadastro) é o único recorte que sobe como público no Meta. No
  export, células que começam com `=`, `+`, `-` ou `@` são neutralizadas — um nome como
  `=HYPERLINK(...)` executaria ao abrir a planilha. O clique no export é auditado com a contagem.
- **Descadastrar** (pedido de SAIR, de qualquer canal): marca `opted_out_at`; a linha sai de exports
  e do 1:1.
- **Excluir (LGPD):** chama `purge_lead` — linha, inscrições, tokens, presença e versões.

---

## 8. Lembretes

| Quando | Canal | Como |
|---|---|---|
| Na inscrição | E-mail | Confirmação com o link pessoal, automática, só na primeira inscrição do número |
| Véspera | Grupo de avisos + e-mail | Mensagem da equipe no grupo; e-mail pelo botão do console |
| 1 hora antes | Grupo de avisos + e-mail | No grupo, o link da página com `origem=grupo`; no e-mail, o link pessoal |
| Na hora de abrir | Grupo + página + e-mail "começou" | A página vira sala sozinha (§10) |
| Quem não clicou no grupo | 1:1 | Pelo console, um por vez, prioridade a quem iniciou conversa |
| Depois | E-mail + grupo | A gravação |

**E-mail, requisitos:**
- Quatro templates em `packages/email` (confirmação, lembrete, "começou", gravação), com a linguagem de segurança do produto.
- Rodapé com descadastro em um clique pelo `email_unsubscribe_token` do lead, e o cabeçalho `List-Unsubscribe`.
- Envio pela função Inngest de `live-event-jobs.ts`, em lotes, com fallback inline se o Inngest não estiver configurado (`sendEvent` nunca lança).
- Idempotência pelas colunas `email_*_sent_at` da inscrição: apertar o botão duas vezes não manda duas vezes.
- Filtra `email_opt_out_at` e `opted_out_at` antes de cada envio.

**Pré-requisito:** SPF/DKIM do domínio de envio do Resend no domínio real (Riscos 3 do FUNIL). Sem isso a
confirmação cai no spam e o canal redundante não existe.

---

## 9. LGPD

- **Duas finalidades, dois termos** (§3): o do evento, obrigatório e necessário para o que ela pediu;
  o de novidades e anúncios, opcional e desmarcado. O evento nunca é condicionado a publicidade.
  Termo, versão e o texto exato ficam fixados na linha, com a data.
- **Telefone é dado pessoal:** sem SELECT público, nunca no HTML, nunca no metadado de auditoria,
  nunca mostrado de volta para quem digitou.
- **O grupo de avisos não expõe o número** aos outros participantes — e o termo diz isso.
- **Opt-out por todos os caminhos:** responder SAIR (a equipe marca no console), o link de
  descadastro do e-mail, sair do grupo. Quem sai não recebe mais nada e não entra em export.
- **Exclusão de verdade:** `purge_lead` apaga também as versões em `record_versions`.
- **Retenção (definida em 2026-09-26):** o lead sem consentimento de novidades é eliminado **seis
  meses depois do último evento em que se inscreveu** — o tempo de entregar a gravação e a condição
  pós-evento. Quem autorizou novidades fica até retirar a autorização. A eliminação é automática: um
  job diário do Inngest chama `purge_expired_leads()`, que apaga as linhas **e as versões delas**. O
  prazo está no termo do evento e em `privacy-8`.
- **Política de privacidade**, nos seis idiomas, antes da primeira inscrição: `privacy-3` e
  `privacy-4` (a nova categoria de titular — inscrita em evento — e as finalidades), `privacy-6` e
  `privacy-7` (lista enviada à Meta como público, só com o termo opcional), `privacy-8` (retenção),
  e `legal-updated`. Resend e Meta atuam como operadores.
- Esta base é **nova e com consentimento limpo** — não misture com os ~500 contatos antigos (§9.1).

### 9.1 A base antiga (~500): documentar antes de convidar

**Decisão de 2026-09-26: documentar a base legal.** O FUNIL já condiciona o primeiro disparo a essa
base a isso (item 6 da Fase 0; Riscos 1; portão de largada) e avisa que há uma única oportunidade de
reconquista.

- **O documento:** `docs/LGPD-BASE-LEGADA.md`, criado como rascunho nesta revisão, com a estrutura da
  avaliação de legítimo interesse (LIA), o que o repositório já sabe dessa base e as lacunas que só a
  Debora e a revisão jurídica preenchem. **Nenhum convite à base antiga sai antes de ele estar
  preenchido, revisado e assinado.**
- **Como o convite sai:** pelos canais externos que o FUNIL já prevê (os ~500 estão fora deste banco;
  o produto não tem disparo em massa), com identificação de quem escreve e opt-out em toda mensagem.
- **A lista antiga nunca é importada em `leads`.** Quem da base antiga se inscreve em `/lei-15345`
  vira lead novo, com o termo novo e consentimento limpo. É assim que a base antiga migra para a nova
  sem herdar o problema dela.
- **Quem já tem conta** é convidado pelo aviso in-app (`/admin/announcements`, sem código novo; o
  link digitado no console leva `origem=app` e os `utm_*`). E-mail a titulares de conta, se houver,
  respeita `lifecycle_email_opt_out`.

---

## 10. O dia do evento — a transmissão acontece na própria página

`lib/live-event.ts` resolve o estado como `campaign-offer.ts` faz: um `state` com motivo nomeado, e
`closed` derivado dele — nunca inferido da ausência de um campo. Com `state = 'ao_vivo'`, a
`/lei-15345` deixa de ser convite e passa a ser a sala:

- **A transmissão roda embutida**, no `@vidstack/react` que já é dependência. O provider de YouTube
  dele usa `youtube-nocookie.com` por padrão; carregar com `load="play"` e pôster (o player só existe
  quando ela toca — a regra de vídeo e consentimento do FUNIL:378) e declarar `streamType="live"`,
  porque o provider de YouTube não detecta sozinho e mostraria controles de vídeo gravado.
- **O botão de assinar fica ao lado do vídeo** durante a transmissão inteira, com o destino da
  convenção da `/china`: `getSellableCampaign()` e, sem oferta à venda, `/planos`. Link:
  `/assinar?origem=lei-15345&utm_source=lei-15345&utm_medium=ao-vivo&utm_campaign=lei-15345&utm_content=china-lei15345-aovivo-v1`
  (o prefixo `china-` faz a `/assinar` abrir no ângulo China).
- **Quem já paga não vê botão de compra.** A página lê sessão e assinatura no servidor, com a mesma
  consulta de `assinatura/page.tsx:185-194`. Motivo: a `/assinar` manda quem está logado direto ao
  checkout, e ali um plano pago existente é substituído **sem crédito pelos dias pagos**
  (`assinatura/page.tsx:291-294`, BILLING-AUDIT A1). Para quem paga, no lugar do botão:
  "Você já é assinante. Obrigada por estar aqui." Gratuito, trial e anônimo veem o botão.
- **Quem tem o cookie de inscrita cai direto na sala.** Quem não tem vê o formulário — ou, se já se
  inscreveu em outro aparelho, só o campo de WhatsApp ("Já se inscreveu? Digite seu WhatsApp") — e
  entra em seguida, sem perder o começo.
- **Páginas abertas antes da hora viram sala sozinhas:** a partir de dez minutos antes de
  `starts_at`, o cliente consulta `GET /api/public/evento/estado` a cada 30 segundos (cache de 15) e,
  quando o estado muda, mostra "A transmissão começou. Toque para entrar." e recarrega a página no
  toque.
- **Presença medida pela página:** enquanto o player toca, um batimento a cada 60 segundos para
  `/api/public/evento/presenca` grava primeira e última vez e soma o tempo assistido em
  `live_event_presence`. Isso substitui a "lista de presença da sala", que o YouTube não fornece.

### Os três caminhos do aviso, no dia

1. Mensagem no grupo de avisos, apontando para `/lei-15345?origem=grupo&…`
2. A própria `/lei-15345`, que vira sala sozinha em quem já está com ela aberta
3. E-mail "começou", com o link pessoal

Mais a rede de segurança: o 1:1 do console, um por vez, para quem se inscreveu e nunca clicou no
grupo.

**Toda divulgação aponta para `/lei-15345`, nunca para o YouTube.** É o que mantém a medição de
presença, o botão de assinar ao lado e o controle do que a página mostra quando a transmissão termina.

---

## 11. Depois do evento

Com `state = 'encerrado'`:

- Herói vira **"A gravação está aqui"**, com o vídeo gravado no mesmo player.
- O botão de assinar continua, pelo mesmo `getSellableCampaign()`, com `utm_medium=gravacao` e
  `utm_content=china-lei15345-gravacao-v1`. **O prazo que aparecer é o de `campaign_offer`** — o
  mesmo que o checkout recusa. Nenhum prazo mora em `live_events`. Quem já paga continua sem botão.
- **O formulário não some:** vira uma captura curta, "Receber a gravação no meu WhatsApp", com o
  mesmo termo do evento e a mesma caixa opcional. Quem chega pelo link encaminhado depois da live
  também é lead — é a premissa do documento. Essas inscrições entram com `after_event = true` e são
  medidas à parte.
- A Comunidade é encerrada com a mensagem final da oferta, ou vira canal permanente — decisão de
  vocês.
- Só quem marcou a caixa de novidades vira público no Meta e recebe a próxima campanha.

**Atribuição da compra ao evento:**
- O first-touch não serve aqui: ele é gravado uma vez por conta, e a base que já tem conta nunca seria creditada.
- Cupom também não: empilharia desconto sobre o preço da campanha.
- O mecanismo: a `/assinar` repassa `origem` e `utm_*` para o `next` do checkout (o `sanitizeInternalNext` preserva a query), e o início do checkout grava a última campanha em `meta_attribution`, ao lado dos sinais que ela já guarda. Essa linha é sobrescrita a cada checkout, então é last-touch por construção.
- O webhook passa a campanha para o `Purchase`.
- Complementar, no console: casar o e-mail do lead com o da conta, para ver quem se inscreveu e depois assinou por outro caminho.

É aqui que a campanha se paga mesmo que o caixa do evento decepcione.

---

## 12. A operação do dia

O código não opera a noite sozinho. Papéis, cada um com um nome definido antes do ensaio:

| Papel | Faz |
|---|---|
| Apresentadora | A Debora: conduz a noite e a consulta simulada |
| Operador da sala | Muda o estado no console, acompanha o player e a página, dispara os e-mails |
| Admin da Comunidade | Manda as mensagens do grupo nos horários do §8, redefine o convite se vazar |
| Suporte 1:1 | Atende quem escreve no número dono e faz o 1:1 do console |

**Antes do dia, com antecedência:**
- [ ] `docs/LGPD-BASE-LEGADA.md` assinado, se a base antiga for convidada (§9.1)
- [ ] Política de privacidade publicada com a base de leads (§9)
- [ ] Número dono cadastrado no console; Comunidade criada por ele, grupo de avisos, dois admins, só admins enviam, convite no console
- [ ] YouTube: canal verificado, transmissão ao vivo habilitada **com 48 horas de folga** (a primeira habilitação leva até 24), incorporação permitida, transmissão não listada criada
- [ ] Oferta aberta em `campaign_offer` e **compra de teste real com PIX** feita pelo link da `/lei-15345`
- [ ] SPF/DKIM do domínio de envio
- [ ] Ensaio com transmissão de teste embutida na `/lei-15345` **de produção**: Android simples, iPhone, e o navegador do Instagram; estado mudando com a página aberta; e-mail chegando fora do spam
- [ ] Roteiro da consulta simulada, com paciente e diálogo fictícios, e o aparelho de gravação testado
- [ ] Mensagem pronta para queda: "A transmissão caiu. Voltamos em alguns minutos, nesta mesma página."

---

## 13. Fases e esforço

| Fase | Entrega | Esforço |
|---|---|---|
| 1 | Migração 0112 (quatro tabelas, termos, três RPCs) + pgTAP 0042 | 5–6 h |
| 2 | Página, formulário (server action, honeypot, telefone), confirmação, cookie e link pessoal, rotas `entrar`/`grupo`/`whatsapp` | 6–7 h |
| 3 | Console `/admin/leads`: eventos, leads, 1:1, export, descadastro, exclusão LGPD, menu nos seis idiomas | 5–6 h |
| 4 | O dia: player ao vivo, consulta do estado, batimento de presença, CTA que sabe quem já paga | 4–5 h |
| 5 | Pós-evento: gravação, CTA, captura curta, atribuição last-touch no checkout | 3–4 h |
| 6 | E-mail: quatro templates, job em lote com fallback, descadastro de lead, idempotência | 4–5 h |
| 7 | Tracking e textos legais: `track()` com `eventId`, `Lead`/`generate_lead`, `TRACKING.md`, política nos seis idiomas | 2–3 h |
| 8 | Verificação ponta a ponta em celular real e navegador embutido | 2 h |

**Total: 31 a 38 horas.** A estimativa anterior (19 a 25) não contava o que as convenções do repo
impõem — versionamento e pgTAP, anti-abuso no banco, consentimento versionado, auditoria, menu nos
seis idiomas, política de privacidade — nem o e-mail completo, que foi mantido. A operação do §12
não está nessas horas.

### O limite deixou de ser hora e passou a ser data

Com tempo disponível, o risco muda de lugar: não é mais construir de menos, é **construir tanto que o
evento atrase**. A janela da China tem validade — fotos de setembro deixam de ser notícia em
novembro, e a Lei 15.345 vai deixando de ser assunto novo. Marque a data do evento primeiro e
construa para caber nela.

**Se a data apertar, corte nesta ordem** (cada item vira melhoria da segunda edição):
1. O tempo assistido — o batimento continua marcando presença, sem somar segundos.
2. A consulta automática do estado — a mensagem do grupo pede "recarregue a página".
3. A captura pós-evento.

**Nunca corte:** consentimento em dois termos, anti-abuso, exclusão LGPD, o CTA que esconde a compra
de quem já paga, e o link pessoal.

---

## 14. Medição

Cadeia: visita → inscrição → clique no grupo → presença → clique na oferta → compra.

1. **Inscrição ÷ visita** — julga a página, por canal (`origem` da inscrição). Abaixo de 20% em tráfego da base, o problema é a promessa do herói.
2. **Clique no grupo ÷ inscrição** — julga a tela de confirmação, **separado por celular e computador** (no computador, sem WhatsApp Desktop, o número mede o aparelho, não o botão). Abaixo de 60% no celular, o botão não está claro o bastante.
3. **Presença ÷ inscrição** — julga o lembrete, por `live_event_presence`.
4. **Tempo assistido** — quem passou de 20 minutos é o público mais quente que vocês terão em meses; vira público de anúncio **só com o termo de novidades**.
5. **Compra com origem no evento** — pela última campanha gravada no checkout (§11), nunca por cupom. Nunca por criação de conta.
6. **Inscrições pós-evento** — `after_event = true`, à parte.

### Tracking

- `ViewContent` na montagem, `content_name: "lei-15345"`, como as outras páginas do funil.
- `Lead` na primeira inscrição do número, **só pelo navegador** nesta edição, com `eventID` = id da
  inscrição. Requer estender `track(event, props, { eventId, ga4Name })`: hoje `track()` não repassa o
  `eventID` ao Pixel. No GA4 o mesmo disparo sai como `generate_lead`.
- **Por que não também pelo servidor:** a postura de interesse legítimo do `docs/TRACKING.md` cobre
  as transações de titulares de conta, e uma inscrita no evento não é titular. Passar o `Lead` para o
  servidor exige estender a postura nos três textos (aviso de cookies, `privacy-7`, `cookies-4`) com
  `CONSENT_VERSION` novo no mesmo commit, e acrescentar a chave de telefone (`ph`) em `meta-capi.ts`.
  Fica como evolução, já preparada pelo `eventID`.
- Registrar `Lead`/`generate_lead` e `ViewContent` desta página no mapa do `docs/TRACKING.md`.

---

## 15. Checklist antes do merge

Os hooks de marketing (guard e lint) **não rodam em `(funil)`** — os filtros de disparo só olham
`(marketing)` e `components/marketing`. Este checklist é a verificação; carregue a skill
`marketing-page` à mão. (Ampliar os filtros dos hooks para `(funil)` é a correção que a `/china`
também registra.)

- [ ] `"/lei-15345"` e `"/api/public/evento"` em `PUBLIC_PREFIXES`
- [ ] Fora do `sitemap.ts`, com `robots: { index: false, follow: false }`; `opengraph-image.tsx` próprio, **sem data**
- [ ] Exatamente um `<h1>`; `alt` real no retrato; nenhum número, depoimento ou logo fabricado; guardrails clínicos; nada de escassez que não venha do servidor
- [ ] "Debora" sem acento; nada de "oficial" ou "internacional"; nada que diga que a lei exige registro; consulta demonstrada como simulada
- [ ] `live_events`, `leads` e inscrições sem leitura anônima; escrita só por RPC `service_role`; versionamento nas três; pgTAP 0042 passando
- [ ] Convite da Comunidade e id do vídeo nunca no HTML fora do estado certo
- [ ] Telefone normalizado no servidor por `normalizeMobileBr`; celular obrigatório; dígitos puros no banco
- [ ] Honeypot devolvendo a mesma confirmação; limite por rede no banco, folgado
- [ ] Segunda inscrição: confirmação, token novo, lead intocado, nome digitado na tela
- [ ] Dois termos versionados, texto fixado na linha; caixa de novidades desmarcada
- [ ] Política de privacidade atualizada nos seis idiomas
- [ ] Cookie opaco `httpOnly` com hash no banco; link pessoal recriando o cookie
- [ ] CTA por `getSellableCampaign()`, com `origem`/`utm_*`, **escondido para quem já paga**
- [ ] Batimento de presença gravando fora das tabelas versionadas
- [ ] E-mails com descadastro de um clique, `List-Unsubscribe`, idempotentes, filtrando opt-out
- [ ] Console atrás do gate de superadmin, `recordAudit` em toda mutação sem dado pessoal, export neutralizando fórmulas
- [ ] `ViewContent` e `Lead` (navegador, com `eventID`) disparando; `TRACKING.md` atualizado
- [ ] Horários sempre em "horário de Brasília"
- [ ] Teste de ponta a ponta num Android simples, num iPhone e no navegador do Instagram — não só no desktop

---

## 16. Documentos que mudam junto

- **`docs/FUNIL.md`:**
  - T2.0 e T6.4 passam a "em andamento", com a entidade `leads` desta migração.
  - O D7 registra que `live_events` substitui a chave `masterclass` de `platform_settings`, e T3.3 passa a ser outra linha dessa tabela.
  - A decisão de venda self-service, em vez de call e `/agendar`, fica registrada no A.3 e no EPIC 2.
  - Entrada no diário A.4 quando a página for entregue.
- **`docs/TRACKING.md`:** o `Lead` de navegador e o `generate_lead`, e a nota de que o `Lead` de servidor depende de estender a postura.
- **`docs/PAGINA-CHINA.md`:** a §0.1 passa a citar `/lei-15345` e esta spec — atualizado nesta revisão.
- **`docs/LGPD-BASE-LEGADA.md`:** rascunho criado nesta revisão; preencher e assinar.
- **`.claude/rules/marketing.md`:** opcional, junto com a ampliação dos filtros dos hooks.

---

## 17. O que a implementação fez diferente deste texto (2026-09-26)

Registrado para ninguém "corrigir" de volta. Cada item foi decidido na construção ou na verificação de
ponta a ponta contra o banco local.

- **Sem o campo só de WhatsApp para quem já se inscreveu (§10).** Quem chega sem o cookie vê o
  formulário completo; digitar de novo o mesmo número emite um token novo para aquele aparelho e
  mostra a confirmação com o nome **digitado**, sem revelar nada sobre a dona do número. Um campo só de
  telefone seria uma segunda porta com as mesmas regras, e o formulário completo já é a primeira.
- **O QR carrega o token pessoal.** Ele abre `/api/public/evento/grupo?i=<token>`, porque quem escaneia
  é o celular, que não tem o cookie do computador. O mesmo link pessoal e o QR voltam a aparecer depois
  de recarregar a página, reconstruídos a partir do cookie.
- **Presença é presença no ao vivo.** O batimento só grava com o evento em `ao_vivo`, e a gravação não
  envia batimento. Sem isso, `presença ÷ inscrição` (§14) contava quem abriu a página antes da hora ou
  assistiu à gravação dias depois.
- **Depois do evento, a promessa é a gravação (§11).** Confirmação ("Pronto, Ana. Você vai receber a
  gravação."), botão e mensagem do WhatsApp, dica do e-mail e textos do herói passam para o passado. A
  inscrição pós-evento recebe o e-mail `recording` quando a gravação já existe, nunca o `confirmation`
  ("seu lugar está garantido"); sem gravação, ela entra no envio `recording` do console. O bloco de
  captura continua na tela depois do envio, com a confirmação dentro.
- **`purge_lead(lead, motivo)`** recebe o motivo do operador e o grava na auditoria — a única coisa que
  sobrevive à exclusão além de quem e quando.
- **Export do público de anúncio no formato da Meta:** cabeçalhos `phone,email,fn,ln,country`, telefone
  como `55` + dígitos **sem "+"** — o "+" acionava a neutralização de fórmula e saía `'+55…`, que a
  Meta não casa. Primeiro e último nome separados, país `BR`.
- **Console de leads:** e-mail, evento e canal começam ocultos na grade (reativáveis no painel de
  colunas) — a `DataTable` compartilhada é a grade MIT, sem colunas fixas, e num notebook as ações por
  linha ficavam fora da tela. `updated_by` do evento é carimbado por gatilho a partir da sessão.
- **Player:** o pôster vai no próprio `MediaPlayer` (sem ele o provedor busca a miniatura no
  i.ytimg.com ao carregar), e o player monta depois da hidratação (o layout Plyr do vidstack diverge
  entre servidor e cliente).
- **`notFound()` responde 200 com a página de 404** em `rascunho`, porque o `src/app/loading.tsx` da raiz
  abre o streaming antes. Vale para todo `notFound()` do app; a página já é `noindex`.

---

## 18. Vários eventos, um depois do outro (2026-09-28, migração `0113`)

A primeira versão modelava vários eventos no banco, mas o resto assumia um só: página com texto no
código, rotas que carregavam o evento fixo `lei-15345`, um cookie de uma vaga, assunto de e-mail citando
a Lei 15.345 e nenhum jeito de criar evento sem SQL. Agora cada evento tem página, inscrições e
resultados próprios, e **um evento novo nunca mexe nos dados de outro**.

**Decisões da dona do produto (2026-09-28):**

- O **texto da página é dado do evento**, editado no console: título, assunto em poucas palavras,
  manchete (com `**destaque**`), assinatura, texto de abertura (e a versão no passado), até três
  assuntos com ícone de uma lista fixa, "para quem é" e a descrição do link. Um modelo só renderiza
  todos os eventos. As regras de linguagem do §4 valem para quem escreve no console: as páginas de
  `(funil)` nunca passam pelo lint.
- **O que a página faz depois que o evento termina é um parâmetro de cada evento:** continuar com a
  gravação e a captura curta, ou levar quem visitar para outro endereço **deste site** (um caminho
  começando com `/` — o banco recusa `//host` e URL absoluta). A superadmin continua vendo a página,
  com um aviso. O destino é conferido ao salvar e de novo a cada visita: não pode ser a própria página
  (em qualquer grafia), nem um rascunho, nem outro evento encerrado que também redireciona. Se o destino
  estragar depois (o outro evento voltou a rascunho), a visita vê a página normal e a superadmin vê um
  aviso de que o redirecionamento está sendo ignorado. Com redirecionamento, o e-mail da gravação fica
  desligado (na tela e na ação do servidor): ele prometeria uma gravação que ninguém vê.
- **Parceria não tem cadastro próprio.** A convidada entra na assinatura e no texto do próprio evento
  ("com Debora Giovanella e …"). O bloco "Quem apresenta" continua sendo o da Debora.

**Endereços.** O primeiro evento continua em `/lei-15345` (já está em e-mails, anúncios e QR). Todo evento
novo fica em `/ao-vivo/<endereço>`; `/ao-vivo/lei-15345` leva para `/lei-15345`. O endereço trava quando
o evento é publicado pela primeira vez ou recebe a primeira inscrição (gatilho no banco). A publicação fica
carimbada em `published_at`, uma vez, e não se apaga: voltar o evento para rascunho não destrava o
endereço nem permite excluir (`was_published`).

**Rotas públicas.** Descobrem o evento pelo token (`?i=`, no link pessoal e no QR) ou por `?e=<endereço>`
junto com o cookie. O cookie guarda **uma entrada por evento** (`<endereço>~<token>`), até seis eventos,
o mais novo primeiro: uma vaga só fazia a inscrição num segundo evento apagar o reconhecimento do
primeiro, e uma vaga por token deixava os links de e-mail de um evento (cada um cunha um token)
empurrarem os outros para fora. Um token novo do mesmo evento substitui o anterior. Pedido sem `?i=`
nem `?e=` (um link antigo, uma aba aberta antes do deploy) cai no evento mais recente do cookie. O
batimento de presença manda o endereço do evento no corpo.

**Console.**
- `/admin/eventos` lista os eventos por situação (próximos, ao vivo, encerrados, arquivados), com
  visitas, inscrições, presentes e compras de cada um, e cria ou duplica eventos. A cópia leva texto e
  configuração, nunca inscrições, data, transmissão ou gravação, e nasce em rascunho.
- `/admin/eventos/<id>` tem cinco abas: **Resultados**, **Inscritas** (a lista do 1:1, só deste evento),
  **Página**, **Configuração** (inclui o pós-evento, arquivar e excluir) e **E-mails**.
- Excluir só existe para rascunho que nunca foi publicado e não tem inscrição (o banco recusa o resto);
  todo o resto se arquiva, sem perder página, inscrições nem resultados.
- A aba **Página** tem também o título da aba e da prévia do link (opcional; em branco, usa o título do
  evento). A **Configuração** escolhe a abertura do `/assinar` que o botão da página usa (o ângulo
  lidera o `utm_content`; a Lei 15.345 usa `china`, como no código antigo).
- `/admin/leads` virou a visão por **pessoa**: uma linha por pessoa com os eventos dela, descadastro,
  exclusão LGPD e a exportação do público de anúncio, agora sem repetir quem se inscreveu em dois
  eventos. Um seletor de evento recorta contadores, tabela e exportação juntos: o arquivo sempre tem o
  que o contador mostrou. A leitura pagina acima do teto de 1.000 linhas da API.

**Resultados por evento (§14), com o que passou a ser medido:**
- **Visitas por canal:** contadas no servidor por evento, dia (Brasília) e canal (`origem` ou
  `utm_source`), só em carregamento de documento (`Sec-Fetch-Dest: document`), nunca para robô, rascunho
  ou superadmin. O `refresh` depois da inscrição e a server action não contam: inflavam cada inscrição em
  duas visitas. Sem IP e sem user agent, só a contagem.
  O canal é normalizado igual nas visitas e nas inscrições (minúsculas, `[a-z0-9_-]`, até 32
  caracteres, "direto" quando vazio), e cada evento guarda no máximo 30 canais por dia; o excedente vira
  "outro". Sem isso, qualquer `?origem=` inventado virava uma linha no banco e um rótulo no console.
- **Aparelho do clique no grupo:** celular ou computador, pela classe do user agent, para ler a taxa de
  clique pelo celular como o §14 pede. É um **contador por evento** (`live_event_device_clicks`),
  somado no primeiro clique de cada inscrição, **nunca gravado na pessoa**: o termo de contato que ela
  aceitou lista o que se guarda sobre ela, e o aparelho não está lá.
- **Compras do evento:** o webhook grava, para a **primeira fatura paga** de uma assinatura, a campanha
  do checkout (`purchase_attributions`) quando ela foi capturada até 14 dias antes. O botão de cada
  evento usa `utm_campaign=<endereço>`, e é isso que o console soma. A compra só conta **enquanto a
  fatura continuar paga**: estorno e chargeback saem dos números sem ninguém apagar nada. Se a gravação
  falhar, o webhook responde erro e o provedor reenvia (a gravação é idempotente pela fatura).
- **Último toque também por cookie:** o middleware guarda a campanha de qualquer link que traga uma
  (`medchina-campanha`, 14 dias, httpOnly), e o checkout usa esse cookie quando o link não traz campanha
  — o botão que cai em `/planos` (sem oferta vendável) e a volta dias depois também creditam o evento.
  Sem campanha no link nem no cookie, o checkout limpa a campanha anterior, para uma compra semanas
  depois não ser creditada a um evento antigo.
- **E-mails:** o assunto nomeia o evento pelo assunto em poucas palavras ("É amanhã: o ao vivo sobre
  a Lei 15.345"); sem assunto, pelo título entre aspas.

### 18.1 Revisão adversarial (2026-09-28)

Uma revisão em quatro frentes (segurança, correção, produto, dados) confirmou 28 problemas na primeira
versão do §18. Tudo acima já descreve o comportamento corrigido; o que mudou de regra:

- **Uma inscrição num segundo evento não desfaz decisão nenhuma.** O formulário não prova que o número
  é de quem digitou. Por isso: não suspende descadastro registrado pela equipe; não devolve o
  consentimento de novidades a quem o revogou (só acrescenta a quem nunca teve); e o e-mail de
  confirmação vai para pessoa nova ou, para quem já existia, só quando o e-mail digitado é o guardado.
- **A janela por rede conta as inscrições DESTE evento**, como o limite que ela lê.
- **Rascunho não se revela:** a inscrição num rascunho responde igual a um evento inexistente.
- **O título da aba e a abertura do `/assinar` da Lei 15.345 voltaram** a ser os do código antigo
  (`page_title` e `offer_angle` no evento), e o cabeçalho "Uma noite" passou a sair do horário
  (manhã, tarde ou noite em Brasília).
- **Console:** erro de leitura aparece como erro, com "Tentar de novo", nunca como "sem dados"; trocar
  de aba não perde o que foi digitado; taxa de inscrição acima de 100% vira "—" (as visitas só
  começaram a ser contadas na `0113`); os próximos eventos aparecem do mais perto para o mais longe;
  os cartões mostram o funil em barras (`MetricBars`); campos e seletores têm nome acessível.

Testes: `packages/db/tests/0043_live_events_crud.test.sql` (50 asserções) e
`apps/web/src/lib/live-event-common.test.ts` + `campaign-params.test.ts`.
