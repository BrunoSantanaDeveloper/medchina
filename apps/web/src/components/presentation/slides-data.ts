import { Bi, GalleryFrame, SlideData } from "./types";

/**
 * Content for the Xinjiang congress deck.
 *
 * Fidelity rules, learned from an audit against the roteiro:
 *
 * - `script` follows `attachments/Discurso_MedChina_AI_China_14_minutos.docx.md`
 *   near-verbatim. It is the teleprompter: if a sentence is not here, Debora
 *   will not say it on stage.
 * - Nothing on a slide claims more than the roteiro claims. No superlatives the
 *   material does not support, no security guarantees the product cannot give,
 *   and no AI promise that contradicts the product's own safety language (the
 *   AI prepares drafts; the professional decides).
 * - The ethical disclaimer is quoted VERBATIM in one place only
 *   (`ETHICAL_DISCLAIMER`), because the roteiro has Debora read it aloud.
 * - Every projected string is bilingual. The speaker's language is Portuguese;
 *   the room's language is Chinese.
 */

/**
 * Slide 16's fixed clause, verbatim from the roteiro (§"contrato ético") and
 * from the product's own screens. Do not paraphrase or shorten it: Debora reads
 * it out loud, and the phrase is the product's safety contract.
 */
export const ETHICAL_DISCLAIMER: Bi = {
  pt: "Esta sugestão é um apoio ao raciocínio clínico e não substitui avaliação profissional, exame físico, observação da língua, palpação do pulso, análise de contraindicações ou encaminhamento quando necessário.",
  zh: "此建议仅为临床推理的辅助，不能替代专业评估、体格检查、舌象观察、脉诊、禁忌症分析，以及必要时的转诊。",
};

/** Public contact shown on the closing slide, and the target of the printed QR. */
export const CONTACT = {
  /** Confirm before the talk — the repo has no NEXT_PUBLIC_SITE_URL committed. */
  site: "medchinaprontuarios.com.br",
  siteUrl: "https://medchinaprontuarios.com.br",
  email: "contato@medchinaprontuarios.com.br",
  city: { pt: "Goiânia, GO · Brasil", zh: "巴西 · 戈亚斯州 · 戈亚尼亚" } as Bi,
  qrCode: "/images/palestra/qr-medchina.svg",
};

/* ------------------------------------------------------------------ */
/* Slide 2 · founders                                                  */
/* ------------------------------------------------------------------ */

export interface FounderCard {
  name: string;
  role: Bi;
  line: Bi;
  /** Drop a real photo here and it replaces the monogram. */
  photo: string;
  monogram: string;
  accent: "primary" | "secondary";
  facts: Bi[];
}

