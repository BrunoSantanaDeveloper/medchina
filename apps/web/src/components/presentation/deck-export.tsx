"use client";

import { fitSlide } from "./deck-fit";
import { DeckModeContext } from "./deck-mode";
import { SlideRenderer } from "./slide-views";
import { SLIDES_DATA } from "./slides-data";
import { DeckLang, SlideData } from "./types";
import { useSearchParams } from "next/navigation";
import { CSSProperties, Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CircleNotch, FilePdf, FilePpt, Info, Translate } from "@phosphor-icons/react";

const CANVAS_W = 1280;
const CANVAS_H = 720;
/** Room the page frame keeps from the window edge on screen. */
const SCREEN_GUTTER = 64;

/** 1280×720 in inches: PowerPoint's own 16:9 page, so nothing is letterboxed. */
const PPTX_W = 13.333;
const PPTX_H = 7.5;
/** Captured at 1920×1080 — a projector's own resolution, not more. */
const SHOT_RATIO = 1.5;

const LANG_NAME: Record<DeckLang, string> = { pt: "Português", zh: "中文" };

/**
 * The teleprompter as a page of its own, facing the slide it belongs to.
 *
 * Portuguese whatever the deck's language: the slides are for the room, this is
 * for the person holding the sheet. It carries what the presenter window shows
 * — the stage direction, the media note, the optional cut, the script — so a
 * printed copy is a real fallback for the phone dying on stage.
 */
