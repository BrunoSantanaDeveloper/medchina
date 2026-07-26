# Medchina — PRD completo da nova versão

**Prontuário inteligente e assistente clínico para Medicina Tradicional Chinesa**

> Visão do produto: permitir que a profissional mantenha a atenção no paciente enquanto o Medchina registra, organiza e prepara a consulta para revisão clínica.

| **Campo**        | **Definição**                                                         |
|------------------|-----------------------------------------------------------------------|
| Versão           | 1.0                                                                   |
| Data             | 12 de julho de 2026                                                   |
| Status           | Especificação consolidada para planejamento e desenvolvimento         |
| Plataformas      | Web responsiva + aplicativo mobile complementar para iOS e Android    |
| Modelo comercial | Freemium com planos Gratuito, Assistente e Pro                        |
| Escopo           | Nova versão do Medchina; não é uma simples atualização da base antiga |

*CONFIDENCIAL — USO INTERNO*

# Controle do documento

| **Versão** | **Data**   | **Descrição**                                                                                                              |
|------------|------------|----------------------------------------------------------------------------------------------------------------------------|
| 1.0        | 12/07/2026 | Consolidação do escopo funcional, IA clínica, web, mobile, planos, contratação, onboarding, segurança, métricas e roadmap. |

Este PRD consolida as decisões de produto tomadas até o momento. Valores, volumes de processamento e determinados detalhes jurídicos são hipóteses de lançamento e devem passar por validação comercial, financeira, clínica, regulatória e jurídica antes da publicação definitiva.

# Sumário executivo

O Medchina é uma plataforma clínica para Medicina Tradicional Chinesa e possui recursos manuais de cadastro, anamnese, análise, recomendações, combinações, protocolos, planejamento terapêutico e documentos. A nova versão não deve simplesmente reproduzir esses recursos: deve conectá-los em uma experiência contínua e automatizada por inteligência artificial.

O diferencial principal será um assistente clínico ambiente. Durante uma consulta autorizada, o aplicativo mobile captura o áudio; a plataforma identifica participantes, transcreve a conversa, preenche a anamnese estruturada, registra observações ditadas pela profissional, compara a consulta ao histórico, identifica lacunas e prepara análises e condutas conforme o plano contratado. A profissional permanece responsável por revisar, editar, validar e finalizar o prontuário.

O modelo comercial será freemium. O plano Gratuito mantém os recursos clínicos manuais e cadastros sem limite funcional de pacientes ou prontuários. O plano Assistente automatiza a documentação. O plano Pro automatiza também a preparação do raciocínio terapêutico. Toda nova conta poderá ativar um trial Pro sem cartão, iniciado somente na primeira consulta real com IA.

## Decisões consolidadas

| **Decisão**       | **Regra**                                                                                                                     |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------|
| Produto existente | O projeto é uma nova versão do Medchina, não o MVP inicial da empresa.                                                        |
| Plano gratuito    | Todos os recursos manuais atuais permanecerão disponíveis, com pacientes e prontuários ilimitados.                            |
| Monetização       | O pagamento será pela automação e economia de tempo, não pelo acesso básico ao prontuário.                                    |
| Trial             | Trial Pro de 14 dias ou 300 minutos, iniciado na primeira consulta real com IA, sem cartão e sem cobrança automática.         |
| Mobile            | Aplicativo complementar focado em captação de áudio e comandos rápidos; contratação e cobrança somente na web.                |
| IA no MVP         | A IA preencherá a anamnese, comparará histórico, apontará lacunas e, conforme o plano, preparará análise e plano terapêutico. |
| Controle clínico  | Nenhuma inferência da IA se torna decisão final sem revisão ou validação da profissional.                                     |
| Arquitetura       | Uma profissional por workspace no MVP, com estrutura técnica preparada para múltiplos usuários no futuro.                     |

# 1. Contexto, visão e posicionamento

## 1.1 Problema

Profissionais de Medicina Tradicional Chinesa precisam combinar escuta atenta, observação, raciocínio clínico, registro de dados e elaboração de condutas. O uso constante do computador durante a consulta reduz contato visual, fragmenta a escuta e aumenta o trabalho posterior de documentação. Mesmo quando uma plataforma já oferece análises e protocolos, o valor é limitado se a profissional ainda precisar alimentar manualmente todas as etapas.

## 1.2 Visão

> O Medchina será o sistema operacional clínico da profissional de MTC: acompanha a consulta, organiza o prontuário e prepara o caminho terapêutico sem substituir o julgamento profissional.

## 1.3 Proposta de valor

- **Presença clínica:** reduzir a necessidade de olhar para telas e digitar durante o atendimento.

- **Continuidade:** transformar conversa, anamnese, análise, protocolo, plano e documentos em um fluxo único.

- **Especialização:** respeitar a lógica da MTC, incluindo observação, interrogação, ausculta/olfação e palpação.

- **Explicabilidade:** mostrar fatos, inferências, lacunas, evidências e referências rastreáveis.

- **Controle profissional:** manter a profissional como responsável por decidir, ajustar, validar e assinar.

- **Acesso:** oferecer uma base gratuita plenamente utilizável e monetizar a automação.

## 1.4 Posicionamento recomendado

Medchina é uma plataforma de prontuário eletrônico e gestão clínica para Medicina Tradicional Chinesa que reduz a carga administrativa e apoia o raciocínio clínico por meio de inteligência artificial explicável e supervisionada. A plataforma não realiza tratamento autônomo: transcrições, preenchimentos, hipóteses, recomendações e minutas permanecem sob revisão e responsabilidade da profissional.

## 1.5 Princípios de produto

- A atenção ao paciente vem antes da interação com a interface.

- A IA deve reduzir etapas, não criar uma nova burocracia de cliques.

- Fatos, observações e inferências devem ser visualmente distintos.

- O sistema deve destacar exceções e incertezas, não exigir aprovação campo a campo quando a evidência for clara.

- Informação não mencionada não pode ser inventada nem preenchida como negativa.

- A origem de cada informação extraída deve ser recuperável.

- Recursos de segurança e integridade não serão usados como diferencial premium.

- O plano gratuito deve permitir trabalho clínico real; planos pagos devem economizar tempo.

- Web e mobile representam o mesmo prontuário, não bases separadas.

# 2. Objetivos, não objetivos e critérios de sucesso

## 2.1 Objetivos do MVP da nova versão

- Permitir cadastro gratuito e uso contínuo dos recursos manuais do Medchina.

- Captar consultas pelo aplicativo mobile com segurança e tolerância a falhas.

- Preencher automaticamente a anamnese estruturada a partir do áudio e de comandos de voz.

- Reduzir o tempo de documentação posterior à consulta.

- Conectar a anamnese aos recursos existentes de análise, recomendações, protocolos, plano terapêutico e documentos.

- Diferenciar claramente os planos Gratuito, Assistente e Pro.

- Permitir que uma conta gratuita experimente o Pro sem cartão e sem perda de dados ao término.

- Oferecer rastreabilidade, consentimento, versionamento e auditoria adequados para dados sensíveis.

## 2.2 Não objetivos do MVP

- Prescrição autônoma de medicamentos, fórmulas chinesas ou qualquer conteúdo sem validação profissional.

- Diagnóstico autônomo ou substituição de exame físico, língua, pulso e palpação.

- Análise automática de imagens de língua.

- Leitura automatizada de pulso por hardware.

- Portal completo do paciente.

- Conta clínica multiusuário completa, recepção, unidades e permissões avançadas.

- Contratação, upgrade, pagamento ou compra de minutos no aplicativo mobile.

- Prontuário compartilhado entre profissionais no MVP.

## 2.3 North Star Metric

> Número de consultas finalizadas com prontuário revisado por profissional ativo por mês, segmentado entre fluxo manual e fluxo com IA.

## 2.4 Critérios de sucesso iniciais

