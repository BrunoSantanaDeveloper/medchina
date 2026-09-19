/**
 * Pitch deck for the NVIDIA Inception application (`/pitch`).
 *
 * The program asks for a deck that states the mission, the solution and the
 * competitive market value, from a company that is incorporated, under ten
 * years old, not public, employs at least one developer and keeps a live site.
 * Everything here answers one of those.
 *
 * **Every number on these slides is one the congress deck already carries**
 * (`components/presentation/slides-data.ts`) or comes from the product's own
 * documentation — the survey of February 2021 (3.800 respondents), the platform
 * totals, the clinical library count, the published plan prices. A pitch is
 * read by people who check, and a number invented here would be the cheapest
 * possible way to lose the application.
 *
 * Portuguese only: the program page this targets is the Brazilian one. An
 * English pass is a translation of this file, nothing structural.
 */

export interface PitchSlide {
  key: string;
  kicker: string;
  title: string;
  subtitle?: string;
}

export interface PitchStat {
  value: string;
  label: string;
  note?: string;
  tone?: "primary" | "secondary" | "jade";
}

export interface PitchCard {
  title: string;
  body: string;
}

export interface PitchStep {
  index: string;
  title: string;
  body: string;
}

/* ------------------------------------------------------------------ */
/* Cover                                                               */
/* ------------------------------------------------------------------ */

export const COVER = {
  product: "MedChina",
  line: "Prontuário clínico e assistente de IA para Medicina Tradicional Chinesa",
  claim: "A consulta é oral. O registro, até hoje, era manual.",
  facts: [
    { label: "Sede", value: "Brasil" },
    { label: "Fundação", value: "2021" },
    { label: "Site", value: "medchinaprontuarios.com.br" },
    { label: "Time", value: "2 sócios · engenharia própria" },
  ],
};

/* ------------------------------------------------------------------ */
/* 02 · the problem                                                    */
/* ------------------------------------------------------------------ */

export const PROBLEM_CARDS: PitchCard[] = [
  {
    title: "Quem digita, não olha",
    body: "A medicina chinesa se faz observando, ouvindo, perguntando e palpando. Cada minuto no teclado é um minuto fora do paciente.",
  },
  {
    title: "Uma sessão por semana",
    body: "No Brasil o atendimento é semanal, não diário como na China. Sete dias depois, reconstruir a consulta de memória é o normal da profissão.",
  },
  {
    title: "Nenhum software falava a língua da clínica",
    body: "Prontuários genéricos não têm anamnese energética, língua e pulso, padrões, pontos e meridianos. Sobrou a ficha de papel.",
  },
];

/** The February 2021 survey, over the 3.800 professionals of our own congress. */
export const PROBLEM_SURVEY: { label: string; value: string; percent: number; highlight?: boolean }[] = [
  { label: "Registravam os atendimentos de alguma forma", value: "77%", percent: 77 },
  { label: "Queriam um prontuário eletrônico dedicado", value: "72,7%", percent: 72.7 },
  { label: "Queriam um sistema de gestão do consultório", value: "90,9%", percent: 90.9 },
  { label: "Usavam algum prontuário eletrônico", value: "6,8%", percent: 6.8, highlight: true },
];

export const PROBLEM_NOTE =
  "Demanda declarada por quase todos, atendida por quase ninguém: essa distância é o mercado. Pesquisa de fevereiro de 2021, base de 3.800 profissionais do nosso congresso.";

/* ------------------------------------------------------------------ */
/* 03 · why now                                                        */
/* ------------------------------------------------------------------ */

export const WHY_NOW_STATS: PitchStat[] = [
  {
    value: "12/01/2026",
    label: "Lei 15.345 sancionada",
    note: "A profissão de acupunturista passa a ser regulamentada no Brasil, depois de 22 anos de tramitação.",
    tone: "primary",
  },
  {
    value: "370 mil",
    label: "Profissionais de medicina chinesa no país",
    note: "Estimativa das entidades do setor. Não havia registro profissional único antes da lei.",
    tone: "secondary",
  },
  {
    value: "20 a 35 mi",
    label: "Brasileiros já tratados com acupuntura",
    note: "Quatro décadas de difusão, entre o SUS e o setor privado.",
    tone: "jade",
  },
];

export const WHY_NOW_NOTE =
  "Com a regulamentação, o registro clínico deixa de ser uma escolha pessoal e passa a ser um dever profissional. A obrigação chega antes de existir uma ferramenta feita para ela.";

