---
documento: "Avaliação e plano de implementação — home assistiva (chat-first) pós-login"
versao: "1.0"
data: "7 de agosto de 2026"
status: "Proposta avaliada — aguarda decisão de escopo"
produto: "MedChina"
tela: "/inicio (app autenticado)"
idioma: "pt-BR"
fonte_de_verdade: "docs/PRODUCT.md (PRD) + CLAUDE.md"
---

# Home assistiva pós-login

## 1. A proposta avaliada

Substituir a home atual (`/inicio`) por uma interface conversacional no estilo das
plataformas de IA atuais, com:

1. chat como elemento central, respondendo sobre a operação da conta logada
   (consultas, agenda, pacientes, conteúdo de MTC);
2. CTAs explícitos para usuários do plano Gratuito;
3. acessos rápidos às funcionalidades essenciais.

## 2. Avaliação comercial

### 2.1 O diagnóstico está correto

A home hoje é indistinguível de um prontuário eletrônico convencional: agenda do
dia, rascunhos abertos, prontuários recentes, dois contadores. **Nada acima da
dobra afirma que este produto tem IA.** Para um produto cujo valor premium
inteiro é a IA, isso é uma falha de posicionamento real, não estética.

Três fatos do próprio produto reforçam o diagnóstico:

- **O plano Gratuito já inclui 20 mensagens/mês de biblioteca** (migração 0042).
  O comentário da migração diz explicitamente que a biblioteca é o *"prove the AI
  hook"*. Ou seja: a aposta comercial já foi feita — mas o gancho está enterrado
  como um item de menu que o usuário pode nunca abrir.
- **O trial Pro só começa na primeira consulta REAL com IA** (PRD §5.7). É um
  primeiro passo de altíssimo compromisso: exige paciente na sala, consentimento
  registrado e gravação. Entre "criou a conta" e "gravou a primeira consulta" não
  existe hoje nenhuma experiência de IA de baixo compromisso.
- A ativação medida (`lib/onboarding.ts`) trata como *aha moment* a primeira
  consulta **finalizada** — um marco que pode levar dias. O intervalo até lá é
  exatamente onde a conta esfria.

### 2.2 A prescrição está parcialmente errada

Substituir a home por um chat resolve o posicionamento e cria três problemas
maiores.

**(a) O trabalho a ser feito no login não é conversar.**
A profissional abre o sistema entre pacientes, frequentemente com alguém
esperando. A primeira pergunta dela é *"quem é o próximo / o que ficou pendente"*
— e a resposta certa para isso é uma lista que se lê num relance, não um prompt
em branco. Claude e ChatGPT são chat-first porque o chat **é** o produto. Aqui o
chat é *uma* funcionalidade; o produto é o prontuário. Trocar uma resposta
escaneável por uma caixa de texto cobra tempo dela em **todo** login, para sempre,
em troca de um ganho de posicionamento que acontece **uma vez**.

**(b) O chat não é a vantagem competitiva — a captura ambiente é.**
Esta é a objeção comercial mais importante. O diferencial defensável do MedChina
é *"você para de digitar durante a consulta"*: áudio → transcrição diarizada →
anamnese preenchida com proveniência. Um chat de MTC é valioso, porém é a parte
mais **fácil de copiar** do produto — qualquer concorrente pluga um RAG numa
base. Uma home chat-first promove a funcionalidade secundária à vitrine e deixa a
cunha real enterrada. O que precisa estar acima da dobra é a **captura**, com o
chat como prova complementar.

**(c) Chat-first transforma a home numa paywall para o Gratuito.**
Com 20 mensagens/mês, uma home que é uma caixa de prompt convida a gastá-las em
perguntas triviais na primeira semana. A partir daí, a primeira tela após o login
passa a ser um limite atingido. O diferencial vira porta trancada — pior do que
um dashboard neutro.

### 2.3 Veredito