| **Dimensão**          | **Indicador alvo inicial**                                                                                 |
|-----------------------|------------------------------------------------------------------------------------------------------------|
| Ativação gratuita     | Usuário cadastra ao menos 1 paciente e finaliza 1 consulta manual.                                         |
| Ativação da IA        | Usuário grava, revisa e finaliza a primeira consulta com IA.                                               |
| Tempo para valor      | Primeira consulta real com IA concluída em até 72 horas após ativação do trial.                            |
| Confiabilidade mobile | Nenhuma gravação confirmada como enviada antes do aceite do servidor; recuperação após interrupções.       |
| Qualidade da IA       | A maioria das edições deve se concentrar em campos destacados como ambíguos, não em correção generalizada. |
| Conversão             | Conversão do trial para Assistente ou Pro monitorada por perfil e uso, sem meta fixa antes do beta.        |
| Retenção              | Uso recorrente semanal da IA por assinantes e continuidade do uso manual por gratuitos ativos.             |

# 3. Públicos, personas e permissões

## 3.1 Persona primária

Profissional autônoma de Medicina Tradicional Chinesa que realiza atendimentos individuais, usa recursos como acupuntura, auriculoterapia, moxabustão, ventosaterapia, dietoterapia e práticas complementares, e precisa registrar prontuários com menor interrupção da conversa.

## 3.2 Personas secundárias pós-MVP

- Profissional com alto volume de atendimentos e necessidade de relatórios e personalizações.

- Clínica com vários profissionais, recepção e protocolos compartilhados.

- Paciente que preenche pré-anamnese, recebe orientações e registra evolução.

## 3.3 Modelo de conta no MVP

- Cada cadastro cria um workspace individual.

- Existe uma profissional responsável por workspace.

- O banco de dados deve possuir entidades de workspace, usuário, papel e vínculo, ainda que apenas um papel clínico esteja exposto no MVP.

- A arquitetura não pode depender de um usuário global único.

- O suporte interno poderá acessar dados somente por procedimento controlado, autorização, justificativa e log de auditoria.

## 3.4 Perfis de acesso

| **Perfil**               | **MVP**  | **Permissões**                                                                                                                            |
|--------------------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------|
| Profissional responsável | Sim      | Acesso clínico integral ao próprio workspace, configurações, assinatura, pacientes, consultas, IA e documentos.                           |
| Suporte interno          | Restrito | Acesso temporário e auditado apenas para suporte; preferência por ferramentas de diagnóstico sem conteúdo clínico. |
| Administrador de clínica | Pós-MVP  | Gestão de profissionais, cobrança, unidades, permissões e relatórios.                                                                     |
| Recepção                 | Pós-MVP  | Agenda e dados administrativos mínimos, sem acesso clínico integral.                                                                      |
| Paciente                 | Pós-MVP  | Pré-anamnese, consentimentos, orientações, documentos e acompanhamento.                                                                   |

# 4. Arquitetura de experiência: web e mobile

## 4.1 Plataforma web

A web será o ambiente principal e completo. Cadastro, contratação, cobrança, configurações, gestão do prontuário, revisão clínica, análises, protocolos, documentos, biblioteca e administração serão executados na web.

## 4.2 Aplicativo mobile complementar

O aplicativo para iOS e Android será uma extensão operacional para usuários já cadastrados. O foco será captação segura de áudio, seleção de paciente, verificação de consentimento, registro rápido por voz, envio e acompanhamento do processamento. Ele não será uma versão completa da web.

## 4.3 Distribuição de responsabilidades

| **Capacidade**                 | **Web**                                      | **Mobile**                                    |
|--------------------------------|----------------------------------------------|-----------------------------------------------|
| Cadastro da conta              | Sim                                          | Não; somente login de conta existente         |
| Planos, contratação e cobrança | Sim                                          | Não                                           |
| Cadastro completo de pacientes | Sim                                          | Somente seleção e dados mínimos de contexto   |
| Agenda                         | Completa ou básica conforme módulo existente | Consultas do dia e abertura rápida            |
| Anamnese manual                | Completa                                     | Não no MVP                                    |
| Gravação de consulta           | Opcional via navegador                       | Função principal                              |
| Comandos de observação por voz | Sim, opcional                                | Sim                                           |
| Revisão da anamnese por IA     | Completa                                     | Status e notificação; revisão completa na web |
| Análise e plano terapêutico    | Completo                                     | Não no MVP                                    |
| Documentos e prescrição        | Completo                                     | Não no MVP                                    |
| Biblioteca clínica             | Completa                                     | Não no MVP                                    |
| Privacidade e suporte          | Completo                                     | Resumo, permissões e canais de ajuda          |

## 4.4 Regra de comércio nas lojas

- O app será gratuito para download e funcionará como complemento da ferramenta web.

- Não haverá preços, checkout, contratação, upgrade, downgrade, pacote adicional ou botão de compra dentro do app.

- Não haverá WebView de checkout nem chamada direta para compra externa.

- O app poderá mostrar o estado do plano e o consumo operacional, sem ação de compra.

- Comunicações comerciais e contratação serão realizadas pela web e por canais externos permitidos.

- A estratégia deverá ser revisada a cada submissão, pois as regras das lojas podem mudar e a aprovação depende da implementação concreta.

# 5. Planos, limites e monetização

## 5.1 Princípio de monetização

> O plano gratuito entrega capacidade clínica manual. Os planos pagos vendem automação, economia de tempo e continuidade do fluxo.

## 5.2 Planos propostos

| **Plano**           | **Preço mensal - hipótese** | **Papel**                                                       |
|---------------------|-----------------------------|-----------------------------------------------------------------|
| Medchina Gratuito   | R\$ 0                       | Aquisição, hábito e uso clínico manual contínuo.                |
| Medchina Assistente | R\$ 199                     | Automação da documentação e preenchimento da consulta.          |
| Medchina Pro        | R\$ 299                     | Automação documental e preparação clínica/terapêutica ampliada. |

Os preços são hipóteses de lançamento. Devem ser validados com custos de IA, impostos, suporte, margem desejada e testes com usuários. Poderá ser oferecida cobrança anual com benefício equivalente a até dois meses, sem comprometer a flexibilidade financeira.

## 5.3 Medchina Gratuito

- Cadastro ilimitado de pacientes.

- Consultas e prontuários ilimitados.

- Anamnese manual completa.

- Análises manuais já existentes.

- Recomendações, combinações e protocolos em fluxo manual.

- Plano terapêutico manual.

- Prescrições e documentos manuais conforme habilitação.

- Biblioteca clínica, agenda, histórico e recursos atuais definidos para a nova versão.

- Um workspace individual e uma profissional responsável.

- Sem gravação, transcrição ou automação recorrente da IA após o trial.

A ausência de limite clínico não implica armazenamento infinito. O plano deve ter política de uso justo, limite de tamanho de anexos, cota de armazenamento não clínico, restrição à vídeos e tratamento de contas abandonadas, sem limitar pacientes e prontuários textuais.

## 5.4 Medchina Assistente

- Todos os recursos do Gratuito.

- Aplicativo mobile complementar.

- Gravação segura e transcrição.

- Separação entre falas da profissional e do paciente.

- Preenchimento automático da anamnese estruturada.

- Registro de língua, pulso, palpação e outras observações por comando de voz.

- Resumo clínico e extração de sintomas, medicamentos, exames, datas e mudanças.

- Comparação com consultas anteriores.

- Identificação de lacunas, ambiguidades e contradições.

- Rastreabilidade entre campo preenchido e trecho do áudio.

- Preparação dos dados para os recursos manuais de análise.

- Até 3.000 minutos de áudio processado por ciclo mensal, equivalentes comercialmente a cerca de 60 consultas de 50 minutos.

## 5.5 Medchina Pro

- Todos os recursos do Assistente.

- Até 6.000 minutos de áudio processado por ciclo mensal, equivalentes comercialmente a cerca de 120 consultas de 50 minutos.

- Hipóteses automáticas de padrões de desarmonia.

- Evidências favoráveis, sinais contraditórios e dados ausentes.

