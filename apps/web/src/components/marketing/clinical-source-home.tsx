"use client";

import { useEffect, useRef, useState } from "react";

import type { HomeCopy } from "@/components/marketing/home-copy";
import { rich } from "@/components/marketing/home-copy/rich";
import HomeEvidence from "@/components/marketing/home-evidence";
import HomeFooter from "@/components/marketing/home-footer";
import HomeHeader from "@/components/marketing/home-header";
import HomeLanguageNotice from "@/components/marketing/home-language-notice";
import type { PublicPlanDisplay } from "@/components/marketing/pricing-section";
import type { LocaleOption } from "@/constants";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  AndroidLogo,
  AppleLogo,
  ArrowRight,
  ArrowUpRight,
  BatteryFull,
  CaretDown,
  CellSignalFull,
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
  LockKey,
  Notebook,
  Pause,
  Play,
  Plus,
  SealCheck,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Stethoscope,
  Tag,
  TrendUp,
  Waveform,
  WifiHigh,
} from "@phosphor-icons/react";

const signUpUrl = "/auth/sign-up";
const signInUrl = "/auth/sign-in";

/**
 * Everything on this page that is NOT copy: which icon carries a benefit, which
 * screenshot belongs to a flow step, the review tone of an anamnesis field.
 *
 * The words themselves live in `home-copy/<locale>.ts` (six languages, keyed by
 * the same ids used here), so a translation can never move a screenshot or
 * repaint a review state — and a language that renames a section still gets the
 * right icon.
 */
const BENEFIT_ICONS: Record<string, PhosphorIcon> = {
  listen: Headphones,
  fields: FileText,
  history: ClockCounterClockwise,
  hypotheses: Sparkle,
  plan: Notebook,
  decision: SealCheck,
};

const VALUE_ICONS: PhosphorIcon[] = [Notebook, SlidersHorizontal, TrendUp, ShieldCheck];

const FLOW_STEPS = [
  {
    id: "consulta",
    number: "01",
    icon: ShieldCheck,
    image: "/images/medchina-flow-consulta-real.webp",
    width: 500,
    height: 350,
  },
  {
    id: "anamnese",
    number: "02",
    icon: FileText,
    image: "/images/medchina-flow-anamnese-real.webp",
    width: 960,
    height: 540,
  },
  {
    id: "plano",
    number: "03",
    icon: SealCheck,
    image: "/images/medchina-flow-plano-real.webp",
    width: 820,
    height: 558,
  },
] as const;

const MOBILE_HIGHLIGHT_ICONS: Record<string, PhosphorIcon> = {
  consent: ShieldCheck,
  voice: Waveform,
  sync: CloudCheck,
};

const HERO_INSIGHT_ICONS: PhosphorIcon[] = [FileText, Sparkle, Stethoscope];

const TRACEABILITY_ICONS: Record<string, PhosphorIcon> = {
  origin: Eye,
  authorship: Fingerprint,
  validation: SealCheck,
};

const SECURITY_ICONS: Record<string, PhosphorIcon> = {
  consent: ShieldCheck,
  access: LockKey,
  audio: Database,
  history: ClockCounterClockwise,
};

/**
 * The icon of each tier. Its words (eyebrow, badge, button) are copy; everything
 * commercial (name, description, price, period, what is included) comes from the
 * database through `getDisplayPlans`, because a price written in this file goes
 * stale the moment it changes in /admin/billing.
 *
 * A slug with no entry still renders — plainly, with no badge — so adding a plan
 * can never blank out the pricing section.
 */
const PLAN_ICONS: Record<string, PhosphorIcon> = {
  gratuito: Notebook,
  assistente: Waveform,
  pro: Sparkle,
};

