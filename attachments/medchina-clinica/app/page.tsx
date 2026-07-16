const highlights = [
  "Feito para MTC",
  "IA supervisionada",
  "Web + app mobile",
  "Trial Pro quando você decidir",
];

const trustItems = [
  {
    number: "01",
    title: "Comece gratuitamente",
    text: "Use os recursos clínicos manuais sem limite de pacientes ou prontuários.",
  },
  {
    number: "02",
    title: "Automatize quando fizer sentido",
    text: "Ative o trial Pro somente quando estiver pronta para uma consulta real com IA.",
  },
  {
    number: "03",
    title: "Revise antes de finalizar",
    text: "Preenchimentos, hipóteses e sugestões permanecem sob sua validação.",
  },
  {
    number: "04",
    title: "Web + mobile, em conjunto",
    text: "O app facilita a captação; a plataforma web concentra a experiência completa.",
  },
];

const benefits = [
  { number: "01", title: "Esteja na consulta, não no formulário.", text: "Use a captação mobile e os comandos de voz para reduzir a digitação durante o atendimento." },
  { number: "02", title: "A conversa encontra o campo certo.", text: "Sintomas, hábitos, emoções, medicamentos, exames e evolução são preparados dentro da estrutura clínica do Medchina." },
  { number: "03", title: "Veja o que mudou desde a última consulta.", text: "Compare relatos, sintomas, técnicas e respostas ao longo do acompanhamento." },
  { number: "04", title: "Hipóteses explicadas, não respostas fechadas.", text: "O Pro apresenta padrões possíveis, sinais favoráveis, contradições, dados ausentes e referências para sua análise." },
  { number: "05", title: "Do padrão ao plano, sem recomeçar do zero.", text: "Recomendações, combinações, protocolos e orientações são organizados para revisão." },
  { number: "06", title: "A decisão final continua sendo sua.", text: "Nada é finalizado automaticamente. Você edita, rejeita, valida e assina." },
];

const mtcCategories = [
  "Queixa principal", "Sono e energia", "Alimentação e digestão", "Emoções e contexto",
  "Yin e Yang", "Qi, Sangue e Líquidos", "Zang-Fu", "Cinco Elementos",
  "Constituição", "Língua e pulso", "Pontos e meridianos", "Acupuntura",
  "Auriculoterapia", "Moxabustão", "Ventosaterapia", "Dietoterapia",
];

const plans = [
  {
    id: "gratuito",
    name: "Medchina Gratuito",
    price: "R$ 0",
    description: "Para organizar sua prática e utilizar os recursos clínicos manualmente.",
    features: ["Pacientes e prontuários ilimitados", "Anamnese e análise manuais", "Plano terapêutico e documentos", "Agenda, histórico e biblioteca clínica"],
    cta: "Começar gratuitamente",
  },
  {
    id: "assistente",
    name: "Medchina Assistente",
    price: "Em breve",
    description: "Para atender sem depender de anotações e preenchimento durante a conversa.",
    features: ["Tudo do Gratuito", "Aplicativo mobile", "Gravação, transcrição e separação de falantes", "Anamnese automática e comparação", "Lacunas, contradições e rastreabilidade"],
    cta: "Conhecer o Assistente",
    highlighted: true,
  },
  {
    id: "pro",
    name: "Medchina Pro",
    price: "Em breve",
    description: "Para automatizar a documentação e preparar o raciocínio terapêutico.",
    features: ["Tudo do Assistente", "Hipóteses de padrões de desarmonia", "Sinais favoráveis e contraditórios", "Pontos, combinações e protocolos", "Plano terapêutico preparado para revisão"],
    cta: "Conhecer o Pro",
  },
];

