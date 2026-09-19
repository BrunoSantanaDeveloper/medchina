"use client";

import { fitSlide } from "../presentation/deck-fit";
import { PITCH_SLIDES } from "./pitch-data";
import { PitchRenderer } from "./pitch-views";
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Logo from "@/components/logo/logo";
import { ArrowsIn, ArrowsOut, CaretLeft, CaretRight, FilePdf } from "@phosphor-icons/react";

const CANVAS_W = 1280;
const CANVAS_H = 720;

/**
 * The pitch deck, on the congress deck's stage.
 *
 * Same fixed canvas, same class vocabulary, same fit guard (`deck-fit.ts`) — a
 * slide composed once and scaled to whatever screen it is opened on. What it
 * deliberately does NOT carry is the machinery that exists for a live talk: no
 * teleprompter, no 40-minute clock, no phone sync, no language switch. A pitch
 * is read, not performed, and the file that gets submitted is the PDF.
 */
export default function PitchDeck() {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLElement>(null);

  const slide = PITCH_SLIDES[index];
  const total = PITCH_SLIDES.length;

  const go = useCallback((next: number) => setIndex(Math.min(Math.max(next, 0), total - 1)), [total]);

  // Position lives in the hash, so a reload does not lose the page someone is
  // looking at — and a link can point at one slide.
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
    const measure = () => setScale(Math.min(stage.clientWidth / CANVAS_W, stage.clientHeight / CANVAS_H, 1.6));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Nothing clipped: the same rule the congress deck uses.
  useLayoutEffect(() => {
    const section = slideRef.current;
    if (!section) return;
    section.style.setProperty("--fit", "1");
    const frame = requestAnimationFrame(() => fitSlide(section));
    return () => cancelAnimationFrame(frame);
  }, [slide.key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        go(index - 1);
      } else if (event.key === "Home") {
        go(0);
      } else if (event.key === "End") {
        go(total - 1);
      } else if (event.key === "f" || event.key === "F") {
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setFullscreen(false);
      return;
    }
    await rootRef.current?.requestFullscreen();
    setFullscreen(true);
  }

  return (
    <div className="deck" data-lang="pt" lang="pt-BR" ref={rootRef}>
      <div className="deck-ambience" aria-hidden="true">
        <span />
        <span />
      </div>

      <header className="deck-chrome deck-chrome--header">
        <Logo classNameFull="h-7 w-auto" classNameMobile="hidden" />
        <p className="deck-context">
          <strong>Pitch deck</strong>
          <span>NVIDIA Inception · MedChina</span>
        </p>

        <div className="deck-chrome-group deck-chrome-group--end">
          <a className="deck-btn" href="/pitch/exportar" target="_blank" rel="noopener">
            <FilePdf size={15} weight="duotone" aria-hidden="true" />
            Exportar
          </a>
          <button
            className="deck-btn deck-btn--icon"
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {fullscreen ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
          </button>
        </div>
      </header>

      <main
        className="deck-stage"
        ref={stageRef}
        onClick={(event) => {
          if (event.target === stageRef.current) go(index + 1);
        }}
      >
        <div className="deck-canvas" style={{ "--deck-scale": scale } as CSSProperties}>
          <section className="deck-slide" ref={slideRef} key={slide.key} aria-label={slide.title}>
            <PitchRenderer slide={slide} />
          </section>
        </div>
      </main>

      <footer className="deck-chrome deck-chrome--footer">
        <div className="deck-chrome-group">
          <button
            className="deck-btn deck-btn--icon"
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Slide anterior"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <button
            className="deck-btn deck-btn--primary deck-btn--icon"
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === total - 1}
            aria-label="Próximo slide"
          >
            <CaretRight size={15} weight="bold" />
          </button>
        </div>

        <span className="deck-counter">
          {String(index + 1).padStart(2, "0")} / {total}
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

        <div className="deck-chrome-group deck-chrome-group--end">
          <label className="deck-context" htmlFor="pitch-jump">
            Ir para
          </label>
          <select
            className="deck-select"
            id="pitch-jump"
            value={index}
            onChange={(event) => go(Number(event.target.value))}
          >
            {PITCH_SLIDES.map((item, position) => (
              <option key={item.key} value={position}>
                {String(position + 1).padStart(2, "0")} — {item.title}
              </option>
            ))}
          </select>
        </div>
      </footer>
    </div>
  );
}