- Comparação longitudinal aprofundada da evolução.

- Sugestões automáticas de pontos e combinações.

- Preparação de protocolos e objetivos terapêuticos.

- Preparação do plano terapêutico para revisão.

- Sugestões de técnicas complementares e orientações domiciliares.

- Minutas de documentos e prescrições permitidas, sem finalização autônoma.

- Modelos e protocolos personalizados ampliados.

- Indicadores de evolução e processamento prioritário.

- Suporte prioritário conforme política operacional.

## 5.6 Diferença essencial entre Assistente e Pro

| **Plano**  | **Automatiza**                                                                                   | **Não automatiza**                                                            |
|------------|--------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| Assistente | Escuta, transcrição, organização, preenchimento, comparação e identificação de lacunas.          | Decisão terapêutica e preparação automatizada completa de protocolos/conduta. |
| Pro        | Documentação e preparação do raciocínio terapêutico, recomendações, protocolos, plano e minutas. | Validação final, exame físico, assinatura e responsabilidade profissional.    |

## 5.7 Trial Pro

- Disponível para novas contas gratuitas elegíveis.

- Duração de 14 dias ou 300 minutos, o que ocorrer primeiro.

- A contagem começa apenas quando a profissional inicia conscientemente a primeira consulta real com IA.

- Exploração da plataforma e demonstração fictícia não consomem o trial.

- Não exige cartão e não gera cobrança automática.

- Ao terminar, a conta retorna ao Gratuito.

- Pacientes, prontuários, anamnese, análise e documentos gerados permanecem acessíveis.

- Novas gravações e novos processamentos ficam indisponíveis até contratação.

- A contratação ocorre exclusivamente na web.

## 5.8 Consumo e excedentes

- O sistema exibirá consumo de minutos na web; o app poderá mostrar somente saldo/status operacional.

- Alertas de consumo em 80%, 95% e 100%.

- Uma gravação em andamento não deve ser interrompida silenciosamente ao atingir o limite. O tratamento financeiro ocorrerá após preservação do áudio.

- Pacotes adicionais poderão ser oferecidos na web em volumes como 600, 1.500 e 3.000 minutos, após validação de custo.

  **Implementado** (migração `0055_audio_minute_packs.sql`): compra única na web, disponível apenas para quem já assina um plano com minutos — o preço por minuto é maior que o do plano, de modo que o avulso é conveniência para quem estourou o ciclo e nunca um substituto mais barato da assinatura. Os minutos comprados formam um segundo poço, consumido só depois dos minutos do ciclo, sem validade, e sobrevivem a `past_due`, a um cancelamento e a um downgrade — não sobrevivem à suspensão administrativa.

- Recarga automática será opcional e exigirá consentimento explícito na web.

- Nenhuma cobrança excedente será realizada sem autorização prévia.

  Continua literalmente verdadeiro com os pacotes: nada é cobrado como excedente. Estourar o limite interrompe apenas trabalho NOVO de IA e convida a uma compra que a profissional faz ativamente.

- **Falha de pagamento não é cancelamento** (migração `0054_billing_grace_period.sql`): uma cobrança recusada mantém o plano utilizável por uma janela configurável (`platform_settings`, chave `dunning`, padrão 7 dias) contada a partir do momento da falha. Encerrada a janela, o comportamento anterior volta: cessa o trabalho novo de IA e o prontuário segue acessível. A causa do bloqueio é nomeada pela allowance (`reason`), de modo que uma falha de cartão nunca é apresentada como limite esgotado — as ações que resolvem cada caso são diferentes.

# 6. Jornada de aquisição, cadastro e contratação

## 6.1 Página de apresentação

A comunicação deve começar pelo resultado, não pela lista de recursos. Mensagem recomendada: “Atenda olhando para o paciente. O Medchina organiza o restante.” A página demonstrará a sequência consulta gravada, anamnese preenchida, lacunas identificadas, análise preparada e plano pronto para revisão.

## 6.2 Entrada gratuita

Chamada principal: “Comece gratuitamente. Cadastre pacientes e use todos os recursos clínicos manuais sem limite.” Chamada secundária: “Quando estiver pronta, experimente o Medchina Pro e transforme a consulta em anamnese, análise e plano terapêutico.”

## 6.3 Cadastro web

- Nome completo.

- E-mail verificado.

- Telefone verificado quando necessário para segurança e prevenção de abuso.

- Senha ou método de autenticação aprovado.

- Área de atuação.

- Aceite dos Termos de Uso e ciência da Política de Privacidade.

Dados como registro profissional, assinatura, configurações clínicas e termos de paciente serão coletados progressivamente, antes da primeira ação que dependa deles.

## 6.4 Escolha de início

| **Opção**                     | **Destino**                                                     |
|-------------------------------|-----------------------------------------------------------------|
| Conhecer manualmente          | Cadastrar primeiro paciente e realizar consulta manual.         |
| Ver demonstração da IA        | Executar uma consulta fictícia sem iniciar o trial.             |
| Realizar consulta real com IA | Configurar consentimentos, instalar o app e ativar o trial Pro. |

## 6.5 Checkout web

- Exibir plano, minutos, ciclo, preço, impostos quando aplicável e data da próxima cobrança.

- Explicar excedentes, cancelamento, downgrade, retenção de dados e tratamento do áudio.

- Permitir mensal e anual, conforme disponibilidade comercial.

- Aceite dos termos comerciais e das condições de processamento por IA.

- Cartão para recorrência; Pix poderá ser oferecido para anual conforme gateway e estratégia.

- Página de sucesso com confirmação, checklist e QR Codes para as lojas.

## 6.6 Upgrade, downgrade e cancelamento

- Upgrade é ativado após confirmação da cobrança ou regra comercial definida.

- Downgrade nunca remove prontuários ou documentos anteriores.

- Ao sair de um plano de IA, novos processamentos ficam indisponíveis e o fluxo manual permanece.

- Cancelamento interrompe renovação e informa a data final de acesso pago.

- A plataforma deve oferecer exportação dos dados e instruções claras sobre retenção.

- A inadimplência deve gerar avisos e período de regularização antes de suspender novos processamentos.

- Acesso de leitura e exportação não deve desaparecer abruptamente por uma falha de pagamento.

# 7. Onboarding e ativação

## 7.1 Objetivos de ativação

| **Tipo** | **Evento de ativação**                                                |
|----------|-----------------------------------------------------------------------|
| Gratuito | Primeiro paciente cadastrado e primeira consulta manual finalizada.   |
| IA       | Primeira consulta gravada, anamnese revisada e prontuário finalizado. |

## 7.2 Onboarding progressivo

- Não apresentar um formulário extenso de configuração imediatamente após o cadastro.

- Solicitar cada dado quando sua finalidade estiver clara.

- Usar checklist persistente no dashboard até a ativação.

- Oferecer demonstração fictícia antes de exigir uso com paciente real.

- Ensinar no contexto, com orientações curtas, em vez de depender de um vídeo longo.

## 7.3 Checklist recomendado

- Completar perfil profissional.

- Ativar autenticação em dois fatores.

- Configurar assinatura e identificação documental.

- Configurar consentimentos e política de áudio.

- Personalizar blocos da anamnese.

- Cadastrar primeiro paciente.

- Finalizar primeira consulta manual.

- Assistir à demonstração da IA.

- Instalar o aplicativo mobile.

- Testar microfone e sincronização.

- Processar primeira consulta com IA.

- Finalizar primeiro prontuário gerado com IA.

## 7.4 Demonstração sem consumo

A demonstração deverá usar paciente e diálogo fictícios e mostrar transcrição, preenchimento, rastreabilidade, lacunas, hipóteses, recomendações e plano. Ela não inicia nem consome o trial.

## 7.5 Primeira consulta real com IA

- Confirmar perfil e permissões necessárias.

- Configurar retenção do áudio.

- Configurar ou selecionar modelo de consentimento.

- Instalar e autenticar no app.