const faqs = [
  ["Posso usar o Medchina gratuitamente?", "Sim. O plano Gratuito permite cadastrar pacientes, registrar consultas e utilizar os recursos clínicos manuais sem limite de pacientes ou prontuários textuais."],
  ["O trial começa quando eu criar minha conta?", "Não. O trial Pro começa somente quando você decidir iniciar sua primeira consulta real com IA. São 14 dias ou 300 minutos, o que ocorrer primeiro."],
  ["Preciso cadastrar um cartão para testar o Pro?", "Não. O trial não exige cartão, não gera cobrança automática e, ao terminar, sua conta volta ao plano Gratuito."],
  ["A IA toma decisões clínicas por mim?", "Não. A IA organiza informações, aponta lacunas e prepara possibilidades. A revisão, a validação e a decisão final continuam sob responsabilidade da profissional."],
  ["A IA preenche o que não foi dito?", "Não. O que não foi informado permanece em branco. Campos ambíguos ou contraditórios são destacados para sua revisão."],
  ["Preciso gravar todas as consultas?", "Não. A gravação é opcional e depende de autorização. Você pode seguir usando todos os recursos manuais quando não quiser ou não puder gravar."],
  ["Como registro língua, pulso e palpação?", "Essas observações podem ser registradas manualmente ou ditadas pela profissional. O sistema não infere achados físicos apenas pela fala do paciente."],
  ["O aplicativo substitui a versão web?", "Não. O aplicativo é complementar e focado na captação. A revisão clínica completa, planos, documentos e configurações permanecem na plataforma web."],
  ["O Medchina serve apenas para acupuntura?", "Não. A plataforma também pode organizar auriculoterapia, moxabustão, ventosaterapia, dietoterapia e outras práticas configuradas pela profissional."],
  ["O que acontece com meus dados após o trial?", "Pacientes, prontuários e conteúdos já produzidos permanecem acessíveis. Apenas novos processamentos com IA ficam indisponíveis até a contratação de um plano pago."],
];

function Logo() {
  return (
    <a className="brand" href="#inicio" aria-label="Medchina, início">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>medchina</span>
    </a>
  );
}

function Header() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Navegação principal">
          <a href="#como-funciona">Como funciona</a>
          <a href="#recursos">Recursos</a>
          <a href="#planos">Planos</a>
          <a href="#seguranca">Segurança</a>
          <a href="#duvidas">Dúvidas</a>
        </nav>
        <div className="header-actions">
          <a className="login-link" href="#cadastro">Entrar</a>
          <a className="button button-small" href="#cadastro">
            Começar gratuitamente
          </a>
        </div>
        <details className="mobile-menu">
          <summary aria-label="Abrir menu"><span /><span /></summary>
          <nav aria-label="Navegação mobile">
            <a href="#como-funciona">Como funciona</a>
            <a href="#recursos">Recursos</a>
            <a href="#planos">Planos</a>
            <a href="#seguranca">Segurança</a>
            <a href="#duvidas">Dúvidas</a>
            <a className="button" href="#cadastro">Começar gratuitamente</a>
          </nav>
        </details>
      </div>
    </header>
  );
}

