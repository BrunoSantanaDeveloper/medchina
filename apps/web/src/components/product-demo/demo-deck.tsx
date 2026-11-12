"use client";

import { fitSlide } from "../presentation/deck-fit";
import { DEMO_SLIDES } from "./demo-data";
import { DemoRenderer } from "./demo-views";
import { type CSSProperties, type TouchEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Logo from "@/components/logo/logo";
import { ArrowsIn, ArrowsOut, CaretLeft, CaretRight, FilePdf } from "@phosphor-icons/react";

const CANVAS_W = 1280;
const CANVAS_H = 720;
/** Same idle time as the congress deck before the toolbar leaves the screen. */
const CHROME_IDLE_MS = 3200;

/**
 * The product demo, on the congress deck's stage.
 *
 * Built to be shown by anyone, in two situations: presented from a laptop
 * (fullscreen, arrow keys or a clicker, the toolbar leaving the screen after a
 * few idle seconds, like the congress deck's stage-clean) and sent as a link
 * that opens on a phone (the canvas centred by position — `.deck--public` — and
 * a swipe to move on). None of the talk machinery: no teleprompter, clock,
 * phone sync or language switch.
 */
export default function DemoDeck() {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [scale, setScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const slideRef = useRef<HTMLElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const total = DEMO_SLIDES.length;
  const slide = DEMO_SLIDES[index];

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

  // Position lives in the hash: a reload keeps the slide, and a link can point
  // at one (`/demonstracao#s2`).
  useEffect(() => {
    const fromHash = Number(window.location.hash.replace("#s", ""));
    if (Number.isInteger(fromHash) && fromHash > 0 && fromHash <= total) setIndex(fromHash - 1);
  }, [total]);

  useEffect(() => {
    window.history.replaceState(null, "", `#s${index + 1}`);
  }, [index]);

  /* --- one layout, any screen ---------------------------------------- */
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

  // Nothing clipped: the same rule as the congress deck (deck-fit.ts).
  useLayoutEffect(() => {
    const section = slideRef.current;
    if (!section) return;
    section.style.setProperty("--fit", "1");
    const frame = requestAnimationFrame(() => fitSlide(section));
    return () => cancelAnimationFrame(frame);
  }, [slide.key]);

  /* --- fullscreen ------------------------------------------------------ */
  // iPhone Safari cannot put an element in fullscreen: no button there, rather
  // than one that does nothing.
  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  // Stage-clean: in fullscreen the audience is looking at the slide, so the
  // toolbar leaves after a few idle seconds and comes back on any input.
  useEffect(() => {
    if (!fullscreen) {
      setChromeHidden(false);
      return;
    }
    let timer = window.setTimeout(() => setChromeHidden(true), CHROME_IDLE_MS);
    const wake = () => {
      setChromeHidden(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setChromeHidden(true), CHROME_IDLE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [fullscreen]);

  /* --- keyboard and touch ---------------------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a browser shortcut (Ctrl+F, Cmd+←…).
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;

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
      } else if (event.key === "f" || event.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, next, prev, total, toggleFullscreen]);

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

  return (
    <div
      className={chromeHidden ? "deck deck--public deck--clean" : "deck deck--public"}
      data-lang="pt"
      lang="pt-BR"
      ref={rootRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="deck-ambience" aria-hidden="true">
        <span />
        <span />
      </div>

      <header className="deck-chrome deck-chrome--header">
        <a href="/" aria-label="MedChina — página inicial">
          <Logo classNameFull="h-7 w-auto" classNameMobile="hidden" />
        </a>
        <p className="deck-context">
          <strong>Demonstração do produto</strong>
          <span>Prontuário inteligente para Medicina Tradicional Chinesa</span>
        </p>

        <div className="deck-chrome-group deck-chrome-group--end">
          <a className="deck-btn" href="/demonstracao/exportar" target="_blank" rel="noopener">
            <FilePdf size={15} weight="duotone" aria-hidden="true" />
            Exportar
          </a>
          {canFullscreen && (
            <button
              className="deck-btn deck-btn--icon"
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Sair da tela cheia" : "Apresentar em tela cheia"}
              title={fullscreen ? "Sair da tela cheia (F)" : "Apresentar em tela cheia (F)"}
            >
              {fullscreen ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
            </button>
          )}
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
            aria-label={`Slide ${index + 1} de ${total}: ${slide.title}`}
          >
            <DemoRenderer slide={slide} />
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
          aria-label="Progresso da apresentação"
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