function SlideNotes({ slide, place }: { slide: SlideData; place: string }) {
  return (
    <div className="deck-slide-inner deck-notes">
      <header className="deck-notes-head">
        <span>
          {place} · Bloco {slide.block} · {slide.timeRange}
        </span>
        <h2>{slide.title.pt}</h2>
      </header>

      <div className="deck-notes-grid">
        {/* Real paragraphs, not the blank lines the teleprompter uses: on a
            fixed page each blank line costs a full line, and that alone pushed
            the longest script past the page and had it clipped. */}
        <div className="deck-notes-script">
          {slide.script.split(/\n{2,}/).map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </div>

        <aside className="deck-notes-side">
          <div className="deck-notes-card">
            <h3>Instrução de palco</h3>
            <p>{slide.stageNote}</p>
          </div>
          {slide.media && (
            <div className="deck-notes-card">
              <h3>Mídia</h3>
              <p>{slide.media.productionNote}</p>
            </div>
          )}
          {slide.optionalCut && (
            <div className="deck-notes-card deck-notes-card--cut">
              <h3>Corte opcional — pule se o tempo apertar</h3>
              <p>{slide.optionalCut}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** The same text, as one block for PowerPoint's own speaker notes. */
function notesText(slide: SlideData) {
  return [
    `INSTRUÇÃO DE PALCO: ${slide.stageNote}`,
    slide.media ? `MÍDIA: ${slide.media.productionNote}` : null,
    "",
    slide.script,
    slide.optionalCut ? `\nCORTE OPCIONAL: ${slide.optionalCut}` : null,
  ]
    .filter((part) => part !== null)
    .join("\n");
}

/**
 * The deck as a document: every slide, one page each, in the language chosen.
 *
 * It renders the SAME `SlideRenderer` the stage uses, so a PDF page and the
 * projected slide cannot drift apart. Printing is the browser's own pipeline
 * ("Salvar como PDF"): no server, no headless browser on Vercel, fonts embedded
 * as they render, and `@page` sized to the canvas — 1280×720 is 13.33×7.5 in,
 * the same 16:9 widescreen PowerPoint uses, so the file drops into any
 * projector or slide viewer without letterboxing.
 *
 * The page is not ready to print until the fonts are in and every slide has
 * been fitted; the button says so instead of printing a half-measured deck.
 */
export default function DeckExport() {
  const params = useSearchParams();
  const [lang, setLang] = useState<DeckLang>(params.get("idioma") === "zh" ? "zh" : "pt");
  const [withAnnex, setWithAnnex] = useState(params.get("anexo") !== "0");
  const [withScript, setWithScript] = useState(params.get("roteiro") === "1");
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  /** How far the PowerPoint export got, or an error to show instead. */
  const [pptx, setPptx] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const pagesRef = useRef<HTMLElement>(null);

  const slides = withAnnex ? SLIDES_DATA : SLIDES_DATA.filter((slide) => !slide.annex);
  const annexCount = SLIDES_DATA.filter((slide) => slide.annex).length;

  /*
    Chrome names the PDF after the document title. Setting it once is not
    enough: Next re-applies the route's metadata title after hydration, so the
    file came out as "Exportar palestra — MedChina | MedChina". It is set again
    on `beforeprint`, the moment the dialog reads it.
  */
  const fileTitle = `MedChina - Palestra Xinjiang - ${lang === "zh" ? "中文" : "Portugues"}`;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("idioma", lang);
    if (withAnnex) url.searchParams.delete("anexo");
    else url.searchParams.set("anexo", "0");
    if (withScript) url.searchParams.set("roteiro", "1");
    else url.searchParams.delete("roteiro");
    window.history.replaceState(null, "", url);

    const applyTitle = () => {
      document.title = fileTitle;
    };
    applyTitle();
    window.addEventListener("beforeprint", applyTitle);
    return () => window.removeEventListener("beforeprint", applyTitle);
  }, [lang, withAnnex, withScript, fileTitle]);

  // Fit every page, but only once the faces are loaded: a slide measured in the
  // fallback font is measured wrong, and the error only shows on paper.
  useLayoutEffect(() => {
    setReady(false);
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
  }, [lang, withAnnex, withScript]);

  // On screen the pages shrink to the window; on paper they are always 1:1
  // (the print stylesheet overrides the scale).
  useLayoutEffect(() => {
    const pages = pagesRef.current;
    if (!pages) return;
    const measure = () => setScale(Math.min(1, (pages.clientWidth - SCREEN_GUTTER) / CANVAS_W));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pages);
    return () => observer.disconnect();
  }, []);

  /*
    PowerPoint, for an organiser who asks for a .pptx and opens it on their own
    machine. Each slide goes in as one full-bleed image, because the deck is
    CSS — its layout, fonts and the composed frames have no PowerPoint
    equivalent, and a shape-by-shape translation would drift from the projected
    slide at the first edit. That is the trade the hint on the bar states: the
    file carries the deck exactly, and its text is not editable there.

    Both libraries are loaded only when the button is pressed, so they never
    reach the bundle of any other page.
  */
  async function exportPptx() {
    // Only the slides are rasterised; a notes page would be an image of text
    // where PowerPoint already has a place for the words.
    const pages = pagesRef.current?.querySelectorAll<HTMLElement>(
      ".deck-export-page:not([data-notes]) .deck-export-canvas",
    );
    if (!pages?.length) return;

    setFailed(null);
    setPptx({ done: 0, total: pages.length });

    try {
      const [{ default: PptxGenJS }, { toPng }] = await Promise.all([import("pptxgenjs"), import("html-to-image")]);
      const deck = new PptxGenJS();
      deck.defineLayout({ name: "DECK_16X9", width: PPTX_W, height: PPTX_H });
      deck.layout = "DECK_16X9";
      deck.title = fileTitle;

      for (const [index, canvas] of [...pages].entries()) {
        const slide = canvas.querySelector<HTMLElement>(".deck-slide");
        const shot = await toPng(canvas, {
          width: CANVAS_W,
          height: CANVAS_H,
          pixelRatio: SHOT_RATIO,
          // The page is scaled down to fit the window; the capture is not.
          style: { transform: "none", transformOrigin: "top left" },
          backgroundColor: slide ? getComputedStyle(slide).backgroundColor : undefined,
        });
        const page = deck.addSlide();
        page.addImage({ data: shot, x: 0, y: 0, w: PPTX_W, h: PPTX_H });
        if (withScript) page.addNotes(notesText(slides[index]));
        setPptx({ done: index + 1, total: pages.length });
      }

      await deck.writeFile({ fileName: `${fileTitle}.pptx` });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "Não foi possível gerar o arquivo.");
    } finally {
      setPptx(null);
    }
  }

  const busy = pptx !== null;

  return (
    <DeckModeContext.Provider value="export">
      <div className="deck deck--export" data-lang={lang} lang={lang === "zh" ? "zh-Hans" : "pt-BR"}>
        <header className="deck-export-bar">
          <div className="deck-export-heading">
            <FilePdf size={22} weight="duotone" aria-hidden="true" />
            <div>
              <strong>Exportar a palestra</strong>
              <span>
                {withScript ? slides.length * 2 : slides.length} páginas · {LANG_NAME[lang]}
                {withScript && " · com roteiro"}
              </span>
            </div>
          </div>

          <div className="deck-langswitch" role="group" aria-label="Idioma do PDF">
            <Translate size={15} weight="duotone" aria-hidden="true" />
            <button type="button" onClick={() => setLang("pt")} aria-pressed={lang === "pt"}>
              PT
            </button>
            <button type="button" onClick={() => setLang("zh")} aria-pressed={lang === "zh"}>
              中文
            </button>
          </div>

          <label className="deck-export-check">
            <input type="checkbox" checked={withAnnex} onChange={(event) => setWithAnnex(event.target.checked)} />
            Incluir o anexo ({annexCount} slides de perguntas)
          </label>

          <label className="deck-export-check">
            <input type="checkbox" checked={withScript} onChange={(event) => setWithScript(event.target.checked)} />
            Incluir o roteiro
          </label>

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
              document.title = fileTitle;
              window.print();
            }}
            disabled={!ready || busy}
            aria-busy={!ready}
          >
            {ready ? (
              <FilePdf size={16} weight="duotone" aria-hidden="true" />
            ) : (
              <CircleNotch size={16} className="deck-export-spin" aria-hidden="true" />
            )}
            {ready ? "Gerar PDF" : "Preparando páginas…"}
          </button>

          {failed ? (
            <p className="deck-export-hint deck-export-hint--error">
              <Info size={15} weight="duotone" aria-hidden="true" />
              <span>
                O PowerPoint não foi gerado: {failed} O PDF continua disponível e sai igual ao que está na tela.
              </span>
            </p>
          ) : (
            <p className="deck-export-hint">
              <Info size={15} weight="duotone" aria-hidden="true" />
              <span>
                <b>PDF</b>: na janela que abrir, escolha <b>Destino: Salvar como PDF</b>; se o fundo sair branco, marque{" "}
                <b>Gráficos de plano de fundo</b> em “Mais configurações”. <b>PowerPoint</b>: cada slide entra como
                imagem em 1920×1080, fiel ao projetado, mas com o texto não editável lá dentro. Nos dois, os vídeos saem
                como imagem. Com <b>roteiro</b>, o PDF ganha uma página de teleprompter após cada slide e o PowerPoint
                recebe o texto nas notas do apresentador — sempre em português, qualquer que seja o idioma dos slides.
              </span>
            </p>
          )}
        </header>

        <main className="deck-export-pages" ref={pagesRef} style={{ "--export-scale": scale } as CSSProperties}>
          {slides.map((slide, index) => {
            const place = slide.annex ? "Anexo" : slide.roteiroSlide ? `Slide ${slide.roteiroSlide}` : slide.kicker.pt;

            return (
              <Fragment key={slide.key}>
                <article className="deck-export-page" aria-label={`Página ${index + 1}`}>
                  <p className="deck-export-caption">
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    {place} · {slide.title.pt}
                  </p>
                  <div className="deck-export-sheet">
                    <div className="deck-export-canvas">
                      <section className="deck-slide" aria-label={slide.title[lang]}>
                        <SlideRenderer slide={slide} lang={lang} />
                      </section>
                    </div>
                  </div>
                </article>

                {withScript && (
                  <article className="deck-export-page" data-notes="true" aria-label={`Roteiro do slide ${index + 1}`}>
                    <p className="deck-export-caption">
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      Roteiro · {slide.title.pt}
                    </p>
                    <div className="deck-export-sheet">
                      <div className="deck-export-canvas">
                        <section className="deck-slide">
                          <SlideNotes slide={slide} place={place} />
                        </section>
                      </div>
                    </div>
                  </article>
                )}
              </Fragment>
            );
          })}
        </main>
      </div>
    </DeckModeContext.Provider>
  );
}
