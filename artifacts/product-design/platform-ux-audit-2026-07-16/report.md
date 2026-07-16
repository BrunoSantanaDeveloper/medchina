# Auditoria transversal de UX — MedChina

Data: 16 de julho de 2026  
Superfície: experiência autenticada da profissional na web, com os handoffs críticos para o app mobile.  
Modo: auditoria combinada de UX e acessibilidade, baseada em capturas atuais e inspeção do código.

## Veredito

O MedChina já tem bons elementos de domínio — pacientes, agenda diária, prontuário imutável, consentimentos separados, proveniência da IA e planos versionados —, mas eles foram implementados como **páginas e componentes independentes**. Falta uma camada que carregue continuamente a intenção da profissional, o paciente ativo, o estado da consulta, os pré-requisitos e o próximo passo.

O problema central não é apenas “falta cadastrar paciente dentro da Agenda”. É um padrão sistêmico:

1. a tela atual detecta um pré-requisito;
2. manda a pessoa para outro módulo ou simplesmente bloqueia;
3. não preserva o que ela já informou;
4. não oferece retorno automático;
5. frequentemente não diferencia erro de ausência real de dados.

Saúde geral: **crítica para teste com usuários leigos e frágil para operação clínica real**.

## Escopo e método

Foram cobertos: login/2FA e retorno de rota, onboarding e reentrada, início, Agenda, pacientes, consentimentos, consultas, gravação/IA, hipóteses, plano/documentos, shell de navegação, busca, atalhos, configurações, billing e handoff web–mobile. Superadmin não faz parte da jornada de uma profissional comum e foi excluído.

As telas foram executadas em Chromium isolado, com backend Supabase local simulado e dados fictícios. Viewports: 1440 × 1000 e 390 × 844; pt-BR, tema claro e movimento reduzido. Nenhum dado remoto foi lido ou alterado.

## Evidência visual — passos auditados

### 1. Retorno após login — frágil

![Início após retorno](01-inicio-retorno-incompleto.png)

O checklist mostra ativação factual, mas não oferece reentrada nas três trilhas iniciais. Busca, atalhos, UI showcase, Docs e configurador visual competem com as tarefas clínicas.

### 2. Agenda vazia — visualmente saudável, semanticamente frágil

![Agenda vazia](02-agenda-vazia.png)

O estado vazio e o CTA são claros. Porém, erro de rede, organização ainda carregando e ausência real de consultas terminam no mesmo resultado visual.

### 3. Agendar sem paciente — crítico

![Modal de agendamento sem paciente](03-agenda-sem-paciente.png)

O botão “Agendar” fica desabilitado, mas não existe “Cadastrar paciente aqui”, explicação do pré-requisito ou preservação do formulário para uma saída temporária.

### 4. Cadastro fora da Agenda — crítico para continuidade

![Cadastro de paciente fora da Agenda](04-cadastro-fora-da-agenda.png)

O formulário é uma página separada. Após salvar, sempre leva à ficha do paciente; “Cancelar” leva à lista. Data, duração e motivo do agendamento anterior são perdidos.

### 5. Agenda com consulta — frágil

![Agenda com consulta](05-agenda-com-consulta.png)

A prioridade de “Iniciar atendimento” funciona bem. “Cancelar” executa imediatamente, sem confirmação, consequência, motivo, desfazer ou tratamento de falha.

### 6. Agendamento com pacientes existentes — frágil

![Agendamento com paciente existente](06-agendamento-com-paciente.png)

O seletor distingue pessoas somente pelo nome, criando risco com homônimos. Não há estado de carregamento/retry e, ao abrir a Agenda em outro dia, o modal ainda usa “agora + 1 hora”, não o dia visualizado.

### 7. Conflito de horário — razoável, com ambiguidade

![Conflito de horário](07-conflito-de-horario.png)