/* ------------------------------------------------------------------ */
/* 04 · the solution                                                   */
/* ------------------------------------------------------------------ */

export const SOLUTION_STEPS: PitchStep[] = [
  {
    index: "01",
    title: "Captura",
    body: "Com o consentimento do paciente registrado, o celular ou o computador grava a consulta. Offline não interrompe: a gravação fica cifrada no aparelho e sobe sozinha quando a conexão volta.",
  },
  {
    index: "02",
    title: "Transcrição com diarização",
    body: "O áudio vira texto com quem falou e o minuto exato. A cobertura é conferida contra a duração da gravação: transcrição que parou no meio é retomada.",
  },
  {
    index: "03",
    title: "Anamnese estruturada",
    body: "Uma segunda leitura preenche apenas campos de uma lista fechada, cada valor com a frase de origem, o minuto e o falante. Lacunas viram perguntas, nunca respostas.",
  },
  {
    index: "04",
    title: "Raciocínio clínico",
    body: "Sob solicitação: hipóteses de padrões de desarmonia com sinais a favor, sinais contra e o que falta investigar; e o rascunho do plano terapêutico por modalidade.",
  },
];

export const SOLUTION_NOTE =
  "Tudo chega como rascunho. Nada entra no prontuário como fato antes de a profissional revisar, editar e validar.";

/* ------------------------------------------------------------------ */
/* 05 · product                                                        */
/* ------------------------------------------------------------------ */

export const PRODUCT_SHOTS: { src: string; alt: string; caption: string }[] = [
  {
    src: "/images/agenda-preparar-atendimento.jpg",
    alt: "Tela da agenda do MedChina com o preparo do atendimento",
    caption: "Antes · a agenda entrega o resumo pronto do paciente",
  },
  {
    src: "/images/audio-capta-mobile.jpg",
    alt: "Captura de áudio da consulta no aplicativo MedChina",
    caption: "Durante · o celular vira o gravador clínico",
  },
  {
    src: "/images/anamnese-automatica.jpg",
    alt: "Anamnese preenchida automaticamente com a origem de cada campo",
    caption: "Depois · a anamnese chega preenchida e rastreável",
  },
];

export const PRODUCT_NOTE =
  "Produto em produção, não protótipo: web completa, aplicativo companheiro para captura, prontuário, agenda, biblioteca clínica e documentos assinados com verificação por QR.";

/* ------------------------------------------------------------------ */
/* 06 · why it is trusted                                              */
/* ------------------------------------------------------------------ */

export const TRUST_CARDS: PitchCard[] = [
  {
    title: "A citação é conferida na transcrição",
    body: "Todo valor traz a frase, o minuto e quem falou. O software procura essa frase no áudio transcrito: se não estiver lá, o valor é marcado como não confirmado.",
  },
  {
    title: "Exame só vale na voz do profissional",
    body: "Língua, pulso, palpação e padrão só entram quando ditados por ele. Achado atribuído à fala do paciente é descartado, não registrado.",
  },
  {
    title: "Silêncio nunca vira registro",
    body: "Ausência de dado jamais é escrita como negação. O campo permanece vazio, marcado como não informado.",
  },
  {
    title: "Tema sensível sempre volta para conferência",
    body: "Medicamentos, gestação, anticoagulantes, marca-passo, cirurgias, alergias e lesões são marcados para revisão, seja qual for a leitura do modelo.",
  },
];

export const TRUST_NOTE =
  "São garantias verificadas em código depois que o modelo responde, não instruções dadas a ele. É o que separa um assistente clínico de um gerador de texto — e o que um conselho profissional vai perguntar primeiro.";

/* ------------------------------------------------------------------ */
/* 07 · the stack                                                      */
/* ------------------------------------------------------------------ */

export const STACK_ROWS: { term: string; body: string }[] = [
  {
    term: "Inferência",
    body: "Transcrição com diarização e extração estruturada por LLM, atrás de uma interface de provedor — o modelo é trocável sem tocar no produto. O custo por consulta é a unidade econômica do negócio.",
  },
  {
    term: "Recuperação",
    body: "RAG com pgvector sobre acervo curado de medicina chinesa: 459 documentos de fontes tradicionais, mais os protocolos da própria profissional. Citação que não resolve em trecho recuperado é descartada.",
  },
  {
    term: "Dado clínico",
    body: "Postgres multi-tenant com RLS, trilha de auditoria imutável, consentimento versionado por finalidade e prontuário congelado após finalização. Nenhum áudio ou conteúdo clínico treina modelo público.",
  },
  {
    term: "Operação",
    body: "Next.js na Vercel, Supabase, jobs assíncronos com fallback inline, aplicativo Expo para captura. Time de engenharia próprio, sem terceirização.",
  },
];