- Executar teste de microfone e espaço local.

- Selecionar paciente e confirmar consentimento.

- Iniciar gravação; nesse momento o trial começa.

- Encerrar, enviar, processar, revisar exceções e finalizar prontuário.

## 7.6 Educação durante o trial

| **Momento**       | **Conteúdo**                                                          |
|-------------------|-----------------------------------------------------------------------|
| Primeira consulta | Gravação, preenchimento da anamnese e revisão.                        |
| Segunda consulta  | Comparação histórica, comandos de voz, origem dos campos e lacunas.   |
| Terceira consulta | Diferenciais Pro: padrões, protocolos, plano e documentos preparados. |
| Meio do trial     | Consultas, minutos, tempo de revisão e funcionalidades utilizadas.    |
| Fim do trial      | Recomendação entre Assistente e Pro baseada no uso real.              |

## 7.7 Conversão recorrente do gratuito

- Mostrar benefícios no contexto de tarefas manuais, sem modal repetitivo.

- Após anamnese manual, explicar que o Assistente pode preparar os campos automaticamente.

- Após análise ou protocolo manual, explicar que o Pro pode preparar o raciocínio e a conduta.

- Exibir convite persistente discreto no dashboard.

- Aumentar a intensidade somente após uso recorrente.

- Calcular estimativas de tempo economizado com dados reais do produto, não valores inventados.

# 8. Jornada clínica principal

## 8.1 Antes da consulta

- Exibir agenda e pacientes previstos.

- Apresentar resumo da última consulta, padrões registrados, técnicas aplicadas, resposta e pendências.

- Destacar alertas clínicos, alergias, medicamentos e contraindicações.

- Permitir pré-anamnese e envio de exames em fase posterior ou quando o recurso já existir.

## 8.2 Durante a consulta

A experiência mobile entra em Modo Consulta e prioriza nome do paciente, indicador de gravação, tempo, alertas essenciais, pausa, observação por voz e finalização. A IA trabalha sem exigir acompanhamento constante da transcrição.

## 8.3 Depois da consulta

- Anamnese estruturada preenchida.

- Resumo clínico.

- Mudanças desde a consulta anterior.

- Dados ambíguos, contraditórios ou ausentes.

- Hipóteses e análises conforme plano.

- Plano terapêutico e minutas conforme plano.

- Revisão concentrada em exceções.

- Finalização e assinatura do registro.

## 8.4 Estados da consulta

| **Estado**         | **Descrição**                                         |
|--------------------|-------------------------------------------------------|
| Agendada           | Consulta criada e ainda não iniciada.                 |
| Em atendimento     | Sessão ativa, com ou sem gravação.                    |
| Aguardando envio   | Áudio encerrado e mantido localmente.                 |
| Enviando           | Transferência em andamento.                           |
| Processando IA     | Transcrição e estruturação em execução.               |
| Aguardando revisão | Rascunho disponível para a profissional.              |
| Rascunho manual    | Consulta sem IA ainda não finalizada.                 |
| Finalizada         | Registro revisado e fechado.                          |
| Adendo necessário  | Correção posterior sem sobrescrever registro final.   |
| Cancelada          | Consulta cancelada, preservando auditoria necessária. |
| Falha              | Falha de envio ou processamento que exige ação.       |

## 8.5 Finalização e imutabilidade

- Conteúdo de IA permanece rascunho até revisão e finalização.

- Depois de finalizado, o registro original não pode ser sobrescrito silenciosamente.

- Correções posteriores serão adendos com autor, data, motivo e vínculo à versão anterior.

- O sistema guardará versão do modelo, prompt, biblioteca e processamento associados à análise.

# 9. Requisitos funcionais da plataforma web

## 9.1 Autenticação e conta

- Cadastro público self-service na web.

- Verificação de e-mail.

- Senha forte, recuperação segura e 2FA.

- Gestão de sessões e encerramento remoto.

- Perfil profissional, área, registro, habilitações e assinatura.

- Workspace individual e preferências clínicas.

- Página de plano e cobrança.

- Exportação e solicitação de encerramento da conta.

## 9.2 Dashboard

- Agenda do dia e próximas consultas.

- Pacientes recentes.

- Consultas aguardando revisão.

- Falhas de envio ou processamento.

- Alertas e retornos pendentes.

- Checklist de onboarding enquanto não concluído.

- Consumo de minutos para planos pagos e trial.

- Convites contextuais para trial ou upgrade, com frequência controlada.

## 9.3 Agenda

- Criar, editar, cancelar e reagendar consultas.

- Duração e status.

- Vincular paciente.

- Abrir Modo Consulta a partir do evento.

- Evitar conflito simples de horário.

- Lembretes e confirmação são opcionais conforme recursos existentes; integrações avançadas ficam para evolução.

## 9.4 Pacientes

- Nome, data de nascimento, contatos e dados administrativos mínimos.

- CPF, endereço e contato de emergência opcionais e coletados quando necessários.

- Histórico de saúde, diagnósticos existentes, alergias, medicamentos e exames.

- Alertas clínicos configuráveis.

- Consentimentos separados e versionados.

- Linha do tempo de consultas, tratamentos, documentos e evolução.

- Anexos com limites e política de armazenamento.

- Busca por nome, telefone, documento e conteúdo permitido do prontuário.

- Detecção ou aviso de possível cadastro duplicado.

## 9.5 Consentimentos

- Ciência sobre tratamento de dados do prontuário.

- Autorização opcional para gravação de áudio.

- Autorização opcional para transcrição e processamento por IA.

- Autorização de imagens clínicas, quando utilizada.

- Autorização para comunicação e compartilhamento específico, quando aplicável.

- Versão, data, hora, forma de aceite e eventual revogação.

- Confirmação de gravação por consulta ou política claramente definida.

- Recusa de gravação não pode impedir atendimento manual.

## 9.6 Anamnese integrativa

A anamnese será estruturada em blocos expansíveis e configuráveis. Deve permitir preenchimento manual, extração automática e registro por voz.

- Queixa principal e história atual: início, intensidade, localização, qualidade, fatores de melhora/piora, tratamentos, exames e diagnósticos existentes.

- Rotina e estilo de vida: sono, energia, alimentação, digestão, evacuação, urina, trabalho, atividade física, hidratação e substâncias.

- Aspectos emocionais e contexto: preocupação, medo, raiva, tristeza, frustração, sobrecarga, relações, trabalho, perdas e eventos.

- Avaliação MTC: Yin/Yang, Qi, Sangue, Líquidos, Zang-Fu, Cinco Elementos, fatores patogênicos, constituição, língua, pulso e palpação.

- Campos personalizados e modelos por profissional.

- Marcação de não informado, não aplicável, negado pelo paciente e observado pela profissional.

## 9.7 Linha do tempo e evolução

- Evolução de queixa, sintomas e escalas ao longo do tempo.

- Técnicas, pontos, materiais e orientações aplicadas.

- Resposta relatada e possíveis eventos adversos.

- Mudanças em sono, dor, energia, digestão e outros domínios.

- Documentos emitidos e próxima reavaliação.

- Filtros por período, problema, técnica e documento.

## 9.8 Documentos

- Plano terapêutico da sessão.

- Orientações para casa.

- Documentos e prescrições profissionais permitidos pela habilitação.

- Identificação do paciente e profissional, data, versão e assinatura.

- QR Code de validação sem exposição pública de conteúdo clínico.

- Página pública mínima com status, código, emissor, data e eventual revogação.

- Diferenciar imagem de assinatura, assinatura eletrônica e assinatura digital certificada.

- A IA prepara minutas; a profissional revisa e assina.

## 9.9 Biblioteca clínica

- Biblioteca privada organizada por tema, autor, edição e página.

- Fontes tradicionais, protocolos internos e evidências científicas classificados separadamente.

- Responsável editorial, data de inclusão, status e histórico de revisão.

- Referência junto à sugestão específica.

- Não reproduzir capítulos completos ou trechos extensos protegidos.

