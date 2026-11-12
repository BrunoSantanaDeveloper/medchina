"use client";

import { fitSlide } from "../presentation/deck-fit";
import { DeckModeContext } from "../presentation/deck-mode";
import { DEMO_SLIDES } from "./demo-data";
import { DemoRenderer } from "./demo-views";
import { CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { CircleNotch, FilePdf, FilePpt, Info } from "@phosphor-icons/react";

const CANVAS_W = 1280;
const CANVAS_H = 720;
const SCREEN_GUTTER = 64;
/** 1280×720 in inches: PowerPoint's own 16:9 page. */
const PPTX_W = 13.333;
const PPTX_H = 7.5;
const SHOT_RATIO = 1.5;
const FILE_TITLE = "MedChina - Demonstração do produto";

/**
 * The product demo as a file to send — `/demonstracao/exportar`.
 *
 * The same two routes out as the other decks: the browser's own print pipeline
 * for the PDF (one page per slide, `@page` already sized to the canvas by
 * `palestra.css`) and a .pptx whose slides are the rasterised pages. Rendered
 * in `export` mode, so the running clip on the first slide prints as its still
 * instead of an empty box.
 */
export default function DemoExport() {
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [pptx, setPptx] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const pagesRef = useRef<HTMLElement>(null);

  // Fit only after the fonts load: a slide measured in the fallback face is
  // measured wrong, and the error would only show on paper.
  useLayoutEffect(() => {
    let cancelled = false;
    let frame = 0;
    document.fonts.ready.then(() => {
      frame = requestAnimationFrame(() => {
        if (cancelled || !pagesRef.current) return;
        pagesRef.current.querySelectorAll<HTMLElement>(".deck-slide").forEach(fitSlide);
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    const pages = pagesRef.current;
    if (!pages) return;
    const measure = () => setScale(Math.min(1, (pages.clientWidth - SCREEN_GUTTER) / CANVAS_W));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pages);
    return () => observer.disconnect();
  }, []);

  async function exportPptx() {
    const canvases = pagesRef.current?.querySelectorAll<HTMLElement>(".deck-export-canvas");
    if (!canvases?.length) return;

    setFailed(null);
    setPptx({ done: 0, total: canvases.length });

    try {
      const [{ default: PptxGenJS }, { toPng }] = await Promise.all([import("pptxgenjs"), import("html-to-image")]);
      const deck = new PptxGenJS();
      deck.defineLayout({ name: "DECK_16X9", width: PPTX_W, height: PPTX_H });
      deck.layout = "DECK_16X9";
      deck.title = FILE_TITLE;

      for (const [index, canvas] of [...canvases].entries()) {
        const slide = canvas.querySelector<HTMLElement>(".deck-slide");
        const shot = await toPng(canvas, {
          width: CANVAS_W,
          height: CANVAS_H,
          pixelRatio: SHOT_RATIO,
          style: { transform: "none", transformOrigin: "top left" },
          backgroundColor: slide ? getComputedStyle(slide).backgroundColor : undefined,
        });
        deck.addSlide().addImage({ data: shot, x: 0, y: 0, w: PPTX_W, h: PPTX_H });
        setPptx({ done: index + 1, total: canvases.length });
      }

      await deck.writeFile({ fileName: `${FILE_TITLE}.pptx` });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "Não foi possível gerar o arquivo.");
    } finally {
      setPptx(null);
    }
  }

  const busy = pptx !== null;

  return (
    <DeckModeContext.Provider value="export">
      <div className="deck deck--export" data-lang="pt" lang="pt-BR">
        <header className="deck-export-bar">
          <div className="deck-export-heading">
            <FilePdf size={22} weight="duotone" aria-hidden="true" />
            <div>
              <strong>Exportar a demonstração do produto</strong>
              <span>{DEMO_SLIDES.length} páginas · MedChina</span>
            </div>
          </div>

          <button className="deck-btn" type="button" onClick={exportPptx} disabled={!ready || busy} aria-busy={busy}>
            {busy ? (
              <CircleNotch size={16} className="deck-export-spin" aria-hidden="true" />
            ) : (
              <FilePpt size={16} weight="duotone" aria-hidden="true" />
            )}
            {pptx ? `Gerando ${pptx.done} de ${pptx.total}…` : "PowerPoint"}
          </button>

          <button
            className="deck-btn deck-btn--primary"
            type="button"
            onClick={() => {
              // Next re-applies the route's metadata title after hydration, and
              // the browser names the PDF after the title at print time.
              document.title = FILE_TITLE;
              window.print();
            }}
            disabled={!ready || busy}
          >
            {ready ? (
              <FilePdf size={16} weight="duotone" aria-hidden="true" />
            ) : (
              <CircleNotch size={16} className="deck-export-spin" aria-hidden="true" />
            )}
            {ready ? "Gerar PDF" : "Preparando páginas…"}
          </button>

          <p className={failed ? "deck-export-hint deck-export-hint--error" : "deck-export-hint"}>
            <Info size={15} weight="duotone" aria-hidden="true" />
            <span>
              {failed
                ? `O PowerPoint não foi gerado: ${failed} O PDF continua disponível.`
                : "No PDF, escolha Destino: Salvar como PDF. As páginas saem em 13,33 × 7,5 pol — o 16:9 que o PowerPoint e qualquer projetor esperam. No PowerPoint, cada slide é uma imagem: o texto não é editável."}
            </span>
          </p>
        </header>

        <main className="deck-export-pages" ref={pagesRef} style={{ "--export-scale": scale } as CSSProperties}>
          {DEMO_SLIDES.map((slide, index) => (
            <article className="deck-export-page" key={slide.key} aria-label={`Página ${index + 1}`}>
              <p className="deck-export-caption">
                <b>{String(index + 1).padStart(2, "0")}</b>
                {slide.title}
              </p>
              <div className="deck-export-sheet">
                <div className="deck-export-canvas">
                  <section className="deck-slide" aria-label={slide.title}>
                    <DemoRenderer slide={slide} />
                  </section>
                </div>
              </div>
            </article>
          ))}
        </main>
      </div>
    </DeckModeContext.Provider>
  );
}
