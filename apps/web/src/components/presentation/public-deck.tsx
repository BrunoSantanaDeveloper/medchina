"use client";

import { fitSlide } from "./deck-fit";
import { SlideRenderer } from "./slide-views";
import type { DeckLang, SlideData } from "./types";
import { type CSSProperties, type TouchEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Logo from "@/components/logo/logo";
import { ArrowLeft, CaretLeft, CaretRight, Translate } from "@phosphor-icons/react";

const CANVAS_W = 1280;
const CANVAS_H = 720;

/**
 * The congress deck for the public (/palestra/publica).
 *
 * The SAME slides as the stage — rendered by the same `SlideRenderer`, fitted
 * by the same rule (deck-fit.ts) — with none of the stage machinery: no
 * presenter view, no teleprompter, no PDF export, no phone sync, no timer.
 *
 * It receives its slides as PROPS, already stripped of every speaker-only field
 * by the server page, and never imports `slides-deck.ts`: a client module that
 * imported the slide list would ship the teleprompter to every visitor, whatever
 * the page does with it.
 */
export default function PublicDeck({ slides }: { slides: SlideData[] }) {
  const [index, setIndex] = useState(0);
  const [lang, setLang] = useState<DeckLang>("pt");
  const [scale, setScale] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const stageRef = useRef<HTMLElement>(null);
  const slideRef = useRef<HTMLElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const total = slides.length;
  const slide = slides[index];

  const go = useCallback(
    (target: number) => {
      const bounded = Math.max(0, Math.min(total - 1, target));
      setDirection(bounded >= index ? "forward" : "back");
      setIndex(bounded);
    },
    [index, total],
  );
  const next = useCallback(() => go(index + 1), [go, index]);
  const prev = useCallback(() => go(index - 1), [go, index]);

  // One layout, every screen: the canvas is composed at 1280×720 and scaled.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const { width, height } = stage.getBoundingClientRect();
      if (!width || !height) return;
      setScale(Math.min(width / CANVAS_W, height / CANVAS_H));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Nothing gets clipped — Portuguese runs longer than Chinese (deck-fit.ts).
  useLayoutEffect(() => {
    const section = slideRef.current;
    if (!section) return;
    section.style.setProperty("--fit", "1");
    const frame = requestAnimationFrame(() => fitSlide(section));
    return () => cancelAnimationFrame(frame);
  }, [slide?.key, lang]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        next();
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        prev();
      } else if (event.key === "Home") {
        go(0);
      } else if (event.key === "End") {
        go(total - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, next, prev, total]);

  const onTouchStart = (event: TouchEvent) => {
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = start.x - event.changedTouches[0].clientX;
    const dy = Math.abs(start.y - event.changedTouches[0].clientY);
    // A diagonal scroll is not a swipe.
    if (Math.abs(dx) < 60 || dy > Math.abs(dx)) return;
    if (dx > 0) next();
    else prev();
  };

  if (!slide) return null;

  return (
    <div
      className="deck deck--public"
      data-lang={lang}
      lang={lang === "zh" ? "zh-Hans" : "pt-BR"}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="deck-ambience" aria-hidden="true">
        <span />
        <span />
      </div>

      <header className="deck-chrome deck-chrome--header">
        <a href="/china" aria-label="MedChina — voltar para a página do congresso">
          <Logo classNameFull="h-7 w-auto" classNameMobile="hidden" />
        </a>
        <p className="deck-context">
          <strong>Congresso de MTC · Xinjiang, China</strong>
          <span>Apresentação de Debora Giovanella · setembro de 2026</span>
        </p>

        <div className="deck-chrome-group deck-chrome-group--end">
          <a className="deck-btn" href="/china">
            <ArrowLeft size={15} weight="bold" aria-hidden="true" />
            Voltar
          </a>
          {/* One language on screen at a time — this switches, it does not add. */}
          <div className="deck-langswitch" role="group" aria-label="Idioma dos slides">
            <Translate size={15} weight="duotone" aria-hidden="true" />
            <button type="button" onClick={() => setLang("pt")} aria-pressed={lang === "pt"}>
              PT
            </button>
            <button type="button" onClick={() => setLang("zh")} aria-pressed={lang === "zh"}>
              中文
            </button>
          </div>
        </div>
      </header>

      <main
        className="deck-stage"
        ref={stageRef}
        onClick={(event) => {
          // Advance only on the empty stage, so a click on a control inside a
          // slide does exactly what it says.
          if (event.target === stageRef.current) next();
        }}
      >
        <div className="deck-canvas" style={{ "--deck-scale": scale } as CSSProperties}>
          <section
            className="deck-slide"
            ref={slideRef}
            key={slide.key}
            data-direction={direction}
            aria-label={`Slide ${index + 1} de ${total}: ${slide.title[lang]}`}
          >
            <SlideRenderer slide={slide} lang={lang} />
          </section>
        </div>
        {/* A 16:9 slide on a phone held upright is a strip; this says so once. */}
        <p className="deck-rotate-hint">Gire o celular para ver os slides maiores.</p>
      </main>

      <footer className="deck-chrome deck-chrome--footer">
        <div className="deck-chrome-group">
          <button
            className="deck-btn deck-btn--icon"
            type="button"
            onClick={prev}
            disabled={index === 0}
            aria-label="Slide anterior"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <button
            className="deck-btn deck-btn--primary deck-btn--icon"
            type="button"
            onClick={next}
            disabled={index === total - 1}
            aria-label="Próximo slide"
          >
            <CaretRight size={15} weight="bold" />
          </button>
        </div>

        <span className="deck-counter">
          {index + 1} / {total}
        </span>

        <div
          className="deck-progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
        >
          <i style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
      </footer>
    </div>
  );
}