/* ------------------------------------------------------------------ */
/* 08 · market                                                         */
/* ------------------------------------------------------------------ */

export const MARKET_STATS: PitchStat[] = [
  {
    value: "370 mil",
    label: "Profissionais no Brasil",
    note: "Mercado endereçável total.",
    tone: "primary",
  },
  {
    value: "6,8%",
    label: "Usavam prontuário eletrônico",
    note: "O restante é conversão a partir do papel, não troca de fornecedor.",
    tone: "secondary",
  },
  {
    value: "R$ 199–299",
    label: "Assinatura mensal por profissional",
    note: "Assistente e Pro, preços públicos vigentes.",
    tone: "jade",
  },
];

export const MARKET_SCENARIOS: { share: string; base: string; arr: string }[] = [
  { share: "1%", base: "3.700 assinantes", arr: "R$ 8,8 mi / ano" },
  { share: "3%", base: "11.100 assinantes", arr: "R$ 26,5 mi / ano" },
  { share: "5%", base: "18.500 assinantes", arr: "R$ 44,2 mi / ano" },
];

export const MARKET_NOTE =
  "Cenários de penetração sobre a base estimada, a R$ 199 por mês — não são projeção de receita. O concorrente real não é outro software: é a ficha de papel.";

/* ------------------------------------------------------------------ */
/* 09 · traction                                                       */
/* ------------------------------------------------------------------ */

export const TRACTION_STATS: PitchStat[] = [
  { value: "1.046", label: "Profissionais cadastrados", note: "Base da primeira geração do produto.", tone: "primary" },
  { value: "222", label: "Assinaturas pagas", note: "Antes de existir qualquer recurso de IA.", tone: "secondary" },
  {
    value: "3.800",
    label: "Profissionais no nosso congresso",
    note: "Canal próprio desde 2020, sem mídia paga.",
    tone: "jade",
  },
];

export const TRACTION_TIMELINE: PitchStep[] = [
  {
    index: "2020",
    title: "Comunidade",
    body: "1º Congresso Práticas da Sabedoria Milenar, online e gratuito. Financiou o desenvolvimento.",
  },
  {
    index: "2021",
    title: "Produto",
    body: "Primeira versão com a lógica da medicina chinesa. Mil usuários no plano gratuito em um ano, sem propaganda.",
  },
  {
    index: "2026",
    title: "IA em produção",
    body: "Nova geração completa: captura, transcrição, anamnese rastreável, hipóteses, plano e biblioteca clínica.",
  },
];

/* ------------------------------------------------------------------ */
/* 10 · business model                                                 */
/* ------------------------------------------------------------------ */

export const PLANS: { name: string; price: string; body: string; accent?: boolean }[] = [
  {
    name: "Gratuito",
    price: "R$ 0",
    body: "Prontuário manual completo, pacientes e registros ilimitados, para sempre. É a porta de entrada e a nossa missão.",
  },
  {
    name: "Assistente",
    price: "R$ 199/mês",
    body: "3.000 minutos de áudio por ciclo: captura, transcrição e anamnese preenchida com procedência.",
    accent: true,
  },
  {
    name: "Pro",
    price: "R$ 299/mês",
    body: "6.000 minutos, raciocínio clínico, plano terapêutico e revisão de caso na biblioteca.",
  },
];

export const MODEL_NOTE =
  "A unidade cobrada é o minuto de áudio processado, medida no servidor e registrada em razão própria. Isso amarra preço a custo de inferência — e é exatamente onde ganho de eficiência vira margem.";

/* ------------------------------------------------------------------ */
/* 11 · team                                                           */
/* ------------------------------------------------------------------ */

export const TEAM: { name: string; role: string; body: string; photo: string; monogram: string }[] = [
  {
    name: "Debora Giovanella",
    role: "Fundadora · Direção clínica",
    body: "Terapeuta de medicina chinesa desde 2017, com formação em shiatsu e acupuntura, e 25 anos em gestão de marketing e vendas. Idealizadora do congresso que originou a comunidade. Conduz a visão clínica do produto.",
    photo: "/images/palestra/fundadora-debora.jpg",
    monogram: "DG",
  },
  {
    name: "Bruno Santana",
    role: "Sócio · Engenharia",
    body: "Engenheiro de software com mais de 15 anos de experiência e especialista em inteligência artificial aplicada. Lidera toda a tecnologia: arquitetura de IA sob regras clínicas estritas e conformidade com a LGPD.",
    photo: "/images/palestra/fundador-bruno.jpg",
    monogram: "BS",
  },
];

