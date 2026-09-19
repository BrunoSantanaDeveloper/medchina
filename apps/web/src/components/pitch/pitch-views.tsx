"use client";

import {
  ASK_CARDS,
  ASK_NOTE,
  COVER,
  ELIGIBILITY,
  MARKET_NOTE,
  MARKET_SCENARIOS,
  MARKET_STATS,
  MODEL_NOTE,
  type PitchSlide,
  type PitchStat,
  PLANS,
  PROBLEM_CARDS,
  PROBLEM_NOTE,
  PROBLEM_SURVEY,
  PRODUCT_NOTE,
  PRODUCT_SHOTS,
  SOLUTION_NOTE,
  SOLUTION_STEPS,
  STACK_ROWS,
  TEAM,
  TRACTION_STATS,
  TRACTION_TIMELINE,
  TRUST_CARDS,
  TRUST_NOTE,
  WHY_NOW_NOTE,
  WHY_NOW_STATS,
} from "./pitch-data";
import { CSSProperties } from "react";

import Logo from "@/components/logo/logo";
import {
  Brain,
  Certificate,
  ChartLineUp,
  Coins,
  Cpu,
  Database,
  Fingerprint,
  Lightning,
  LockKey,
  Microphone,
  MinusCircle,
  Rocket,
  ShieldCheck,
  Sparkle,
  Stethoscope,
  UsersThree,
  WarningCircle,
  Waveform,
} from "@phosphor-icons/react";

/** See the note in `slide-views.tsx`: prettier eats a leading space in a class
 *  string interpolation, so class names are composed here instead. */
const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** Stagger index for the entry choreography (`.deck-reveal`). */
const at = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

function Head({ slide, center }: { slide: PitchSlide; center?: boolean }) {
  return (
    <header className={cx("deck-head", "deck-reveal", center && "deck-head--center")} style={at(0)}>
      <span className="deck-eyebrow">{slide.kicker}</span>
      <h2 className="deck-title">{slide.title}</h2>
      {slide.subtitle && <p className="deck-sub">{slide.subtitle}</p>}
    </header>
  );
}

function Stat({ stat, index }: { stat: PitchStat; index: number }) {
  return (
    <article className={cx("deck-stat", `deck-stat--${stat.tone ?? "primary"}`, "deck-reveal")} style={at(index)}>
      <b>{stat.value}</b>
      <span>{stat.label}</span>
      {stat.note && <small>{stat.note}</small>}
    </article>
  );
}