**Válida na intenção, a executar em forma diferente.** Não é "chat no lugar da
home", e sim **home assistiva**: a resposta do dia continua escaneável, e ganha
acima dela uma faixa de assistente que (i) nomeia o diferencial, (ii) oferece
ações concretas de um clique e (iii) abre o chat para o que for aberto.

A segunda parte da proposta — *"o chat deveria responder qualquer coisa da
operação na conta logada"* — é valiosa e viável, mas é **projeto próprio**, não um
ajuste de layout: hoje não existe tool-calling no `ChatProvider`
(`packages/ai/src/types.ts` expõe apenas `streamChat` e `generateStructured`).

## 3. Decisão de escopo

| Entra | Não entra (agora) |
| --- | --- |
| Faixa de assistente acima da dobra em `/inicio` | Substituir a home pelo chat |
| Sugestões que executam ações determinísticas | Chat que **escreve** no prontuário |
| Perguntas operacionais respondidas com dados reais | Geração livre sobre fatos clínicos |
| CTA explícito por estado de plano | CTA promocional permanente no chrome |
| Chat aberto (MTC) como hoje, com entrada destacada | Ampliar a cota do Gratuito |

## 4. Arquitetura em três fases

As fases são independentes e cada uma entrega valor sozinha. A Fase 2 só se
justifica se a Fase 1 mostrar uso.

---

### Fase 1 — Faixa assistiva na home (sem IA nova)

**Objetivo comercial:** nomear o diferencial no primeiro segundo e encurtar o
caminho até a primeira experiência de IA, sem custo de inferência.

**Onde:** `apps/web/src/app/(dashboard)/inicio/page.tsx`, imediatamente abaixo do
cabeçalho e **acima** de "Hoje".

**Composição:**

1. **Saudação + proposta de valor** — uma linha que diz o que o produto faz de
   diferente ("Grave a consulta; a anamnese chega pronta para sua revisão"),
   variando por estado de ativação, não por horário do dia.
2. **Trilho de sugestões** (4 no máximo), cada uma um `ProductAction` real:
   - *Preparar próxima consulta* → abre o `ConsultationBriefingDialog` já
     existente (determinístico, sem IA, sem cota — `lib/patient-briefing.ts`);
   - *Gravar consulta agora* → `/consultas/[id]` da próxima agendada, ou criação;
   - *Perguntar à biblioteca* → `/biblioteca` com o prompt pré-preenchido;
   - *Ver o que a IA prepara* → demonstração do fluxo (ver 6.2).
3. **Estado do plano e CTA** — derivado de `org_audio_allowance.reason`
   (nunca inferido de flags):
   - `no_plan` / `trial_not_started` → "Experimente o Pro na próxima consulta —
     14 dias ou 300 min, sem cartão";
   - `trial_*` → dias/minutos restantes (já implementado em `AudioUsageCard`);
   - `past_due_*` → corrigir pagamento, nunca "compre mais";
   - plano ativo → nada comercial.

**Custo:** nenhuma inferência. Tudo determinístico sobre dados já carregados pela
home.

**Riscos:** empurra "Hoje" para baixo. Mitigação: a faixa é compacta (uma linha de
texto + um trilho de botões), e recolhe para uma única linha quando a ativação
está completa.

---

### Fase 2 — Perguntas operacionais (classificar → executar → renderizar)

**Objetivo:** atender a segunda parte da proposta — perguntar sobre agenda,
pacientes e consultas — sem inventar fato clínico e sem queimar cota.

**A decisão de arquitetura que torna isto viável:** não usar um agente que
*gera* a resposta. Usar o padrão que o produto já aplica em `/admin/insights` e
nas hipóteses clínicas — **o modelo escolhe e parametriza; o código executa e
renderiza**:

```
pergunta → [LLM: generateStructured] → intenção + parâmetros validados
         → [código: consulta sob a RLS dela] → dados reais
         → [UI: componente determinístico] → resposta
```

Três consequências diretas:

- **Nenhum fato operacional é gerado.** "Você tem 3 consultas amanhã" vem de um
  `count`, não de um token previsto. Se estiver errado, é bug de query — não
  alucinação. Isto importa: um erro aqui faz a profissional perder um paciente.