- Tratamento de divergências entre autores.

- Direitos de uso e licenciamento avaliados antes da ingestão.

## 9.10 Busca, exportação e suporte

- Busca global com controle de acesso.

- Exportação por paciente em formato legível e, quando possível, estruturado.

- Exportação da conta mediante solicitação.

- Central de ajuda, contato de suporte e registro de chamados.

- Ferramentas internas devem evitar exposição de conteúdo clínico desnecessário.

# 10. Inteligência artificial clínica

## 10.1 Papel da IA

> A IA é uma assistente de documentação e raciocínio clínico. Ela pode extrair, organizar, comparar, apontar lacunas e preparar possibilidades; não substitui observação, exame, decisão, encaminhamento ou responsabilidade profissional.

## 10.2 Pipeline

| **Etapa**      | **Resultado**                                                                    |
|----------------|----------------------------------------------------------------------------------|
| Captura        | Áudio associado a workspace, profissional, paciente, consulta e consentimento.   |
| Transcrição    | Texto com falantes, horários e marcação de trechos.                              |
| Extração       | Sintomas, medicamentos, exames, datas, hábitos, emoções, evolução e observações. |
| Estruturação   | Preenchimento dos campos da anamnese como rascunho.                              |
| Comparação     | Mudanças, persistências e possíveis contradições com o histórico.                |
| Lacunas        | Perguntas e campos relevantes ainda não investigados.                            |
| Raciocínio Pro | Hipóteses, evidências, contradições, referências e caminhos terapêuticos.        |
| Preparação     | Plano, protocolos, orientações e documentos para revisão.                        |
| Validação      | Edição, aprovação e finalização pela profissional.                               |

## 10.3 Categorias de informação

| **Categoria**           | **Exemplo**                            | **Tratamento**                                                     |
|-------------------------|----------------------------------------|--------------------------------------------------------------------|
| Relato do paciente      | “Acordo três vezes à noite.”           | Pode preencher automaticamente, preservando origem.                |
| Observação profissional | “Língua pálida com marcas dentárias.”  | Registrada por voz ou interface; não inferida da fala do paciente. |
| Inferência da IA        | Possível Deficiência de Qi do Baço.    | Exibida separadamente e nunca tratada como fato.                   |
| Decisão profissional    | Padrão validado e pontos selecionados. | Registrada como conduta final, com autoria e data.                 |

## 10.4 Transcrição

- Diarização entre profissional e paciente.

- Marcação temporal.

- Pontuação e segmentação.

- Destaque de sintomas, medicamentos, exames, datas e mudanças.

- Mecanismo para ouvir o trecho original.

- Indicação clara quando a identificação do falante for incerta.

- Não alterar semanticamente a fala para “corrigir” conteúdo clínico.

## 10.5 Preenchimento automático da anamnese

- Mapear cada fato ao campo adequado.

- Manter o campo vazio quando a informação não existir.

- Não converter ausência de menção em negação.

- Suportar múltiplos fatos por campo e histórico temporal.

- Marcar conflitos, como datas diferentes ou medicamentos divergentes.

- Preservar unidade, intensidade, frequência e temporalidade.

- Permitir aprovar uma seção inteira e revisar apenas exceções.

## 10.6 Estados de revisão por campo

| **Estado**                     | **Uso**                                                                    |
|--------------------------------|----------------------------------------------------------------------------|
| Preenchido com evidência clara | Informação diretamente apoiada por trecho identificável.                   |
| Requer atenção                 | Ambiguidade, baixa qualidade do áudio, conflito ou alto impacto clínico.   |
| Não informado                  | Sem evidência no atendimento.                                              |
| Editado pela profissional      | Conteúdo corrigido ou complementado.                                       |
| Rejeitado                      | Sugestão removida, mantendo log de feedback sem poluir o prontuário final. |

## 10.7 Lacunas e perguntas sugeridas

O sistema deve identificar informações ausentes relevantes para o raciocínio em curso. Sugestões durante a consulta serão discretas e priorizadas. Alertas contínuos ou excesso de notificações devem ser evitados para não substituir a distração da digitação por distração da IA.

## 10.8 Hipóteses de padrões - Pro

- Usar o rótulo “Hipóteses de padrões de desarmonia - exigem validação clínica”.

- Exibir padrão, sinais favoráveis, sinais contraditórios, dados ausentes e referências.

- Evitar “confiança alta” como precisão clínica. Preferir “correspondência fraca, moderada ou forte com os dados registrados”.

- Permitir comparar hipótese atual com padrões anteriores.

- Não concluir hipótese quando os dados essenciais estiverem ausentes sem destacar a limitação.

##  10.9 Plano terapêutico - Pro

### Acupuntura

- Objetivo terapêutico.

- Pontos principais e complementares.

- Meridianos.

- Estratégia de tonificação, dispersão, harmonização, aquecimento ou regulação.

- Frequência sugerida, sempre editável.

### Dietoterapia chinesa

- Natureza térmica predominante observada.

- Alimentos a favorecer ou reduzir temporariamente.

- Sugestões simples de refeições.

- Restrições clínicas, nutricionais, alergias e preferências.

### Moxabustão

- Técnica, região ou pontos.

- Objetivo terapêutico.

- Checklist de contraindicações antes da aplicação.

### Auriculoterapia

- Pontos, material, lado, orientações de estímulo e reavaliação.

### Ventosaterapia

- Técnica, região, intensidade, duração, registro fotográfico opcional e orientações pós-sessão.

## 10.10 Regras de segurança clínica da IA

- Não prescrever ou finalizar documento sem ação profissional.

- Não ocultar contraindicações conhecidas.

- Não afirmar diagnóstico convencional ou emergência sem base e sem direcionamento apropriado.

- Destacar medicamentos, gestação, anticoagulantes, marcapasso, cirurgias, lesões e alergias relevantes.

- Permitir que a profissional rejeite, edite e reporte uma sugestão.

- Registrar versão do modelo, prompt e fontes utilizadas.

- Manter conjunto de casos de teste e avaliação clínica antes de liberar mudanças de modelo.

## 10.11 Mensagem obrigatória

> “Esta sugestão é um apoio ao raciocínio clínico e não substitui avaliação profissional, exame físico, observação da língua, palpação do pulso, análise de contraindicações ou encaminhamento quando necessário.”

# 11. PRD funcional do aplicativo mobile

## 11.1 Objetivo

Permitir que a profissional conduza a maior parte da consulta sem olhar para o computador, capturando áudio e observações com segurança e sincronizando a sessão com o mesmo prontuário da web.

## 11.2 Escopo do MVP mobile

- Offline first.

- Login de conta existente.

- Biometria para reabertura, quando disponível.

- Consultas do dia e busca de paciente.

- Abertura ou criação simplificada de consulta vinculada.

- Verificação de consentimento.

- Iniciar, pausar, retomar e encerrar gravação.

- Indicador visual persistente de gravação.

- Observações por voz.

- Fila de envio e status de processamento.

- Recuperação de gravações interrompidas.

- Notificação de anamnese pronta para revisão na web.

- Configurações mínimas de microfone, privacidade e suporte.

## 12.3 Telas

| **Tela**      | **Elementos**                                                                    |
|---------------|----------------------------------------------------------------------------------|
| Login         | E-mail, senha/método, 2FA, recuperação e biometria após primeiro acesso.         |
| Início        | Consultas de hoje, busca, gravações pendentes, falhas e status de sincronização. |
| Paciente      | Nome, alertas essenciais, próxima/última consulta e botão de iniciar.            |
| Consentimento | Status, versão e confirmação antes da gravação.                                  |
| Modo Consulta | Paciente, cronômetro, gravação, pausa, observação por voz e finalizar.           |
| Envio         | Progresso, somente no dispositivo, enviando, confirmado e falha.                 |
| Processamento | Recebido, processando e pronto para revisão.                                     |
| Configurações | Biometria, permissões, privacidade, suporte, versão e sair.                      |