Permitir override deliberado é positivo. Entretanto, o aviso não informa qual consulta conflita e mantém simultaneamente “Agendar mesmo assim” e o CTA principal “Agendar”.

### 8. Lista de pacientes — razoável

![Lista de pacientes](08-lista-de-pacientes.png)

A lista é orientada à pessoa, pesquisável e mostra alerta clínico. Ainda não permite agendar diretamente, completar cadastro mínimo ou distinguir erro de lista vazia.

### 9. Ficha do paciente — crítica na resolução de estado

![Ficha do paciente](09-ficha-do-paciente.png)

A linha do tempo mostra agendada, rascunho e finalizada. Porém, a ficha só reconhece `draft` como consulta ativa; estados `scheduled`, `in_progress` e `awaiting_review` podem resultar em outra consulta criada em paralelo. Não há editar paciente nem “Agendar consulta”.

### 10. Consentimentos — crítico

![Consentimentos](10-consentimentos.png)

Os fins são separados, o que é correto. Mas switches concedem/revogam imediatamente sem exibir o termo, versão, confirmação ou consequência. Quando a pessoa veio da consulta, não existe retorno automático ao ponto de origem.

### 11. Consulta em rascunho — crítico

![Consulta em rascunho](11-consulta-em-rascunho.png)

“Finalizar prontuário” está disponível independentemente de salvamento, gravação ou processamento. Alertas clínicos do paciente não aparecem. O gravador desvia para consentimentos e a contagem de campos ignora a queixa principal.

### 12. Destino “Preparar consulta com IA” — crítico

![Configurações como destino da preparação de IA](12-destino-preparar-ia.png)

A promessa inicial termina em configurações genéricas, em inglês, com Organization, Connections e Billing. Não conduz a consentimento, app mobile, paciente, teste de microfone ou ativação do trial.

### 13. Destino “Ver a IA funcionando” — frágil

![Página pública de demonstração](13-destino-demonstracao-ia.png)

É uma explicação pública visualmente boa, mas não uma demonstração in-product executável. O shell muda para marketing, exibe “Entrar” para quem já está autenticada e não registra progresso nem oferece retorno contextual.

### 14. Assistente do menu — crítico para confiança

![Assistente genérico](14-assistente-generico.png)

O menu clínico abre “AI Chat” genérico em inglês, com “Upgrade” e sugestões de template. Isso parece um produto diferente e pode induzir a profissional a enviar conteúdo clínico no lugar errado.

### 15. Agenda no viewport móvel — frágil

![Agenda móvel](15-agenda-mobile.png)

O reflow básico funciona, mas o configurador visual flutuante cobre conteúdo e não existe uma navegação clínica dedicada para o contexto compacto.

### 16. Agendamento móvel sem paciente — crítico

![Agendamento móvel sem paciente](16-agenda-sem-paciente-mobile.png)

O bloqueio se repete em uma área menor: CTA desabilitado e nenhuma criação rápida. Um sheet full-screen com quick-create seria mais apropriado.

### 17. Consulta no viewport móvel — crítico

![Consulta móvel](17-consulta-mobile.png)

O formulário longo domina a tela, “Finalizar prontuário” aparece antes de orientação e o gravador/estado da consulta ficam abaixo da dobra. O configurador também cobre campos.

### 18. Busca global — crítico para confiança

![Busca global de template](18-busca-global-template.png)

A busca mostra produtos, categorias e usuários fictícios de e-commerce. Ela não pesquisa pacientes, consultas, documentos nem ações clínicas.

### 19. Atalhos — crítico para confiança

![Atalhos de template](19-atalhos-template.png)

Os atalhos oferecem “Add Product”, “Add Category” e “Discounts”. Como parecem funcionais, não são apenas ruído visual: quebram a credibilidade do produto.

## Forças reais