function HeroMockup() {
  return (
    <div className="hero-visual" role="img" aria-label="Aplicativo Medchina gravando uma consulta autorizada e plataforma web exibindo a anamnese preenchida para revisão da profissional.">
      <div className="orbit orbit-one" aria-hidden="true" />
      <div className="orbit orbit-two" aria-hidden="true" />

      <div className="web-mockup">
        <div className="web-topbar">
          <div className="mini-brand"><span className="mini-mark" /> medchina</div>
          <div className="web-search">Buscar paciente</div>
          <div className="avatar">MA</div>
        </div>
        <div className="web-body">
          <aside className="web-sidebar" aria-hidden="true">
            <span className="side-active" />
            <span /><span /><span /><span />
          </aside>
          <div className="record-panel">
            <div className="record-heading">
              <div>
                <span className="kicker">CONSULTA · 15 JUL 2026</span>
                <strong>Anamnese de Helena</strong>
              </div>
              <span className="review-chip">Pronta para revisão</span>
            </div>
            <div className="record-progress"><span /></div>
            <div className="record-tabs"><b>Resumo</b><span>Anamnese</span><span>Análise MTC</span><span>Plano</span></div>
            <div className="record-grid">
              <div className="record-main">
                <article className="field-card clear">
                  <div className="field-title"><span className="status-dot" /> Sono <small>Evidência clara</small></div>
                  <p>Desperta aproximadamente três vezes durante a noite.</p>
                  <div className="source-line">↳ Relato da paciente · 14:32</div>
                </article>
                <article className="field-card attention">
                  <div className="field-title"><span className="status-dot" /> Sintomas associados <small>Requer atenção</small></div>
                  <p>Calor noturno e episódios de sudorese.</p>
                  <div className="source-line">↳ Conferir contexto · 15:08</div>
                </article>
                <article className="field-card empty">
                  <div className="field-title"><span className="status-dot" /> Língua e pulso <small>Não informado</small></div>
                  <p>Adicionar observação da profissional.</p>
                </article>
              </div>
              <aside className="change-card">
                <span className="kicker">DESDE A ÚLTIMA CONSULTA</span>
                <strong>3 mudanças</strong>
                <ul>
                  <li><i /> Sono fragmentado</li>
                  <li><i /> Calor noturno</li>
                  <li><i /> Tensão cervical</li>
                </ul>
                <button type="button">Revisar consulta <span>→</span></button>
              </aside>
            </div>
          </div>
        </div>
      </div>

      <div className="flow-line" aria-hidden="true"><span /><i /><b /></div>

      <div className="phone-mockup">
        <div className="phone-speaker" />
        <div className="phone-screen">
          <div className="phone-top"><span>09:41</span><span>● ● ●</span></div>
          <div className="phone-nav"><span>‹</span><strong>Consulta</strong><i /></div>
          <div className="patient-mini">
            <div className="patient-avatar">HM</div>
            <div><strong>Helena Martins</strong><span>Consentimento confirmado</span></div>
            <b>✓</b>
          </div>
          <div className="recording-state">
            <div className="pulse-ring"><span /></div>
            <small>GRAVAÇÃO EM ANDAMENTO</small>
            <strong>32:18</strong>
            <div className="sound-wave" aria-hidden="true">
              {Array.from({ length: 22 }).map((_, index) => <i key={index} />)}
            </div>
          </div>
          <div className="phone-actions">
            <button type="button"><span>Ⅱ</span>Pausar</button>
            <button type="button"><span>＋</span>Observação</button>
          </div>
          <button className="finish-button" type="button">Finalizar consulta</button>
        </div>
      </div>

      <div className="floating-note note-one"><span>✓</span><div><b>Informação vinculada</b><small>Trecho da conversa localizado</small></div></div>
      <div className="floating-note note-two"><span>03</span><div><b>Campos preparados</b><small>Prontos para sua revisão</small></div></div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero section-shell" id="inicio">
      <div className="hero-copy">
        <div className="eyebrow"><span /> Prontuário inteligente para Medicina Tradicional Chinesa</div>
        <h1>Atenda olhando para o paciente. <em>O Medchina organiza o restante.</em></h1>
        <p className="hero-subtitle">Grave a consulta com autorização, tenha a anamnese preenchida e receba análises, protocolos e um plano terapêutico preparados para sua revisão — sem perder o controle clínico.</p>
        <div className="hero-actions">
          <a className="button" href="#cadastro">Começar gratuitamente <span>→</span></a>
          <a className="text-button" href="#como-funciona"><span className="play-icon">▶</span> Ver como funciona</a>
        </div>
        <p className="microcopy"><span>✓</span> Sem cartão. Pacientes e prontuários manuais ilimitados.</p>
        <div className="hero-highlights">
          {highlights.map((item) => <span key={item}><i>✓</i>{item}</span>)}
        </div>
      </div>
      <HeroMockup />
    </section>
  );
}