## 12.4 Estados da gravação

| **Estado**          | **Regra**                                                      |
|---------------------|----------------------------------------------------------------|
| Preparada           | Paciente e consulta selecionados; gravação ainda não iniciada. |
| Gravando            | Microfone ativo e indicação permanente.                        |
| Pausada             | Áudio não captado; motivo opcional.                            |
| Encerrada           | Arquivo fechado localmente.                                    |
| Aguardando envio    | Sem conexão ou aguardando fila.                                |
| Enviando            | Transferência ativa e retomável.                               |
| Envio interrompido  | Retentativa automática ou ação do usuário.                     |
| Enviada             | Servidor confirmou integridade e recebimento.                  |
| Processando         | Backend executa pipeline.                                      |
| Pronta para revisão | Resultado disponível na web.                                   |
| Falha               | Ação necessária sem apagar arquivo recuperável.                |
| Cancelada           | Cancelamento explícito e auditado.                             |

## 12.5 Funcionamento offline

- A gravação deve continuar sem internet.

- O áudio local deve ser criptografado.

- O app deve mostrar quando o conteúdo existe apenas no dispositivo.

- O upload será retomável e executado quando houver conexão, respeitando restrições do sistema operacional.

- O arquivo local só será excluído após confirmação de recebimento e integridade pelo servidor.

- A política de retenção local deve lidar com falta de espaço e alertar antes de novas gravações.

## 12.6 Interrupções

- Chamadas telefônicas e uso concorrente do microfone.

- Troca de aplicativo e bloqueio da tela.

- Perda de conexão.

- Bateria baixa.

- Encerramento inesperado.

- Falta de espaço.

- Permissão de microfone revogada.

- Reinicialização ou desligamento.

Em toda interrupção, o app deverá preservar o conteúdo já captado, registrar o evento e informar claramente se houve lacuna na gravação.

## 12.7 Comandos de voz

- Registrar língua, pulso, palpação e sinais observados.

- Criar marcador para revisão posterior.

- Registrar técnica aplicada e resposta imediata.

- Pausar ou retomar somente quando tecnicamente seguro e com confirmação sonora/visual.

- Comandos não devem ser confundidos com fala do paciente; usar gesto dedicado ou frase de ativação configurada.

## 12.8 Regras de privacidade mobile

- Solicitar microfone somente quando necessário.

- Exibir indicação clara durante a gravação.

- Não mostrar conteúdo clínico sensível em notificações.

- Bloquear após inatividade.

- Evitar conteúdo clínico em logs de diagnóstico.

- Registrar início, pausa, retomada, encerramento, envio e exclusão.

- Informar uso de fornecedores de IA e obter permissões aplicáveis.

- Não armazenar dados de saúde em serviços pessoais de backup não aprovados.

## 12.9 Fora de escopo mobile

- Cadastro de nova conta.

- Contratação, pagamento e gestão de plano.

- Edição completa da anamnese.

- Revisão aprofundada da análise.

- Criação completa de protocolos.

- Prescrições e emissão de documentos.

- Biblioteca e relatórios.

- Administração de clínica.

# 13. Modelo conceitual de dados

| **Entidade**       | **Principais atributos/relações**                                            |
|--------------------|------------------------------------------------------------------------------|
| Workspace          | Plano, status, preferências, retenção, limites e configurações.              |
| Usuário            | Identidade, autenticação, papel, habilitações, assinatura e sessões.         |
| Paciente           | Dados mínimos, contatos, alertas, consentimentos e vínculo ao workspace.     |
| Consulta           | Paciente, profissional, agenda, status, versões e finalização.               |
| Gravação           | Dispositivo, consentimento, duração, checksum, estados, retenção e exclusão. |
| Transcrição        | Segmentos, falantes, horários, qualidade e origem.                           |
| Anamnese           | Modelo, campos, valores, origem, estado de revisão e versão.                 |
| Observação clínica | Tipo, autoria, método de entrada e data.                                     |
| Hipótese           | Padrão, evidências, contradições, lacunas, fontes e validação.               |
| Plano terapêutico  | Objetivos, pontos, técnicas, frequência, validação e execução.               |
| Documento          | Tipo, versão, assinatura, QR, status e revogação.                            |
| Fonte clínica      | Obra, edição, autor, tema, página, licença, status editorial.                |
| Consentimento      | Tipo, versão, aceite, revogação, consulta e evidência.                       |
| Auditoria          | Ator, ação, alvo, data, origem e justificativa.                              |
| Assinatura/Plano   | Produto, ciclo, minutos, consumo, pagamento e eventos.                       |

## 13.1 Origem de dados por campo

- Cada campo preenchido pela IA guarda referência ao segmento da transcrição.

- Campos editados guardam valor original, valor final e autor da mudança.

- Dados manuais e dados extraídos não são indistinguíveis no rascunho.

- O prontuário final pode apresentar conteúdo consolidado, mantendo a proveniência nos bastidores.

# 14. Segurança, privacidade e governança

## 14.1 Premissas

Dados clínicos são altamente sensíveis. O produto deve ser desenvolvido com privacidade desde a concepção, minimização, controle de acesso, rastreabilidade e retenção definida. Este PRD não substitui parecer jurídico ou regulatório.

## 14.2 Controles obrigatórios

- Criptografia em trânsito e em repouso.

- 2FA e gestão segura de sessões.

- Segregação lógica por workspace.

- Controle de acesso com menor privilégio.

- Logs de acesso, criação, alteração, exportação e suporte.

- Backups automáticos e testes periódicos de restauração.

- Versionamento do prontuário e adendos.

- Proteção de segredos, chaves e credenciais.

- Monitoramento de disponibilidade, falhas e acesso suspeito.

- Política de retenção para áudio, transcrições, anexos e logs.

## 14.3 Tratamento de áudio

- Consentimento separado para gravação e IA.

- Possibilidade de pausar e encerrar.

- Retenção configurável conforme opções legalmente validadas.

- Opção de apagar o áudio após transcrição validada, preservando apenas registros necessários.

- Exclusão local após confirmação do servidor.

- Nenhum áudio ou conteúdo clínico usado para treinar modelos públicos.

- Contratos com fornecedores devem prever retenção, treinamento, segurança, subprocessadores e incidentes.

## 14.4 Minimização

- CPF, endereço e contato de emergência não serão obrigatórios em todos os casos.

- Enviar a fornecedores somente dados necessários para o processamento.

- Pseudonimizar identificadores sempre que tecnicamente possível.

- Não incluir conteúdo clínico em analytics de marketing, notificações ou logs comuns.

## 14.5 Direitos e ciclo de vida

- Canal para solicitações de acesso, correção, exportação e eliminação quando aplicável.

- Regras claras sobre obrigações de guarda e limites de exclusão de prontuário.

- Encerramento da conta com informação sobre retenção e exportação.

- Portabilidade em formato legível e progressivamente estruturado.

## 14.6 Incidentes

- Plano de resposta com classificação de severidade.

- Responsáveis, contatos e cadeia de decisão.

- Preservação de evidências e registro de ações.

- Comunicação entre operadores e controlador sem demora injustificada.

- Procedimento para avaliar risco ou dano relevante e cumprir prazos legais aplicáveis.

- Simulações e revisão periódica.

## 14.7 Fornecedores e IA

- Inventário de fornecedores e subprocessadores.

- Região de processamento e transferência internacional documentadas.

- Proibição contratual de uso para treinamento não autorizado.

- Prazos de exclusão e suporte a incidentes.

- Avaliação de segurança antes da contratação.

- Plano de substituição de fornecedor e portabilidade técnica.

## 14.8 Avaliação regulatória

Como o Pro prepara hipóteses, pontos, protocolos e condutas, deverá ser realizada análise específica sobre o enquadramento regulatório do software e sobre as regras profissionais aplicáveis. Avisos de responsabilidade são necessários, mas não substituem a avaliação da finalidade e do comportamento real do produto.

# 15. Requisitos não funcionais