export const FOUNDERS: FounderCard[] = [
  {
    name: "Debora Giovanella",
    role: { pt: "Fundadora · Terapeuta de MTC", zh: "创始人 · 中医治疗师" },
    line: {
      pt: "Terapeuta desde 2017 · 25 anos em gestão de marketing e vendas",
      zh: "2017年起执业 · 25年市场与销售管理经验",
    },
    photo: "/images/palestra/fundadora-debora.webp",
    monogram: "DG",
    accent: "primary",
    facts: [
      {
        pt: "Formação em shiatsu (2017) e em acupuntura (2018–2019)",
        zh: "指压疗法（2017）与针灸（2018–2019）专业训练",
      },
      {
        pt: "Idealizadora do 1º Congresso Práticas da Sabedoria Milenar (2020)",
        zh: "首届“千年智慧实践”大会发起人（2020）",
      },
      { pt: "Conduz a visão clínica do produto", zh: "主导产品的临床方向" },
    ],
  },
  {
    name: "Bruno Santana",
    role: { pt: "Sócio · Engenharia", zh: "合伙人 · 技术负责人" },
    line: { pt: "Engenheiro de software com 15 anos de experiência · TriboDEV", zh: "15年经验的软件工程师 · TriboDEV" },
    photo: "/images/palestra/fundador-bruno.webp",
    monogram: "BS",
    accent: "secondary",
    facts: [
      { pt: "Lidera toda a tecnologia do MedChina", zh: "全面负责 MedChina 的技术研发" },
      { pt: "Arquitetura de IA sob regras clínicas estritas e LGPD", zh: "在严格临床规则与巴西数据保护法下的AI架构" },
      { pt: "TriboDEV, a casa de desenvolvimento responsável pela plataforma", zh: "TriboDEV：负责平台开发的技术团队" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Slide 3 · two centuries timeline                                    */
/* ------------------------------------------------------------------ */

export interface TimelineEvent {
  year: string;
  label: Bi;
  body: Bi;
  emphasis?: boolean;
}

export const TIMELINE_EVENTS: TimelineEvent[] = [
  {
    year: "1808",
    label: { pt: "A corte portuguesa", zh: "葡萄牙王室迁抵" },
    body: {
      pt: "Primeiros relatos de acupunturistas vindos de Macau, com a corte de Dom João VI.",
      zh: "最早记载：随若昂六世王室自澳门抵达的针灸医者。",
    },
  },
  {
    year: "1812",
    label: { pt: "Plantações de chá", zh: "试验性茶园" },
    body: {
      pt: "A coroa autoriza a vinda de dois mil chineses para as plantações experimentais de chá no Rio de Janeiro.",
      zh: "王室批准两千名中国人赴里约热内卢的试验性茶园。",
    },
  },
  {
    year: "1958",
    label: { pt: "Ensino formal", zh: "正规教学的开端" },
    body: {
      pt: "Friedrich Spaeth começa a ensinar no Rio e em São Paulo. Nasce a Sociedade Brasileira de Acupuntura.",
      zh: "Friedrich Spaeth 在里约与圣保罗开班授课，巴西针灸学会成立。",
    },
  },
  {
    year: "2026",
    label: { pt: "Lei federal 15.345", zh: "第15345号联邦法律" },
    body: {
      pt: "Depois de 218 anos, a profissão de acupunturista é regulamentada no Brasil.",
      zh: "历经218年，针灸师职业在巴西获得法律规范。",
    },
    emphasis: true,
  },
];

export const TIMELINE_BARRIER: Bi = {
  pt: "Por mais de um século, a barreira foi o idioma: os mestres orientais não ensinavam em português. A técnica estava aqui; o conhecimento não circulava.",
  zh: "一个多世纪以来，语言是最大的障碍：东方医者无法用葡语授课。技术已在，知识却未流通。",
};

/* ------------------------------------------------------------------ */
/* Slide 4 · public health milestones                                  */
/* ------------------------------------------------------------------ */

export interface Milestone {
  year: string;
  label: Bi;
  body: Bi;
  emphasis?: boolean;
}

export const MILESTONES: Milestone[] = [
  {
    year: "1988",
    label: { pt: "Entrada no SUS", zh: "纳入公共卫生体系" },
    body: {
      pt: "A acupuntura chega à rede pública de saúde, restrita aos médicos.",
      zh: "针灸进入公立医疗网络，但仅限医师执业。",
    },
  },
  {
    year: "1995",
    label: { pt: "Especialidade médica", zh: "确认为医学专科" },
    body: {
      pt: "O Conselho Federal de Medicina reconhece a especialidade. Enfermagem, fisioterapia e biomedicina fazem o mesmo movimento em seus territórios.",
      zh: "联邦医学委员会确认其为专科；护理、理疗与生物医学委员会随后在各自领域作出同样认定。",
    },
  },
  {
    year: "2006",
    label: { pt: "PNPIC", zh: "PNPIC 国家政策" },
    body: {
      pt: "A Política Nacional de Práticas Integrativas abre o sistema público aos profissionais não médicos.",
      zh: "《国家整合与补充医疗实践政策》向非医师专业人员开放公立系统。",
    },
    emphasis: true,
  },
  {
    year: "2018",
    label: { pt: "Prática multiprofissional", zh: "多专业实践确立" },
    body: {
      pt: "A acupuntura é consolidada oficialmente como prática multiprofissional no SUS.",
      zh: "针灸在公共卫生体系中正式确立为多专业实践。",
    },
  },
];

export const MILESTONES_NOTE: Bi = {
  pt: "Quase três décadas de disputas nos tribunais em torno de uma única pergunta: quem pode segurar a agulha?",
  zh: "近三十年的司法争讼，只围绕一个问题：谁可以持针？",
};

/* ------------------------------------------------------------------ */
/* Slide 5 · the scale in Brazil                                       */
/* ------------------------------------------------------------------ */

export interface StatCard {
  value: Bi;
  label: Bi;
  note: Bi;
  tone?: "primary" | "secondary" | "jade";
  wide?: boolean;
  /** A part-to-whole reading: draws a meter track under the figure. */
  meter?: { value: number; total: number; caption: Bi };
}

export const SUS_STATS: StatCard[] = [
  {
    value: { pt: "5.000.000+", zh: "500万+" },
    label: { pt: "Sessões no SUS na década encerrada em 2018", zh: "至2018年的十年间公立系统治疗人次" },
    note: { pt: "A prática integrativa mais usada do sistema público", zh: "公共体系中应用最广的整合疗法" },
    tone: "primary",
  },
  {
    value: { pt: "1,1 milhão", zh: "110万" },
    label: { pt: "Sessões em um único ano", zh: "单一年度治疗人次" },
    note: { pt: "Dados do SUS referentes a 2024", zh: "公共卫生体系2024年数据" },
    tone: "primary",
  },
  {
    value: { pt: "83%", zh: "83%" },
    label: { pt: "Dos municípios brasileiros oferecem práticas integrativas", zh: "巴西城市已开展整合医疗服务" },
    note: { pt: "Presença capilar em todo o país", zh: "覆盖全国各地" },
    tone: "primary",
  },
  {
    value: { pt: "20 a 35 milhões", zh: "2000万–3500万" },
    label: { pt: "De brasileiros já se trataram com acupuntura", zh: "已接受过针灸治疗的巴西民众" },
    note: {
      pt: "Entre um em cada dez e um em cada seis habitantes — num país de mais de 210 milhões",
      zh: "在超过2.1亿人口中，约每6至10人中即有1人",
    },
    tone: "jade",
    wide: true,
  },
];

export const SUS_FOOTNOTE: Bi = {
  pt: "Os conselhos profissionais apontam subnotificação nos registros: estes números oficiais são o piso, não o teto.",
  zh: "各专业委员会指出登记存在漏报：官方数字是下限，而非上限。",
};

/* ------------------------------------------------------------------ */
/* Slide 6 · the law                                                   */
/* ------------------------------------------------------------------ */

/**
 * The 22 years, plotted instead of asserted.
 *
 * `at` is the position on the rail as a share of the elapsed time between the
 * bill's presentation (July 2003) and the signature (January 2026) — 270 months
 * in all. Spacing the markers by real elapsed time is the whole point: the
 * 16-year silence between 2003 and the Chamber vote is the argument, and evenly
 * spaced markers would erase it.
 */
export interface LawMilestone {
  year: string;
  at: number;
  label: Bi;
  detail: Bi;
  emphasis?: boolean;
}

export const LAW_TRACK: LawMilestone[] = [
  {
    year: "2003",
    at: 0,
    label: { pt: "Projeto apresentado", zh: "提案提出" },
    detail: { pt: "Julho · dep. Celso Russomanno", zh: "7月 · 众议员 Celso Russomanno" },
  },
  {
    year: "2019",
    at: 71,
    label: { pt: "Aprovado na Câmara", zh: "众议院通过" },
    detail: { pt: "16 anos depois", zh: "历时16年" },
  },
  {
    year: "2026",
    at: 100,
    label: { pt: "Sancionada", zh: "签署生效" },
    detail: { pt: "12 de janeiro · Lei 15.345", zh: "1月12日 · 第15345号法律" },
    emphasis: true,
  },
];

export const LAW_SPAN: Bi = {
  pt: "22 anos de tramitação no Congresso Nacional",
  zh: "国会审议历时22年",
};

export const LAW_FACTS: StatCard[] = [
  {
    value: { pt: "370 mil", zh: "37万" },
    label: { pt: "Profissionais de medicina chinesa no Brasil", zh: "巴西中医药从业者（估计）" },
    note: { pt: "Estimativas do setor — ainda não há censo oficial", zh: "行业估算，尚无官方普查" },
    tone: "primary",
  },
];

export const LAW_GROUPS: Bi[] = [
  { pt: "Quem tem graduação superior em acupuntura", zh: "取得针灸本科学历者" },
  { pt: "Quem se formou no exterior, após validação do diploma", zh: "境外毕业并通过学历认证者" },
  {
    pt: "Profissionais de saúde com título de especialista reconhecido pelo seu conselho",
    zh: "经所属委员会认可、具专科资质的卫生专业人员",
  },
  { pt: "Quem comprova ao menos cinco anos de exercício contínuo", zh: "能证明连续执业满五年者" },
];

export const LAW_GROUPS_NOTE: Bi = {
  pt: "A lei também garante que outras profissões da saúde sigam usando procedimentos de acupuntura, mediante formação adequada.",
  zh: "该法同时保障其他卫生专业人员在具备相应训练的前提下继续使用针灸技术。",
};

export const LAW_QUOTE: Bi = {
  pt: "Não haverá mais campo para o amadorismo na medicina chinesa brasileira. A regulamentação constrói um lugar de respeito para quem honra essa ciência.",
  zh: "巴西的中医药将不再有业余主义的空间。立法为敬重这门学问的人建立了应有的位置。",
};

/* ------------------------------------------------------------------ */
/* Slide 7 · two cultures                                              */
/* ------------------------------------------------------------------ */

export interface CultureColumn {
  flag: "cn" | "br";
  title: Bi;
  subtitle: Bi;
  items: Bi[];
}

export const CULTURES: CultureColumn[] = [
  {
    flag: "cn",
    title: { pt: "Na China", zh: "在中国" },
    subtitle: { pt: "Tradição hospitalar", zh: "医院与师承传统" },
    items: [
      { pt: "O tratamento pode ser diário, às vezes por semanas seguidas.", zh: "治疗可每日进行，有时持续数周。" },
      {
        pt: "Formação universitária com hospital-escola e supervisão direta.",
        zh: "大学教育、附属医院实习与带教督导。",
      },
      { pt: "Dezenas de pacientes por dia, com preceptores ao lado.", zh: "每日诊治数十位患者，师长就在身旁。" },
    ],
  },
  {
    flag: "br",
    title: { pt: "No Brasil", zh: "在巴西" },
    subtitle: { pt: "Consultório privado", zh: "独立诊所" },
    items: [
      {
        pt: "Uma sessão por semana — pelo custo, pelas distâncias, pela rotina de trabalho.",
        zh: "每周一次——受费用、距离与工作节奏所限。",
      },
      {
        pt: "Cada sessão precisa render mais, e o raciocínio clínico precisa ser mais preciso.",
        zh: "每次诊疗都须更有效，辨证也须更精准。",
      },
      {
        pt: "Formação pulverizada em centenas de cursos, sem padrão nacional; experiência construída na solidão do consultório.",
        zh: "培训分散于数百个课程，缺乏全国标准；临床经验在独自执业中积累。",
      },
    ],
  },
];

export const PATIENT_NOTE: Bi = {
  pt: "O paciente brasileiro acredita na acupuntura, mas em geral não a reconhece como uma racionalidade médica completa: muitos chegam “para relaxar”, ou como último recurso. Educar esse paciente também é trabalho do terapeuta.",
  zh: "巴西患者信任针灸，却大多未将其视为一套完整的医学体系：许多人只为“放松”而来，或已别无他法。教育患者，同样是治疗师的工作。",
};

/* ------------------------------------------------------------------ */
/* Slide 8 · paper records                                             */
/* ------------------------------------------------------------------ */

export const PAPER_PAINS: Bi[] = [
  { pt: "Rasga, molha e se perde no transporte entre dois consultórios", zh: "在两处诊所间往返时会撕破、受潮、遗失" },
  { pt: "Não faz busca, não faz backup", zh: "无法检索，无法备份" },
  { pt: "Não compara nada com nada ao longo do acompanhamento", zh: "无法在随访中比对前后变化" },
];

export const PAPER_SEARCH: Bi[] = [
  { pt: "Sem anamnese energética", zh: "没有能量层面的问诊结构" },
  { pt: "Sem língua e pulso", zh: "没有舌象与脉象" },
  { pt: "Sem pontos nem meridianos", zh: "没有腧穴与经络" },
];

export const PAPER_DECISION: Bi = {
  pt: "Naquele momento eu decidi que faria o primeiro sistema de prontuário eletrônico para os acupunturistas do Brasil.",
  zh: "就在那一刻，我决定要做巴西第一套为针灸师而生的电子病历系统。",
};

/* ------------------------------------------------------------------ */
/* Slide 9 · the 2020 congress                                         */
/* ------------------------------------------------------------------ */

export const CONGRESS_CARDS: StatCard[] = [
  {
    value: { pt: "19–21/06/2020", zh: "2020年6月19–21日" },
    label: { pt: "1º Congresso Práticas da Sabedoria Milenar", zh: "首届“千年智慧实践”大会" },
    note: {
      pt: "Seis profissionais de áreas diferentes da medicina chinesa, ao vivo",
      zh: "六位来自中医药不同领域的专业人士现场分享",
    },
    tone: "primary",
  },
  {
    value: { pt: "3.800+", zh: "3800+" },
    label: { pt: "Acessos nos três dias", zh: "三天内的访问人次" },
    note: {
      pt: "Totalmente online e gratuito — o evento pioneiro no Brasil nesse formato",
      zh: "全程线上、完全免费——开巴西同类活动之先河",
    },
    tone: "primary",
  },
  {
    value: { pt: "2020", zh: "2020年" },
    label: { pt: "O financiamento veio do próprio trabalho", zh: "以自身工作筹得启动资金" },
    note: {
      pt: "Divulgar cursos de Mestre Tung, I Ching e fitoterapia chinesa gerou o capital para contratar o programador",
      zh: "推广董氏奇穴、易经与中药课程，筹得聘请程序员的资金",
    },
    tone: "jade",
  },
];

/* ------------------------------------------------------------------ */
/* Slide 10 · the survey                                               */
/* ------------------------------------------------------------------ */

export interface SurveyStat {
  value: Bi;
  label: Bi;
  note: Bi;
  /** The plotted magnitude, 0–100. All four share the 3.800-respondent base,
   *  which is exactly why they belong on one axis instead of four cards. */
  percent: number;
  /** `attention` is the one bar the whole product answers — the 6,8% gap. */
  tone: "attention" | "primary";
}

export const SURVEY_STATS: SurveyStat[] = [
  {
    value: { pt: "6,8%", zh: "6.8%" },
    label: { pt: "Usavam algum prontuário eletrônico", zh: "在使用电子病历" },
    note: { pt: "E sempre um sistema genérico, emprestado da medicina ocidental", zh: "且均为借用自西医的通用系统" },
    percent: 6.8,
    tone: "attention",
  },
  {
    value: { pt: "77%", zh: "77%" },
    label: { pt: "Registravam seus atendimentos de alguma forma", zh: "以某种方式记录诊疗" },
    note: { pt: "Muitos ainda no papel", zh: "其中许多人仍使用纸质卡片" },
    percent: 77,
    tone: "primary",
  },
  {
    value: { pt: "72,7%", zh: "72.7%" },
    label: { pt: "Queriam um prontuário eletrônico dedicado", zh: "希望拥有专属的电子病历" },
    note: { pt: "Construído sob a lógica da medicina chinesa", zh: "依循中医自身的诊疗逻辑" },
    percent: 72.7,
    tone: "primary",
  },
  {
    value: { pt: "90,9%", zh: "90.9%" },
    label: { pt: "Queriam um sistema de gestão para o consultório", zh: "希望拥有完整的诊所管理系统" },
    note: { pt: "Agenda, financeiro e histórico em um só lugar", zh: "预约、财务与病史合于一处" },
    percent: 90.9,
    tone: "primary",
  },
];

export const SURVEY_SOURCE: Bi = {
  pt: "Fevereiro de 2021 · pesquisa sobre a base de 3.800 acupunturistas que participaram do congresso",
  zh: "2021年2月 · 面向3800名与会针灸师发出的问卷调研",
};

export const SURVEY_CONCLUSION: Bi = {
  pt: "A necessidade era quase universal, e a oferta era quase zero.",
  zh: "需求几乎是普遍的，而市场供给几近于零。",
};

/* ------------------------------------------------------------------ */
/* Slide 11 · version 1 and the free tier                              */
/* ------------------------------------------------------------------ */

/**
 * Screens of the 2021 version the roteiro asks to narrate over. Drop the files
 * at these paths and they render inside the window frames; until then each
 * frame draws a skeleton sketch of that v1 screen (`sketch`), so the slide
 * shows four little product windows instead of four empty rectangles.
 */
export const V1_GALLERY: GalleryFrame[] = [
  {
    src: "/images/palestra/v1-cadastro.webp",
    sketch: "cadastro",
    caption: { pt: "Cadastro de pacientes", zh: "患者建档" },
  },
  { src: "/images/palestra/v1-agenda.webp", sketch: "agenda", caption: { pt: "Agenda", zh: "预约日程" } },
  {
    src: "/images/palestra/v1-anamnese.webp",
    sketch: "anamnese",
    caption: { pt: "Anamnese guiada de MTC", zh: "中医引导式问诊" },
  },
  {
    src: "/images/palestra/v1-financeiro.webp",
    sketch: "financeiro",
    caption: { pt: "Controle financeiro", zh: "财务管理" },
  },
];

export const V1_MILESTONES: StatCard[] = [
  {
    value: { pt: "Agosto de 2021", zh: "2021年8月" },
    label: { pt: "Lançamento da primeira versão", zh: "首个版本发布" },
    note: {
      pt: "Em vez de uma folha em branco, a anamnese guiada conduzia pelas perguntas que a nossa medicina exige",
      zh: "不再是一张白纸：引导式问诊按中医所需的次第逐一提问",
    },
    tone: "primary",
  },
  {
    value: { pt: "2022 · 1.000", zh: "2022年 · 1000" },
    label: { pt: "Usuários na versão gratuita", zh: "免费版用户" },
    note: { pt: "Todos chegando de forma orgânica, sem anúncios", zh: "全部自然增长，未投放任何广告" },
    tone: "jade",
  },
  {
    value: { pt: "Agosto de 2023", zh: "2023年8月" },
    label: { pt: "Início da segunda etapa, com a versão 2.0", zh: "第二阶段启动，2.0版本" },
    note: { pt: "A busca do encaixe definitivo entre produto e mercado", zh: "寻找产品与市场的最终契合" },
    tone: "secondary",
  },
];

export const FREE_TIER_PLEDGE: Bi = {
  pt: "Sempre existirá uma versão gratuita de verdade, porque a missão é elevar o registro clínico da profissão inteira — não só de quem pode pagar.",
  zh: "永远会有一个真正免费的版本：我们的使命是提升整个行业的临床记录水平，而不只是服务有能力付费的人。",
};

/* ------------------------------------------------------------------ */
/* Slide 12 · the platform today                                       */
/* ------------------------------------------------------------------ */

/**
 * Real figures from the legacy platform's database (see
 * `attachments/plano-captacao-medchina (1).pdf`). Two things stay out of this
 * slide on purpose: activation rates and revenue targets are internal
 * diagnosis, not stage material.
 *
 * CONFIRM ON THE DAY: pull the current totals from production and update the
 * values below — the roteiro marks this slide as "PREENCHER antes da palestra".
 */
export const PLATFORM_STATS: StatCard[] = [
  {
    value: { pt: "1.046", zh: "1046" },
    label: { pt: "Profissionais cadastrados na plataforma", zh: "平台注册的专业用户" },
    note: { pt: "Base construída desde 2021, sem mídia paga", zh: "自2021年积累，未投放付费广告" },
    tone: "primary",
  },
  {
    value: { pt: "222", zh: "222" },
    label: { pt: "Já assinaram planos pagos", zh: "曾订阅付费方案" },
    note: { pt: "Profissionais que sustentaram o produto ao longo da jornada", zh: "一路支持产品走到今天的专业人士" },
    // 222 of the 1.046 above — the number means nothing without its denominator,
    // and the share is the free tier working as designed, not a shortfall.
    meter: { value: 222, total: 1046, caption: { pt: "dos 1.046 cadastrados", zh: "占1046名注册用户" } },
    tone: "secondary",
  },
  {
    value: { pt: "100%", zh: "100%" },
    label: { pt: "Das funcionalidades da nova geração em produção", zh: "新一代功能已全部上线" },
    note: {
      pt: "Prontuário, captação de áudio, agenda e apoio ao raciocínio clínico",
      zh: "病历、录音采集、预约与临床推理辅助",
    },
    tone: "jade",
  },
];

/* ------------------------------------------------------------------ */
/* Bloco 6 · the pause                                                 */
/* ------------------------------------------------------------------ */

export const PAUSE_LINE: Bi = {
  pt: "Para eu estar aqui hoje, foi preciso parar. Foi preciso olhar para a vida depois do diagnóstico e decidir.",
  zh: "为了今天能站在这里，我必须停下来；必须在确诊之后重新审视生命，决定什么值得我的时间。",
};

/* ------------------------------------------------------------------ */
/* Slide 13 · the motto                                                */
/* ------------------------------------------------------------------ */

/** The motto, split so the second sentence takes the accent colour on stage. */
export const MOTTO: Bi = {
  pt: "Atenda olhando para o paciente.",
  zh: "目视患者，全心诊疗。",
};

export const MOTTO_EM: Bi = {
  pt: "O MedChina organiza o restante.",
  zh: "其余的记录，交给 MedChina。",
};

export const ATTENTION_THIEVES: Bi[] = [
  { pt: "Digitar durante o atendimento rouba o contato visual", zh: "诊中打字会夺走目光的交流" },
  { pt: "Digitar fragmenta a escuta", zh: "打字会打断倾听" },
  {
    pt: "Não registrar na hora significa reconstruir a consulta de memória à noite",
    zh: "当场不记录，夜里就得凭记忆重建整场诊疗",
  },
];

/* ------------------------------------------------------------------ */
/* Slide 14 · before, during, after                                    */
/* ------------------------------------------------------------------ */

export interface FlowStep {
  step: string;
  label: Bi;
  title: Bi;
  body: Bi;
  image: string;
  imageAlt: string;
  /** CSS object-position — each capture has its content in a different place. */
  imageFocus: string;
}

export const FLOW_STEPS: FlowStep[] = [
  {
    step: "01",
    label: { pt: "Antes", zh: "诊前" },
    title: { pt: "A agenda entrega um resumo pronto", zh: "预约页呈现一份现成的摘要" },
    body: {
      pt: "O que aconteceu na última sessão, quais padrões foram registrados, quais técnicas foram aplicadas, como o paciente respondeu, e quais alertas existem: alergias, medicamentos em uso, contraindicações.",
      zh: "上次诊疗的经过、已记录的证型、施用的技术、患者的反应，以及既有的警示：过敏、在用药物、禁忌症。",
    },
    image: "/images/medchina-flow-consulta-real.webp",
    imageAlt: "Tela do MedChina para preparar a consulta e registrar o consentimento",
    imageFocus: "50% 8%",
  },
  {
    step: "02",
    label: { pt: "Durante", zh: "诊中" },
    title: { pt: "O celular vira um gravador clínico", zh: "手机成为临床录音器" },
    body: {
      pt: "Com o consentimento do paciente registrado, o aplicativo captura o áudio. A profissional não digita: olha nos olhos, escuta, observa e examina, ditando em voz alta o que vê na língua e sente no pulso.",
      zh: "在患者同意已登记的前提下，应用采集诊疗录音。医者无需打字：她注视、倾听、观察、诊察，并口述所见舌象与所感脉象。",
    },
    image: "/images/medchina-flow-anamnese-real.webp",
    imageAlt: "Tela da anamnese estruturada no prontuário MedChina",
    imageFocus: "50% 0%",
  },
  {
    step: "03",
    label: { pt: "Depois", zh: "诊后" },
    title: { pt: "A anamnese chega estruturada para revisão", zh: "结构化问诊已备好，等待复核" },
    body: {
      pt: "A plataforma transcreve a conversa separando a fala da profissional e a do paciente, e preenche a anamnese: queixa e história; sono, energia, alimentação, digestão; aspectos emocionais; e a avaliação própria da medicina chinesa.",
      zh: "平台转写对话并区分医者与患者的话语，继而填写问诊：主诉与现病史；睡眠、精力、饮食、消化；情志；以及中医自身的辨证内容。",
    },
    image: "/images/medchina-flow-plano-real.webp",
    imageAlt: "Tela do MedChina com validação do plano terapêutico",
    // The left half of this capture is an empty panel; crop to the right side.
    imageFocus: "100% 4%",
  },
];

export const OFFLINE_NOTE: Bi = {
  pt: "Se a internet cair, a gravação continua, guardada e criptografada no aparelho. O envio recomeça sozinho quando a conexão volta, e nada é apagado do celular antes de o servidor confirmar que recebeu tudo.",
  zh: "若网络中断，录音继续，并在设备本地加密保存。连接恢复后自动续传；在服务器确认完整接收之前，手机上不会删除任何内容。",
};

/* ------------------------------------------------------------------ */
/* Slide 15 · traceable anamnesis                                      */
/* ------------------------------------------------------------------ */

export interface Principle {
  index: string;
  title: Bi;
  body: Bi;
}

export const TRACE_PRINCIPLES: Principle[] = [
  {
    index: "01",
    title: { pt: "Cada campo guarda a origem da informação", zh: "每一字段都保留信息出处" },
    body: {
      pt: "A profissional toca no campo e ouve o trecho exato do áudio de onde aquilo veio. Nada aparece no prontuário sem que se possa verificar de onde saiu.",
      zh: "点触字段即可听到该内容出自录音的确切片段。凡入病历，皆可回溯来源。",
    },
  },
  {
    index: "02",
    title: { pt: "O que o paciente não disse permanece vazio", zh: "患者未言之处，留白" },
    body: {
      pt: "O sistema jamais transforma ausência de informação em negação. Se ninguém perguntou sobre o sono, o campo fica marcado como “não informado”. É uma questão de honestidade clínica.",
      zh: "系统绝不把“未提及”变成“否定”。若无人问及睡眠，该字段即标注为“未告知”。这是临床诚实的问题。",
    },
  },
  {
    index: "03",
    title: { pt: "O sistema aponta lacunas e contradições", zh: "系统标示缺漏与矛盾" },
    body: {
      pt: "Duas datas diferentes para o início da dor ficam destacadas. Um sintoma importante não investigado vira uma pergunta sugerida. E a consulta é comparada com o histórico: o que mudou, o que persiste, o que melhorou.",
      zh: "疼痛起始出现两个不同日期时会被标出；重要症状未加追问时，系统会提出应问之题。并与既往病史比对：何者改变、何者持续、何者好转。",
    },
  },
];

/** A run of quote text; `m` marks the stretches the AI actually extracted. */
export interface QuoteSegment {
  t: string;
  m?: boolean;
}

export interface EvidenceField {
  label: Bi;
  value: Bi;
  state: Bi;
  tone: "clear" | "attention" | "missing";
  /** Timestamp of the audio excerpt this field points back to. */
  source?: string;
}

/**
 * The worked example on slide 15 — the same fictitious consultation the home
 * uses. The three field rows are the three principles made visible: a clear
 * extraction with its audio source, a gap flagged for attention, and a field
 * that stays "not informed" because tongue and pulse are the professional's
 * own observation, never inferred from patient speech.
 */
export const EVIDENCE = {
  timestamp: "14:32",
  duration: "0:14",
  speaker: { pt: "Paciente · áudio autorizado", zh: "患者 · 已授权录音" } as Bi,
  player: { pt: "Trecho original", zh: "原始片段" } as Bi,
  organized: { pt: "a IA organiza", zh: "AI 整理" } as Bi,
  quote: {
    pt: [
      { t: "Tenho acordado umas " },
      { t: "três vezes durante a noite", m: true },
      { t: ". Sinto " },
      { t: "muito calor", m: true },
      { t: " e às vezes acordo " },
      { t: "suando", m: true },
      { t: "." },
    ],
    zh: [
      { t: "我夜里会醒" },
      { t: "三次", m: true },
      { t: "左右，觉得" },
      { t: "很热", m: true },
      { t: "，有时醒来" },
      { t: "一身汗", m: true },
      { t: "。" },
    ],
  } as Record<"pt" | "zh", QuoteSegment[]>,
  fields: [
    {
      label: { pt: "Sono", zh: "睡眠" },
      value: { pt: "Desperta aproximadamente três vezes durante a noite.", zh: "夜间约醒三次。" },
      state: { pt: "Evidência clara", zh: "证据明确" },
      tone: "clear",
      source: "14:32",
    },
    {
      label: { pt: "Evolução", zh: "病程" },
      value: {
        pt: "Frequência relatada; início e evolução ainda não informados.",
        zh: "已述频次；起始与演变尚未告知。",
      },
      state: { pt: "Requer atenção", zh: "需要注意" },
      tone: "attention",
      source: "14:32",
    },
    {
      label: { pt: "Língua e pulso", zh: "舌象与脉象" },
      value: { pt: "Aguardando observação direta da profissional.", zh: "有待医者亲自诊察。" },
      state: { pt: "Não informado", zh: "未告知" },
      tone: "missing",
    },
  ] as EvidenceField[],
  footer: {
    pt: "Nada é finalizado automaticamente — a profissional revisa, ajusta e confirma.",
    zh: "任何内容都不会自动定稿——由医者复核、调整并确认。",
  } as Bi,
};

/* ------------------------------------------------------------------ */
/* Slide 16 · hypotheses                                               */
/* ------------------------------------------------------------------ */

export interface HypothesisColumn {
  title: Bi;
  tone: "support" | "attention" | "missing";
  items: Bi[];
}

export const HYPOTHESIS_COLUMNS: HypothesisColumn[] = [
  {
    title: { pt: "Sinais que favorecem", zh: "支持的征象" },
    tone: "support",
    items: [
      { pt: "Língua pálida com marcas dentárias", zh: "舌淡有齿痕" },
      { pt: "Cansaço após as refeições", zh: "食后倦怠" },
      { pt: "Sensação de peso nos membros", zh: "四肢困重" },
    ],
  },
  {
    title: { pt: "Sinais que contradizem", zh: "不支持的征象" },
    tone: "attention",
    items: [
      { pt: "Pulso em corda e rápido", zh: "脉弦而数" },
      { pt: "Ausência de fezes amolecidas", zh: "无便溏" },
    ],
  },
  {
    title: { pt: "Dados que ainda faltam", zh: "尚待查证" },
    tone: "missing",
    items: [
      { pt: "Palpação do ponto Mu do Baço", zh: "脾之募穴按诊" },
      { pt: "Horário em que a fadiga se agrava", zh: "疲乏加重的时辰" },
    ],
  },
];

export const HYPOTHESIS_FRAMING: Bi = {
  pt: "O sistema nunca diz “o paciente tem Deficiência de Qi do Baço”. Ele diz: os dados registrados têm correspondência com este padrão; estes sinais apoiam; este sinal contradiz; falta investigar isto.",
  zh: "系统绝不会说“患者为脾气虚”。它说的是：已记录的资料与此证型存在对应；这些征象支持；这一征象不支持；此项尚待查证。",
};

export const INFORMATION_LAYERS: Bi[] = [
  { pt: "O que o paciente relatou", zh: "患者所述" },
  { pt: "O que a profissional observou", zh: "医者所察" },
  { pt: "O que a inteligência artificial inferiu", zh: "人工智能所推" },
  { pt: "O que a profissional decidiu", zh: "医者所决" },
];

export const LAYERS_NOTE: Bi = {
  pt: "Essas quatro camadas nunca se misturam. E depois de finalizado, o prontuário se torna imutável: correções entram como adendos, com autor, data e motivo.",
  zh: "这四个层次绝不混淆。病历一经归档即不可更改：更正以附记形式录入，注明作者、日期与理由。",
};

/* ------------------------------------------------------------------ */
/* Slide 17 · library and security                                     */
/* ------------------------------------------------------------------ */

export interface FeatureCard {
  title: Bi;
  body: Bi;
  tone: "primary" | "secondary" | "jade";
}

export const LIBRARY_SECURITY: FeatureCard[] = [
  {
    title: { pt: "Biblioteca clínica com fontes citadas", zh: "带出处引用的临床知识库" },
    body: {
      pt: "Estudar e tirar dúvidas conversando com uma base curada, que separa três naturezas de conteúdo: as fontes tradicionais, os protocolos internos e as evidências científicas. Cada profissional adiciona os próprios protocolos, que passam a alimentar as sugestões do seu consultório.",
      zh: "以对话方式研习与释疑，知识库经过甄选，并将三类内容分立：传统文献、内部方案与现代科研证据。每位医者可加入自己的方案，用于其诊所的建议生成。",
    },
    tone: "primary",
  },
  {
    title: { pt: "Consentimento específico e versionado", zh: "分项且带版本的知情同意" },
    body: {
      pt: "Uma autorização para a gravação, outra para o processamento por inteligência artificial. A recusa nunca impede o atendimento manual.",
      zh: "录音一项授权，人工智能处理另一项授权。拒绝授权绝不妨碍以人工方式完成诊疗。",
    },
    tone: "secondary",
  },
  {
    title: { pt: "Dado clínico é o dado mais sensível que existe", zh: "临床数据是最敏感的数据" },
    body: {
      pt: "Tudo é criptografado, cada acesso fica em trilha de auditoria e nenhum áudio ou conteúdo clínico é usado para treinar modelos públicos de IA. Seguimos a lei brasileira de proteção de dados desde a concepção do sistema.",
      zh: "全程加密，每次访问留有审计轨迹；任何录音或临床内容都不用于训练公开的AI模型。系统自设计之初即遵循巴西数据保护法。",
    },
    tone: "jade",
  },
];

export const MANAGEMENT_NOTE: Bi = {
  pt: "E toda a gestão que fez o MedChina nascer continua lá: agenda, financeiro do consultório e a história completa de cada paciente organizada em linha do tempo.",
  zh: "当初催生 MedChina 的管理功能一如既往：预约、诊所财务，以及每位患者按时间轴整理的完整病史。",
};

export const FREE_TIER_NOTE: Bi = {
  pt: "O plano gratuito oferece o prontuário manual completo, com pacientes e registros ilimitados, para sempre. O que se paga é a automação — o tempo que a inteligência artificial devolve para a profissional.",
  zh: "免费方案永久提供完整的手工病历，患者与记录数量不限。付费购买的是自动化——是人工智能为医者省回的时间。",
};

/* ------------------------------------------------------------------ */
/* Slide 18 · the four examinations                                    */
/* ------------------------------------------------------------------ */

export interface Examination {
  glyph: string;
  pinyin: string;
  meaning: Bi;
  note: Bi;
  assisted?: boolean;
}

export const FOUR_EXAMINATIONS: Examination[] = [
  {
    glyph: "望",
    pinyin: "Wàng",
    meaning: { pt: "Observar", zh: "观察" },
    note: { pt: "Não pode ser delegado", zh: "不可假手于机器" },
  },
  {
    glyph: "闻",
    pinyin: "Wén",
    meaning: { pt: "Ouvir e cheirar", zh: "闻声嗅气" },
    note: { pt: "Não pode ser delegado", zh: "不可假手于机器" },
  },
  {
    glyph: "问",
    pinyin: "Wèn",
    meaning: { pt: "Perguntar", zh: "问诊" },
    note: { pt: "Onde o MedChina ajuda: no registro do interrogatório", zh: "MedChina 所助之处：问诊的记录" },
    assisted: true,
  },
  {
    glyph: "切",
    pinyin: "Qiè",
    meaning: { pt: "Palpar", zh: "切脉按诊" },
    note: { pt: "Não pode ser delegado", zh: "不可假手于机器" },
  },
];

export const AI_LIMITS: Bi = {
  pt: "A nossa IA não olha, não palpa, não decide. Ela escuta, organiza, lembra e pergunta. Ela devolve à profissional exatamente aquilo que a burocracia roubou: tempo e atenção.",
  zh: "我们的AI不观察、不触诊、不做决定。它只倾听、整理、提醒与发问，把文书所夺走的东西还给医者：时间与专注。",
};

export const DISCIPLE_QUOTE: Bi = {
  pt: "Durante séculos, esse alguém foi o discípulo que acompanhava o mestre e anotava. A nossa tecnologia faz o papel do discípulo. A medicina continua sendo do mestre.",
  zh: "数百年来，担此任者是随师抄录的门徒。我们的技术只做门徒的角色，医道仍属于医者。",
};

export const DUTY_NOTE: Bi = {
  pt: "Com a profissão regulamentada, o registro clínico deixou de ser uma escolha pessoal e virou um dever profissional. Prontuário bem-feito protege o paciente, protege o profissional e dignifica a profissão.",
  zh: "职业获得立法规范之后，临床记录不再是个人选择，而成为专业义务。完善的病历保护患者、保护医者，也让这门职业更有尊严。",
};

/* ------------------------------------------------------------------ */
/* Slide 19 · the bridge                                               */
/* ------------------------------------------------------------------ */

export const CONFUCIUS_CARD: FeatureCard = {
  title: {
    pt: "Instituto Confúcio de Medicina Chinesa · Goiânia, desde 2019",
    zh: "中医孔子学院 · 戈亚尼亚，自2019年",
  },
  body: {
    pt: "Uma parceria entre a Universidade Federal de Goiás, no Brasil, e a Universidade de Medicina Chinesa de Hebei. É o único Instituto Confúcio da América Latina que, além da cultura, da língua e da arte chinesas, se dedica à medicina chinesa e à formação de novos profissionais.",
    zh: "由巴西戈亚斯联邦大学与中国河北中医药大学共建。这是拉丁美洲唯一一所在中华文化、语言与艺术之外，专门致力于中医药传播与人才培养的孔子学院。",
  },
  tone: "secondary",
};

export const INVITATION_CARD: FeatureCard = {
  title: { pt: "Um convite concreto às instituições chinesas", zh: "向中国机构发出的具体邀请" },
  body: {
    pt: "Universidades, professores e instituições que queiram alcançar o público brasileiro encontram no MedChina um canal direto com essa comunidade — em eventos e cursos, ou levando conteúdo de referência, com a devida curadoria e licença, para dentro da biblioteca clínica que os nossos profissionais consultam todos os dias.",
    zh: "希望触达巴西受众的高校、教师与机构，可通过 MedChina 直达这一专业群体——或以活动与课程的形式，或在恰当的甄选与授权之下，将权威内容纳入我们的医者每日查阅的临床知识库。",
  },
  tone: "primary",
};

export const BRIDGE_LINE: Bi = {
  pt: "A medicina chinesa cresceu no Brasil por dois séculos sem falar português. Imaginem o que ela pode fazer agora que aprendeu.",
  zh: "两个世纪以来，中医药在巴西生长，却从未说过葡萄牙语。如今它学会了，请想象它能走多远。",
};

/* ------------------------------------------------------------------ */
/* Slide 20 · closing                                                  */
/* ------------------------------------------------------------------ */

export const CLOSING_LINE: Bi = {
  pt: "Comecei falando de uma ficha de papel que rasgava e se perdia. Termino falando de um prontuário que escuta, organiza e prepara, para que o terapeuta brasileiro possa fazer o que os mestres desta terra fazem há milênios: olhar para o paciente.",
  zh: "开场时我讲的是一张会撕破、会遗失的纸卡；此刻我讲的是一份会倾听、会整理、会预备的病历，好让巴西的治疗师能做这片土地上的先师们做了数千年的事：看着患者。",
};

export const CLOSING_PLEDGE: Bi = {
  pt: "Estaremos sempre trabalhando para honrar os ancestrais que escreveram cada ideograma e que ensinam, há milênios, essa arte e essa sabedoria.",
  zh: "我们将始终努力，以不负先贤——是他们写下这一个个汉字，并将这门技艺与智慧传承了数千年。",
};

/* ------------------------------------------------------------------ */
/* The deck                                                            */
/* ------------------------------------------------------------------ */

export const SLIDES_DATA: SlideData[] = [
  {
    key: "cover",
    roteiroSlide: 1,
    block: 1,
    blockTitle: { pt: "Abertura e apresentação", zh: "开场与介绍" },
    timeRange: "0:00–3:00",
    kicker: { pt: "Congresso de MTC · ALAR / Xinjiang, China · 2026", zh: "中医药大会 · ALAR / 中国新疆 · 2026" },
    title: { pt: "Do papel ao prontuário inteligente", zh: "从纸质病历到智能病历" },
    subtitle: {
      pt: "A medicina chinesa no Brasil e a jornada do MedChina",
      zh: "中医药在巴西的发展与 MedChina 的历程",
    },
    stageNote: "Slide 1 · Título da palestra + bandeiras do Brasil e da China.",
    script: `Boa tarde.

Quero agradecer aos organizadores deste evento por esta preciosa oportunidade e a todos os especialistas e colegas pela atenção e pela troca.

Para uma acupunturista brasileira, estar aqui não é apenas uma viagem de trabalho. É uma peregrinação.

Hoje quero compartilhar uma história que une três elementos: a trajetória da acupuntura no Brasil, minha trajetória como terapeuta e o nascimento do MedChina AI.`,
  },
  {
    key: "founders",
    roteiroSlide: 2,
    block: 1,
    blockTitle: { pt: "Abertura e apresentação", zh: "开场与介绍" },
    timeRange: "0:00–3:00",
    kicker: { pt: "Quem constrói o MedChina", zh: "MedChina 的建设者" },
    title: { pt: "Sabedoria milenar e engenharia moderna", zh: "千年智慧与现代工程" },
    subtitle: { pt: "Três histórias que, na verdade, são uma só", zh: "三个故事，其实是同一个故事" },
    stageNote:
      "Slide 2 · Foto dos fundadores + logo MedChina. Fotos reais em /images/palestra/ substituem os monogramas.",
    script: `Meu sócio, Bruno Santana, é engenheiro de software, com mais de 15 anos de experiência, e lidera a tecnologia do MedChina.

Vamos começar pelo princípio.`,
  },
  {
    key: "timeline",
    roteiroSlide: 3,
    block: 2,
    blockTitle: { pt: "Dois séculos de agulhas no Brasil", zh: "巴西的两百年银针" },
    timeRange: "3:00–9:00",
    kicker: { pt: "1808 → 2026", zh: "1808 → 2026" },
    title: { pt: "218 anos de agulhas em solo brasileiro", zh: "银针在巴西土地上的218年" },
    subtitle: {
      pt: "De Macau até o ensino formal de 1958",
      zh: "从澳门医者到1958年的正规教学",
    },
    stageNote: "Slide 3 · Linha do tempo: 1808 → 2026.",
    optionalCut: `[CORTE OPCIONAL] Quem quebrou esse isolamento foi um personagem improvável: Friedrich Spaeth, um fisioterapeuta nascido em Luxemburgo, que fugiu do nazismo, estudou acupuntura na Alemanha e se naturalizou brasileiro. Em 1958, Spaeth começou a ensinar acupuntura no Rio de Janeiro e em São Paulo. Naquele mesmo ano nasceu a Sociedade Brasileira de Acupuntura. É esse o marco do ensino formal da medicina chinesa no meu país.`,
    script: `Existem registros de acupuntura chinesa no Brasil há 218 anos.

Os primeiros relatos mencionam acupunturistas vindos de Macau em 1808, junto à corte portuguesa que havia se transferido para o Brasil.

Mas havia uma grande barreira: o idioma.

Os mestres orientais não conseguiam ensinar em português. Durante mais de um século, a acupuntura permaneceu principalmente dentro das colônias de imigrantes.

E, mesmo assim, ela cresceu.`,
  },
  {
    key: "milestones",
    roteiroSlide: 4,
    block: 2,
    blockTitle: { pt: "Dois séculos de agulhas no Brasil", zh: "巴西的两百年银针" },
    timeRange: "3:00–9:00",
    kicker: { pt: "Marcos institucionais", zh: "制度里程碑" },
    title: { pt: "A entrada na saúde pública", zh: "进入公共卫生体系" },
    subtitle: {
      pt: "1988 SUS · 1995 conselhos · 2006 PNPIC · 2018 prática multiprofissional",
      zh: "1988 纳入SUS · 1995 专业委员会 · 2006 PNPIC · 2018 多专业实践",
    },
    stageNote: "Slide 4 · Marcos: 1988 SUS · 1995 conselhos · 2006 PNPIC.",
    script: `Em 1988, a acupuntura entrou na rede pública de saúde, inicialmente restrita à aplicação por médicos.

Em 2018, foi consolidada como prática multiprofissional no Sistema Único de Saúde, o SUS.

Segundo os dados apresentados nesta palestra, entre 2008 e 2018 foram realizados mais de cinco milhões de atendimentos, e as práticas integrativas chegaram a 83% dos municípios brasileiros.`,
  },
  {
    key: "sus-numbers",
    roteiroSlide: 5,
    block: 2,
    blockTitle: { pt: "Dois séculos de agulhas no Brasil", zh: "巴西的两百年银针" },
    timeRange: "3:00–9:00",
    kicker: { pt: "Números do SUS e do setor privado", zh: "公共体系与私立市场的数据" },
    title: { pt: "A dimensão da acupuntura no Brasil", zh: "针灸在巴西的规模" },
    subtitle: {
      pt: "A prática integrativa mais usada em toda a rede pública brasileira",
      zh: "巴西公立医疗系统中应用最广的整合疗法",
    },
    stageNote: "Slide 5 · Números do SUS.",
    script: `A acupuntura é a prática integrativa mais usada no sistema público brasileiro. Na década encerrada em 2018, foram mais de cinco milhões de sessões. Em 2024, foram 1,1 milhão de sessões em um único ano.

As práticas integrativas chegaram a 83% dos municípios brasileiros.

E somando quatro décadas de difusão, as estimativas apontam que entre 20 e 35 milhões de brasileiros já se trataram com acupuntura — algo entre um em cada dez e um em cada seis habitantes do país.`,
  },
  {
    key: "law",
    roteiroSlide: 6,
    block: 3,
    blockTitle: { pt: "A lei que esperamos por 22 anos", zh: "等待了22年的立法" },
    timeRange: "9:00–13:00",
    kicker: { pt: "Um novo profissional está nascendo", zh: "一种新的专业身份正在诞生" },
    title: { pt: "12 de janeiro de 2026 · Lei 15.345", zh: "2026年1月12日 · 第15345号法律" },
    subtitle: {
      pt: "A regulamentação da profissão de acupunturista no Brasil",
      zh: "针灸师职业在巴西的立法规范",
    },
    stageNote: "Slide 6 · 12 de janeiro de 2026 — Lei 15.345.",
    optionalCut: `[CORTE OPCIONAL] A lei não resolveu tudo, e é honesto dizer isso. Ainda não temos um conselho profissional próprio nem diretrizes nacionais de formação. A graduação superior em acupuntura ainda é rara no país, então a porta de entrada mais usada será a comprovação dos cinco anos de prática. Dois pontos do texto foram vetados, entre eles o que permitia o exercício por técnicos de nível médio, um veto negociado justamente para valorizar a formação superior. E nem todos comemoraram: o Conselho Federal de Medicina segue entendendo a acupuntura como ato médico, enquanto os conselhos de fisioterapia, enfermagem e farmácia celebraram a conquista e já publicam as suas normas. O debate continua. Mas agora ele acontece dentro de uma moldura legal.`,
    script: `Em 12 de janeiro de 2026, segundo a trajetória apresentada nesta palestra, foi sancionada a Lei 15.345, que regulamenta a profissão de acupunturista no Brasil.

Assim, 218 anos depois das primeiras referências à presença da acupuntura chinesa no Brasil, a profissão entra em um novo momento: com mais reconhecimento, mas também com mais responsabilidade e deveres.

E quem honra essa ciência precisa de ferramentas à altura dessa responsabilidade.`,
  },
  {
    key: "cultures",
    roteiroSlide: 7,
    block: 4,
    blockTitle: { pt: "O paciente e o terapeuta brasileiros", zh: "巴西的患者与治疗师" },
    timeRange: "13:00–16:00",
    kicker: { pt: "Como é atender MTC no Brasil", zh: "在巴西行医是怎样的" },
    title: { pt: "Brasil e China: duas culturas de tratamento", zh: "巴西与中国：两种诊疗文化" },
    subtitle: {
      pt: "Frequência, solidão no consultório e a exigência de um registro impecável",
      zh: "就诊频次、独立执业，以及对病历近乎苛刻的要求",
    },
    stageNote: "Slide 7 · Brasil e China: duas culturas de tratamento.",
    script: `Aqui na China, um tratamento de acupuntura pode ser diário, e a frequência faz parte da lógica terapêutica.

No Brasil, é comum que o paciente faça uma sessão por semana.

Por isso, o registro clínico precisa ser muito bem feito. Uma semana depois, é difícil recuperar de memória todos os detalhes de uma consulta.

Muitos acupunturistas trabalham sozinhos, sem hospital-escola, residência ou um colega mais experiente ao lado para discutir um caso difícil.

Foi pensando nesse profissional que o MedChina nasceu: para oferecer estrutura de registro, segurança de dados e apoio ao raciocínio clínico.`,
  },
  {
    key: "paper",
    roteiroSlide: 8,
    block: 5,
    blockTitle: { pt: "Do papel ao MedChina", zh: "从纸质病历到 MedChina" },
    timeRange: "16:00–22:30",
    kicker: { pt: "A gênese do projeto", zh: "项目的缘起" },
    title: { pt: "Começou numa ficha de papel", zh: "始于一张纸卡" },
    subtitle: {
      pt: "2017–2019: a busca por um sistema que falasse a nossa língua",
      zh: "2017–2019：寻找一套“说我们语言”的系统",
    },
    stageNote: "Slide 8 · Foto ou imagem de fichas de papel.",
    script: `Em 2017, na minha primeira formação como terapeuta, comecei a registrar tudo desde o primeiro paciente: dados, queixa e tratamento.

Tudo em fichas de papel.

Eu não encontrava no mercado um prontuário desenvolvido para a lógica da medicina chinesa. Faltavam elementos como anamnese energética, avaliação de língua e pulso, pontos e meridianos.

Foi então que decidi criar um sistema de prontuário eletrônico para acupunturistas brasileiros.

Eu ainda não tinha dinheiro, experiência clínica acumulada nem conhecia todas as necessidades de um acupunturista.

Mas tinha uma ideia e um propósito.`,
  },
  {
    key: "congress",
    roteiroSlide: 9,
    block: 5,
    blockTitle: { pt: "Do papel ao MedChina", zh: "从纸质病历到 MedChina" },
    timeRange: "16:00–22:30",
    kicker: { pt: "União na adversidade da pandemia", zh: "疫情之中的守望相助" },
    title: { pt: "A semente da comunidade: 2020", zh: "社群的种子：2020年" },
    subtitle: {
      pt: "1º Congresso Práticas da Sabedoria Milenar — online e gratuito",
      zh: "首届“千年智慧实践”大会——线上、免费",
    },
    stageNote: "Slide 9 · Congresso Práticas da Sabedoria Milenar — junho de 2020.",
    script: `Então chegou 2020 e veio a pandemia.

Milhares de colegas ficaram sem pacientes e sem saber quando poderiam voltar a trabalhar.

Pensei: se não podíamos atender, poderíamos aprender juntos.

Em junho de 2020, criei o Congresso Práticas da Sabedoria Milenar, totalmente online e gratuito.

Foi com esse trabalho que consegui arrecadar os recursos para criar e desenvolver o MedChina.

Ainda em 2020, contratei o programador. A tecnologia começou a nascer.`,
  },
  {
    key: "survey",
    roteiroSlide: 10,
    block: 5,
    blockTitle: { pt: "Do papel ao MedChina", zh: "从纸质病历到 MedChina" },
    timeRange: "16:00–22:30",
    kicker: { pt: "Evidência antes do produto", zh: "先有实证，再有产品" },
    title: { pt: "A dor real em quatro números", zh: "四个数据揭示真实痛点" },
    subtitle: {
      pt: "Fevereiro de 2021 · pesquisa sobre a base de 3.800 acupunturistas do congresso",
      zh: "2021年2月 · 面向3800名与会针灸师的问卷调研",
    },
    stageNote: "Slide 10 · Pesquisa de fevereiro de 2021 — os quatro números.",
    script: `Em fevereiro de 2021, fizemos uma pesquisa com a base de 3.800 acupunturistas qualificados que haviam participado do congresso.

Os resultados mostraram uma necessidade praticamente universal e pouca oferta de soluções específicas.

A partir dessa pesquisa, construímos o MedChina, um software de prontuários e gestão de consultórios dedicado aos acupunturistas do Brasil.`,
  },
  {
    key: "version-one",
    roteiroSlide: 11,
    block: 5,
    blockTitle: { pt: "Do papel ao MedChina", zh: "从纸质病历到 MedChina" },
    timeRange: "16:00–22:30",
    kicker: { pt: "Validação orgânica", zh: "自然增长的验证" },
    title: { pt: "A primeira versão e o compromisso da gratuidade", zh: "首个版本与免费的承诺" },
    subtitle: {
      pt: "2021–2023: mil usuários orgânicos e o início da versão 2.0",
      zh: "2021–2023：一千名自然增长用户与 2.0 版的启动",
    },
    stageNote:
      "Slide 11 · Linha do tempo da empresa 2020–2023 + [TELAS] 3 ou 4 capturas da v1 (cadastro, agenda, anamnese, financeiro) — narrar sobre as imagens. Arquivos em /images/palestra/v1-*.webp.",
    script: `A primeira versão foi lançada em agosto de 2021, com a lógica da medicina chinesa e conteúdo de MTC dentro do sistema.

A anamnese guiada era o coração da plataforma.

Um ano depois, tínhamos mil usuários na versão gratuita, sem propaganda paga.

Decidimos manter uma versão gratuita porque nossa missão é contribuir para elevar o registro clínico da profissão, e não apenas atender quem pode pagar.`,
  },
  {
    key: "platform-today",
    roteiroSlide: 12,
    block: 5,
    blockTitle: { pt: "Do papel ao MedChina", zh: "从纸质病历到 MedChina" },
    timeRange: "16:00–22:30",
    kicker: { pt: "A plataforma hoje", zh: "今日的平台" },
    title: { pt: "O MedChina em números", zh: "MedChina 的实际数据" },
    subtitle: {
      pt: "Uma comunidade construída desde 2021, sem mídia paga",
      zh: "自2021年积累的专业社群，未投放付费广告",
    },
    stageNote:
      "Slide 12 · Números atuais. Os valores exibidos vêm do banco da plataforma anterior (1.046 cadastros, 222 pagantes). CONFERIR NO DIA: puxar os totais atuais de produção antes da palestra e atualizar PLATFORM_STATS.",
    script: `Hoje, são 1.046 profissionais cadastrados na plataforma e 222 deles já assinaram planos pagos.

Então a vida me pediu uma pausa.`,
  },
  {
    key: "pause",
    block: 6,
    blockTitle: { pt: "A pausa e o renascimento", zh: "暂停与重生" },
    timeRange: "22:30–26:00",
    kicker: { pt: "Bloco 6", zh: "第六段" },
    title: { pt: "A pausa", zh: "暂停" },
    tone: "solemn",
    stageNote: "Sem slide. Tela escura ou neutra. Falar devagar.",
    script: `Em 2025, recebi um diagnóstico muito difícil: câncer de endométrio.

Passei por cirurgia, quimioterapia, radioterapia e braquiterapia.

O tratamento foi um sucesso.

Em 2026, voltamos com mais recursos e mais tecnologia — justamente no ano em que a profissão de acupunturista foi reconhecida no Brasil.

Com isso aprendi ainda mais a respeitar o tempo das coisas.`,
  },
  {
    key: "testimony-cnaa",
    block: 6,
    blockTitle: { pt: "A pausa e o renascimento", zh: "暂停与重生" },
    timeRange: "22:30–26:00",
    kicker: { pt: "Depoimento", zh: "证言" },
    title: { pt: "Uma voz do novo momento brasileiro", zh: "来自巴西新阶段的声音" },
    tone: "solemn",
    stageNote: "Vídeo 1 · Alexander Assunção (CNAA), 60–90s, legendado. Após o vídeo, dizer a frase de fecho.",
    script: `Quero que vocês ouçam agora uma voz importante desse novo momento do Brasil: Alexander Assunção, presidente do Conselho Nacional de Autorregulamentação da Acupuntura.

[Após o vídeo] Esse é o espírito do momento que o Brasil vive. E é nesse momento que o MedChina renasceu.`,
    media: {
      kind: "video",
      label: {
        pt: "Depoimento · Conselho Nacional de Autorregulamentação da Acupuntura",
        zh: "证言 · 巴西针灸自律全国委员会",
      },
      duration: "60–90s",
      sourceUrl: "/videos/palestra/depoimento-1-alexander-assuncao.mp4",
      speaker: { pt: "Alexander da Silveira Assunção", zh: "Alexander da Silveira Assunção" },
      role: { pt: "Presidente do CNAA", zh: "CNAA 主席" },
      productionNote:
        "Vídeo legendado em mandarim, 16:9, 60–90s. Salvar em apps/web/public/videos/palestra/depoimento-1-alexander-assuncao.mp4.",
    },
  },
  {
    key: "motto",
    roteiroSlide: 13,
    block: 7,
    blockTitle: { pt: "O prontuário que escuta", zh: "会倾听的病历" },
    timeRange: "26:00–34:30",
    kicker: { pt: "O que rouba a atenção do terapeuta", zh: "什么夺走了医者的专注" },
    title: { pt: "Atenda olhando para o paciente", zh: "目视患者，全心诊疗" },
    subtitle: { pt: "O MedChina organiza o restante", zh: "其余的记录，交给 MedChina" },
    stageNote: 'Slide 13 · MedChina AI — "Atenda olhando para o paciente. O MedChina organiza o restante."',
    script: `E é nesse novo momento que nasce o MedChina AI.

O MedChina de hoje nasceu de uma pergunta simples: o que rouba a atenção do terapeuta durante a consulta?

O computador. A tela. A digitação.

Enquanto registra, o profissional pode perder contato visual, fragmentar a escuta e levar trabalho para casa.

O MedChina AI foi criado para devolver essa atenção ao paciente.`,
  },
  {
    key: "flow",
    roteiroSlide: 14,
    block: 7,
    blockTitle: { pt: "O prontuário que escuta", zh: "会倾听的病历" },
    timeRange: "26:00–34:30",
    kicker: { pt: "Uma consulta, do começo ao fim", zh: "一次完整的诊疗" },
    title: { pt: "Antes, durante e depois da consulta", zh: "诊前、诊中、诊后" },
    subtitle: {
      pt: "O que antes tomava uma hora do dia acontece enquanto ela atende",
      zh: "过去每天要花一小时的事，如今在诊疗中即已完成",
    },
    stageNote: "Slide 14 · O fluxo: antes, durante e depois da consulta. Telas reais do sistema atual.",
    script: `Durante a consulta, com o consentimento do paciente, o celular ou computador pode capturar o áudio.

O profissional pode olhar, escutar, observar e examinar.

Depois, o sistema transcreve a conversa, separa a fala do profissional e do paciente e organiza a anamnese.

São estruturados dados como queixa principal, história atual, sono, energia, alimentação, digestão, aspectos emocionais e avaliação pela medicina chinesa.`,
  },
  {
    key: "traceability",
    roteiroSlide: 15,
    block: 7,
    blockTitle: { pt: "O prontuário que escuta", zh: "会倾听的病历" },
    timeRange: "26:00–34:30",
    kicker: { pt: "Respeito pela clínica", zh: "对临床的敬重" },
    title: { pt: "Anamnese preenchida com origem rastreável", zh: "可溯源的结构化问诊" },
    subtitle: {
      pt: "Nada aparece no prontuário sem que se possa verificar de onde saiu",
      zh: "凡入病历，皆可回溯其出处",
    },
    stageNote: "Slide 15 · Anamnese preenchida com origem rastreável.",
    script: `Mas há algo que considero fundamental: cada informação preenchida guarda sua origem, permitindo ao profissional ouvir o trecho correspondente do áudio.

Se o paciente não informou alguma coisa, o sistema não transforma silêncio em resposta negativa. O campo permanece como “não informado”.

O sistema também pode apontar lacunas, contradições e mudanças em relação ao histórico.`,
  },
  {
    key: "hypotheses",
    roteiroSlide: 16,
    block: 7,
    blockTitle: { pt: "O prontuário que escuta", zh: "会倾听的病历" },
    timeRange: "26:00–34:30",
    kicker: { pt: "Apoio ao raciocínio clínico", zh: "临床推理辅助" },
    title: { pt: "Hipóteses de padrões de desarmonia", zh: "证型假说" },
    subtitle: {
      pt: "Sinais que favorecem · sinais que contradizem · dados que faltam",
      zh: "支持的征象 · 不支持的征象 · 尚待查证",
    },
    stageNote: "Slide 16 · Hipóteses de padrões + as quatro camadas + a frase do contrato ético (ler verbatim).",
    script: `A partir dos dados organizados, o MedChina AI prepara hipóteses de padrões de desarmonia.

Para cada hipótese, apresenta os sinais que favorecem, os que contradizem e os dados que ainda faltam.

Depois que o profissional valida um padrão, o sistema pode preparar sugestões de pontos e combinações, estratégias de tonificação ou dispersão e apoio a técnicas como moxabustão, auriculoterapia, ventosaterapia e dietoterapia chinesa, com checagem de contraindicações.

Também pode preparar o plano terapêutico e os documentos para casa do paciente.

Mas a decisão final continua sendo do profissional.

O prontuário diferencia aquilo que o paciente relatou, aquilo que o profissional observou, aquilo que a inteligência artificial inferiu e aquilo que o profissional decidiu.

Essa separação é essencial.`,
  },
  {
    key: "testimony-user",
    block: 7,
    blockTitle: { pt: "O prontuário que escuta", zh: "会倾听的病历" },
    timeRange: "26:00–34:30",
    kicker: { pt: "Depoimento", zh: "证言" },
    title: { pt: "Como ter um colega na sala", zh: "仿佛诊室里多了一位同道" },
    subtitle: {
      pt: "Quem trabalha sozinho em consultório sabe o valor disso",
      zh: "独自执业的人，最懂这份价值",
    },
    stageNote: "Vídeo 2 · Hellen, usuária do MedChina, 60–90s, legendado.",
    script: `Nossos usuários descrevem essa experiência de um jeito que me emociona: como ter um colega na sala. Um mentor que auxilia no raciocínio, apresenta pontos de vista e faz avaliações cuidadosas que nos fazem ver mais e melhor o cenário do paciente. Quem trabalha sozinho em consultório sabe o valor disso.

Mas ninguém explica isso melhor do que quem usa. Ouçam a Hellen.`,
    media: {
      kind: "video",
      label: { pt: "Depoimento · usuária do MedChina", zh: "证言 · MedChina 使用者" },
      duration: "60–90s",
      sourceUrl: "/videos/palestra/depoimento-2-hellen.mp4",
      speaker: { pt: "Hellen", zh: "Hellen" },
      role: { pt: "Terapeuta de MTC · usuária do MedChina", zh: "中医治疗师 · MedChina 用户" },
      productionNote:
        "Vídeo legendado em mandarim, 16:9, 60–90s. Salvar em apps/web/public/videos/palestra/depoimento-2-hellen.mp4.",
    },
  },
  {
    key: "library-security",
    roteiroSlide: 17,
    block: 7,
    blockTitle: { pt: "O prontuário que escuta", zh: "会倾听的病历" },
    timeRange: "26:00–34:30",
    kicker: { pt: "Dois pontos finais sobre a plataforma", zh: "关于平台的最后两点" },
    title: { pt: "Biblioteca clínica e segurança", zh: "临床知识库与数据安全" },
    subtitle: {
      pt: "Fontes citadas, consentimento por finalidade e nenhum dado em modelos públicos",
      zh: "出处可引 · 分项授权 · 不用于公开模型",
    },
    stageNote: "Slide 17 · Biblioteca clínica e segurança.",
    script: `A plataforma também possui uma biblioteca clínica com base de conhecimento de medicina chinesa e respostas acompanhadas de fontes.

E existe uma questão que não pode ser secundária: segurança.

Com o consentimento do paciente, os dados são criptografados, os acessos ficam registrados em trilha de auditoria e, segundo a arquitetura do sistema, os áudios e conteúdos clínicos não são utilizados para treinar modelos públicos de inteligência artificial.

O MedChina também mantém uma versão gratuita com prontuário manual, cadastro de pacientes e registros ilimitados.

O que se paga é a automação: o tempo que a tecnologia devolve ao profissional.`,
  },
  {
    key: "four-examinations",
    roteiroSlide: 18,
    block: 8,
    blockTitle: { pt: "Tecnologia que respeita a tradição", zh: "尊重传统的技术" },
    timeRange: "34:30–37:00",
    kicker: { pt: "望 · 闻 · 问 · 切", zh: "四诊合参" },
    title: { pt: "O que a inteligência artificial não faz", zh: "人工智能不做的事" },
    subtitle: {
      pt: "A tecnologia faz o papel do discípulo. A medicina continua sendo do mestre.",
      zh: "技术只做门徒的角色，医道仍属于医者",
    },
    stageNote: "Slide 18 · O que a IA não faz (望闻问切 em destaque).",
    script: `Eu sei que falar de inteligência artificial em medicina tradicional chinesa pode parecer uma contradição.

Para mim, é justamente o contrário.

A medicina chinesa é uma medicina de presença.

Vocês conhecem isso melhor do que ninguém: wàng, wén, wèn, qiè — observar, ouvir e cheirar, perguntar e palpar.

O MedChina AI não olha, não palpa e não decide.

Ele escuta, organiza, lembra e pergunta.

Ele ajuda a devolver ao profissional aquilo que a burocracia pode roubar: tempo e atenção.

Com a nova regulamentação, o registro clínico também ganha ainda mais importância.

Um prontuário bem feito protege o paciente, protege o profissional e dignifica a profissão.`,
  },
  {
    key: "bridge",
    roteiroSlide: 19,
    block: 9,
    blockTitle: { pt: "A ponte Brasil–China", zh: "巴西—中国之桥" },
    timeRange: "37:00–40:00",
    kicker: { pt: "Cooperação que já existe", zh: "已然存在的合作" },
    title: { pt: "Instituto Confúcio de Medicina Chinesa", zh: "中医孔子学院" },
    subtitle: {
      pt: "Goiânia · Universidade Federal de Goiás e Universidade de Medicina Chinesa de Hebei",
      zh: "戈亚尼亚 · 戈亚斯联邦大学与河北中医药大学",
    },
    stageNote: "Slide 19 · Instituto Confúcio de Medicina Chinesa — Goiânia.",
    script: `Quero terminar falando de uma ponte entre nossos dois países.

Desde 2019, Goiânia sedia o Instituto Confúcio de Medicina Chinesa, uma parceria entre a Universidade Federal de Goiás e a Universidade de Medicina Chinesa de Hebei.

Essa cooperação aproxima nossos dois países.

O Brasil tem centenas de milhares de profissionais interessados em conhecimento de qualidade.

A China tem fontes, mestres e uma experiência clínica acumulada por milênios.

Entre os dois países, podemos construir ainda mais pontes.

Nós queremos ser uma delas.

Universidades, professores e instituições chinesas que desejem alcançar o público brasileiro podem encontrar no MedChina AI um canal direto com essa comunidade — por meio de eventos, cursos e conteúdo de referência, com a devida curadoria e licença, dentro da biblioteca clínica.

A medicina chinesa cresceu no Brasil por dois séculos sem falar português.

Imaginem o que ela pode fazer agora que aprendeu.`,
  },
  {
    key: "closing",
    roteiroSlide: 20,
    block: 9,
    blockTitle: { pt: "Encerramento", zh: "闭幕" },
    timeRange: "37:00–40:00",
    kicker: { pt: "Do papel ao prontuário inteligente", zh: "从纸质病历到智能病历" },
    title: { pt: "Obrigada · 谢谢", zh: "谢谢 · Obrigada" },
    subtitle: {
      pt: "Honrando os ancestrais que escreveram cada ideograma",
      zh: "以敬那些写下每一个汉字的先贤",
    },
    stageNote: "Slide 20 · Encerramento — logo MedChina + agradecimento + QR. Abrir para perguntas, se houver tempo.",
    script: `Termino com uma imagem simples.

Um prontuário que escuta, organiza e prepara, para que o terapeuta brasileiro possa fazer aquilo que os mestres desta terra fazem há milênios: olhar para o paciente.

Nossa caminhada ainda é longa.

Mas queremos continuar expandindo, divulgando, ensinando e praticando a medicina chinesa no Brasil, sempre com respeito aos ancestrais que construíram essa arte e essa sabedoria.

Que a tecnologia nos ajude a preservar aquilo que é essencialmente humano na nossa profissão.

Muito obrigada. 谢谢 — Xièxie.`,
  },
];
