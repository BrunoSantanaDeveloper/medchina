"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import {
  AndroidLogo,
  ArrowRight,
  ArrowUpRight,
  AppleLogo,
  BatteryFull,
  CaretDown,
  CellSignalFull,
  ChatCircleText,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  CloudCheck,
  Database,
  DotsThree,
  Eye,
  FileText,
  Fingerprint,
  Headphones,
  List,
  LockKey,
  MinusCircle,
  MoonStars,
  Notebook,
  Pause,
  Play,
  Plus,
  SealCheck,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Stethoscope,
  TrendUp,
  WarningCircle,
  Waveform,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

const signUpUrl = "https://medchina-wheat.vercel.app/auth/sign-up";
const signInUrl = "https://medchina-wheat.vercel.app/auth/sign-in";

const faqItems = [
  {
    question: "Posso usar o MedChina gratuitamente?",
    answer:
      "Sim. O plano Gratuito permite cadastrar pacientes, registrar consultas e usar os recursos clínicos manuais sem limite de pacientes ou prontuários. Gravação, transcrição e automação fazem parte dos planos pagos e do trial Pro.",
  },
  {
    question: "O trial começa quando eu criar minha conta?",
    answer:
      "Não. Você pode conhecer e configurar o MedChina gratuitamente. O trial Pro começa somente quando você decidir iniciar sua primeira consulta real com IA.",
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
];

const benefits = [
  {
    icon: Headphones,
    title: "Esteja na consulta, não no formulário",
    body: "Use a captação mobile e os comandos de voz para reduzir a digitação durante o atendimento.",
  },
  {
    icon: FileText,
    title: "A conversa encontra o campo certo",
    body: "Sintomas, hábitos, emoções, medicamentos, exames e evolução chegam organizados à sua revisão.",
  },
  {
    icon: ClockCounterClockwise,
    title: "Veja o que mudou",
    body: "Compare relatos, sintomas, técnicas e respostas ao longo do acompanhamento.",
  },
  {
    icon: Sparkle,
    title: "Hipóteses explicadas",
    body: "No Pro, padrões possíveis mostram sinais favoráveis, contradições, dados ausentes e referências.",
  },
  {
    icon: Notebook,
    title: "Do padrão ao plano",
    body: "Protocolos, orientações e minutas são organizados sem fazer você recomeçar do zero.",
  },
  {
    icon: SealCheck,
    title: "A decisão continua sua",
    body: "Nada é finalizado automaticamente. Você edita, rejeita, valida e assina.",
  },
];

const valueHighlights = [
  {
    icon: Notebook,
    title: "Anamnese estruturada na linguagem da MTC",
  },
  {
    icon: SlidersHorizontal,
    title: "Modelos e planos personalizáveis",
  },
  {
    icon: TrendUp,
    title: "Evolução clínica acompanhada com inteligência",
  },
  {
    icon: ShieldCheck,
    title: "Segurança e privacidade em todo o fluxo",
  },
];

const flowSteps = [
  {
    number: "01",
    label: "Consulta",
    title: "O atendimento começa com contexto e consentimento.",
    body: "Selecione a paciente, registre as autorizações e escolha como preparar a consulta. Áudio e observações permanecem associados ao mesmo prontuário.",
    proof: "Consentimento e próxima ação visíveis no atendimento",
    icon: ShieldCheck,
    image: "/images/medchina-flow-consulta-real.webp",
    alt: "Tela real do MedChina para preparar a gravação da consulta e registrar o consentimento",
  },
  {
    number: "02",
    label: "Anamnese",
    title: "A conversa encontra a estrutura clínica.",
    body: "Queixa principal, história atual e demais campos ficam reunidos em uma anamnese clara para sua revisão — sem transformar silêncio em resposta.",
    proof: "Campos estruturados, editáveis e prontos para revisão",
    icon: FileText,
    image: "/images/medchina-flow-anamnese-real.webp",
    alt: "Tela real da anamnese estruturada no prontuário MedChina",
  },
  {
    number: "03",
    label: "Plano e evolução",
    title: "Você valida a conduta e acompanha o que mudou.",
    body: "O plano terapêutico permanece editável e conectado ao histórico. A plataforma prepara o próximo passo; você revisa, ajusta e decide.",
    proof: "Plano terapêutico validado pela profissional",
    icon: SealCheck,
    image: "/images/medchina-flow-plano-real.webp",
    alt: "Tela real do MedChina com gravação da consulta e validação do plano terapêutico",
  },
];

const mtcCategories = [
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
];

const mobileHighlights = [
  {
    id: "consent",
    icon: ShieldCheck,
    label: "Consentimento ativo",
    title: "Gravação protegida",
    detail: "A autorização fica vinculada à consulta antes da captação.",
  },
  {
    id: "voice",
    icon: Waveform,
    label: "Observação por voz",
    title: "Contexto sem digitação",
    detail: "Língua, pulso e notas clínicas entram durante o atendimento.",
  },
  {
    id: "sync",
    icon: CloudCheck,
    label: "Sincronização segura",
    title: "Áudio preservado",
    detail: "O envio é confirmado antes de remover a cópia do aparelho.",
  },
];

const pricingPlans = [
  {
    name: "Gratuito",
    eyebrow: "Fundação clínica",
    badge: "Comece aqui",
    icon: Notebook,
    description: "Organize pacientes, consultas e prontuários enquanto constrói seu fluxo no MedChina.",
    price: "R$ 0",
    cadence: "/mês",
    cta: "Criar conta grátis",
    features: [
      "Pacientes e prontuários ilimitados",
      "Anamnese e protocolos manuais",
      "Consultas e recursos clínicos manuais",
      "Sem cartão",
    ],
  },
  {
    name: "Assistente",
    eyebrow: "Documentação automática",
    badge: "Mais escolhido",
    icon: Waveform,
    description: "Transforme a conversa em documentação estruturada, pronta para a sua revisão clínica.",
    price: "R$ 199",
    cadence: "/mês",
    cta: "Começar com automação",
    featured: true,
    features: [
      "Tudo do plano Gratuito",
      "Aplicativo, gravação e transcrição",
      "Anamnese com origem rastreável",
      "Até 3.000 minutos por mês",
    ],
  },
  {
    name: "Pro",
    eyebrow: "Inteligência supervisionada",
    badge: "Mais completo",
    icon: Sparkle,
    description: "Avance da documentação para hipóteses e possibilidades terapêuticas que você valida.",
    price: "R$ 299",
    cadence: "/mês",
    cta: "Conhecer o Pro",
    features: [
      "Tudo do plano Assistente",
      "Hipóteses e padrões explicados",
      "Protocolos e plano preparados",
      "Até 6.000 minutos por mês",
    ],
  },
];

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a className={`brand ${inverse ? "brand--inverse" : ""}`} href="#inicio" aria-label="MedChina — início">
      <img src="/brand/medchina-mark.png" alt="" width={38} height={38} />
      <span>
        Med<span>China</span>
      </span>
    </a>
  );
}