- Ativação gratuita deriva de fatos reais, não de cliques.
- Estados vazios de Início, Agenda e Pacientes possuem explicação e ação.
- O modelo “agendamento e consulta usam a mesma linha” é conceitualmente forte.
- O cuidado manual continua possível sem gravação ou plano pago.
- Consentimentos são separados por finalidade e revogações são auditáveis.
- Prontuário finalizado é imutável; correções usam adendos.
- IA clínica preserva proveniência, lacunas, contradições e limitações.
- MUI fornece boa base de diálogo, autocomplete, skeleton e responsividade.

## P0 — correções críticas

### 1. Separar ativação, exploração e continuidade

Hoje as três opções iniciais gravam apenas `welcome`; o produto não registra qual trilha foi escolhida. `/onboarding` e o login mandam para `/inicio` assim que `welcome` existe, e o checklist desaparece quando concluído ou dispensado.

Evidências: `app/onboarding/page.tsx:40-44,67-85`; `lib/onboarding.ts:113-127`; `components/product/onboarding-checklist.tsx:37-38`; `packages/onboarding/src/index.ts:89-91`.

Criar `/primeiros-passos`, sempre acessível no menu e no perfil, com:

- trilha manual;
- demonstração real da IA;
- preparação da primeira consulta real com IA;
- “continuar de onde parei” e “explorar outro caminho”.

O checklist de ativação continua baseado em fatos. Exploração precisa de estado próprio e nunca deve desaparecer como conteúdo.

### 2. Adotar um contrato de navegação contextual

Toda transição que resolve pré-requisito precisa carregar `origin`, `returnTo`, entidade e rascunho. Cadastro de paciente, consentimento, billing e autenticação OAuth hoje perdem parte ou todo o contexto.

Padrão recomendado: resolver no local primeiro; quando não couber, navegar com retorno validado e restaurar o estado anterior.

### 3. Cadastrar paciente dentro do agendamento

O autocomplete da Agenda deve oferecer:

- busca remota incremental;
- nome + identificador secundário mínimo;
- “Cadastrar ‘Marina’ aqui”;
- formulário rápido no mesmo drawer/sheet: nome obrigatório, telefone opcional;
- “Salvar e usar”, retornando ao agendamento sem perder data, duração e motivo.

Evidências: `components/product/schedule-dialog.tsx:75-103,165-174,224-230`; `pacientes/novo/page.tsx:40-109,118-257`.

### 4. Corrigir Agenda e transições concorrentes

- CTA deve semear o dia atualmente visualizado.
- Limpar paciente anterior sincronamente ao reabrir.
- Diferenciar homônimos.
- Conflito deve retornar horário/paciente conflitante numa operação transacional.
- Cancelar precisa confirmação contextual e desfazer.
- Start/cancel/reschedule devem exigir `status=scheduled` no update.
- Falhas precisam de erro + retry, nunca estado vazio.
- Separar nota administrativa de `chief_complaint`.

Evidências: `agenda/page.tsx:55-119,164-225,253-284`; `schedule-dialog.tsx:75-153`; `migrations/0027_agenda.sql:26-61`.

### 5. Criar uma máquina de estados/capabilities de consulta

Hoje a UI usa basicamente `isFinalized`; portanto consultas `scheduled` e `cancelled` também podem editar anamnese, gravar, gerar IA/plano e finalizar.

Matriz necessária, compartilhada entre UI e APIs:

| Estado | Ações permitidas |
|---|---|
| `scheduled` | iniciar, reagendar, cancelar |
| `draft` / `in_progress` | editar, gravar, salvar |
| `awaiting_review` | revisar, resolver lacunas, finalizar |
| `finalized` | ler, adicionar adendo, emitir documento validado |
| `cancelled` | ler e reagendar; nenhuma ação clínica |

Evidências: `consultas/[id]/page.tsx:169,342-507`; `clinical-pipeline.ts:57-65`; APIs de hypotheses/plan; timeline em `pacientes/[id]/page.tsx:203-219`.

### 6. Resolver uma única consulta ativa por paciente