| **Categoria**    | **Requisito**                                                                                                           |
|------------------|-------------------------------------------------------------------------------------------------------------------------|
| Disponibilidade  | Serviços críticos de prontuário e envio devem ter monitoramento e meta de disponibilidade definida antes do lançamento. |
| Desempenho       | Telas clínicas comuns devem responder rapidamente; operações pesadas devem ser assíncronas e mostrar estado.            |
| Processamento    | A plataforma deve informar estimativa ou progresso sem prometer resultado instantâneo.                                  |
| Resiliência      | Upload retomável, idempotência, prevenção de duplicidade e recuperação de falhas.                                       |
| Escalabilidade   | Separar captura, transcrição, estruturação e raciocínio em etapas observáveis.                                          |
| Acessibilidade   | Contraste, navegação por teclado, rótulos, tamanho de toque e suporte a leitores de tela.                               |
| Compatibilidade  | Web moderna responsiva; versões mínimas de iOS/Android definidas com a equipe técnica.                                  |
| Observabilidade  | Métricas, traces e logs sem conteúdo clínico desnecessário.                                                             |
| Manutenibilidade | Regras de plano e limites configuráveis sem nova publicação do app.                                                     |
| Localização      | Português do Brasil no MVP; estrutura preparada para outros idiomas.                                                    |

## 15.1 Metas técnicas a definir antes do beta

- Tempo máximo aceitável para abrir Modo Consulta.

- Tempo de confirmação do upload.

- Tempo mediano e percentil 95 de transcrição e estruturação.

- Taxa máxima de falha de gravação, upload e processamento.

- Limite de tamanho e duração por gravação.

- Tempo de retenção local e servidor.

- RPO e RTO para restauração de dados.

# 16. Direção de UX, conteúdo e identidade

## 16.1 Direção visual

- Sofisticação, acolhimento, silêncio visual e precisão clínica.

- Baixa densidade de alertas durante a consulta.

- Hierarquia clara entre fato, observação, inferência e decisão.

- Uso moderado de cores; vermelho reservado a risco ou falha.

- Componentes expansíveis para anamneses longas.

- Ações primárias grandes e inequívocas no mobile.

## 16.2 Linguagem

- Evitar afirmar que a IA “diagnostica”.

- Usar “hipótese”, “sugestão”, “correspondência com os dados” e “requer validação”.

- Diferenciar “relatado pelo paciente” e “observado pela profissional”.

- Explicar erros e próximos passos em linguagem simples.

- Não usar mensagens que culpem o usuário por falhas técnicas.

## 16.3 Redução de distração

- Transcrição ao vivo não precisa ocupar a tela principal.

- Sugestões durante consulta serão agrupadas e priorizadas.

- Alertas críticos podem interromper; lacunas comuns ficam disponíveis sob demanda.

- A revisão posterior destaca apenas itens que exigem atenção.

# 17. Analytics e métricas

## 17.1 Aquisição e freemium

- Cadastros e origem.

- Custo por conta criada.

- Cadastro do primeiro paciente.

- Primeira consulta manual.

- Retenção gratuita em 7, 30 e 90 dias.

- Custo de armazenamento e suporte por conta gratuita.

## 17.2 Descoberta da IA

- Demonstração iniciada/concluída.

- Clique para trial.

- Instalação do app.

- Teste de microfone.

- Primeira gravação.

## 17.3 Trial e conversão

- Consultas processadas.

- Minutos consumidos.

- Primeira revisão finalizada.

- Uso de recursos Pro.

- Conversão para Assistente ou Pro.

- Número de consultas antes da conversão.

- Motivos de não contratação.

## 17.4 Qualidade e segurança

- Falhas de gravação/upload/processamento.

- Campos editados, rejeitados e confirmados.

- Correções de medicamentos, datas e negações.

- Tempo de revisão.

- Trechos sem falante identificado.

- Incidentes e acessos de suporte.

## 17.5 Retenção e valor

- Profissionais com gravações semanais.

- Consultas por profissional.

- Tempo estimado economizado com base em uso real.

- Cancelamentos por preço, qualidade, baixo uso ou privacidade.

- Upgrade/downgrade.

- Margem por plano e custo de IA por minuto.

Analytics de produto não deve receber transcrição, conteúdo de prontuário ou identificadores clínicos desnecessários.

# 18. Notificações e comunicação

## 18.1 Notificações operacionais

- Upload pendente ou falhou.

- Processamento concluído.

- Consulta aguardando revisão.

- Limite de minutos próximo.

- Problema de segurança ou sessão.

- Cobrança falhou e período de regularização.

## 18.2 Privacidade

Notificações mobile e e-mails não devem mostrar nome do paciente, diagnóstico, sintomas ou conteúdo sensível por padrão. O texto deve ser genérico, como “Uma consulta está pronta para revisão”.

## 18.3 Comunicação comercial

- Ofertas de trial e upgrade são realizadas na web e por canais externos permitidos.

- O usuário pode desativar comunicações promocionais.

- Mensagens contextuais dentro da web devem ter limite de frequência.

- O app não contém calls to action de compra externa.

# 19. Critérios de aceite por épico

## 19.1 Conta gratuita

- Usuário cria conta web sem pagamento.

- Pode cadastrar pacientes e finalizar consultas manuais sem limite de quantidade.

- Pode usar os recursos manuais definidos para a nova versão.

- Convites para IA não impedem o fluxo gratuito.

## 19.2 Trial Pro

- Não inicia no cadastro nem na demonstração.

- Inicia na primeira gravação real confirmada.

- Encerra por 14 dias ou 300 minutos.

- Não exige cartão e não cobra automaticamente.

- Ao término, preserva todos os dados e retorna ao Gratuito.

## 19.3 Gravação mobile

- Não inicia sem paciente, consulta e consentimento aplicável.

- Mostra indicação permanente.

- Pausa, retoma e encerra sem perda dos segmentos válidos.

- Sobrevive a conexão instável e preserva conteúdo após encerramento inesperado.

- Só marca “enviado” após confirmação do servidor.

- Não oferece contratação ou checkout.

## 19.4 Preenchimento da anamnese

- Campos possuem origem recuperável.

- Ausência de fala não vira negação.

- Ambiguidades são destacadas.

- Observações da profissional não são confundidas com relato do paciente.

- Profissional pode editar, rejeitar e finalizar.

## 19.5 Pro

- Hipóteses mostram evidências, contradições, lacunas e referências.

- Plano e documentos permanecem rascunhos.

- Ações finais exigem confirmação profissional.

- Toda sugestão registra versão e fontes utilizadas.

## 19.6 Segurança

- Dados segregados por workspace.

- Acesso de suporte é auditado.

- Backups são restauráveis e testados.

- Áudios seguem política de retenção e não treinam modelos públicos.

- Exportação e encerramento possuem fluxo documentado.

# 20. Escopo consolidado do MVP

## 20.1 Incluído

| **Área**      | **MVP**                                                                                                                    |
|---------------|----------------------------------------------------------------------------------------------------------------------------|
| Comercial     | Gratuito, Assistente, Pro, trial, checkout web e gestão de assinatura.                                                     |
| Web           | Conta, dashboard, agenda, pacientes, anamnese, consultas, revisão, análise, plano, documentos, biblioteca e configurações. |
| Mobile        | Login, agenda do dia, paciente, consentimento, gravação, voz, upload, status e notificações.                               |
| IA Assistente | Transcrição, diarização, resumo, preenchimento, comparação, lacunas e rastreabilidade.                                     |
| IA Pro        | Hipóteses, recomendações, protocolos, plano e minutas.                                                                     |
| Segurança     | 2FA, criptografia, logs, backups, consentimentos, versionamento e retenção.                                                |
| Freemium      | Recursos manuais ilimitados em pacientes/prontuários e upsell contextual.                                                  |

## 20.2 Fora do MVP

- Análise de imagem da língua.

- Hardware de pulso.

- Portal completo do paciente.

- Clínicas multiusuário e recepção.