/* ------------------------------------------------------------------ */
/* 12 · the ask                                                        */
/* ------------------------------------------------------------------ */

export const ASK_CARDS: PitchCard[] = [
  {
    title: "Custo por consulta",
    body: "O preço do plano é governado pelo custo de inferência do minuto de áudio. Servir modelos próprios com TensorRT-LLM e NIM ataca diretamente a margem.",
  },
  {
    title: "Soberania do dado clínico",
    body: "Dado de saúde sob LGPD tem restrição de trânsito e de retenção. Rodar transcrição e raciocínio em infraestrutura que controlamos vira requisito de venda.",
  },
  {
    title: "Um modelo que fala medicina chinesa",
    body: "Temos o acervo curado, os protocolos e o corpus clínico anotado com procedência. Falta a esteira para treinar e avaliar um modelo de domínio em português.",
  },
  {
    title: "Fala de consultório, não de estúdio",
    body: "Consultas de 50 minutos, dois falantes, ruído real e termos técnicos: diarização e ASR de domínio são o gargalo de qualidade do produto.",
  },
];

export const ASK_NOTE =
  "Pedimos ao Inception: créditos de nuvem, as SDKs para essa esteira, orientação técnica e a rede do Inception Capital Connect.";

export const ELIGIBILITY: string[] = [
  "Constituída em 2021 · CNPJ ativo",
  "Site em operação",
  "Engenharia própria no time",
  "Menos de 10 anos · capital fechado",
  "Não é consultoria, cripto, nuvem nem revenda",
];

/* ------------------------------------------------------------------ */
/* The deck                                                            */
/* ------------------------------------------------------------------ */

export const PITCH_SLIDES: PitchSlide[] = [
  { key: "cover", kicker: "NVIDIA Inception · candidatura", title: "MedChina" },
  {
    key: "problem",
    kicker: "O problema",
    title: "A profissão registra no papel — quando registra",
    subtitle: "Pesquisa com 3.800 profissionais de medicina chinesa, fevereiro de 2021",
  },
  {
    key: "why-now",
    kicker: "Por que agora",
    title: "Uma profissão inteira acabou de ser regulamentada",
    subtitle: "O registro clínico deixou de ser hábito pessoal e virou dever profissional",
  },
  {
    key: "solution",
    kicker: "A solução",
    title: "O prontuário que escuta a consulta",
    subtitle: "Da fala ao prontuário estruturado, com a origem de cada informação",
  },
  {
    key: "product",
    kicker: "Produto",
    title: "Em produção, com clientes pagantes",
    subtitle: "Web completa, aplicativo de captura e documentos verificáveis",
  },
  {
    key: "trust",
    kicker: "O diferencial defensável",
    title: "Quatro garantias verificadas em código",
    subtitle: "Depois que o modelo responde, é o software que confere o resultado",
  },
  {
    key: "stack",
    kicker: "Arquitetura",
    title: "Onde a IA entra, e onde ela é contida",
    subtitle: "Inferência trocável, recuperação citada, dado clínico isolado",
  },
  {
    key: "market",
    kicker: "Mercado",
    title: "370 mil profissionais, 6,8% informatizados",
    subtitle: "O concorrente a bater é o papel",
  },
  {
    key: "traction",
    kicker: "Tração",
    title: "Comunidade antes do produto, produto antes da IA",
    subtitle: "Cada etapa financiou a seguinte",
  },
  {
    key: "model",
    kicker: "Modelo de negócio",
    title: "Freemium com o minuto de áudio como unidade",
    subtitle: "O que se paga é a automação, não o prontuário",
  },
  {
    key: "team",
    kicker: "Time",
    title: "Clínica e engenharia, na mesma mesa",
    subtitle: "Quem atende define o produto; quem constrói responde pela IA",
  },
  {
    key: "ask",
    kicker: "O pedido",
    title: "Por que o NVIDIA Inception",
    subtitle: "Quatro frentes em que a plataforma da NVIDIA muda a economia do produto",
  },
];
