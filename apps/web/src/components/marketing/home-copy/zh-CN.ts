import type { HomeCopy } from "./pt-BR";

/**
 * Simplified Chinese home copy. Typed against the pt-BR original, so a key
 * added, renamed or dropped there fails this file at compile time.
 *
 * Two things this language needs that the others do not:
 * - The brand faces (Mulish, TT Chocolates) carry no Han glyphs. The platform
 *   CJK families are appended to the landing font stacks (--cjk in
 *   clinical-source-home.css), so Latin text keeps the brand face and only the
 *   Han characters fall through to the system face.
 * - Headlines take their OWN line breaks (\n): Chinese has no spaces, so a
 *   break borrowed from the Portuguese would land mid-phrase.
 */
export const homeCopy: HomeCopy = {
  meta: {
    title: "MedChina | 中医智能病历与临床助手",
    description: "在一个为中医打造的平台上管理患者、问诊记录、分析与治疗方案。AI 负责整理，判断与决定始终由您完成。",
  },

  nav: {
    brandAria: "MedChina — 首页",
    desktopAria: "主导航",
    mobileAria: "移动端导航",
    howItWorks: "如何运作",
    features: "功能",
    security: "安全",
    plans: "套餐",
    signIn: "登录",
    signUp: "免费注册",
    openMenu: "打开菜单",
    closeMenu: "关闭菜单",
  },

  language: {
    label: "语言",
    ariaLabel: "选择网站语言",
    names: {
      "pt-BR": "Português (Brasil)",
      en: "English",
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      "zh-CN": "简体中文",
    },
    notice: {
      message: "我们根据您浏览器的语言设置，以简体中文显示本网站。",
      switchToDefault: "查看葡萄牙语版本",
      dismiss: "关闭提示",
    },
  },

  hero: {
    eyebrow: "从初诊主诉到疗程随访，始终清晰",
    title: "您的中医临床工作，\n由一套**您来监督**的\nAI 来支持。",
    lead: "记录诊疗过程、结构化问诊内容、串联临床证型，全程可追溯，而判断权始终在您手中。",
    ctaPrimary: "免费注册",
    ctaSecondary: "了解平台",
    guarantee: "14 天免费试用，无需银行卡 · 随时取消",
    trustAria: "保障",
    trust: ["知情同意", "全程可追溯", "临床掌控权"],
    principle: "__AI 负责整理。__\n解读、确认与决定由您完成。",
    stageAria: "MedChina 的电脑端与手机端",
    compositeAlt: "中医师在电脑和手机上使用 MedChina",
    platformAria: "支持 iOS 与 Android 的应用",
    availableFor: "支持",
    insights: [
      { title: "信息可溯源", detail: "保留原始出处与上下文。" },
      { title: "假设供您复核", detail: "所有建议都需要您的判断。" },
      { title: "方案由您决定", detail: "治法与调整均由您确定。" },
    ],
  },

  valueStrip: {
    ariaLabel: "MedChina 的主要价值",
    items: ["按中医语言结构化的问诊", "可自定义的模板与方案", "智能辅助的疗效追踪", "全流程的安全与隐私保护"],
  },

  flow: {
    eyebrow: "全流程，不断档",
    title: "在倾听、辨证与随访之间，\n形成一条**连贯**的主线。",
    lead: "从初次接触到后续随访，MedChina 以结构、上下文与安全性串联诊疗的每一个环节。",
    steps: {
      consulta: {
        label: "接诊",
        title: "诊疗从上下文与知情同意开始。",
        body: "选择患者、登记授权，并决定如何准备本次诊疗。录音与观察记录始终归属于同一份病历。",
        proof: "接诊过程中同意状态与下一步清晰可见",
        alt: "MedChina 中准备诊疗录音并登记知情同意的界面",
      },
      anamnese: {
        label: "问诊",
        title: "对话自动落入临床结构。",
        body: "主诉、现病史及其他条目汇总为一份清晰的问诊记录供您复核——沉默不会被当作答案。",
        proof: "结构化条目，可编辑、可复核",
        alt: "MedChina 病历中结构化问诊记录的界面",
      },
      plano: {
        label: "方案与随访",
        title: "由您确认治法，并追踪变化。",
        body: "治疗方案始终可编辑，并与既往记录相连。平台准备下一步，您复核、调整并作出决定。",
        proof: "由医师确认的治疗方案",
        alt: "MedChina 中诊疗录音与已确认治疗方案的界面",
      },
    },
  },

  presence: {
    eyebrow: "临床在场",
    title: "技术退到幕后，\n**医患关系留在中心。**",
    lead: "中医诊疗依赖倾听、观察与个体化判断。MedChina 减少事务性负担，让您只复核真正需要决定的部分。",
    railLabel: "实际工作中的变化",
    railHint: "查看各项价值",
    principle: "__没有看不见的自动化。__ 每一步都由医师复核、调整并确认。",
    benefits: [
      {
        id: "listen",
        title: "专注于患者，而不是表单",
        body: "借助手机录音与语音指令，减少诊疗过程中的打字。",
      },
      {
        id: "fields",
        title: "对话自动进入正确的条目",
        body: "症状、生活习惯、情志、用药、检查与病情变化，整理好后交由您复核。",
      },
      {
        id: "history",
        title: "看清变化",
        body: "对比整个随访过程中的主诉、症状、所用技法与反应。",
      },
      {
        id: "hypotheses",
        title: "有依据的证型假设",
        body: "在 Pro 版中，可能的证型会列出支持依据、矛盾之处、缺失信息与参考来源。",
      },
      {
        id: "plan",
        title: "从证型到方案",
        body: "协定处方、医嘱与草稿自动整理，无需从零开始。",
      },
      {
        id: "decision",
        title: "决定权仍属于您",
        body: "没有任何内容会自动定稿。编辑、否决、确认与签署都由您完成。",
      },
    ],
    visualAria: "MedChina 支持下的临床在场",
    visualAlt: "中医师在诊疗中倾听患者叙述",
    visualTag: "专注于诊疗",
    proofTitle: "把倾听留住",
    proofDetail: "诊疗中更少盯着屏幕",
    focusLabel: "当前聚焦",
    focusAiOrganizes: "AI 负责整理",
    focusYouValidate: "由您确认",
  },

  mobile: {
    eyebrow: "MedChina 手机端",
    title: "手机负责采集诊疗内容。**平台负责整理诊疗记录。**",
    lead: "手机应用用于经授权的录音与语音记录观察。网页端则用于复核问诊、分析与治疗方案。",
    checks: [
      "当日诊疗安排与安全选择患者",
      "录音前先取得知情同意",
      "暂停、继续并随时记录观察",
      "以语音记录舌象、脉象与触诊",
    ],
    offlineTitle: "网络不稳定，不等于诊疗记录丢失。",
    offlineDetail: "录音会被保留，待网络恢复后自动上传。",
    showcaseAria: "MedChina 应用的交互演示",
    deviceAlt: "运行 MedChina 应用的智能手机",
    platformChipAria: "支持 iOS 与 Android 的应用",
    platformChipLabel: "iOS 与 Android",
    bubblesAria: "应用亮点",
    highlights: [
      {
        id: "consent",
        label: "同意已生效",
        title: "受保护的录音",
        detail: "采集前，授权已与本次诊疗绑定。",
      },
      {
        id: "voice",
        label: "语音记录观察",
        title: "无需打字的上下文",
        detail: "舌象、脉象与临床笔记可在诊疗中随时录入。",
      },
      {
        id: "sync",
        label: "安全同步",
        title: "录音妥善保存",
        detail: "确认上传成功后，才会删除设备上的副本。",
      },
    ],
    phone: {
      secure: "已受保护",
      inProgress: "诊疗进行中",
      patientName: "Helena Martins",
      patientKind: "复诊 · 针灸",
      patientWhen: "今天 09:00 · 已确认同意",
      recording: "录音中",
      paused: "已暂停",
      audioAuthorized: "录音已授权",
      resume: "继续",
      pause: "暂停",
      noteAdded: "笔记已添加",
      addNote: "添加笔记",
      noteHint: "语音或文字",
      observation: "舌象与脉象",
      observationHint: "记录观察",
      tabConsult: "诊疗",
      tabHistory: "历史",
      tabRecord: "病历",
    },
  },

  supervised: {
    eyebrow: "受监督的 AI",
    title: "问诊自动填写，但绝不把**未提及当作否定。**",
    lead: "MedChina 整理患者所述内容，保留每条信息的出处，未提及的条目一律留空。",
    conversation: {
      sourceLabel: "临床来源",
      title: "虚构对话 · Helena Martins",
      time: "14:32–14:46",
      quote: "“我每天晚上大概会==醒三次==。觉得==很热==，有时候会==出汗==醒过来。”",
      playAria: "播放片段",
      pauseAria: "暂停片段",
      playingLabel: "正在播放片段",
      originalLabel: "原始片段",
      speaker: "患者 · 已授权录音",
      duration: "0:14",
    },
    bridgeLabel: "AI 整理",
    prepared: {
      badge: "受监督的整理",
      title: "已准备的问诊记录",
      summary: "整理 3 个条目 · 未作出任何决定",
      reviewChip: "必须复核",
      listen: "收听出处",
      noEvidence: "录音中没有相关依据",
      fields: [
        {
          id: "sleep",
          label: "睡眠",
          value: "夜间约醒三次。",
          state: "依据明确",
        },
        {
          id: "evolution",
          label: "病情变化",
          value: "已述频次；起病时间与病情演变尚未提及。",
          state: "需要留意",
        },
        {
          id: "observation",
          label: "舌象与脉象",
          value: "等待医师直接观察。",
          state: "未提供",
        },
      ],
      footerTitle: "没有任何内容自动定稿",
      footerDetail: "由您复核、调整并确认后，才会存入病历。",
    },
    traceability: [
      { id: "origin", title: "出处可回溯", detail: "每个条目都与对应的录音片段保持关联。" },
      {
        id: "authorship",
        title: "来源不混淆",
        detail: "患者、医师、AI 与最终决定始终区分清楚。",
      },
      { id: "validation", title: "明确确认", detail: "经您复核后，病历才会继续推进。" },
    ],
  },

  mtc: {
    eyebrow: "专业定位",
    title: "一套依照**中医思维**构建的病历系统。",
    lead: "不必把您的诊疗塞进通用病历，MedChina 按中医临床的要素来组织整个评估过程。",
    quote: "“使用 MedChina 的模板，按需调整问诊结构，保留您自己的出诊方式。”",
    categories: [
      "主诉",
      "睡眠与精力",
      "饮食与消化",
      "情志与生活背景",
      "阴阳",
      "气、血、津液",
      "脏腑",
      "五行",
      "舌象",
      "脉象",
      "针灸",
      "耳穴",
    ],
  },

  security: {
    eyebrow: "安全",
    title: "临床数据需要的不只是便利，**而是掌控。**",
    lead: "安全、可追溯与数据最小化贯穿整个临床流程——从知情同意到修改记录。",
    cards: [
      {
        id: "consent",
        title: "分项知情同意",
        body: "录音、转写、AI 与影像可分别授权，并保留版本记录。",
      },
      {
        id: "access",
        title: "受保护的访问",
        body: "双因素认证、会话管理、加密与访问日志。",
      },
      {
        id: "audio",
        title: "录音可控",
        body: "只有在安全确认上传之后，本地副本才会被删除。",
      },
      {
        id: "history",
        title: "修改记录",
        body: "定稿、修改与补充说明均可追溯，含操作者、时间与版本。",
      },
    ],
  },

  pricing: {
    eyebrow: "透明的套餐",
    title: "按自己的节奏开始。\n**需要时再启用自动化。**",
    lead: "先用一套完整的临床基础功能起步，再用两档受监督的自动化节省时间，而不放弃判断权。",
    trustAria: "开始使用的条件",
    trust: ["免费账户即可起步", "Pro 试用由您触发", "无需银行卡，不自动扣费"],
    plans: {
      gratuito: { eyebrow: "临床基础", badge: "从这里开始", cta: "免费注册" },
      assistente: { eyebrow: "自动记录", badge: "多数人的选择", cta: "开始使用自动化" },
      pro: { eyebrow: "受监督的智能", badge: "功能最完整", cta: "了解 Pro" },
    },
    defaultEyebrow: "套餐",
    defaultCta: "免费注册",
    offerEyebrow: "活动价格",
    offerCta: "立即订阅",
    offerTitle: "这是本次活动的条件。\n**以本页价格，在活动开放期间有效。**",
    offerLead: "免费账户和 Pro 试用依然存在，只是不是从这里出发的路径。在本页，您可以直接订阅想要的方案。",
    offerTrustAria: "本次优惠的条件",
    offerTrustGuarantee: "{days} 天退款保证",
    offerTrustDeadline: "优惠有效期至 {date}",
    offerAssuranceTitle: "{days} 天退款保证。",
    offerAssuranceDetail: "如果不适合您的临床工作，可在 {days} 天内申请退款，全额退回。",
    included: "包含内容",
    assuranceTitle: "开始工作时，试用才开始。",
    assuranceDetail:
      "Pro 试用在您第一次实际使用时启动——录音、排期、导入病历或使用临床文献库——并会立即通知您。不会自动产生任何费用。",
    assuranceLink: "查看常见问题",
  },

  faq: {
    eyebrow: "常见问题",
    title: "常见问题解答",
    lead: "关于免费套餐、试用以及人工智能所扮演角色的关键答案。",
    cta: "免费开始使用",
    items: [
      {
        question: "可以免费使用 MedChina 吗？",
        answer:
          "可以。免费套餐支持登记患者、记录诊疗并使用手动录入的临床功能，患者数量与病历数量均不限。录音、转写与自动化属于付费套餐及 Pro 试用。",
      },
      {
        question: "注册账户时试用就开始了吗？",
        answer:
          "不会。注册账户、完善资料和浏览平台都不消耗任何额度。Pro 试用会在您第一次实际使用时自动开始——录制一次诊疗、安排一次就诊、导入既往病历或使用临床文献库——并会在开始的那一刻通知您。",
      },
      {
        question: "试用 Pro 需要绑定银行卡吗？",
        answer: "不需要。试用无需绑定银行卡，也不会自动扣费。",
      },
      {
        question: "AI 会替我作出临床决定吗？",
        answer:
          "不会。AI 负责整理信息、指出缺失，在 Pro 版中还会准备证型假设与治疗思路。复核、确认与最终决定始终由医师完成。",
      },
      {
        question: "对于未提及的条目，AI 会编造答案吗？",
        answer:
          "未提及的内容一律留空——未提及绝不等同于否定。含糊或前后矛盾的条目会被标注，且每一条提取出的信息都可回溯到诊疗中的对应片段。",
      },
      {
        question: "手机应用可以取代网页版吗？",
        answer:
          "不能。手机应用是补充，专注于录音采集、语音指令与处理状态查看。完整复核、治疗方案与各项设置都在网页端完成。",
      },
      {
        question: "我的数据会被用于训练公开模型吗？",
        answer:
          "MedChina 的政策禁止将临床信息用于训练公开模型。关于服务商、数据留存与处理方式的细节，请见隐私说明文档。",
      },
    ],
  },

  finalCta: {
    eyebrow: "下一次接诊，可以不一样",
    title: "更专注于诊疗。**更清晰地决策。**",
    lead: "整理您的患者资料，了解各项临床功能，并在确有需要时再启用自动化。",
    ctaPrimary: "创建我的免费账户",
    ctaSecondary: "了解如何运作",
    bullets: ["病历数量不限", "试用由您触发", "不自动扣费"],
  },

  footer: {
    tagline: "面向中医的病历系统与临床思路辅助。",
    productTitle: "产品",
    accountTitle: "账户",
    companyTitle: "公司",
    signUp: "免费开始使用",
    helpCenter: "帮助中心",
    about: "关于我们",
    contact: "联系我们",
    privacy: "隐私",
    rights: "© 2026 MedChina. 保留所有权利。",
    disclaimer: "MedChina 不能替代专业评估、体格检查、望舌、切脉、禁忌症判断，以及必要时的转诊。",
  },
};
