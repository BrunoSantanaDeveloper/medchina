import type { AmbientMedia } from "../presentation/types";

/**
 * The product demo deck (`/demonstracao`): three slides that show MedChina to
 * anyone, with no event, audience or date attached.
 *
 * Everything here is drawn from the congress deck (`components/presentation/`)
 * and checked against the code it describes — the claims are the ones the
 * product enforces, never more:
 *
 * - **No prices, no trial length, no counts.** Those are configurable data
 *   (plans, `platform_settings`) and change; a deck that gets forwarded must not
 *   carry a number that may already be wrong. The free tier is named only as
 *   the home names it.
 * - **The AI never diagnoses.** It prepares drafts and hypotheses; the
 *   professional reviews, edits, validates and signs (CLAUDE.md, PRD §10/§16).
 * - **Offline capture is encrypted on the device** — true on both capture
 *   surfaces: the web recorder (IndexedDB + AES-GCM) and the app
 *   (`apps/mobile/src/lib/recording-crypto.ts`).
 * - **Screenshots carry no patient name.** The congress deck's agenda capture
 *   shows one, so this deck does not use it.
 *
 * Portuguese only, written to the reader as "você".
 */

export interface DemoSlide {
  key: "produto" | "como-funciona" | "decisao";
  kicker: string;
  /** The full title — what the counter, the export caption and `aria-label` read. */
  title: string;
  subtitle?: string;
}

/* ------------------------------------------------------------------ */
/* 01 · what it is                                                     */
/* ------------------------------------------------------------------ */

/** The brand line, split so the second sentence takes the accent colour. */
export const MOTTO = "Atenda olhando para o paciente.";
export const MOTTO_EM = "O MedChina organiza o restante.";

export const PROBLEM_LABEL = "O que o teclado tira da consulta";

export const PROBLEMS: string[] = [
  "Digitar durante o atendimento rouba o contato visual",
  "Digitar fragmenta a escuta",
  "Não registrar na hora é reconstruir a consulta de memória, à noite",
];

/**
 * The accelerated consultation the congress deck runs on its motto slide —
 * the same file, so the two decks can never show different products. The
 * caption says the clip is sped up, because a replay at speed with no word
 * about it claims a pace the product does not have.
 *
 * `AmbientMedia` is the shared, bilingual media type; this deck projects only
 * `pt`, and the Chinese strings are the congress deck's own for the same clip.
 */
export const PRODUCT_CLIP: AmbientMedia = {
  kind: "ambient",
  label: {
    pt: "Uma consulta registrada no MedChina, em velocidade acelerada",
    zh: "一次在 MedChina 中完成的诊疗记录，加速播放",
  },
  sourceUrl: "/videos/palestra/consulta-acelerada.mp4",
  poster: "/videos/palestra/consulta-acelerada-poster.jpg",
  // The picture is 1920x879 inside a 1920x1080 file; see the congress deck.
  aspect: "1920 / 872",
  caption: {
    pt: "Consulta registrada no MedChina · velocidade acelerada",
    zh: "平台中的诊疗记录 · 加速播放",
  },
  standby: { pt: "Uma consulta, do áudio à anamnese", zh: "一次诊疗：从录音到问诊" },
  productionNote: "",
};

/* ------------------------------------------------------------------ */
/* 02 · how it works                                                   */
/* ------------------------------------------------------------------ */

export interface DemoStep {
  step: string;
  label: string;
  title: string;
  body: string;
  image: string;
  imageAlt: string;
  /** CSS object-position — each capture has what matters in a different place. */
  imageFocus: string;
  /**
   * The action the step is about sits on the capture's bottom edge (the record
   * buttons, "Validar plano"), so the edge is shown as it is instead of under
   * the fade the flow cards put over a crop — a faded button reads as disabled.
   */
  keepEdge?: boolean;
}

export const FLOW_STEPS: DemoStep[] = [
  {
    step: "01",
    label: "Durante",
    title: "Grave a consulta",
    body: "Com o consentimento do paciente registrado, o celular ou o computador grava o atendimento. Você não digita: olha, escuta, examina e dita em voz alta o que vê na língua e sente no pulso.",
    image: "/images/audio-capta-mobile.jpg",
    imageAlt:
      "Gravação em andamento no MedChina, com cronômetro, nível do áudio e os botões Pausar e Encerrar e enviar",
    imageFocus: "50% 100%",
    keepEdge: true,
  },
  {
    step: "02",
    label: "Depois",
    title: "A anamnese chega preenchida",
    body: "A conversa é transcrita separando a sua fala da fala do paciente, e cada informação vai para o campo certo com o trecho do áudio de onde saiu. O que ninguém disse fica como “não informado”.",
    image: "/images/anamnese-automatica.jpg",
    imageAlt:
      "Anamnese preenchida a partir da gravação, com os selos Requer atenção e Relato da paciente e o atalho para ouvir o trecho do áudio",
    imageFocus: "0% 100%",
  },
  {
    step: "03",
    label: "Você decide",
    title: "Hipóteses e plano, como rascunho",
    body: "Quando você pede, o MedChina prepara hipóteses de padrões de desarmonia, com sinais a favor, sinais contra e o que falta investigar, e o rascunho do plano terapêutico por modalidade. Você aceita, edita ou recusa.",
    image: "/images/medchina-flow-plano-real.webp",
    imageAlt: "Painel do plano terapêutico no MedChina, com os botões Validar plano e Editar plano",
    imageFocus: "100% 100%",
    keepEdge: true,
  },
];