- Agenda pública, pagamentos de pacientes e financeiro completo.

- Prescrição autônoma.

- Revisão clínica completa no app.

- Integrações complexas e interoperabilidade em larga escala.

# 21. Visão pós-MVP

## 21.1 Medchina Clinical

- Prontuário longitudinal avançado.

- Mapas corporais.

- Escalas e resultados.

- Registro estruturado de língua e pulso.

- Eventos adversos e acompanhamento.

## 21.2 Medchina Copilot

- Preparação pré-consulta.

- Análise longitudinal aprofundada.

- Personalização por protocolos.

- Avaliação contínua da qualidade do modelo.

- Novas modalidades com validação clínica.

## 21.3 Medchina Patient

- Pré-anamnese.

- Consentimentos.

- Envio de exames.

- Orientações.

- Questionários e evolução entre sessões.

- Comunicação segura.

## 21.4 Medchina Clinic

- Múltiplos profissionais.

- Recepção e permissões.

- Unidades e salas.

- Agenda pública.

- Pacotes, pagamentos e indicadores operacionais.

## 21.5 Medchina Knowledge

- Biblioteca editorial avançada.

- Protocolos da clínica.

- Versionamento e compartilhamento.

- Classificação entre tradição, protocolo interno e evidência.

## 21.6 Medchina Insights

- Evolução agregada.

- Resposta por técnica.

- Adesão e retornos.

- Tempo de documentação.

- Indicadores financeiros e de ocupação.

## 21.7 Medchina Trust

- Governança de consentimento.

- Permissões granulares.

- Auditoria avançada.

- Painel de fornecedores e IA.

- Processos regulatórios e conformidade.

# 22. Estratégia de entrega e validação

## 22.1 Fase 0 - preparação

- Mapear recursos atuais que serão preservados manualmente.

- Definir arquitetura multi-tenant e modelo de dados.

- Validar base jurídica, regulatória e contratos de fornecedores.

- Medir custo real de áudio e IA com consultas representativas.

- Definir taxonomia da anamnese e casos de teste clínicos.

## 22.2 Fase 1 - alpha interno

- Cadastro gratuito e fluxo manual.

- Gravação mobile controlada.

- Upload, transcrição e preenchimento.

- Revisão por equipe e profissionais convidados.

- Sem recomendações automáticas para usuários externos até atingir qualidade mínima.

## 22.3 Fase 2 - beta fechado

- Profissionais convidados.

- Trial controlado.

- Assistente completo.

- Pro com hipóteses e plano sob monitoramento.

- Coleta de feedback estruturado e revisão de segurança.

## 22.4 Fase 3 - lançamento

- Cadastro público gratuito.

- Planos e checkout web.

- Apps publicados como complementos.

- Trial Pro sob demanda.

## 22.5 Fase 4 - otimização

- Ajuste de preços e minutos.

- Melhoria de conversão e onboarding.

- Personalização clínica.

- Roadmap para clínicas e pacientes.

# 23. Riscos e mitigação

| **Risco**                      | **Impacto**               | **Mitigação**                                                                         |
|--------------------------------|---------------------------|---------------------------------------------------------------------------------------|
| Plano gratuito muito completo  | Baixa conversão           | Monetizar economia de tempo; upsell contextual; medir usuários de alto uso manual.    |
| Custo de IA superior à receita | Margem negativa           | Medir custo por minuto, limites, processamento em lote e pacotes adicionais.          |
| Erro de transcrição clínica    | Registro incorreto        | Rastreabilidade, campos de atenção, revisão e testes com vocabulário MTC.             |
| Alucinação terapêutica         | Risco clínico/regulatório | RAG controlado, fontes, limites, validação profissional e avaliação regulatória.      |
| Perda de gravação              | Perda de confiança        | Armazenamento local criptografado, upload retomável, estados claros e recuperação.    |
| Paciente errado                | Violação grave            | Seleção explícita, confirmação visual e bloqueio de gravação sem vínculo.             |
| Rejeição das lojas             | Atraso mobile             | App complementar sem compras, notas de revisão detalhadas e revalidação de políticas. |
| Vazamento de dados             | Dano legal/reputacional   | Segurança por design, fornecedores avaliados, incident response e auditoria.          |
| Onboarding longo               | Baixa ativação            | Progressivo, demonstração fictícia e início do trial sob demanda.                     |

# 24. Decisões pendentes antes do desenvolvimento final

- Preço definitivo e condições anuais.

- Custo-alvo por minuto e margem mínima.

- Limites exatos de anexos e política de uso justo do Gratuito.

- Política de retenção do áudio e opções disponíveis ao profissional.

- Tempo máximo de uma gravação e tamanho de arquivo.

- Versões mínimas de iOS e Android.

- Fornecedor ou arquitetura de transcrição, diarização e LLM.

- Fontes clínicas licenciadas para a biblioteca.

- Regras por profissão/habilitação para documentos e prescrições.

- Enquadramento regulatório do módulo Pro.

- Metas técnicas de disponibilidade, RPO, RTO e processamento.

- Termos exatos do processo de exclusão, guarda e portabilidade.

- Escopo do suporte prioritário.

- Política de reprocessamento e consumo de minutos em falhas.

# 25. Glossário

| **Termo**      | **Definição**                                                                    |
|----------------|----------------------------------------------------------------------------------|
| MTC            | Medicina Tradicional Chinesa.                                                    |
| Workspace      | Espaço lógico isolado de uma profissional ou futura clínica.                     |
| Diarização     | Separação dos participantes/falantes de uma gravação.                            |
| RAG            | Recuperação de referências de uma base controlada para apoiar a geração.         |
| Rascunho de IA | Conteúdo gerado que ainda não foi finalizado pela profissional.                  |
| Proveniência   | Origem de uma informação, como trecho de áudio, entrada manual ou fonte clínica. |
| Adendo         | Complemento ou correção posterior que preserva o registro original.              |
| RPO/RTO        | Metas de perda máxima de dados e tempo de recuperação.                           |

# 26. Referências normativas e de plataforma consultadas

As referências abaixo orientam requisitos do produto, mas não substituem parecer jurídico, regulatório ou profissional.

**Apple App Review Guidelines:** https://developer.apple.com/app-store/review/guidelines/ - Regras de apps médicos, gravação, dados, IA de terceiros e app complementar gratuito.

**Google Play - Noções básicas sobre a política de pagamentos:** https://support.google.com/googleplay/android-developer/answer/10281818?hl=pt-BR - Apps de consumo, comunicação e faturamento.

**Google Play - Política de pagamentos:** https://support.google.com/googleplay/android-developer/answer/9858738?hl=pt-BR - Requisitos gerais de pagamentos digitais.

**ANPD - Comunicação de Incidente de Segurança:** https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis - Avaliação e comunicação de incidentes.

**Lei nº 13.709/2018 - LGPD:** https://www.planalto.gov.br/ccivil_03/\_ato2015-2018/2018/lei/l13709.htm - Proteção de dados pessoais e dados sensíveis.

**Lei nº 13.787/2018:** https://www.planalto.gov.br/ccivil_03/\_ato2015-2018/2018/lei/l13787.htm - Digitalização e utilização de sistemas informatizados para prontuários.

# 27. Mensagens de produto recomendadas

## 27.1 Proposta principal

> Atenda olhando para o paciente. O Medchina organiza o restante.

## 27.2 Gratuito

> Comece gratuitamente. Cadastre pacientes e use os recursos clínicos manuais sem limite.

## 27.3 Assistente

> Atenda sem precisar preencher o prontuário durante a conversa.

## 27.4 Pro

> Da conversa ao plano terapêutico, tudo preparado para sua revisão.

## 27.5 Fim do trial

> Seu teste do Medchina Pro terminou. Todo o histórico permanece disponível. Continue gratuitamente com os recursos manuais ou escolha um plano para continuar automatizando suas consultas.

**FIM DO PRD**

Medchina - Nova versão v1.0