- **Usa infraestrutura que já existe.** `generateStructured` já está no
  `ChatProvider` e já é usado pela extração de anamnese. **Não é preciso
  construir loop agêntico nem adotar framework de agentes.**
- **É barato.** Uma chamada estruturada curta por pergunta, com modelo pequeno.
  Viabiliza tratar pergunta operacional como **fora da cota** de biblioteca — o
  que resolve diretamente o problema 2.2(c): a home nunca vira paywall.

**Intenções da primeira entrega** (fechadas, versionadas em código):

| Intenção | Parâmetros | Executa |
| --- | --- | --- |
| `agenda.list` | intervalo | consulta em `consultations` |
| `patient.find` | termo | busca em `patients` |
| `consultation.pending` | — | rascunhos/aguardando revisão |
| `usage.status` | — | `org_audio_allowance` |
| `library.ask` | pergunta | encaminha ao chat atual (**consome cota**) |
| `unknown` | — | oferece as opções, nunca chuta |

**Fronteiras de segurança (não negociáveis):**

- As consultas rodam com o **cliente Supabase da sessão dela** (RLS), nunca com
  service role. A RLS continua sendo a defesa real, como no resto do produto.
- **Somente leitura** nesta fase.
- A fence de impersonação (`is_impersonated()`, migração 0057) permanece válida;
  o roteador não abre caminho novo de escrita.
- **Conteúdo clínico não é persistido na conversa.** Uma resposta operacional que
  cite nomes de pacientes gravaria dado clínico em `messages`. Respostas
  operacionais são renderizadas e **não** persistidas como mensagem; só o par
  (intenção, parâmetros) é auditável.
- Cada uso registra `product_events` — exige estender **as duas** allowlists da
  migração 0048 (nome do evento + propriedades).

---

### Fase 3 — Ações de escrita (somente se a Fase 2 provar uso)

Agendar, criar paciente, iniciar consulta a partir do chat. Entra apenas com:
confirmação explícita antes de qualquer escrita, `recordAudit` em toda mutação, e
as mesmas triggers de imutabilidade (PRD §8.5). **Não planejar em detalhe agora** —
a decisão depende dos dados da Fase 2.

## 5. Métricas de sucesso

Decidir a Fase 2 com base na Fase 1:

| Métrica | Fonte | Leitura |
| --- | --- | --- |
| % de contas que usam ≥1 sugestão na 1ª semana | `product_events` | adoção da faixa |
| Tempo até a 1ª experiência de IA | `product_events` | encurtou? |
| Tempo até a 1ª consulta finalizada (aha) | `lib/onboarding.ts` | não pode piorar |
| Início de trial por origem | `trackCommercialEvent` | a faixa converte? |
| Cliques em "Hoje" após a mudança | novo evento | a faixa atrapalhou o trabalho? |

**Critério de reversão:** se o tempo até a primeira consulta finalizada piorar, a
faixa está no caminho do trabalho real — recolher para uma linha.

## 6. Notas de execução

### 6.1 Reaproveitamento

Já existe e deve ser usado, não reescrito: `ConsultationBriefingDialog`,
`lib/patient-briefing.ts`, `PRODUCT_ACTIONS`, `useAudioAllowance`,
`org_message_allowance`, `EmptyState`, `SectionHeader` da home.

### 6.2 "Ver o que a IA prepara"

A trilha de demonstração roteirizada foi removida do onboarding por descrever o
resultado em prosa em vez de mostrá-lo (ver `app/onboarding/page.tsx`). Se esta
sugestão entrar, precisa **mostrar** — uma consulta de exemplo real, com
proveniência visível — ou não entra.

### 6.3 Contrato de linguagem

Toda copy segue PRD §10 e `docs/DESIGN.md`: a IA **prepara rascunho para
revisão**, nunca diagnostica. Vale igualmente para as sugestões da faixa.

### 6.4 i18n

Toda string nova nos 5 catálogos (`de, en, es, fr, pt-BR`), namespace `product`.