function PhoneRecorder({
  focus,
  copy,
}: {
  focus: { icon: PhosphorIcon; label: string; title: string };
  copy: HomeCopy["mobile"]["phone"];
}) {
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
        <span className="phone-brand">
          <img src="/brand/medchina-mark.png" alt="" width={18} height={18} />
          <strong>MedChina</strong>
        </span>
        <span className="phone-secure">
          <ShieldCheck size={13} weight="duotone" /> {copy.secure}
        </span>
      </div>

      <div className="phone-heading">
        <span>
          <small>{copy.inProgress}</small>
          <strong>{copy.patientName}</strong>
        </span>
        <DotsThree size={18} weight="bold" aria-hidden="true" />
      </div>
      <div className="patient-pill">
        <span className="avatar">HM</span>
        <span>
          <b>{copy.patientKind}</b>
          <small>{copy.patientWhen}</small>
        </span>
        <CheckCircle size={16} weight="fill" aria-hidden="true" />
      </div>

      <div className={`phone-record-card ${isPaused ? "is-paused" : ""}`}>
        <div className="phone-record-meta">
          <span>
            <span className="phone-live-dot" /> {isPaused ? copy.paused : copy.recording}
          </span>
          <span>{copy.audioAuthorized}</span>
        </div>
        <strong className="record-time">32:14</strong>
        <Waveform size={72} weight="duotone" aria-hidden="true" />
        <button
          className="phone-record-toggle"
          type="button"
          onClick={() => setIsPaused(!isPaused)}
          aria-pressed={isPaused}
        >
          {isPaused ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}
          <span>{isPaused ? copy.resume : copy.pause}</span>
        </button>
      </div>

      <div className="phone-quick-actions">
        <button
          className={noteAdded ? "is-complete" : ""}
          type="button"
          onClick={() => setNoteAdded(!noteAdded)}
          aria-pressed={noteAdded}
        >
          {noteAdded ? <CheckCircle size={17} weight="fill" /> : <Plus size={17} />}
          <span>
            <strong>{noteAdded ? copy.noteAdded : copy.addNote}</strong>
            <small>{copy.noteHint}</small>
          </span>
        </button>
        <button type="button">
          <Stethoscope size={17} weight="duotone" />
          <span>
            <strong>{copy.observation}</strong>
            <small>{copy.observationHint}</small>
          </span>
        </button>
      </div>

      <div className="phone-focus-state" aria-live="polite">
        <span>
          <FocusIcon size={18} weight="duotone" aria-hidden="true" />
        </span>
        <span>
          <small>{focus.label}</small>
          <strong>{focus.title}</strong>
        </span>
        <Check size={14} weight="bold" aria-hidden="true" />
      </div>

      <div className="phone-tabbar" aria-hidden="true">
        <span className="is-active">
          <Stethoscope size={16} weight="duotone" />
          <small>{copy.tabConsult}</small>
        </span>
        <span>
          <ClockCounterClockwise size={16} weight="duotone" />
          <small>{copy.tabHistory}</small>
        </span>
        <span>
          <Notebook size={16} weight="duotone" />
          <small>{copy.tabRecord}</small>
        </span>
      </div>
    </div>
  );
}

