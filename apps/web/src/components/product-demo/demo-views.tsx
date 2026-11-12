"use client";

import { AmbientShot } from "../presentation/deck-media";
import {
  CONSENT_NOTE,
  CTA,
  type DemoSlide,
  EVIDENCE,
  FLOW_STEPS,
  GUARANTEES,
  MOTTO,
  MOTTO_EM,
  OFFLINE_NOTE,
  PROBLEM_LABEL,
  PROBLEMS,
  PRODUCT_CLIP,
} from "./demo-data";
import { CSSProperties } from "react";

import Logo from "@/components/logo/logo";
import {
  ChatCircleText,
  CheckCircle,
  CloudCheck,
  Ear,
  Eye,
  Fingerprint,
  MinusCircle,
  MoonStars,
  Play,
  SealCheck,
  ShieldCheck,
  Sparkle,
  Stethoscope,
  TrendUp,
  WarningCircle,
} from "@phosphor-icons/react";

/** See the note in `slide-views.tsx`: prettier eats a leading space in a class
 *  string interpolation, so class names are composed here instead. */
const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** Stagger index for the entry choreography (`.deck-reveal`). */
const at = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

function Head({ slide, center }: { slide: DemoSlide; center?: boolean }) {
  return (
    <header className={cx("deck-head", "deck-reveal", center && "deck-head--center")} style={at(0)}>
      <span className="deck-eyebrow">{slide.kicker}</span>
      <h2 className="deck-title">{slide.title}</h2>
      {slide.subtitle && <p className="deck-sub">{slide.subtitle}</p>}
    </header>
  );
}

export function DemoRenderer({ slide }: { slide: DemoSlide }) {
  switch (slide.key) {
    /* ---------------------------------------------------------- */
    /*
      What it is, and the product running. The congress deck's motto slide
      with the brand row on top, because here it is also the cover: the brand
      line is the promise, the three rows are what it answers, and the clip on
      the right is the product doing it.
    */
    case "produto":
      return (
        <div className="deck-slide-inner">
          <div className="demo-brand deck-reveal" style={at(0)}>
            <Logo classNameFull="h-9 w-auto" classNameMobile="hidden" />
            <span className="deck-eyebrow">{slide.kicker}</span>
          </div>
          <h1 className="deck-title deck-title--lead deck-reveal" style={at(1)}>
            {MOTTO}
            <em>{MOTTO_EM}</em>
          </h1>

          <div className="deck-grid deck-motto demo-motto">
            <div>
              <p className="demo-label deck-reveal" style={at(3)}>
                {PROBLEM_LABEL}
              </p>
              <ul className="deck-motto-list">
                {PROBLEMS.map((item, index) => {
                  const ProblemIcon = [Eye, Ear, MoonStars][index];
                  return (
                    <li className="deck-motto-row deck-reveal" key={item} style={at(index + 4)}>
                      <span className="deck-card-icon">
                        <ProblemIcon size={20} weight="duotone" aria-hidden="true" />
                      </span>
                      <p>{item}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
            <AmbientShot media={PRODUCT_CLIP} lang="pt" index={2} />
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "como-funciona":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} center />
          <div className="deck-body">
            <div className="deck-flow demo-flow">
              {FLOW_STEPS.map((step, index) => (
                <article className="deck-flow-step deck-reveal" key={step.step} style={at(index + 1)}>
                  <div className={cx("deck-flow-shot", step.keepEdge && "demo-shot--edge")}>
                    <img
                      src={step.image}
                      alt={step.imageAlt}
                      decoding="async"
                      style={{ objectPosition: step.imageFocus }}
                    />
                  </div>
                  <div className="deck-flow-body">
                    <span className="deck-flow-label">
                      <b>{step.step}</b>
                      {step.label}
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="deck-grid deck-grid--2 demo-notes">
              <div className="deck-note deck-reveal" style={at(4)}>
                <ShieldCheck size={22} weight="duotone" aria-hidden="true" />
                <p>{CONSENT_NOTE}</p>
              </div>
              <div className="deck-note deck-reveal" style={at(5)}>
                <CloudCheck size={22} weight="duotone" aria-hidden="true" />
                <p>{OFFLINE_NOTE}</p>
              </div>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    /*
      Who decides. The worked example on the left shows the review states the
      professional actually meets — clear, needs attention, not informed — and
      the rules on the right are what the software checks after the model
      answers. The way in closes the column, so the last slide is also the one
      that stays on screen with the address.
    */
    case "decisao":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--split deck-grid--stretch demo-decision">
              <div className="deck-evidence deck-reveal" style={at(1)}>
                <div className="deck-evidence-top">
                  <span>
                    <ChatCircleText size={16} weight="duotone" aria-hidden="true" /> {EVIDENCE.speaker}
                  </span>
                  <time>{EVIDENCE.timestamp}</time>
                </div>
                <blockquote>
                  <p>
                    “
                    {EVIDENCE.quote.map((segment, position) =>
                      segment.m ? <mark key={position}>{segment.t}</mark> : <span key={position}>{segment.t}</span>,
                    )}
                    ”
                  </p>
                </blockquote>
                <div className="deck-evidence-arrow">
                  <span />
                  <Sparkle size={16} weight="duotone" aria-hidden="true" />
                  {EVIDENCE.organized}
                  <span />
                </div>
                {EVIDENCE.fields.map((field, index) => {
                  const FieldIcon = [MoonStars, TrendUp, Stethoscope][index];
                  const StateIcon =
                    field.tone === "clear" ? CheckCircle : field.tone === "attention" ? WarningCircle : MinusCircle;
                  return (
                    <div className={cx("deck-evidence-field", `deck-evidence-field--${field.tone}`)} key={field.label}>
                      <FieldIcon size={20} weight="duotone" aria-hidden="true" />
                      <div>
                        <span className="deck-evidence-heading">
                          <strong>{field.label}</strong>
                          <em>
                            <StateIcon size={13} weight="fill" aria-hidden="true" /> {field.state}
                          </em>
                        </span>
                        <p>{field.value}</p>
                        {field.source && (
                          <span className="deck-evidence-source">
                            <Play size={11} weight="fill" aria-hidden="true" />
                            {`Ouvir o trecho · ${field.source}`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="deck-evidence-footer">
                  <SealCheck size={18} weight="duotone" aria-hidden="true" />
                  <span>{EVIDENCE.footer}</span>
                </div>
              </div>

              <div className="demo-side">
                {GUARANTEES.map((rule, index) => {
                  const RuleIcon = [Fingerprint, Stethoscope, WarningCircle][index];
                  return (
                    <article
                      className={cx("deck-principle", `deck-principle--${index + 1}`, "deck-reveal")}
                      key={rule.title}
                      style={at(index + 2)}
                    >
                      <span className="deck-principle-icon">
                        <RuleIcon size={20} weight="duotone" aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{rule.title}</strong>
                        <p>{rule.body}</p>
                      </div>
                    </article>
                  );
                })}

                <div className="demo-cta deck-reveal" style={at(5)}>
                  <span className="deck-qr">
                    <img src={CTA.qr} alt={`QR code para ${CTA.site}`} />
                  </span>
                  <div>
                    <strong>{CTA.title}</strong>
                    <a href={CTA.siteUrl} target="_blank" rel="noopener">
                      {CTA.site}
                    </a>
                    <p>{CTA.line}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}