A ficha deve escolher `in_progress > awaiting_review > draft > próxima scheduled` e apresentar “Continuar”, “Revisar” ou “Iniciar agendada”. Nunca criar uma nova consulta enquanto já existe uma compatível sem confirmação explícita.

Evidência: `pacientes/[id]/page.tsx:82-118,148-155`.

### 7. Manter contexto clínico em toda consulta

Criar `ClinicalContextBar` com identidade confirmada, alertas clínicos, consulta/agendamento e estados de consentimento. Agenda abre a consulta diretamente e hoje os alertas desaparecem.

Evidências: `agenda/page.tsx:93-108`; `consultas/[id]/page.tsx:109-137`; `pacientes/[id]/page.tsx:161-174`.

### 8. Tornar consentimento contextual e explícito

Substituir switches imediatos por `ConsentSheet` com termo real, versão, impacto, aceitar/revogar e retorno automático. O preflight da IA deve verificar separadamente áudio e processamento por IA antes de gravar.

Evidências: `consultation-recorder.tsx:121-140,280-287`; `consentimentos/page.tsx:42-45,77-130,173-193`; `clinical-pipeline.ts:49-55`.

### 9. Coordenar gravação, autosave e finalização

- `allowance=null/error` nunca pode autorizar captura.
- Preservar blob local até upload confirmado e oferecer retry.
- Proteger saída durante gravação/upload.
- Recarregar imediatamente o painel após upload.
- Antes de finalizar: flush de campos, bloqueio de gravação/processamento ativo e resumo de pendências.

Evidências: `use-audio-allowance.ts:32-44`; `consultation-recorder.tsx:103-108,164-207`; `recordings-panel.tsx:58-96`; `consultas/[id]/page.tsx:179-282,347-349`.

### 10. Fechar a cadeia IA → hipótese → plano → documento

Hoje decisões podem falhar silenciosamente; plano pode ser gerado sem hipótese considerada; salvar/validar ignora erros; emissão fica escondida depois da finalização; reemissão revoga a versão anterior sem confirmação.

Criar uma única trilha com dependências explícitas, operações confirmadas, estados reversíveis até finalização e uma área “Documentos” na ficha.

Evidências: `hypotheses-panel.tsx:169-192,329-364`; `plan-panel.tsx:166-202,341-439`; APIs `plan/route.ts` e `plan/issue/route.ts`.

### 11. Remover superfícies falsas e fora do MVP

Feature-gate ou remover de qualquer ambiente de usuário:

- UI showcase e Docs;
- ThemeForest/configurador visual;
- busca e atalhos de e-commerce;
- AI Chat/extensões genéricas;
- Connections e multi-workspace fora do MVP.

Esses itens não são “polimento futuro”: parecem funcionais e comprometem confiança em um produto clínico.

### 12. Corrigir handoff e segurança mobile

- O app mobile precisa respeitar AAL2/TOTP, hoje não verificado.
- Criar universal links/deep links para consentimento, minutos e revisão web.
- Recarregar gates ao voltar ao app.
- Persistir status `no dispositivo → enviando → confirmado → processando → pronto/falhou`.
- Não apagar o único feedback junto com a fila após upload.

Evidências: `apps/mobile/app/(auth)/sign-in.tsx:29-35`; providers/session; `consulta/[id].tsx:61-74,184-205`; `src/lib/recording-queue.ts:183-209`.

### 13. Hardening de billing

Cancelamento/downgrade precisam confirmação e consequências claras; a escolha do provider não pode começar em Stripe quando só Asaas existe; a UI não deve apresentar `plans.trial_days` como se fosse o trial Pro cardless separado.

Evidências: `settings/billing/components/current-subscription.tsx:35-45,123-128`; `plans-grid.tsx:43-69,95-191`; `settings/billing/actions.ts:130-169`.

## P1 — otimizações importantes

