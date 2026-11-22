/**
 * pt-BR is the STRUCTURAL source of truth for the home's copy: `HomeCopy` is
 * `typeof homeCopyPtBR`, so a missing or extra key in any other language is a
 * compile error — stronger than the runtime key-parity test that guards the
 * next-intl catalogs, and the reason this page's copy does not live in them
 * (its content is structured arrays and per-slug records, not flat keys).
 *
 * Inline markers (see ./rich.tsx): **accent** -> <em>, __lead__ -> <strong>,
 * ==term== -> <mark>, \n -> <br />. Each language chooses its OWN line breaks.
 */
export const homeCopyPtBR = {
  /** Title tag + meta description. Localized like the page itself: a visitor
      who switched to Chinese and shares the link sends a Chinese preview. */
  meta: {
    title: "MedChina | Prontuário inteligente para MTC",
    description:
      "Organize pacientes, anamneses, análises e planos terapêuticos em uma plataforma feita para Medicina Tradicional Chinesa.",
  },

  nav: {
    brandAria: "MedChina — início",
    desktopAria: "Navegação principal",
    mobileAria: "Navegação mobile",
    howItWorks: "Como funciona",
    features: "Recursos",
    security: "Segurança",
    plans: "Planos",
    signIn: "Entrar",
    signUp: "Criar conta grátis",
    openMenu: "Abrir menu",
    closeMenu: "Fechar menu",
  },

  language: {
    label: "Idioma",
    ariaLabel: "Escolher idioma do site",
    /** Each language is named in ITSELF — a visitor who cannot read the current
        language must still recognize her own in the list. */
    names: {
      "pt-BR": "Português (Brasil)",
      en: "English",
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      "zh-CN": "简体中文",
    },
    /**
     * Shown only when the site chose the language FOR the visitor (from her
     * browser or her country) — so it is always read in that language, never in
     * Portuguese. In pt-BR it never appears: pt-BR is the default, and nobody
     * is switched into the language she would have got anyway.
     */
    notice: {
      message: "Este site está em português do Brasil, escolhido pelo idioma do seu navegador.",
      switchToDefault: "Ver em português",
      dismiss: "Fechar aviso",
    },
  },

  hero: {
    eyebrow: "Clareza clínica, do primeiro relato à evolução",
    title: "Sua prática de MTC,\nampliada por uma IA\nque **você supervisiona.**",
    lead: "Registre a consulta, estruture a anamnese e conecte padrões clínicos com rastreabilidade, sem abrir mão da sua decisão.",
    ctaPrimary: "Criar conta gratuita",
    ctaSecondary: "Conhecer a plataforma",
    guarantee: "14 dias grátis, sem cartão · cancele quando quiser",
    trustAria: "Garantias",
    trust: ["Consentimento", "Rastreabilidade", "Controle clínico"],
    principle: "__A IA organiza.__\nVocê interpreta, valida e decide.",
    stageAria: "MedChina no computador e no celular",
    compositeAlt: "Profissional de Medicina Tradicional Chinesa usando o MedChina no computador e no celular",
    platformAria: "Aplicativo disponível para iOS e Android",
    availableFor: "Disponível para",
    insights: [
      { title: "Informação rastreável", detail: "Origem e contexto preservados." },
      { title: "Hipótese para revisão", detail: "Sugestões pedem seu julgamento." },
      { title: "Plano sob sua decisão", detail: "Você define condutas e ajustes." },
    ],
  },

  valueStrip: {
    ariaLabel: "Principais benefícios do MedChina",
    items: [
      "Anamnese estruturada na linguagem da MTC",
      "Modelos e planos personalizáveis",
      "Evolução clínica acompanhada com inteligência",
      "Segurança e privacidade em todo o fluxo",
    ],
  },

  flow: {
    eyebrow: "Todo o fluxo, com continuidade",
    title: "Uma linha **contínua** entre\nescuta, raciocínio e evolução.",
    lead: "Do primeiro contato ao acompanhamento, o MedChina conecta cada etapa da consulta com estrutura, contexto e segurança.",
    steps: {
      consulta: {
        label: "Consulta",
        title: "O atendimento começa com contexto e consentimento.",
        body: "Selecione a paciente, registre as autorizações e escolha como preparar a consulta. Áudio e observações permanecem associados ao mesmo prontuário.",
        proof: "Consentimento e próxima ação visíveis no atendimento",
        alt: "Tela real do MedChina para preparar a gravação da consulta e registrar o consentimento",
      },
      anamnese: {
        label: "Anamnese",
        title: "A conversa encontra a estrutura clínica.",
        body: "Queixa principal, história atual e demais campos ficam reunidos em uma anamnese clara para sua revisão — sem transformar silêncio em resposta.",
        proof: "Campos estruturados, editáveis e prontos para revisão",
        alt: "Tela real da anamnese estruturada no prontuário MedChina",
      },
      plano: {
        label: "Plano e evolução",
        title: "Você valida a conduta e acompanha o que mudou.",
        body: "O plano terapêutico permanece editável e conectado ao histórico. A plataforma prepara o próximo passo; você revisa, ajusta e decide.",
        proof: "Plano terapêutico validado pela profissional",
        alt: "Tela real do MedChina com gravação da consulta e validação do plano terapêutico",
      },
    },
  },

  presence: {
    eyebrow: "Presença clínica",
    title: "A tecnologia fica nos bastidores.\n**O vínculo continua no centro.**",
    lead: "A consulta em MTC exige escuta, observação e leitura individual. O MedChina reduz o esforço operacional para que você revise apenas o que exige sua decisão.",
    railLabel: "O que muda na prática",
    railHint: "Explore os benefícios",
    principle: "__Sem automação invisível.__ A profissional revisa, ajusta e valida cada etapa.",
    benefits: [
      {
        id: "listen",
        title: "Esteja na consulta, não no formulário",
        body: "Use a captação mobile e os comandos de voz para reduzir a digitação durante o atendimento.",
      },
      {
        id: "fields",
        title: "A conversa encontra o campo certo",
        body: "Sintomas, hábitos, emoções, medicamentos, exames e evolução chegam organizados à sua revisão.",
      },
      {
        id: "history",
        title: "Veja o que mudou",
        body: "Compare relatos, sintomas, técnicas e respostas ao longo do acompanhamento.",
      },
      {
        id: "hypotheses",
        title: "Hipóteses explicadas",
        body: "No Pro, padrões possíveis mostram sinais favoráveis, contradições, dados ausentes e referências.",
      },
      {
        id: "plan",
        title: "Do padrão ao plano",
        body: "Protocolos, orientações e minutas são organizados sem fazer você recomeçar do zero.",
      },
      {
        id: "decision",
        title: "A decisão continua sua",
        body: "Nada é finalizado automaticamente. Você edita, rejeita, valida e assina.",
      },
    ],
    visualAria: "Presença clínica apoiada pelo MedChina",
    visualAlt: "Profissional de Medicina Tradicional Chinesa escutando uma paciente durante a consulta",
    visualTag: "Atendimento em foco",
    proofTitle: "Escuta preservada",
    proofDetail: "Menos tela durante a consulta",
    focusLabel: "Em foco agora",
    focusAiOrganizes: "A IA organiza",
    focusYouValidate: "Você valida",
  },

  mobile: {
    eyebrow: "MedChina Mobile",
    title: "Seu celular capta a consulta. **A plataforma organiza o atendimento.**",
    lead: "O aplicativo mobile facilita a gravação autorizada e o registro de observações por voz. Na web, você revisa a anamnese, a análise e o plano terapêutico.",
    checks: [
      "Consultas do dia e seleção segura do paciente",
      "Consentimento antes de gravar",
      "Pausar, retomar e registrar observações",
      "Língua, pulso e palpação por voz",
    ],
    offlineTitle: "Conexão instável não significa consulta perdida.",
    offlineDetail: "O áudio fica preservado e é enviado quando a conexão voltar.",
    showcaseAria: "Demonstração interativa do aplicativo MedChina",
    deviceAlt: "Smartphone moderno com o aplicativo MedChina",
    platformChipAria: "Aplicativo para iOS e Android",
    platformChipLabel: "iOS e Android",
    bubblesAria: "Destaques do aplicativo",
    highlights: [
      {
        id: "consent",
        label: "Consentimento ativo",
        title: "Gravação protegida",
        detail: "A autorização fica vinculada à consulta antes da captação.",
      },
      {
        id: "voice",
        label: "Observação por voz",
        title: "Contexto sem digitação",
        detail: "Língua, pulso e notas clínicas entram durante o atendimento.",
      },
      {
        id: "sync",
        label: "Sincronização segura",
        title: "Áudio preservado",
        detail: "O envio é confirmado antes de remover a cópia do aparelho.",
      },
    ],
    /** The phone mock is a fictitious session (docs/DESIGN.md: never real data). */
    phone: {
      secure: "Protegido",
      inProgress: "CONSULTA EM ANDAMENTO",
      patientName: "Helena Martins",
      patientKind: "Retorno · Acupuntura",
      patientWhen: "Hoje, 09:00 · consentimento confirmado",
      recording: "GRAVANDO",
      paused: "PAUSADA",
      audioAuthorized: "Áudio autorizado",
      resume: "Retomar",
      pause: "Pausar",
      noteAdded: "Nota adicionada",
      addNote: "Adicionar nota",
      noteHint: "por voz ou texto",
      observation: "Língua e pulso",
      observationHint: "registrar observação",
      tabConsult: "Consulta",
      tabHistory: "Histórico",
      tabRecord: "Prontuário",
    },
  },

  supervised: {
    eyebrow: "IA supervisionada",
    title: "A anamnese é preenchida sem transformar **ausência em resposta.**",
    lead: "O MedChina organiza as informações relatadas, preserva a origem de cada dado e mantém em branco o que não foi informado.",
    conversation: {
      sourceLabel: "Fonte clínica",
      title: "Conversa fictícia · Helena Martins",
      time: "14:32–14:46",
      quote:
        "“Tenho acordado umas ==três vezes durante a noite==. Sinto ==muito calor== e às vezes acordo ==suando==.”",
      playAria: "Ouvir trecho",
      pauseAria: "Pausar trecho",
      playingLabel: "Reproduzindo trecho",
      originalLabel: "Trecho original",
      speaker: "Paciente · áudio autorizado",
      duration: "0:14",
    },
    bridgeLabel: "IA organiza",
    prepared: {
      badge: "Organização supervisionada",
      title: "Anamnese preparada",
      summary: "3 campos organizados · nenhuma decisão aplicada",
      reviewChip: "Revisão obrigatória",
      listen: "Ouvir origem",
      noEvidence: "Sem evidência registrada no áudio",
      fields: [
        {
          id: "sleep",
          label: "Sono",
          value: "Desperta aproximadamente três vezes durante a noite.",
          state: "Evidência clara",
        },
        {
          id: "evolution",
          label: "Evolução",
          value: "Frequência relatada; início e evolução temporal ainda não informados.",
          state: "Requer atenção",
        },
        {
          id: "observation",
          label: "Língua e pulso",
          value: "Aguardando observação direta da profissional.",
          state: "Não informado",
        },
      ],
      footerTitle: "Nada foi finalizado automaticamente",
      footerDetail: "Você revisa, ajusta e confirma antes de salvar no prontuário.",
    },
    traceability: [
      { id: "origin", title: "Origem recuperável", detail: "Cada campo mantém vínculo com o trecho correspondente." },
      {
        id: "authorship",
        title: "Autoria preservada",
        detail: "Paciente, profissional, IA e decisão nunca se confundem.",
      },
      { id: "validation", title: "Validação explícita", detail: "O prontuário só avança depois da sua revisão." },
    ],
  },

  mtc: {
    eyebrow: "Especialização",
    title: "Um prontuário construído para a lógica da **Medicina Tradicional Chinesa.**",
    lead: "Em vez de adaptar sua consulta a um prontuário genérico, o MedChina organiza a avaliação segundo os elementos da prática da MTC.",
    quote: "“Use os modelos do MedChina, personalize sua anamnese e mantenha seu próprio modo de atender.”",
    categories: [
      "Queixa principal",
      "Sono e energia",
      "Alimentação e digestão",
      "Emoções e contexto",
      "Yin e Yang",
      "Qi, Sangue e Líquidos",
      "Zang-Fu",
      "Cinco Elementos",
      "Língua",
      "Pulso",
      "Acupuntura",
      "Auriculoterapia",
    ],
  },

  security: {
    eyebrow: "Segurança",
    title: "Dados clínicos exigem mais do que conveniência. **Exigem controle.**",
    lead: "Segurança, rastreabilidade e minimização integradas ao fluxo clínico — do consentimento ao histórico de alterações.",
    cards: [
      {
        id: "consent",
        title: "Consentimento separado",
        body: "Gravação, transcrição, IA e imagens podem ter autorizações específicas e versionadas.",
      },
      {
        id: "access",
        title: "Acesso protegido",
        body: "Autenticação em dois fatores, gestão de sessões, criptografia e registros de acesso.",
      },
      {
        id: "audio",
        title: "Áudio sob controle",
        body: "A cópia local só é removida após a confirmação segura do envio.",
      },
      {
        id: "history",
        title: "Histórico de alterações",
        body: "Finalizações, edições e adendos permanecem rastreáveis, com autoria, data e versão.",
      },
    ],
  },

  pricing: {
    eyebrow: "Planos transparentes",
    title: "Comece no seu ritmo.\n**Automatize quando fizer sentido.**",
    lead: "Uma base clínica completa para começar e dois níveis de automação supervisionada para ganhar tempo sem abrir mão da decisão.",
    trustAria: "Condições para começar",
    trust: ["Conta gratuita para começar", "Trial Pro iniciado por você", "Sem cartão ou cobrança automática"],
    /**
     * How each tier is PRESENTED — everything commercial (name, description,
     * price, period, what is included) still comes from the database through
     * `getDisplayPlans`. A slug with no entry renders plainly, with no badge,
     * so adding a plan can never blank out the pricing section.
     */
    plans: {
      gratuito: { eyebrow: "Fundação clínica", badge: "Comece aqui", cta: "Criar conta grátis" },
      assistente: { eyebrow: "Documentação automática", badge: "Mais escolhido", cta: "Começar com automação" },
      pro: { eyebrow: "Inteligência supervisionada", badge: "Mais completo", cta: "Conhecer o Pro" },
    },
    defaultEyebrow: "Plano",
    defaultCta: "Criar conta grátis",
    /**
     * A seção quando a campanha assume a home (`show_on_home` em
     * /admin/billing → Ofertas). O gratuito e o trial saem dos cards, então o
     * texto em volta deles também precisa sair: a linha e os selos de confiança
     * do catálogo vendem conta gratuita e "sem cartão", exatamente o oposto do
     * que estes cards fazem. O que fica no lugar é derivado de dado real — a
     * garantia da própria configuração, o prazo da própria oferta.
     */
    offerEyebrow: "Condição de campanha",
    offerCta: "Assinar agora",
    offerTitle: "A condição desta campanha.\n**Pelo preço desta página, enquanto ela estiver aberta.**",
    offerLead:
      "A conta gratuita e o teste do Pro continuam existindo — eles só não são o caminho daqui. Nesta página você assina direto o plano que quer.",
    offerTrustAria: "Condições desta oferta",
    offerTrustGuarantee: "{days} dias de garantia",
    offerTrustDeadline: "Condição válida até {date}",
    offerAssuranceTitle: "{days} dias de garantia.",
    offerAssuranceDetail:
      "Se não fizer sentido para a sua prática, você pede o reembolso em até {days} dias e recebe o valor de volta.",
    /**
     * A promoção com data (migração 0126, hoje a Black Friday): a faixa no
     * topo da home e o cartão do plano dela na seção de preços. Os valores
     * entre chaves vêm da própria promoção e do plano — nada aqui é número.
     */
    promoStripAria: "Promoção em andamento",
    promoStrip: "__{label}__ · {plan} a {price} por mês nos {cycles} primeiros meses · até {date}",
    promoStripCta: "Ver a oferta",
    promoTitle: "{label} no MedChina.\n**{plan} a {price} por mês nos {cycles} primeiros meses.**",
    promoLead:
      "Uma condição com data para acabar e com o valor de cada mês decidido no dia em que você assina. A conta gratuita continua existindo; aqui você assina direto o {plan}.",
    promoEyebrow: "{label}",
    promoDiscount: "{value}% off nos {cycles} primeiros meses",
    promoCta: "Assinar o {plan} na {label}",
    promoLadderTitle: "Valor de cada mês",
    promoLadderRange: "Meses {from} a {to}: {price} por mês",
    promoLadderOpen: "A partir do mês {from}: {price} por mês",
    promoCondition: "Hoje você paga {price}. Mensal, sem fidelidade: cancele quando quiser pelo painel.",
    /**
     * Enquanto a promoção está aberta, os chamados da home (cabeçalho, topo,
     * dúvidas e fim) levam à oferta; a conta gratuita continua a um link.
     */
    promoCtaShort: "Ver a oferta da {label}",
    promoHeroNote: "{plan} a {price} por mês nos {cycles} primeiros meses · até {date}",
    promoFreeLink: "Ainda não vai assinar? Crie uma conta gratuita",
    promoFinalEyebrow: "{label} · até {date}",
    promoFinalTitle:
      "{plan} a {price} por mês nos {cycles} primeiros meses. **Se não fizer sentido, você tem {days} dias.**",
    promoFinalBullets: [
      "{days} dias de garantia",
      "Sem fidelidade: cancele pelo painel",
      "Seus dados exportáveis a qualquer momento",
    ],
    included: "O que está incluído",
    assuranceTitle: "Você começa a testar quando começa a trabalhar.",
    assuranceDetail:
      "O trial Pro é ativado na sua primeira ação de trabalho — gravar, agendar, importar ou usar a biblioteca — e avisamos na hora. Nada é cobrado automaticamente.",
    assuranceLink: "Tirar dúvidas",
  },

  faq: {
    eyebrow: "Dúvidas",
    title: "Perguntas frequentes",
    lead: "As respostas mais importantes sobre o plano gratuito, o trial e o papel da inteligência artificial.",
    cta: "Começar gratuitamente",
    items: [
      {
        question: "Posso usar o MedChina gratuitamente?",
        answer:
          "Sim. O plano Gratuito permite cadastrar pacientes, registrar consultas e usar os recursos clínicos manuais sem limite de pacientes ou prontuários. Gravação, transcrição e automação fazem parte dos planos pagos e do trial Pro.",
      },
      {
        question: "O trial começa quando eu criar minha conta?",
        answer:
          "Não. Criar a conta, configurar o perfil e explorar a plataforma não consomem nada. O trial Pro começa automaticamente na sua primeira ação de trabalho — gravar uma consulta, agendar um atendimento, importar seus prontuários ou usar a biblioteca clínica — e avisamos na hora em que isso acontece.",
      },
      {
        question: "Preciso cadastrar um cartão para testar o Pro?",
        answer: "Não. O trial não exige cartão e não gera cobrança automática.",
      },
      {
        question: "A IA toma decisões clínicas por mim?",
        answer:
          "Não. A IA organiza informações, aponta lacunas e, no Pro, prepara hipóteses e possibilidades terapêuticas. A revisão, a validação e a decisão final continuam com a profissional.",
      },
      {
        question: "A IA inventa respostas para campos não mencionados?",
        answer:
          "O que não foi informado permanece em branco — ausência nunca vira negação. Campos ambíguos ou contraditórios são destacados, e cada informação extraída pode ser relacionada ao trecho da consulta.",
      },
      {
        question: "O aplicativo mobile substitui a versão web?",
        answer:
          "Não. O aplicativo é complementar, focado em captação de áudio, comandos por voz e acompanhamento do processamento. A revisão completa, os planos e as configurações ficam na web.",
      },
      {
        question: "Meus dados serão usados para treinar modelos públicos?",
        answer:
          "A política do MedChina proíbe o uso de informações clínicas para treinar modelos públicos. Detalhes sobre fornecedores, retenção e processamento ficam na documentação de privacidade.",
      },
    ],
  },

  finalCta: {
    eyebrow: "Seu próximo atendimento pode começar diferente",
    title: "Mais presença para cuidar. **Mais clareza para decidir.**",
    lead: "Organize seus pacientes, conheça os recursos clínicos e ative a automação apenas quando fizer sentido para você.",
    ctaPrimary: "Criar minha conta gratuita",
    ctaSecondary: "Ver como funciona",
    bullets: ["Prontuários ilimitados", "Trial iniciado por você", "Sem cobrança automática"],
  },

  footer: {
    tagline: "Prontuário e apoio ao raciocínio clínico para Medicina Tradicional Chinesa.",
    productTitle: "Produto",
    accountTitle: "Conta",
    companyTitle: "Empresa",
    signUp: "Começar gratuitamente",
    helpCenter: "Central de ajuda",
    about: "Sobre",
    contact: "Contato",
    privacy: "Privacidade",
    rights: "© 2026 MedChina. Todos os direitos reservados.",
    disclaimer:
      "O MedChina não substitui avaliação profissional, exame físico, observação da língua, palpação do pulso, análise de contraindicações ou encaminhamento quando necessário.",
  },
};

export type HomeCopy = typeof homeCopyPtBR;