function PhoneRecorder({ focus }: { focus: (typeof mobileHighlights)[number] }) {
  const [isPaused, setIsPaused] = useState(false);
  const [noteAdded, setNoteAdded] = useState(false);
  const FocusIcon = focus.icon;

  return (
    <div className="phone-ui">
      <div className="phone-topline">
        <span>09:41</span>
        <span className="phone-status-icons" aria-hidden="true">
          <CellSignalFull size={8} weight="fill" />
          <WifiHigh size={8} weight="bold" />
          <BatteryFull size={9} weight="fill" />
        </span>
      </div>

      <div className="phone-appbar">
        <span className="phone-brand"><img src="/brand/medchina-mark.png" alt="" /><strong>MedChina</strong></span>
        <span className="phone-secure"><ShieldCheck size={13} weight="duotone" /> Protegido</span>
      </div>

      <div className="phone-heading"><span><small>CONSULTA EM ANDAMENTO</small><strong>Helena Martins</strong></span><DotsThree size={18} weight="bold" aria-hidden="true" /></div>
      <div className="patient-pill"><span className="avatar">HM</span><span><b>Retorno · Acupuntura</b><small>Hoje, 09:00 · consentimento confirmado</small></span><CheckCircle size={16} weight="fill" aria-hidden="true" /></div>

      <div className={`phone-record-card ${isPaused ? "is-paused" : ""}`}>
        <div className="phone-record-meta">
          <span><span className="phone-live-dot" /> {isPaused ? "PAUSADA" : "GRAVANDO"}</span>
          <span>Áudio autorizado</span>
        </div>
        <strong className="record-time">32:14</strong>
        <Waveform size={72} weight="duotone" aria-hidden="true" />
        <button className="phone-record-toggle" type="button" onClick={() => setIsPaused(!isPaused)} aria-pressed={isPaused}>
          {isPaused ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}
          <span>{isPaused ? "Retomar" : "Pausar"}</span>
        </button>
      </div>

      <div className="phone-quick-actions">
        <button className={noteAdded ? "is-complete" : ""} type="button" onClick={() => setNoteAdded(!noteAdded)} aria-pressed={noteAdded}>
          {noteAdded ? <CheckCircle size={17} weight="fill" /> : <Plus size={17} />}
          <span><strong>{noteAdded ? "Nota adicionada" : "Adicionar nota"}</strong><small>por voz ou texto</small></span>
        </button>
        <button type="button">
          <Stethoscope size={17} weight="duotone" />
          <span><strong>Língua e pulso</strong><small>registrar observação</small></span>
        </button>
      </div>

      <div className="phone-focus-state" aria-live="polite">
        <span><FocusIcon size={18} weight="duotone" aria-hidden="true" /></span>
        <span><small>{focus.label}</small><strong>{focus.title}</strong></span>
        <Check size={14} weight="bold" aria-hidden="true" />
      </div>

      <div className="phone-tabbar" aria-hidden="true">
        <span className="is-active"><Stethoscope size={16} weight="duotone" /><small>Consulta</small></span>
        <span><ClockCounterClockwise size={16} weight="duotone" /><small>Histórico</small></span>
        <span><Notebook size={16} weight="duotone" /><small>Prontuário</small></span>
      </div>
    </div>
  );
}

function MobileShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeHighlight = mobileHighlights[activeIndex];

  return (
    <div className="mobile-showcase" aria-label="Demonstração interativa do aplicativo MedChina">
      <div className="mobile-device-stage">
        <div className="mobile-device">
          <img className="mobile-device-photo" src="/images/medchina-mobile-device-matte.png" alt="Smartphone moderno com o aplicativo MedChina" />
          <div className="mobile-showcase-main"><PhoneRecorder focus={activeHighlight} /></div>
        </div>
      </div>

      <div className="mobile-platform-chip" aria-label="Aplicativo para iOS e Android">
        <AppleLogo size={17} weight="fill" aria-hidden="true" />
        <AndroidLogo size={17} weight="fill" aria-hidden="true" />
        <span>iOS e Android</span>
      </div>

      <div className="mobile-bubbles" aria-label="Destaques do aplicativo">
        {mobileHighlights.map(({ icon: Icon, label, title, detail }, index) => (
          <button
            className={`mobile-bubble mobile-bubble--${index + 1} ${activeIndex === index ? "is-active" : ""}`}
            type="button"
            key={label}
            onClick={() => setActiveIndex(index)}
            aria-pressed={activeIndex === index}
          >
            <span className="mobile-bubble-icon"><Icon size={22} weight="duotone" aria-hidden="true" /></span>
            <span><small>{label}</small><strong>{title}</strong><em>{detail}</em></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EvidenceRow({
  icon: Icon,
  label,
  value,
  state,
  tone,
  source,
  onPlay,
}: {
  icon: PhosphorIcon;
  label: string;
  value: string;
  state: string;
  tone: "clear" | "attention" | "missing";
  source?: string;
  onPlay: () => void;
}) {
  const StatusIcon = tone === "clear" ? CheckCircle : tone === "attention" ? WarningCircle : MinusCircle;

  return (
    <article className={`evidence-field evidence-field--${tone}`}>
      <span className="evidence-field-icon"><Icon size={22} weight="duotone" aria-hidden="true" /></span>
      <div className="evidence-field-content">
        <div className="evidence-field-heading">
          <strong>{label}</strong>
          <span className="evidence-status"><StatusIcon size={14} weight="fill" aria-hidden="true" /> {state}</span>
        </div>
        <p>{value}</p>
        {source ? (
          <button className="evidence-source" type="button" onClick={onPlay}>
            <Play size={12} weight="fill" aria-hidden="true" /> Ouvir origem · {source}
          </button>
        ) : (
          <span className="evidence-source evidence-source--empty">Sem evidência registrada no áudio</span>
        )}
      </div>
    </article>
  );
}

function SupervisedEvidence() {
  const [playing, setPlaying] = useState(false);
  const playSource = () => setPlaying(true);

  return (
    <div className="evidence-layout">
      <article className="conversation-card">
        <div className="conversation-header">
          <span className="conversation-icon"><ChatCircleText size={22} weight="duotone" aria-hidden="true" /></span>
          <span><small>Fonte clínica</small><strong>Conversa fictícia · Helena Martins</strong></span>
          <span className="conversation-time">14:32–14:46</span>
        </div>
        <blockquote>
          “Tenho acordado umas <mark>três vezes durante a noite</mark>. Sinto <mark>muito calor</mark> e às vezes acordo <mark>suando</mark>.”
        </blockquote>
        <div className={`evidence-player ${playing ? "is-playing" : ""}`}>
          <button type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pausar trecho" : "Ouvir trecho"}>
            {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
          </button>
          <span><strong>{playing ? "Reproduzindo trecho" : "Trecho original"}</strong><small>Paciente · áudio autorizado</small></span>
          <Waveform size={78} weight="duotone" aria-hidden="true" />
          <time>0:14</time>
        </div>
      </article>

      <div className="evidence-bridge" aria-hidden="true">
        <span><Sparkle size={18} weight="fill" /><ArrowRight size={18} weight="bold" /></span>
        <small>IA organiza</small>
      </div>

      <article className="prepared-card">
        <div className="prepared-header">
          <div>
            <span><Sparkle size={18} weight="duotone" aria-hidden="true" /> Organização supervisionada</span>
            <h3>Anamnese preparada</h3>
            <p>3 campos organizados · nenhuma decisão aplicada</p>
          </div>
          <span className="review-chip"><SealCheck size={15} weight="fill" aria-hidden="true" /> Revisão obrigatória</span>
        </div>
        <div className="evidence-fields">
          <EvidenceRow icon={MoonStars} label="Sono" value="Desperta aproximadamente três vezes durante a noite." state="Evidência clara" tone="clear" source="14:32" onPlay={playSource} />
          <EvidenceRow icon={TrendUp} label="Evolução" value="Frequência relatada; início e evolução temporal ainda não informados." state="Requer atenção" tone="attention" source="14:32" onPlay={playSource} />
          <EvidenceRow icon={Stethoscope} label="Língua e pulso" value="Aguardando observação direta da profissional." state="Não informado" tone="missing" onPlay={playSource} />
        </div>
        <div className="prepared-footer">
          <SealCheck size={24} weight="duotone" aria-hidden="true" />
          <span><strong>Nada foi finalizado automaticamente</strong><small>Você revisa, ajusta e confirma antes de salvar no prontuário.</small></span>
        </div>
      </article>
    </div>
  );
}

function FlowTimeline() {
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const steps = Array.from(timeline.querySelectorAll<HTMLElement>(".flow-step"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      steps.forEach((step) => step.classList.add("is-visible"));
      timeline.style.setProperty("--flow-progress", "100%");
      return;
    }

    let frame = 0;
    const update = () => {
      const rect = timeline.getBoundingClientRect();
      const start = window.innerHeight * 0.62;
      const distance = rect.height + window.innerHeight * 0.24;
      const progress = Math.min(1, Math.max(0, (start - rect.top) / distance));

      timeline.style.setProperty("--flow-progress", `${progress * 100}%`);
      steps.forEach((step) => {
        if (step.getBoundingClientRect().top < window.innerHeight * 0.78) {
          step.classList.add("is-visible");
        }
      });
    };

    const queueUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", queueUpdate, { passive: true });
    window.addEventListener("resize", queueUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", queueUpdate);
      window.removeEventListener("resize", queueUpdate);
    };
  }, []);

  return (
    <div className="flow-timeline" ref={timelineRef}>
      <div className="flow-track" aria-hidden="true"><span /></div>
      {flowSteps.map(({ number, label, title, body, proof, icon: Icon, image, alt }, index) => (
        <article className={`flow-step ${index % 2 === 1 ? "flow-step--reverse" : ""}`} key={number}>
          <div className="flow-step-copy">
            <span className="flow-step-label">{label}</span>
            <h3>{title}</h3>
            <p>{body}</p>
            <div className="flow-step-proof">
              <Icon size={22} weight="duotone" aria-hidden="true" />
              <span>{proof}</span>
            </div>
          </div>
          <span className="flow-marker" aria-hidden="true">{number}</span>
          <div className="flow-visual">
            <span className="flow-visual-dots" aria-hidden="true" />
            <div className="flow-screen-shot">
              <img src={image} alt={alt} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function PresenceExperience() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeBenefit = benefits[activeIndex];
  const ActiveIcon = activeBenefit.icon;

  return (
    <div className="presence-experience">
      <div className="presence-rail">
        <div className="presence-rail-label">
          <span>O que muda na prática</span>
          <small>Explore os benefícios</small>
        </div>
        <div className="presence-list">
          {benefits.map(({ icon: Icon, title, body }, index) => {
            const isActive = index === activeIndex;
            const descriptionId = `presence-benefit-${index}`;

            return (
              <button
                className={`presence-item ${isActive ? "is-active" : ""}`}
                type="button"
                key={title}
                aria-expanded={isActive}
                aria-controls={descriptionId}
                onClick={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
              >
                <span className="presence-item-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="presence-item-copy">
                  <span className="presence-item-title">
                    <Icon size={25} weight={isActive ? "duotone" : "light"} aria-hidden="true" />
                    <strong>{title}</strong>
                  </span>
                  <span className="presence-item-description" id={descriptionId}>
                    <span>{body}</span>
                  </span>
                </span>
                <CaretDown className="presence-item-caret" size={20} weight="bold" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div className="presence-principle">
          <CheckCircle size={22} weight="duotone" aria-hidden="true" />
          <span><strong>Sem automação invisível.</strong> A profissional revisa, ajusta e valida cada etapa.</span>
        </div>
      </div>

      <aside className="presence-visual" aria-label="Presença clínica apoiada pelo MedChina">
        <img
          src="/images/medchina-presence-consultation.webp"
          alt="Profissional de Medicina Tradicional Chinesa escutando uma paciente durante a consulta"
        />
        <div className="presence-visual-tag">
          <Waveform size={18} weight="duotone" aria-hidden="true" />
          <span>Atendimento em foco</span>
        </div>
        <div className="presence-proof-card presence-proof-card--top">
          <Headphones size={25} weight="duotone" aria-hidden="true" />
          <span><strong>Escuta preservada</strong><small>Menos tela durante a consulta</small></span>
        </div>
        <div className="presence-focus-card" aria-live="polite">
          <span className="presence-focus-label"><ActiveIcon size={19} weight="duotone" aria-hidden="true" /> Em foco agora</span>
          <strong>{activeBenefit.title}</strong>
          <p>{activeBenefit.body}</p>
          <small><span>A IA organiza</span><Check size={14} weight="bold" aria-hidden="true" /><span>Você valida</span></small>
        </div>
      </aside>
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />
        <nav className="desktop-nav" aria-label="Navegação principal">
          <a href="#como-funciona">Como funciona</a>
          <a href="#recursos">Recursos</a>
          <a href="#seguranca">Segurança</a>
          <a href="#planos">Planos</a>
        </nav>
        <div className="header-actions">
          <a className="login-link" href={signInUrl}>Entrar</a>
          <a className="button button--sm" href={signUpUrl}>Criar conta grátis</a>
        </div>
        <button className="menu-button" type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Fechar menu" : "Abrir menu"}>
          {open ? <X size={24} /> : <List size={24} />}
        </button>
      </div>
      {open && (
        <nav className="mobile-nav" aria-label="Navegação mobile">
          <a onClick={() => setOpen(false)} href="#como-funciona">Como funciona</a>
          <a onClick={() => setOpen(false)} href="#recursos">Recursos</a>
          <a onClick={() => setOpen(false)} href="#seguranca">Segurança</a>
          <a onClick={() => setOpen(false)} href="#planos">Planos</a>
          <a href={signInUrl}>Entrar</a>
          <a className="button" href={signUpUrl}>Criar conta grátis</a>
        </nav>
      )}
    </header>
  );
}

export default function Home() {
  return (
    <main id="inicio">
      <Header />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Clareza clínica, do primeiro relato à evolução</p>
            <h1 id="hero-title">Sua prática de<br />MTC, ampliada<br />por uma IA que<br /><em>você supervisiona.</em></h1>
            <p className="hero-lead">Registre a consulta, estruture a anamnese e conecte padrões clínicos com rastreabilidade — sem abrir mão da sua decisão.</p>
            <div className="hero-actions">
              <a className="button" href={signUpUrl}>Criar conta gratuita <ArrowRight size={18} /></a>
              <a className="button button--secondary" href="#como-funciona"><Play size={17} weight="fill" /> Conhecer a plataforma</a>
            </div>
            <ul className="hero-trust" aria-label="Garantias">
              <li><ShieldCheck size={19} weight="duotone" /> Consentimento</li>
              <li><Fingerprint size={19} weight="duotone" /> Rastreabilidade</li>
              <li><Stethoscope size={19} weight="duotone" /> Controle clínico</li>
            </ul>
            <div className="hero-principle"><span /> <p><strong>A IA organiza.</strong><br />Você interpreta, valida e decide.</p></div>
          </div>

          <div className="hero-stage" aria-label="MedChina no computador e no celular">
            <div className="hero-composite">
              <img
                src="/images/medchina-hero-product-composite.webp"
                alt="Profissional de Medicina Tradicional Chinesa usando o MedChina no computador e no celular"
              />
            </div>
            <div className="platform-badges" aria-label="Aplicativo disponível para iOS e Android">
              <div><AppleLogo size={21} weight="fill" /><span><small>Disponível para</small><strong>iOS</strong></span></div>
              <div><AndroidLogo size={21} weight="fill" /><span><small>Disponível para</small><strong>Android</strong></span></div>
            </div>
            <div className="insight-stack">
              <div><FileText size={24} /><span><strong>Informação rastreável</strong><small>Origem e contexto preservados.</small></span></div>
              <div><Sparkle size={24} /><span><strong>Hipótese para revisão</strong><small>Sugestões pedem seu julgamento.</small></span></div>
              <div><Stethoscope size={24} /><span><strong>Plano sob sua decisão</strong><small>Você define condutas e ajustes.</small></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="value-strip" aria-label="Principais benefícios do MedChina">
        <div className="value-strip-inner">
          {valueHighlights.map(({ icon: Icon, title }) => (
            <div className="value-strip-item" key={title}>
              <span className="value-strip-icon"><Icon size={25} weight="duotone" aria-hidden="true" /></span>
              <strong>{title}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="flow-section section" id="como-funciona">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">Todo o fluxo, com continuidade</p>
          <h2>Uma linha <em>contínua</em> entre<br />escuta, raciocínio e evolução.</h2>
          <p>Do primeiro contato ao acompanhamento, o MedChina conecta cada etapa da consulta com estrutura, contexto e segurança.</p>
        </div>
        <FlowTimeline />
      </section>

      <section className="presence-section" id="recursos">
        <div className="presence-heading">
          <p className="eyebrow eyebrow--light">Presença clínica</p>
          <h2>A tecnologia fica nos bastidores.<br /><em>O vínculo continua no centro.</em></h2>
          <p>A consulta em MTC exige escuta, observação e leitura individual. O MedChina reduz o esforço operacional para que você revise apenas o que exige sua decisão.</p>
        </div>
        <PresenceExperience />
      </section>

      <section className="mobile-section section" id="mobile">
        <div className="mobile-copy">
          <p className="eyebrow eyebrow--light">MedChina Mobile</p>
          <h2>Seu celular capta a consulta. <em>A plataforma organiza o atendimento.</em></h2>
          <p>O aplicativo mobile facilita a gravação autorizada e o registro de observações por voz. Na web, você revisa a anamnese, a análise e o plano terapêutico.</p>
          <ul className="check-list">
            <li><Check size={17} weight="bold" /> Consultas do dia e seleção segura do paciente</li>
            <li><Check size={17} weight="bold" /> Consentimento antes de gravar</li>
            <li><Check size={17} weight="bold" /> Pausar, retomar e registrar observações</li>
            <li><Check size={17} weight="bold" /> Língua, pulso e palpação por voz</li>
          </ul>
          <div className="offline-note"><CloudCheck size={27} /><span><strong>Conexão instável não significa consulta perdida.</strong><small>O áudio fica preservado e é enviado quando a conexão voltar.</small></span></div>
        </div>
        <MobileShowcase />
      </section>

      <section className="supervised-section section" id="ia-supervisionada">
        <div className="section-heading">
          <p className="eyebrow">IA supervisionada</p>
          <h2>A anamnese é preenchida sem transformar <em>ausência em resposta.</em></h2>
          <p>O MedChina organiza as informações relatadas, preserva a origem de cada dado e mantém em branco o que não foi informado.</p>
        </div>
        <SupervisedEvidence />
        <div className="traceability-row">
          <div><Eye size={31} weight="duotone" /><span><strong>Origem recuperável</strong><small>Cada campo mantém vínculo com o trecho correspondente.</small></span></div>
          <div><Fingerprint size={31} weight="duotone" /><span><strong>Autoria preservada</strong><small>Paciente, profissional, IA e decisão nunca se confundem.</small></span></div>
          <div><SealCheck size={31} weight="duotone" /><span><strong>Validação explícita</strong><small>O prontuário só avança depois da sua revisão.</small></span></div>
        </div>
      </section>

      <section className="mtc-section section">
        <div className="mtc-copy">
          <p className="eyebrow eyebrow--light">Especialização</p>
          <h2>Um prontuário construído para a lógica da <em>Medicina Tradicional Chinesa.</em></h2>
          <p>Em vez de adaptar sua consulta a um prontuário genérico, o MedChina organiza a avaliação segundo os elementos da prática da MTC.</p>
          <blockquote>“Use os modelos do MedChina, personalize sua anamnese e mantenha seu próprio modo de atender.”</blockquote>
        </div>
        <div className="mtc-list">
          {mtcCategories.map((category, index) => <div key={category}><span>{String(index + 1).padStart(2, "0")}</span><b>{category}</b><ArrowUpRight size={19} /></div>)}
        </div>
      </section>

      <section className="security-section section" id="seguranca">
        <div className="security-heading">
          <p className="eyebrow eyebrow--light">Segurança</p>
          <h2>Dados clínicos exigem mais do que conveniência. <em>Exigem controle.</em></h2>
          <p>Segurança, rastreabilidade e minimização integradas ao fluxo clínico — do consentimento ao histórico de alterações.</p>
        </div>
        <div className="security-grid">
          <article><ShieldCheck size={32} weight="duotone" /><h3>Consentimento separado</h3><p>Gravação, transcrição, IA e imagens podem ter autorizações específicas e versionadas.</p></article>
          <article><LockKey size={32} weight="duotone" /><h3>Acesso protegido</h3><p>Autenticação em dois fatores, gestão de sessões, criptografia e registros de acesso.</p></article>
          <article><Database size={32} weight="duotone" /><h3>Áudio sob controle</h3><p>A cópia local só é removida após a confirmação segura do envio.</p></article>
          <article><ClockCounterClockwise size={32} weight="duotone" /><h3>Histórico de alterações</h3><p>Finalizações, edições e adendos permanecem rastreáveis, com autoria, data e versão.</p></article>
        </div>
      </section>

      <section className="pricing-section section" id="planos">
        <div className="pricing-stage">
          <div className="section-heading section-heading--center">
            <p className="eyebrow eyebrow--light">Planos transparentes</p>
            <h2>Comece no seu ritmo.<br /><em>Automatize quando fizer sentido.</em></h2>
            <p>Uma base clínica completa para começar e dois níveis de automação supervisionada para ganhar tempo sem abrir mão da decisão.</p>
          </div>
          <div className="pricing-trust" aria-label="Condições para começar">
            <span><CheckCircle size={18} weight="fill" /> Conta gratuita para começar</span>
            <span><CheckCircle size={18} weight="fill" /> Trial Pro iniciado por você</span>
            <span><CheckCircle size={18} weight="fill" /> Sem cartão ou cobrança automática</span>
          </div>
        </div>
        <div className="pricing-grid">
          {pricingPlans.map(({ name, eyebrow, badge, icon: Icon, description, price, cadence, cta, features, featured }) => (
            <article className={`price-card ${featured ? "price-card--featured" : ""}`} key={name}>
              <div className="plan-topline">
                <span className="plan-icon"><Icon size={27} weight="duotone" aria-hidden="true" /></span>
                <span className="plan-label">{badge}</span>
              </div>
              <p className="plan-eyebrow">{eyebrow}</p>
              <h3>{name}</h3>
              <p className="plan-description">{description}</p>
              <div className="price"><strong>{price}</strong><small>{cadence}</small></div>
              <a className={`button ${featured ? "" : "button--secondary"}`} href={signUpUrl}>{cta}<ArrowRight size={17} /></a>
              <div className="plan-includes">
                <strong>O que está incluído</strong>
                <ul>{features.map((feature) => <li key={feature}><CheckCircle size={18} weight="fill" /> {feature}</li>)}</ul>
              </div>
            </article>
          ))}
        </div>
        <div className="pricing-assurance">
          <span className="pricing-assurance-icon"><ShieldCheck size={25} weight="duotone" aria-hidden="true" /></span>
          <span><strong>Você decide quando a automação começa.</strong><small>O trial Pro só é ativado na sua primeira consulta real com IA. Nada é cobrado automaticamente.</small></span>
          <a href="#duvidas">Tirar dúvidas <ArrowRight size={15} /></a>
        </div>
      </section>

      <section className="faq-section section" id="duvidas">
        <div className="faq-intro">
          <p className="eyebrow">Dúvidas</p>
          <h2>Perguntas frequentes</h2>
          <p>As respostas mais importantes sobre o plano gratuito, o trial e o papel da inteligência artificial.</p>
          <a href={signUpUrl}>Começar gratuitamente <ArrowRight size={16} /></a>
        </div>
        <div className="faq-list">
          {faqItems.map((item, index) => (
            <details key={item.question} open={index === 0}>
              <summary>{item.question}<CaretDown size={19} /></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <div>
          <p className="eyebrow eyebrow--light">Seu próximo atendimento pode começar diferente</p>
          <h2>Mais presença para cuidar. <em>Mais clareza para decidir.</em></h2>
          <p>Organize seus pacientes, conheça os recursos clínicos e ative a automação apenas quando fizer sentido para você.</p>
          <div className="hero-actions"><a className="button button--light" href={signUpUrl}>Criar minha conta gratuita <ArrowRight size={18} /></a><a className="text-link-light" href="#como-funciona">Ver como funciona</a></div>
          <ul><li><Check size={17} /> Prontuários ilimitados</li><li><Check size={17} /> Trial iniciado por você</li><li><Check size={17} /> Sem cobrança automática</li></ul>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand"><Brand inverse /><p>Prontuário e apoio ao raciocínio clínico para Medicina Tradicional Chinesa.</p></div>
          <div><strong>Produto</strong><a href="#como-funciona">Como funciona</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a><a href="#seguranca">Segurança</a></div>
          <div><strong>Conta</strong><a href={signUpUrl}>Começar gratuitamente</a><a href={signInUrl}>Entrar</a><a href="#duvidas">Central de ajuda</a></div>
          <div><strong>Empresa</strong><a href="#inicio">Sobre</a><a href="mailto:contato@medchina.com.br">Contato</a><a href="#seguranca">Privacidade</a></div>
        </div>
        <div className="footer-bottom"><span>© 2026 MedChina. Todos os direitos reservados.</span><p>O MedChina não substitui avaliação profissional, exame físico, observação da língua, palpação do pulso, análise de contraindicações ou encaminhamento quando necessário.</p></div>
      </footer>
    </main>
  );
}