- Padronizar toda leitura como `loading | data | empty | error+retry`; atualmente só existem `app/loading.tsx` e `not-found.tsx`, sem error boundaries de produto.
- Dashboard deve mostrar agenda do dia, `scheduled`, `in_progress` e `awaiting_review`, não apenas draft/finalized.
- Extrair cadastro de paciente reutilizável e permitir completar/editar dados depois.
- Criar viewer de transcrição com falantes, timestamps, áudio e origem dos campos.
- Notificar quando processamento terminar; não depender de polling curto ou retorno manual.
- Colocar documentos na linha do tempo do paciente.
- Preservar rascunhos ao sair de plano, consentimento, cadastro ou formulário longo.
- Traduzir Settings, Security, Billing e Assistente para pt-BR; remover mensagens técnicas.
- Corrigir OAuth para preservar rota + query/hash e confirmar convite antes de aceitar.
- Usar o locale selecionado para datas/horas e evitar aritmética fixa de dia em fusos com DST.
- Adicionar testes de integração de Agenda, estado da consulta, consentimentos e gravação; a busca atual não encontrou testes desses fluxos.

## Acessibilidade

Riscos confirmados no código:

- botões somente com ícone sem nome acessível;
- labels sem `htmlFor`/`id` em formulários clínicos;
- switches de consentimento sem nome associado;
- progresso do onboarding sem `role=progressbar`;
- ausência de skip link e `aria-current`;
- salvamento, troca de dia, gravação, sucesso e erro sem regiões live;
- prontuário finalizado usa `disabled` onde `readOnly` permitiria leitura/cópia;
- foco não é coordenado após navegação, erro ou retorno de diálogo.

Ainda são necessários testes reais de teclado, leitor de tela, zoom de 200%, contraste, dark mode e reflow em 320/375/768 px.

## Arquitetura de UX recomendada

1. **Guidance Hub:** `/primeiros-passos`, acessível sempre, com as três trilhas e retomada.
2. **Next Best Action:** Início prioriza consulta do dia → revisão pendente → rascunho → paciente → explorar IA.
3. **Action Registry:** um catálogo real alimenta command palette, empty states, guia e atalhos.
4. **Journey Context:** `origin`, `returnTo`, entidade e draft preservados por todas as transições.
5. **Inline Prerequisite Resolution:** quick-create paciente, consentimento, completar perfil e outras dependências sem abandonar a tarefa.
6. **Shared State Machines:** capabilities de consulta e gravação usadas por UI, APIs e mobile.
7. **Clinical Context Bar:** identidade, alertas, consentimentos e estado visíveis durante o atendimento.
8. **Async State Contract:** erro nunca vira vazio; mutações sempre têm loading, resultado e recuperação.

## Sequência sugerida

1. **P0-A — confiança:** remover fakes/dev, separar erro de vazio e bloquear ações clínicas por estado.
2. **P0-B — orientação:** `/primeiros-passos`, reentrada das três trilhas, next-best-action e `returnTo`.
3. **P0-C — Agenda/Paciente:** quick-create inline, data correta, homônimos, consulta ativa única e cancelamento seguro.
4. **P0-D — clínica:** alertas persistentes, consentimento contextual, gravação recuperável e finalização coordenada.
5. **P0-E — IA/mobile/billing:** fechar dependências, status cross-device, MFA mobile e operações comerciais confirmadas.
6. **P1 — qualidade:** i18n, acessibilidade, responsive/dark, viewer de transcrição, documentos e testes de integração.

## Limites da evidência

- Backend, autenticação e dados foram simulados localmente.
- A auditoria visual usou tema claro; dark mode não foi validado.
- O “mobile” visual é o web responsivo; o app Expo foi auditado por código, não executado em dispositivo.
- Não foram executados leitor de tela, biometria, câmera/microfone real, falhas de rede reais ou provedores de pagamento.
- Segurança foi considerada apenas onde afeta diretamente a jornada; isto não é um pentest.