function MobileShowcase({ copy }: { copy: HomeCopy["mobile"] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeHighlight = copy.highlights[activeIndex];

  return (
    <div className="mobile-showcase" aria-label={copy.showcaseAria}>
      <div className="mobile-device-stage">
        <div className="mobile-device">
          <img
            className="mobile-device-photo"
            src="/images/medchina-mobile-device-matte.webp"
            alt={copy.deviceAlt}
            width={900}
            height={1600}
            loading="lazy"
            decoding="async"
          />
          <div className="mobile-showcase-main">
            <PhoneRecorder
              focus={{
                icon: MOBILE_HIGHLIGHT_ICONS[activeHighlight.id] ?? ShieldCheck,
                label: activeHighlight.label,
                title: activeHighlight.title,
              }}
              copy={copy.phone}
            />
          </div>
        </div>
      </div>

      <div className="mobile-platform-chip" aria-label={copy.platformChipAria}>
        <AppleLogo size={17} weight="fill" aria-hidden="true" />
        <AndroidLogo size={17} weight="fill" aria-hidden="true" />
        <span>{copy.platformChipLabel}</span>
      </div>

      <div className="mobile-bubbles" aria-label={copy.bubblesAria}>
        {copy.highlights.map(({ id, label, title, detail }, index) => {
          const Icon = MOBILE_HIGHLIGHT_ICONS[id] ?? ShieldCheck;

          return (
            <button
              className={`mobile-bubble mobile-bubble--${index + 1} ${activeIndex === index ? "is-active" : ""}`}
              type="button"
              key={id}
              onClick={() => setActiveIndex(index)}
              aria-pressed={activeIndex === index}
            >
              <span className="mobile-bubble-icon">
                <Icon size={22} weight="duotone" aria-hidden="true" />
              </span>
              <span>
                <small>{label}</small>
                <strong>{title}</strong>
                <em>{detail}</em>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FlowTimeline({ copy }: { copy: HomeCopy["flow"] }) {
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
      <div className="flow-track" aria-hidden="true">
        <span />
      </div>
      {FLOW_STEPS.map(({ id, number, icon: Icon, image, width, height }, index) => {
        const step = copy.steps[id];

        return (
          <article className={`flow-step ${index % 2 === 1 ? "flow-step--reverse" : ""}`} key={number}>
            <div className="flow-step-copy">
              <span className="flow-step-label">{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="flow-step-proof">
                <Icon size={22} weight="duotone" aria-hidden="true" />
                <span>{step.proof}</span>
              </div>
            </div>
            <span className="flow-marker" aria-hidden="true">
              {number}
            </span>
            <div className="flow-visual">
              <span className="flow-visual-dots" aria-hidden="true" />
              <div className="flow-screen-shot">
                <img src={image} alt={step.alt} width={width} height={height} loading="lazy" decoding="async" />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function PresenceExperience({ copy }: { copy: HomeCopy["presence"] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeBenefit = copy.benefits[activeIndex];
  const ActiveIcon = BENEFIT_ICONS[activeBenefit.id] ?? Sparkle;

  return (
    <div className="presence-experience">
      <div className="presence-rail">
        <div className="presence-rail-label">
          <span>{copy.railLabel}</span>
          <small>{copy.railHint}</small>
        </div>
        <div className="presence-list">
          {copy.benefits.map(({ id, title, body }, index) => {
            const Icon = BENEFIT_ICONS[id] ?? Sparkle;
            const isActive = index === activeIndex;
            const descriptionId = `presence-benefit-${index}`;

            return (
              <button
                className={`presence-item ${isActive ? "is-active" : ""}`}
                type="button"
                key={id}
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
          <span>{rich(copy.principle)}</span>
        </div>
      </div>

      <aside className="presence-visual" aria-label={copy.visualAria}>
        <img
          src="/images/medchina-presence-consultation.webp"
          alt={copy.visualAlt}
          width={1200}
          height={1500}
          loading="lazy"
          decoding="async"
        />
        <div className="presence-visual-tag">
          <Waveform size={18} weight="duotone" aria-hidden="true" />
          <span>{copy.visualTag}</span>
        </div>
        <div className="presence-proof-card presence-proof-card--top">
          <Headphones size={25} weight="duotone" aria-hidden="true" />
          <span>
            <strong>{copy.proofTitle}</strong>
            <small>{copy.proofDetail}</small>
          </span>
        </div>
        <div className="presence-focus-card" aria-live="polite">
          <span className="presence-focus-label">
            <ActiveIcon size={19} weight="duotone" aria-hidden="true" /> {copy.focusLabel}
          </span>
          <strong>{activeBenefit.title}</strong>
          <p>{activeBenefit.body}</p>
          <small>
            <span>{copy.focusAiOrganizes}</span>
            <Check size={14} weight="bold" aria-hidden="true" />
            <span>{copy.focusYouValidate}</span>
          </small>
        </div>
      </aside>
    </div>
  );
}

export default function ClinicalSourceHome({
  plans,
  couponNotice,
  copy,
  locale,
  autoSwitched,
}: {
  /** Live catalog from packages/billing, already formatted by the server page. */
  plans: PublicPlanDisplay[];
  /** Confirmation that a campaign code was recognized — or that it was not. */
  couponNotice?: { label: string; applied: boolean };
  /** This page's copy in the active language (home-copy/<locale>.ts). */
  copy: HomeCopy;
  locale: LocaleOption;
  /** The site chose the language for this visitor — she must be told. */
  autoSwitched: boolean;
}) {
  return (
    <main id="inicio" className="clinical-source-home">
      {autoSwitched && <HomeLanguageNotice copy={copy.language} defaultLocaleName={copy.language.names["pt-BR"]} />}
      <HomeHeader
        copy={copy.nav}
        links={[
          { href: "#como-funciona", label: copy.nav.howItWorks },
          { href: "#recursos", label: copy.nav.features },
          { href: "#seguranca", label: copy.nav.security },
          { href: "#planos", label: copy.nav.plans },
        ]}
        signInHref={signInUrl}
        cta={{ href: signUpUrl, label: copy.nav.signUp }}
        language={{ copy: copy.language, locale }}
      />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">{copy.hero.eyebrow}</p>
            <h1 id="hero-title">{rich(copy.hero.title)}</h1>
            <p className="hero-lead">{copy.hero.lead}</p>
            <div className="hero-actions">
              <a className="button" href={signUpUrl}>
                {copy.hero.ctaPrimary} <ArrowRight size={18} />
              </a>
              <a className="button button--secondary" href="#como-funciona">
                <Play size={17} weight="fill" /> {copy.hero.ctaSecondary}
              </a>
            </div>
            <p className="hero-guarantee">
              <CheckCircle size={16} weight="fill" /> {copy.hero.guarantee}
            </p>
            <ul className="hero-trust" aria-label={copy.hero.trustAria}>
              <li>
                <ShieldCheck size={19} weight="duotone" /> {copy.hero.trust[0]}
              </li>
              <li>
                <Fingerprint size={19} weight="duotone" /> {copy.hero.trust[1]}
              </li>
              <li>
                <Stethoscope size={19} weight="duotone" /> {copy.hero.trust[2]}
              </li>
            </ul>
            <div className="hero-principle">
              <span /> <p>{rich(copy.hero.principle)}</p>
            </div>
          </div>

          <div className="hero-stage" aria-label={copy.hero.stageAria}>
            <div className="hero-composite">
              <img
                src="/images/medchina-hero-product-composite.webp"
                alt={copy.hero.compositeAlt}
                width={1024}
                height={1536}
                // Above the fold — eager + highest fetch priority (this is the page's LCP element).
                fetchPriority="high"
                decoding="async"
              />
            </div>
            <div className="platform-badges" aria-label={copy.hero.platformAria}>
              <div>
                <AppleLogo size={21} weight="fill" />
                <span>
                  <small>{copy.hero.availableFor}</small>
                  <strong>iOS</strong>
                </span>
              </div>
              <div>
                <AndroidLogo size={21} weight="fill" />
                <span>
                  <small>{copy.hero.availableFor}</small>
                  <strong>Android</strong>
                </span>
              </div>
            </div>
            <div className="insight-stack">
              {copy.hero.insights.map(({ title, detail }, index) => {
                const Icon = HERO_INSIGHT_ICONS[index] ?? FileText;

                return (
                  <div key={title}>
                    <Icon size={24} />
                    <span>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="value-strip" aria-label={copy.valueStrip.ariaLabel}>
        <div className="value-strip-inner">
          {copy.valueStrip.items.map((title, index) => {
            const Icon = VALUE_ICONS[index] ?? Notebook;

            return (
              <div className="value-strip-item" key={title}>
                <span className="value-strip-icon">
                  <Icon size={25} weight="duotone" aria-hidden="true" />
                </span>
                <strong>{title}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flow-section section" id="como-funciona">
        <div className="section-heading section-heading--center">
          <p className="eyebrow">{copy.flow.eyebrow}</p>
          <h2>{rich(copy.flow.title)}</h2>
          <p>{copy.flow.lead}</p>
        </div>
        <FlowTimeline copy={copy.flow} />
      </section>

      <section className="presence-section" id="recursos">
        <div className="presence-heading">
          <p className="eyebrow eyebrow--light">{copy.presence.eyebrow}</p>
          <h2>{rich(copy.presence.title)}</h2>
          <p>{copy.presence.lead}</p>
        </div>
        <PresenceExperience copy={copy.presence} />
      </section>

      <section className="mobile-section section" id="mobile">
        <div className="mobile-copy">
          <p className="eyebrow eyebrow--light">{copy.mobile.eyebrow}</p>
          <h2>{rich(copy.mobile.title)}</h2>
          <p>{copy.mobile.lead}</p>
          <ul className="check-list">
            {copy.mobile.checks.map((check) => (
              <li key={check}>
                <Check size={17} weight="bold" /> {check}
              </li>
            ))}
          </ul>
          <div className="offline-note">
            <CloudCheck size={27} />
            <span>
              <strong>{copy.mobile.offlineTitle}</strong>
              <small>{copy.mobile.offlineDetail}</small>
            </span>
          </div>
        </div>
        <MobileShowcase copy={copy.mobile} />
      </section>

      <section className="supervised-section section" id="ia-supervisionada">
        <div className="section-heading">
          <p className="eyebrow">{copy.supervised.eyebrow}</p>
          <h2>{rich(copy.supervised.title)}</h2>
          <p>{copy.supervised.lead}</p>
        </div>
        <HomeEvidence copy={copy.supervised} />
        <div className="traceability-row">
          {copy.supervised.traceability.map(({ id, title, detail }) => {
            const Icon = TRACEABILITY_ICONS[id] ?? Eye;

            return (
              <div key={id}>
                <Icon size={31} weight="duotone" />
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mtc-section section">
        <div className="mtc-copy">
          <p className="eyebrow eyebrow--light">{copy.mtc.eyebrow}</p>
          <h2>{rich(copy.mtc.title)}</h2>
          <p>{copy.mtc.lead}</p>
          <blockquote>{copy.mtc.quote}</blockquote>
        </div>
        <div className="mtc-list">
          {copy.mtc.categories.map((category, index) => (
            <div key={category}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{category}</b>
              <ArrowUpRight size={19} />
            </div>
          ))}
        </div>
      </section>

      <section className="security-section section" id="seguranca">
        <div className="security-heading">
          <p className="eyebrow eyebrow--light">{copy.security.eyebrow}</p>
          <h2>{rich(copy.security.title)}</h2>
          <p>{copy.security.lead}</p>
        </div>
        <div className="security-grid">
          {copy.security.cards.map(({ id, title, body }) => {
            const Icon = SECURITY_ICONS[id] ?? ShieldCheck;

            return (
              <article key={id}>
                <Icon size={32} weight="duotone" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="pricing-section section" id="planos">
        <div className="pricing-stage">
          <div className="section-heading section-heading--center">
            <p className="eyebrow eyebrow--light">{copy.pricing.eyebrow}</p>
            <h2>{rich(copy.pricing.title)}</h2>
            <p>{copy.pricing.lead}</p>
          </div>
          <div className="pricing-trust" aria-label={copy.pricing.trustAria}>
            {copy.pricing.trust.map((item) => (
              <span key={item}>
                <CheckCircle size={18} weight="fill" /> {item}
              </span>
            ))}
          </div>
        </div>
        {couponNotice && (
          <p className={`pricing-coupon ${couponNotice.applied ? "" : "pricing-coupon--inactive"}`}>
            <Tag size={17} weight="fill" aria-hidden="true" /> {couponNotice.label}
          </p>
        )}
        <div className="pricing-grid">
          {plans.map((plan) => {
            const presentation = copy.pricing.plans[plan.slug as keyof HomeCopy["pricing"]["plans"]];
            const eyebrow = presentation?.eyebrow ?? copy.pricing.defaultEyebrow;
            const cta = presentation?.cta ?? copy.pricing.defaultCta;
            const badge = presentation?.badge;
            const Icon = PLAN_ICONS[plan.slug] ?? Notebook;
            const featured = Boolean(plan.highlighted);
            return (
              <article className={`price-card ${featured ? "price-card--featured" : ""}`} key={plan.slug}>
                <div className="plan-topline">
                  <span className="plan-icon">
                    <Icon size={27} weight="duotone" aria-hidden="true" />
                  </span>
                  {badge && <span className="plan-label">{badge}</span>}
                </div>
                <p className="plan-eyebrow">{eyebrow}</p>
                <h3>{plan.name}</h3>
                {plan.description && <p className="plan-description">{plan.description}</p>}
                {plan.originalPrice && (
                  <p className="plan-was">
                    <s>{plan.originalPrice}</s>
                    {plan.discountLabel && <span className="plan-discount">{plan.discountLabel}</span>}
                  </p>
                )}
                <div className="price">
                  <strong>{plan.price}</strong>
                  {plan.period && <small>{plan.period}</small>}
                </div>
                <a className={`button ${featured ? "" : "button--secondary"}`} href={signUpUrl}>
                  {cta}
                  <ArrowRight size={17} />
                </a>
                <div className="plan-includes">
                  <strong>{copy.pricing.included}</strong>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <CheckCircle size={18} weight="fill" /> {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>
        <div className="pricing-assurance">
          <span className="pricing-assurance-icon">
            <ShieldCheck size={25} weight="duotone" aria-hidden="true" />
          </span>
          <span>
            <strong>{copy.pricing.assuranceTitle}</strong>
            <small>{copy.pricing.assuranceDetail}</small>
          </span>
          <a href="#duvidas">
            {copy.pricing.assuranceLink} <ArrowRight size={15} />
          </a>
        </div>
      </section>

      <section className="faq-section section" id="duvidas">
        <div className="faq-intro">
          <p className="eyebrow">{copy.faq.eyebrow}</p>
          <h2>{copy.faq.title}</h2>
          <p>{copy.faq.lead}</p>
          <a href={signUpUrl}>
            {copy.faq.cta} <ArrowRight size={16} />
          </a>
        </div>
        <div className="faq-list">
          {copy.faq.items.map((item, index) => (
            <details key={item.question} open={index === 0}>
              <summary>
                {item.question}
                <CaretDown size={19} />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <div>
          <p className="eyebrow eyebrow--light">{copy.finalCta.eyebrow}</p>
          <h2>{rich(copy.finalCta.title)}</h2>
          <p>{copy.finalCta.lead}</p>
          <div className="hero-actions">
            <a className="button button--light" href={signUpUrl}>
              {copy.finalCta.ctaPrimary} <ArrowRight size={18} />
            </a>
            <a className="text-link-light" href="#como-funciona">
              {copy.finalCta.ctaSecondary}
            </a>
          </div>
          <ul>
            {copy.finalCta.bullets.map((bullet) => (
              <li key={bullet}>
                <Check size={17} /> {bullet}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <HomeFooter
        brandLabel={copy.nav.brandAria}
        tagline={copy.footer.tagline}
        columns={[
          {
            title: copy.footer.productTitle,
            links: [
              { href: "#como-funciona", label: copy.nav.howItWorks },
              { href: "#recursos", label: copy.nav.features },
              { href: "#planos", label: copy.nav.plans },
              { href: "#seguranca", label: copy.nav.security },
            ],
          },
          {
            title: copy.footer.accountTitle,
            links: [
              { href: signUpUrl, label: copy.footer.signUp },
              { href: signInUrl, label: copy.nav.signIn },
              { href: "#duvidas", label: copy.footer.helpCenter },
            ],
          },
          {
            title: copy.footer.companyTitle,
            links: [
              { href: "#inicio", label: copy.footer.about },
              { href: "mailto:contato@medchinaprontuarios.com.br", label: copy.footer.contact },
              { href: "#seguranca", label: copy.footer.privacy },
            ],
          },
        ]}
        rights={copy.footer.rights}
        disclaimer={copy.footer.disclaimer}
      />
    </main>
  );
}