export const CONSENT_NOTE =
  "O paciente autoriza a gravação e o processamento por IA em separado. Recusar nunca impede o atendimento manual.";

export const OFFLINE_NOTE =
  "Se a internet cair, a gravação continua guardada e criptografada no aparelho, e é enviada sozinha quando a conexão volta.";

/* ------------------------------------------------------------------ */
/* 03 · who decides                                                    */
/* ------------------------------------------------------------------ */

/** A run of quote text; `m` marks the stretches the AI actually extracted. */
export interface QuoteSegment {
  t: string;
  m?: boolean;
}

export interface EvidenceField {
  label: string;
  value: string;
  state: string;
  tone: "clear" | "attention" | "missing";
  /** Timestamp of the audio excerpt this field points back to. */
  source?: string;
}

/**
 * The worked example — the same fictitious consultation the home and the
 * congress deck use. Its three fields ARE the honesty states of the product: a
 * clear extraction with its audio source, a gap flagged for attention, and a
 * field that stays "não informado" because tongue and pulse are the
 * professional's own observation, never inferred from the patient's speech.
 */
export const EVIDENCE = {
  timestamp: "14:32",
  duration: "0:14",
  speaker: "Paciente · áudio autorizado",
  player: "Trecho original",
  organized: "a IA organiza",
  quote: [
    { t: "Tenho acordado umas " },
    { t: "três vezes durante a noite", m: true },
    { t: ". Sinto " },
    { t: "muito calor", m: true },
    { t: " e às vezes acordo " },
    { t: "suando", m: true },
    { t: "." },
  ] as QuoteSegment[],
  fields: [
    {
      label: "Sono",
      value: "Desperta aproximadamente três vezes durante a noite.",
      state: "Evidência clara",
      tone: "clear",
      source: "14:32",
    },
    {
      label: "Evolução",
      value: "Frequência relatada; início e evolução ainda não informados.",
      state: "Requer atenção",
      tone: "attention",
      source: "14:32",
    },
    {
      label: "Língua e pulso",
      value: "Aguardando a sua observação direta.",
      state: "Não informado",
      tone: "missing",
    },
  ] as EvidenceField[],
  footer: "Nada é finalizado automaticamente: você revisa, ajusta e confirma.",
};

/**
 * Three of the four rules the software checks AFTER the model answers
 * (`lib/clinical-extraction.ts`, `lib/clinical-safety.ts`). The fourth —
 * silence never becomes a record — is the third field of the example beside
 * them, so it is shown instead of repeated.
 */
export const GUARANTEES: { title: string; body: string }[] = [
  {
    title: "Cada dado aponta para a fala real",
    body: "Todo valor traz a frase, o minuto e quem falou. Se a frase não está na transcrição, o valor volta como não confirmado.",
  },
  {
    title: "Exame de MTC só vale na sua voz",
    body: "Língua, pulso, palpação e padrão só entram quando ditados por você. Achado atribuído à fala do paciente é descartado.",
  },
  {
    title: "Tema sensível sempre volta para você",
    body: "Medicamentos, gestação, anticoagulantes, marca-passo, cirurgias e alergias são sempre marcados para revisão.",
  },
];

/** The way in. The QR is a real one for the domain (see the congress deck README). */
export const CTA = {
  title: "Conheça o MedChina",
  site: "medchinaprontuarios.com.br",
  siteUrl: "https://medchinaprontuarios.com.br",
  qr: "/images/palestra/qr-medchina.svg",
  line: "Conta gratuita para começar, com o prontuário manual completo. Gravação e IA fazem parte dos planos pagos.",
};

/* ------------------------------------------------------------------ */
/* The deck                                                            */
/* ------------------------------------------------------------------ */

export const DEMO_SLIDES: DemoSlide[] = [
  {
    key: "produto",
    kicker: "Prontuário inteligente para Medicina Tradicional Chinesa",
    title: `${MOTTO} ${MOTTO_EM}`,
  },
  {
    key: "como-funciona",
    kicker: "Como funciona",
    title: "Da conversa ao prontuário, em três passos",
    subtitle: "Você atende. O registro acontece enquanto isso e chega organizado para a sua revisão.",
  },
  {
    key: "decisao",
    kicker: "Quem decide",
    title: "A IA prepara. A decisão é sempre sua.",
    subtitle: "Tudo chega como rascunho: nada entra no prontuário como fato antes da sua validação.",
  },
];