function Note({ children, icon: Icon, index }: { children: string; icon: typeof Sparkle; index: number }) {
  return (
    <div className="deck-note deck-reveal" style={at(index)}>
      <Icon size={22} weight="duotone" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function PitchRenderer({ slide }: { slide: PitchSlide }) {
  switch (slide.key) {
    /* ---------------------------------------------------------- */
    case "cover":
      return (
        <div className="deck-slide-inner deck-slide-inner--center deck-cover">
          <div className="deck-reveal" style={at(0)}>
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
          </div>
          <span className="deck-eyebrow deck-reveal" style={at(1)}>
            {slide.kicker}
          </span>
          <h1 className="deck-reveal" style={at(2)}>
            {COVER.line}
          </h1>
          <p className="deck-sub deck-reveal" style={at(3)}>
            {COVER.claim}
          </p>
          <div className="deck-grid deck-grid--4 pitch-facts deck-reveal" style={at(4)}>
            {COVER.facts.map((fact) => (
              <span key={fact.label}>
                <small>{fact.label}</small>
                <b>{fact.value}</b>
              </span>
            ))}
          </div>

          {/* The program's eligibility criteria, answered where the company is
              introduced — not held back to the last slide, which has an
              argument to make instead. */}
          <ul className="pitch-eligibility deck-reveal" style={at(5)}>
            {ELIGIBILITY.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "problem":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--split pitch-problem">
              <div className="deck-bars">
                {PROBLEM_SURVEY.map((row, index) => (
                  <div
                    className={cx("deck-bar-row", row.highlight && "deck-bar-row--attention", "deck-reveal")}
                    key={row.label}
                    style={at(index + 1)}
                  >
                    <span className="deck-bar-label">{row.label}</span>
                    <b className="deck-bar-value">{row.value}</b>
                    <span className="deck-bar-track">
                      <i style={{ width: `${row.percent}%` }} />
                    </span>
                  </div>
                ))}
              </div>

              <div className="pitch-stack">
                {PROBLEM_CARDS.map((card, index) => (
                  <article className="deck-card deck-reveal" key={card.title} style={at(index + 2)}>
                    <h3>{card.title}</h3>
                    <p>{card.body}</p>
                  </article>
                ))}
              </div>
            </div>
            <Note icon={ChartLineUp} index={6}>
              {PROBLEM_NOTE}
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "why-now":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {WHY_NOW_STATS.map((stat, index) => (
                <Stat stat={stat} index={index + 1} key={stat.label} />
              ))}
            </div>
            <Note icon={Certificate} index={4}>
              {WHY_NOW_NOTE}
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "solution":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} />
          <div className="deck-body">
            <ol className="deck-steps pitch-steps--4">
              {SOLUTION_STEPS.map((step, index) => {
                const Icon = [Microphone, Waveform, Stethoscope, Brain][index];
                return (
                  <li className="deck-step deck-reveal" key={step.index} style={at(index + 1)}>
                    <span className="deck-card-icon">
                      <Icon size={24} weight="duotone" aria-hidden="true" />
                    </span>
                    <b>{step.index}</b>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </li>
                );
              })}
            </ol>
            <Note icon={ShieldCheck} index={5}>
              {SOLUTION_NOTE}
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "product":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {PRODUCT_SHOTS.map((shot, index) => (
                <figure className="deck-window deck-reveal" key={shot.src} style={at(index + 1)}>
                  <span className="deck-window-bar" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <div className="deck-window-body">
                    <img src={shot.src} alt={shot.alt} decoding="async" />
                  </div>
                  <figcaption>
                    <span>{shot.caption}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <Note icon={Rocket} index={4}>
              {PRODUCT_NOTE}
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "trust":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--2">
              {TRUST_CARDS.map((card, index) => {
                const Icon = [Fingerprint, Stethoscope, MinusCircle, WarningCircle][index];
                return (
                  <article className="deck-card deck-guarantee deck-reveal" key={card.title} style={at(index + 1)}>
                    <span className="deck-card-icon">
                      <Icon size={22} weight="duotone" aria-hidden="true" />
                    </span>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <h3>{card.title}</h3>
                    <p>{card.body}</p>
                  </article>
                );
              })}
            </div>
            <Note icon={ShieldCheck} index={5}>
              {TRUST_NOTE}
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "stack":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} />
          <div className="deck-body">
            <dl className="deck-annex">
              {STACK_ROWS.map((row, index) => {
                const Icon = [Cpu, Database, LockKey, Lightning][index];
                return (
                  <div className="deck-annex-row deck-reveal" key={row.term} style={at(index + 1)}>
                    <dt className="deck-annex-term">
                      <Icon size={18} weight="duotone" aria-hidden="true" /> {row.term}
                    </dt>
                    <dd className="deck-annex-body">
                      <span>{row.body}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "market":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {MARKET_STATS.map((stat, index) => (
                <Stat stat={stat} index={index + 1} key={stat.label} />
              ))}
            </div>

            <div className="deck-corpus pitch-scenarios">
              {MARKET_SCENARIOS.map((row) => (
                <div className="deck-corpus-row" key={row.share}>
                  <span className="deck-corpus-n">{row.share}</span>
                  <span className="deck-corpus-what">
                    {row.base}
                    <em>{row.arr}</em>
                  </span>
                </div>
              ))}
            </div>

            <Note icon={Coins} index={6}>
              {MARKET_NOTE}
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "traction":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {TRACTION_STATS.map((stat, index) => (
                <Stat stat={stat} index={index + 1} key={stat.label} />
              ))}
            </div>
            <ol className="deck-steps">
              {TRACTION_TIMELINE.map((step, index) => (
                <li className="deck-step deck-reveal" key={step.index} style={at(index + 4)}>
                  <b>{step.index}</b>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "model":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {PLANS.map((plan, index) => (
                <article
                  className={cx("deck-card", plan.accent && "deck-card--accent", "deck-reveal", "pitch-plan")}
                  key={plan.name}
                  style={at(index + 1)}
                >
                  <span className="pitch-plan-name">{plan.name}</span>
                  <strong className="pitch-plan-price">{plan.price}</strong>
                  <p>{plan.body}</p>
                </article>
              ))}
            </div>
            <Note icon={Coins} index={4}>
              {MODEL_NOTE}
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "team":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--2">
              {TEAM.map((person, index) => (
                <article className="deck-card deck-reveal pitch-person" key={person.name} style={at(index + 1)}>
                  <span className="deck-portrait">
                    <img src={person.photo} alt="" decoding="async" />
                  </span>
                  <div>
                    <h3>{person.name}</h3>
                    <span className="pitch-person-role">{person.role}</span>
                    <p>{person.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <Note icon={UsersThree} index={3}>
              Engenharia própria, sem terceirização: o requisito de desenvolvedor no time do Inception é atendido pela
              estrutura com que o produto já é construído.
            </Note>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "ask":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--2">
              {ASK_CARDS.map((card, index) => {
                const Icon = [Coins, LockKey, Brain, Waveform][index];
                return (
                  <article className="deck-card deck-reveal" key={card.title} style={at(index + 1)}>
                    <span className="deck-card-icon">
                      <Icon size={22} weight="duotone" aria-hidden="true" />
                    </span>
                    <h3>{card.title}</h3>
                    <p>{card.body}</p>
                  </article>
                );
              })}
            </div>

            <Note icon={Sparkle} index={5}>
              {ASK_NOTE}
            </Note>
          </div>
        </div>
      );

    default:
      return null;
  }
}