function TrustStrip() {
  return (
    <section className="trust-strip" aria-label="Benefícios para começar">
      <div className="section-shell trust-grid">
        {trustItems.map((item) => (
          <article key={item.number}>
            <span className="trust-number">{item.number}</span>
            <div><h2>{item.title}</h2><p>{item.text}</p></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, text, align = "left" }: { eyebrow?: string; title: string; text?: string; align?: "left" | "center" }) {
  return (
    <div className={`section-heading ${align === "center" ? "heading-center" : ""}`}>
      {eyebrow && <div className="eyebrow"><span /> {eyebrow}</div>}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function WorkflowDemo() {
  return (
    <section className="content-section workflow-section" id="como-funciona">
      <div className="section-shell">
        <SectionHeading eyebrow="Como funciona" title="Da conversa ao prontuário, em um único fluxo." text="O Medchina conecta o que acontece durante a consulta ao que você precisa revisar e registrar depois dela." align="center" />
        <div className="workflow-demo">
          <input defaultChecked id="flow-conversation" name="workflow" type="radio" />
          <input id="flow-anamnesis" name="workflow" type="radio" />
          <input id="flow-analysis" name="workflow" type="radio" />
          <input id="flow-plan" name="workflow" type="radio" />
          <div className="workflow-tabs" role="tablist" aria-label="Etapas da demonstração">
            <label htmlFor="flow-conversation"><span>01</span><b>Conversa</b><small>Atenda</small></label>
            <label htmlFor="flow-anamnesis"><span>02</span><b>Anamnese</b><small>O Medchina organiza</small></label>
            <label htmlFor="flow-analysis"><span>03</span><b>Análise</b><small>A IA destaca</small></label>
            <label htmlFor="flow-plan"><span>04</span><b>Plano</b><small>Você decide</small></label>
          </div>
          <div className="workflow-panels">
            <article className="workflow-panel panel-conversation">
              <div className="conversation-copy"><span className="step-pill">ETAPA 1 · ATENDA</span><h3>Uma conversa com mais presença.</h3><p>Selecione o paciente, confirme a autorização e inicie a consulta pelo celular. Observações clínicas podem ser ditadas sem interromper a escuta.</p><div className="consent-row"><span>✓</span><div><b>Consentimento confirmado</b><small>Gravação autorizada em 15/07/2026</small></div></div></div>
              <div className="conversation-card"><div className="dialogue"><span>PACIENTE · 14:32</span><p>“Tenho acordado umas três vezes durante a noite. Sinto muito calor e às vezes acordo suando.”</p></div><div className="audio-strip"><b>14:32</b><div>{Array.from({length: 34}).map((_, i) => <i key={i} />)}</div><span>15:08</span></div><div className="speaker-tags"><span>Paciente</span><span>Profissional</span><b>Transcrição protegida</b></div></div>
            </article>
            <article className="workflow-panel panel-anamnesis">
              <div className="conversation-copy"><span className="step-pill">ETAPA 2 · ORGANIZE</span><h3>A conversa encontra a estrutura clínica.</h3><p>Os participantes são identificados e os dados relatados são distribuídos nos campos correspondentes — preservando a origem de cada informação.</p></div>
              <div className="mapping-card"><div className="quote-source">“Acordo três vezes toda noite”<span>Paciente · 14:32</span></div><div className="mapping-arrow">→</div><div className="mapped-field"><span>SONO</span><b>Despertares noturnos</b><small>Evidência clara · Ouvir trecho</small></div></div>
            </article>
            <article className="workflow-panel panel-analysis">
              <div className="conversation-copy"><span className="step-pill">ETAPA 3 · REVISE</span><h3>As exceções chegam primeiro.</h3><p>Mudanças, lacunas, ambiguidades e possíveis contradições são reunidas para que sua revisão se concentre no que realmente exige atenção.</p></div>
              <div className="analysis-stack"><div><span className="analysis-icon change">↗</span><p><b>Mudança identificada</b><small>Sono fragmentado há cerca de dois meses</small></p></div><div><span className="analysis-icon investigate">?</span><p><b>Investigar</b><small>Sede, boca seca, língua e pulso</small></p></div><div><span className="analysis-icon warning">!</span><p><b>Requer atenção</b><small>Evolução do sintoma não informada</small></p></div></div>
            </article>
            <article className="workflow-panel panel-plan">
              <div className="conversation-copy"><span className="step-pill">ETAPA 4 · DECIDA</span><h3>Possibilidades preparadas. Conduta profissional.</h3><p>Revise hipóteses, ajuste recomendações e protocolos, confirme o plano terapêutico e finalize o prontuário.</p></div>
              <div className="plan-review"><div className="plan-row"><span>IA</span><div><b>Possibilidade preparada</b><small>Padrão, sinais favoráveis e dados ausentes</small></div><em>Sugestão</em></div><div className="plan-row professional"><span>VP</span><div><b>Decisão profissional</b><small>Ajustada e validada por você</small></div><em>Validado</em></div><button type="button">Validar e finalizar <span>→</span></button></div>
            </article>
          </div>
        </div>
        <div className="center-action"><a className="text-button underlined" href="#anamnese">Experimentar com dados fictícios <span>→</span></a><small>A demonstração não exige cadastro e não inicia seu trial.</small></div>
      </div>
    </section>
  );
}

function BeforeAfter() {
  return (
    <section className="content-section before-after-section" id="recursos">
      <div className="section-shell split-intro">
        <SectionHeading eyebrow="Presença clínica" title="Sua atenção não deveria estar dividida entre o paciente e o computador." />
        <p>A consulta em Medicina Tradicional Chinesa exige escuta, observação e leitura individual. O Medchina reduz o esforço operacional para que você possa estar mais presente e revisar apenas o que realmente exige sua decisão.</p>
      </div>
      <div className="section-shell comparison-grid">
        <article className="comparison-card before-card"><span className="comparison-label">ANTES</span><h3>O atendimento termina.<br/>A documentação continua.</h3><ul><li>Alternar entre paciente e computador</li><li>Anotar em diferentes lugares</li><li>Preencher a anamnese depois</li><li>Reconstruir o plano terapêutico</li></ul></article>
        <div className="comparison-bridge"><span>→</span></div>
        <article className="comparison-card after-card"><span className="comparison-label">COM O MEDCHINA</span><h3>A consulta flui.<br/>O prontuário acompanha.</h3><ul><li>Conversar com mais presença</li><li>Registrar observações por voz</li><li>Receber a anamnese estruturada</li><li>Finalizar em um fluxo único</li></ul></article>
      </div>
    </section>
  );
}

function Benefits() {
  return (
    <section className="content-section benefits-section">
      <div className="section-shell"><SectionHeading eyebrow="Benefícios" title="Mais presença clínica. Mais continuidade. Menos trabalho repetitivo." align="center" />
        <div className="benefit-grid">{benefits.map((benefit) => <article key={benefit.number}><span>{benefit.number}</span><div className="benefit-icon" aria-hidden="true"><i /></div><h3>{benefit.title}</h3><p>{benefit.text}</p></article>)}</div>
      </div>
    </section>
  );
}

function MobileShowcase() {
  return (
    <section className="content-section mobile-section">
      <div className="section-shell mobile-layout">
        <div className="mobile-copy"><SectionHeading eyebrow="Medchina Mobile" title="Seu celular capta a consulta. A plataforma organiza o atendimento." text="O aplicativo foi pensado para facilitar a gravação autorizada e o registro de observações por voz. Ele complementa a plataforma web, onde você revisa a anamnese, a análise e o plano terapêutico." />
          <ul className="feature-list"><li><span>✓</span> Verificação do consentimento</li><li><span>✓</span> Pausar, retomar e encerrar gravações</li><li><span>✓</span> Observações clínicas por voz</li><li><span>✓</span> Retomada após falhas de conexão</li></ul>
          <div className="connection-note"><span>↻</span><div><b>Conexão instável não deve significar consulta perdida.</b><p>O app informa se o áudio está no celular, sendo enviado ou confirmado pelo servidor.</p></div></div>
          <p className="commercial-note">Disponível como complemento nos planos Assistente e Pro. Cadastro e pagamentos são gerenciados pela web.</p>
        </div>
        <div className="mobile-sequence" aria-label="Três telas conceituais do aplicativo Medchina">
          <div className="mobile-device device-back"><div className="device-head"><span>9:41</span><b>Hoje</b><i /></div><h4>Consultas de hoje</h4><div className="appointment"><span>09:00</span><div><b>Helena Martins</b><small>Retorno · Acupuntura</small></div></div><div className="appointment"><span>11:30</span><div><b>Marina Alves</b><small>Primeira consulta</small></div></div><div className="appointment faded"><span>15:00</span><div><b>Lucas Ferreira</b><small>Acompanhamento</small></div></div></div>
          <div className="mobile-device device-front"><div className="device-head"><span>9:41</span><b>Consulta</b><i /></div><div className="mobile-patient"><span>HM</span><div><b>Helena Martins</b><small>Consentimento confirmado</small></div></div><div className="mobile-record"><i /><small>GRAVANDO</small><b>32:18</b><div className="tiny-wave">▂▅▃▆▂▇▃▅▂▆▃▅</div></div><div className="mini-buttons"><span>Ⅱ<br/><small>Pausar</small></span><span>＋<br/><small>Observação</small></span></div><button type="button">Finalizar</button></div>
          <div className="mobile-device device-side"><div className="device-head"><span>9:41</span><b>Status</b><i /></div><div className="success-circle">✓</div><h4>Consulta enviada</h4><p>A anamnese está sendo preparada.</p><div className="process-status"><span>✓</span><div><b>Upload concluído</b><small>Áudio confirmado</small></div></div><div className="process-status current"><span>···</span><div><b>Em processamento</b><small>Você será notificada</small></div></div></div>
        </div>
      </div>
    </section>
  );
}

function AnamnesisDemo() {
  return (
    <section className="content-section anamnesis-section" id="anamnese">
      <div className="section-shell"><SectionHeading eyebrow="Anamnese inteligente" title="A conversa vira estrutura — sem transformar ausência em resposta." text="O Medchina preserva a origem de cada dado e mantém em branco o que não foi informado. Ambiguidades, contradições e informações sensíveis ficam destacadas para sua revisão." align="center" />
        <div className="anamnesis-demo">
          <blockquote><span>CONVERSA FICTÍCIA · HELENA MARTINS</span><p>“Tenho acordado umas três vezes durante a noite. Sinto muito calor e às vezes acordo suando. Isso começou há cerca de dois meses.”</p><cite><i /> Paciente · 14:32 — 15:08</cite></blockquote>
          <div className="anamnesis-arrow"><span>→</span><small>Organização<br/>supervisionada</small></div>
          <div className="prepared-fields"><div className="prepared-head"><div><span>ANAMNESE PREPARADA</span><h3>Sono e sintomas associados</h3></div><b>6 campos</b></div><div className="prepared-row state-clear"><span className="state-symbol">✓</span><div><b>Sono</b><p>Despertares noturnos, aproximadamente três vezes.</p></div><em>Evidência clara</em></div><div className="prepared-row state-attention"><span className="state-symbol">!</span><div><b>Evolução</b><p>Início há cerca de dois meses; evolução não informada.</p></div><em>Requer atenção</em></div><div className="prepared-row state-empty"><span className="state-symbol">—</span><div><b>Língua e pulso</b><p>Aguardando observação da profissional.</p></div><em>Não informado</em></div><div className="investigation"><span>?</span><p><b>Sugestão de investigação</b> Sede, boca seca, horário dos despertares, características da sudorese, língua e pulso.</p></div></div>
        </div>
      </div>
    </section>
  );
}

function ClinicalReasoning() {
  const cards = [
    ["01", "Hipóteses explicáveis", "Padrões possíveis com sinais favoráveis, contraditórios, dados ausentes e referências utilizadas."],
    ["02", "Recomendações em contexto", "Pontos principais e complementares, combinações, protocolos, meridianos e técnicas."],
    ["03", "Plano preparado", "Objetivo terapêutico, orientações, frequência e documentos — sempre para validação profissional."],
  ];
  return (
    <section className="content-section reasoning-section">
      <div className="section-shell"><div className="reasoning-intro"><SectionHeading eyebrow="Raciocínio clínico supervisionado" title="A IA prepara possibilidades. Você define a conduta." text="A partir da anamnese e do histórico, o Medchina Pro organiza possibilidades de padrões de desarmonia e prepara recomendações para sua revisão." /><a className="button pale-button" href="#planos">Conhecer o Pro <span>→</span></a></div>
        <div className="reasoning-grid">{cards.map(([number,title,text]) => <article key={number}><span>{number}</span><div className="reasoning-symbol"><i/><b/></div><h3>{title}</h3><p>{text}</p><a href="#rastreabilidade">Ver como é explicado <span>→</span></a></article>)}</div>
        <p className="safety-line"><span>i</span> Hipóteses e recomendações exigem revisão clínica. O Medchina não substitui exame físico, observação da língua, palpação do pulso, avaliação de contraindicações ou encaminhamento.</p>
      </div>
    </section>
  );
}

function MtcSpecialization() {
  return (
    <section className="content-section mtc-section">
      <div className="section-shell mtc-layout"><div className="mtc-copy"><SectionHeading eyebrow="Especializado em MTC" title="Um prontuário construído para a lógica da Medicina Tradicional Chinesa." text="Em vez de adaptar sua consulta a um sistema genérico, organize a avaliação segundo os elementos que já fazem parte da sua prática." /><div className="mtc-quote"><span>“</span><p>Use os modelos do Medchina, personalize sua anamnese e mantenha seu próprio modo de atender.</p></div></div><div className="mtc-grid">{mtcCategories.map((item,index) => <span key={item} className={index % 5 === 0 ? "accent" : ""}><i>{String(index + 1).padStart(2,"0")}</i>{item}</span>)}</div></div>
    </section>
  );
}

function Traceability() {
  return (
    <section className="content-section trace-section" id="rastreabilidade">
      <div className="section-shell trace-layout"><div className="trace-demo"><div className="trace-header"><span>CAMPO DA ANAMNESE</span><b>Rastreabilidade ativa</b></div><h3>Sono</h3><p className="trace-value">Desperta aproximadamente três vezes durante a noite.</p><div className="trace-origin"><div className="play-round">▶</div><div><span>ORIGEM · PACIENTE, 14:32</span><p>“Tenho acordado umas três vezes toda noite.”</p></div><em>00:08</em></div><div className="trace-actions"><button type="button">Ouvir trecho</button><button type="button">Editar</button><button type="button">Rejeitar</button><button className="validated" type="button">✓ Validado</button></div></div>
        <div className="trace-copy"><SectionHeading eyebrow="Controle e rastreabilidade" title="Você sempre pode ver de onde a informação veio." text="Ouça o contexto, corrija uma interpretação e registre sua decisão sem tratar uma sugestão como fato clínico." /><div className="source-legend"><span><i className="patient-source"/>Relato do paciente</span><span><i className="professional-source"/>Observação profissional</span><span><i className="ai-source"/>Inferência da IA</span><span><i className="decision-source"/>Decisão profissional</span></div></div></div>
    </section>
  );
}

function Pricing() {
  return (
    <section className="content-section pricing-section" id="planos">
      <div className="section-shell"><SectionHeading eyebrow="Planos" title="Escolha quanto do seu trabalho você quer automatizar." text="Comece gratuitamente e mude de plano quando a automação fizer sentido para sua rotina." align="center" />
        <div className="pricing-status"><span>GRATUITO</span><i/><span>DOCUMENTAÇÃO</span><i/><span>RACIOCÍNIO + PLANO</span></div>
        <div className="pricing-grid">{plans.map((plan) => <article key={plan.id} className={plan.highlighted ? "pricing-card highlighted" : "pricing-card"}>{plan.highlighted && <span className="popular">MAIS ESCOLHIDO</span>}<div className="plan-head"><span className="plan-index">{plan.id === "gratuito" ? "01" : plan.id === "assistente" ? "02" : "03"}</span><h3>{plan.name}</h3><strong>{plan.price}</strong>{plan.price === "Em breve" && <small>Preço em validação comercial</small>}<p>{plan.description}</p></div><ul>{plan.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul><a className={plan.id === "gratuito" ? "button" : "plan-button"} href="#cadastro">{plan.cta} <span>→</span></a>{plan.id === "gratuito" && <small className="no-card">Não exige cartão.</small>}</article>)}</div>
        <p className="pricing-difference"><b>Assistente</b> registra e organiza a consulta. <b>Pro</b> também prepara possibilidades de conduta para sua revisão.</p>
      </div>
    </section>
  );
}

function Security() {
  const pillars = [["01","Consentimento separado","Gravação, transcrição e uso de IA podem possuir autorizações específicas e versionadas."],["02","Áudio sob controle","A cópia local só é removida depois da confirmação segura do envio."],["03","Acesso protegido","Autenticação em dois fatores, gestão de sessões e registros de acesso ajudam a proteger o workspace."],["04","Histórico de alterações","Finalizações, edições e adendos permanecem rastreáveis, com autoria, data e versão."]];
  return (
    <section className="content-section security-section" id="seguranca"><div className="section-shell security-layout"><div className="security-copy"><SectionHeading eyebrow="Segurança e privacidade" title="Dados clínicos exigem mais do que conveniência. Exigem controle." text="O Medchina foi planejado para tratar informações de saúde com segurança, rastreabilidade e minimização. Você controla quando gravar, o que validar e quando finalizar." /><div className="privacy-note"><span>⌁</span><p>Controles de privacidade, consentimento e auditoria integrados ao fluxo clínico.</p></div></div><div className="security-grid">{pillars.map(([number,title,text]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>
  );
}

function Faq() {
  const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) };
  return (
    <section className="content-section faq-section" id="duvidas"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} /><div className="section-shell faq-layout"><div className="faq-intro"><SectionHeading eyebrow="Dúvidas frequentes" title="Clareza antes de começar." text="As respostas mais importantes sobre o plano gratuito, o trial e o papel da inteligência artificial." /><a className="text-button underlined" href="#cadastro">Começar gratuitamente <span>→</span></a></div><div className="faq-list">{faqs.map(([question,answer], index) => <details key={question} open={index === 0}><summary><span>{String(index + 1).padStart(2,"0")}</span><b>{question}</b><i>+</i></summary><p>{answer}</p></details>)}</div></div></section>
  );
}

function FinalCta() {
  return (
    <section className="final-cta" id="cadastro"><div className="section-shell final-cta-inner"><div className="final-symbol" aria-hidden="true"><i/><span/><b/></div><div><div className="eyebrow light-eyebrow"><span /> Comece no seu ritmo</div><h2>Comece gratuitamente.<br/><em>Automatize quando estiver pronta.</em></h2><p>Organize seus pacientes, utilize os recursos clínicos do Medchina e conheça a automação no seu próprio ritmo. Nenhum cartão é necessário para começar.</p><div className="final-actions"><a className="button light-button" href="#inicio">Criar minha conta gratuita <span>→</span></a><a className="final-demo-link" href="#como-funciona">Ver demonstração</a></div><div className="final-points"><span>✓ Prontuários manuais ilimitados</span><span>✓ Trial iniciado somente por você</span><span>✓ Sem cobrança automática</span><span>✓ Dados preservados após o teste</span></div></div></div></section>
  );
}

function Footer() {
  return (
    <footer className="footer"><div className="section-shell footer-main"><div className="footer-brand"><Logo/><p>Prontuário e apoio ao raciocínio clínico para Medicina Tradicional Chinesa.</p></div><div><h3>Produto</h3><a href="#como-funciona">Como funciona</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a><a href="#seguranca">Segurança</a></div><div><h3>Conta</h3><a href="#cadastro">Começar gratuitamente</a><a href="#cadastro">Entrar</a><a href="#duvidas">Central de ajuda</a></div><div><h3>Empresa</h3><a href="#inicio">Sobre</a><a href="#duvidas">Contato</a><a href="#seguranca">Privacidade</a><a href="#seguranca">Termos de uso</a></div></div><div className="section-shell footer-legal"><p>© 2026 Medchina. Todos os direitos reservados.</p><p>O Medchina não substitui avaliação profissional, exame físico, observação da língua, palpação do pulso, análise de contraindicações ou encaminhamento quando necessário.</p></div></footer>
  );
}

export default function Home() {
  return (
    <main>
      <Header />
      <Hero />
      <TrustStrip />
      <WorkflowDemo />
      <BeforeAfter />
      <Benefits />
      <MobileShowcase />
      <AnamnesisDemo />
      <ClinicalReasoning />
      <MtcSpecialization />
      <Traceability />
      <Pricing />
      <Security />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}
