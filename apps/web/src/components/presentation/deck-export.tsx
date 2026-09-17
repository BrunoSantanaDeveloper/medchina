"use client";

import { fitSlide } from "./deck-fit";
import { DeckModeContext } from "./deck-mode";
import { SlideRenderer } from "./slide-views";
import { SLIDES_DATA } from "./slides-data";
import { DeckLang } from "./types";
import { useSearchParams } from "next/navigation";
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CircleNotch, FilePdf, Info, Translate } from "@phosphor-icons/react";

const CANVAS_W = 1280;
/** Room the page frame keeps from the window edge on screen. */
const SCREEN_GUTTER = 64;

const LANG_NAME: Record<DeckLang, string> = { pt: "Português", zh: "中文" };

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
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
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
    window.history.replaceState(null, "", url);

    const applyTitle = () => {
      document.title = fileTitle;
    };
    applyTitle();
    window.addEventListener("beforeprint", applyTitle);
    return () => window.removeEventListener("beforeprint", applyTitle);
  }, [lang, withAnnex, fileTitle]);

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
  }, [lang, withAnnex]);

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

  return (
    <DeckModeContext.Provider value="export">
      <div className="deck deck--export" data-lang={lang} lang={lang === "zh" ? "zh-Hans" : "pt-BR"}>
        <header className="deck-export-bar">
          <div className="deck-export-heading">
            <FilePdf size={22} weight="duotone" aria-hidden="true" />
            <div>
              <strong>Exportar a palestra</strong>
              <span>
                {slides.length} páginas · {LANG_NAME[lang]}
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

          <button
            className="deck-btn deck-btn--primary"
            type="button"
            onClick={() => {
              document.title = fileTitle;
              window.print();
            }}
            disabled={!ready}
            aria-busy={!ready}
          >
            {ready ? (
              <FilePdf size={16} weight="duotone" aria-hidden="true" />
            ) : (
              <CircleNotch size={16} className="deck-export-spin" aria-hidden="true" />
            )}
            {ready ? "Gerar PDF" : "Preparando páginas…"}
          </button>

          <p className="deck-export-hint">
            <Info size={15} weight="duotone" aria-hidden="true" />
            <span>
              Na janela que abrir, escolha <b>Destino: Salvar como PDF</b>. Se o fundo sair branco, marque{" "}
              <b>Gráficos de plano de fundo</b> em “Mais configurações”. Os vídeos saem como imagem.
            </span>
          </p>
        </header>

        <main className="deck-export-pages" ref={pagesRef} style={{ "--export-scale": scale } as CSSProperties}>
          {slides.map((slide, index) => (
            <article className="deck-export-page" key={slide.key} aria-label={`Página ${index + 1}`}>
              <p className="deck-export-caption">
                <b>{String(index + 1).padStart(2, "0")}</b>
                {slide.annex ? "Anexo" : slide.roteiroSlide ? `Slide ${slide.roteiroSlide}` : slide.kicker.pt} ·{" "}
                {slide.title.pt}
              </p>
              <div className="deck-export-sheet">
                <div className="deck-export-canvas">
                  <section className="deck-slide" aria-label={slide.title[lang]}>
                    <SlideRenderer slide={slide} lang={lang} />
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
