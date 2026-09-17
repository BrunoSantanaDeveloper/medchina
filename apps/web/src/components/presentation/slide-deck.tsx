"use client";

import DeckConnect from "./deck-connect";
import { fitSlide } from "./deck-fit";
import { resolveRoom, type SyncStatus, type SyncTransport, useRemoteSync } from "./deck-sync";
import { SlideRenderer } from "./slide-views";
import { SLIDES_DATA } from "./slides-data";
import { DeckLang, SlideData } from "./types";
import { useSearchParams } from "next/navigation";
import { CSSProperties, TouchEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import Logo from "@/components/logo/logo";
import {
  ArrowClockwise,
  ArrowsIn,
  ArrowsOut,
  CaretLeft,
  CaretRight,
  Clock,
  DeviceMobile,
  EyeSlash,
  FilePdf,
  MonitorPlay,
  Moon,
  Pause,
  Play,
  Question,
  Sun,
  Translate,
  X,
} from "@phosphor-icons/react";

/**
 * Class names are composed here rather than with `${cond ? " mod" : ""}`
 * template literals: `prettier-plugin-tailwindcss` normalises whitespace INSIDE
 * class strings, which silently eats the leading space and glues two class
 * names together.
 */
const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

const CANVAS_W = 1280;
const CANVAS_H = 720;
const TOTAL_MINUTES = 40;
const CHROME_IDLE_MS = 3200;
const SYNC_CHANNEL = "medchina-palestra";
const TIMER_STORAGE_KEY = "medchina-palestra-timer";

/** State both windows share. The projector and the presenter never disagree. */
interface DeckState {
  index: number;
  /** The projected language — one at a time, never both (see types.ts). */
  lang: DeckLang;
  dark: boolean;
  blackout: boolean;
  /** Wall-clock timer: elapsed = accumulated + (running ? now - startedAt : 0). */
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

/** What travels between the projector window and the presenter window. */
type DeckMessage = { type: "hello"; from: string } | { type: "state"; from: string; state: DeckState };

const INITIAL: DeckState = {
  index: 0,
  // The room is in Xinjiang: Chinese is the default the audience reads, and
  // Portuguese is one keystroke away for rehearsal.
  lang: "zh",
  dark: false,
  blackout: false,
  running: false,
  startedAt: null,
  accumulatedMs: 0,
};

function elapsedMs(state: DeckState) {
  return state.accumulatedMs + (state.running && state.startedAt ? Date.now() - state.startedAt : 0);
}

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "26:00–34:30" → { start: 1560, end: 2070 } in seconds. */
function parseRange(range: string) {
  const [from, to] = range.split(/[–-]/).map((part) => part.trim());
  const toSeconds = (value?: string) => {
    if (!value) return null;
    const [minutes, seconds] = value.split(":").map(Number);
    return Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : null;
  };
  return { start: toSeconds(from), end: toSeconds(to) };
}

/**
 * Am I ahead, on time or late for the block I am standing in? This is the
 * decision the roteiro's optional cuts exist to serve, and it is why the block
 * time range is compared against the clock instead of merely displayed.
 */
function pace(slide: SlideData, ms: number): "ahead" | "ontime" | "behind" {
  const { start, end } = parseRange(slide.timeRange);
  const seconds = ms / 1000;
  if (start !== null && seconds < start - 60) return "ahead";
  if (end !== null && seconds > end + 60) return "behind";
  return "ontime";
}

/** "Slide 12" for a roteiro slide; the kicker for slides the roteiro does not number. */
function slideLabel(slide: SlideData) {
  return slide.roteiroSlide ? `Slide ${slide.roteiroSlide}` : slide.kicker.pt;
}

/**
 * How long the TALK is, and where she stands in it.
 *
 * The annex sits in the same deck but is not part of the forty minutes, so it
 * is counted separately: a progress bar that reads 81% at the closing line
 * would be telling the room there is a fifth of the talk still to come, right
 * at the moment the talk is supposed to land.
 */
const TALK_SLIDES = SLIDES_DATA.filter((slide) => !slide.annex);
const ANNEX_SLIDES = SLIDES_DATA.filter((slide) => slide.annex);

/** "07 / 23" inside the talk; "Anexo 2 / 4" past its end. */
function position(index: number) {
  const slide = SLIDES_DATA[index];
  if (slide.annex) {
    const place = ANNEX_SLIDES.indexOf(slide) + 1;
    return { label: `Anexo ${place} / ${ANNEX_SLIDES.length}`, share: 1, step: TALK_SLIDES.length };
  }
  const place = TALK_SLIDES.indexOf(slide) + 1;
  return {
    label: `${String(place).padStart(2, "0")} / ${TALK_SLIDES.length}`,
    share: place / TALK_SLIDES.length,
    step: place,
  };
}

/* ------------------------------------------------------------------ */
/* Shared state, across both windows                                   */
/* ------------------------------------------------------------------ */

function useDeckState(role: "projector" | "presenter") {
  const [state, setState] = useState<DeckState>(INITIAL);
  const [room, setRoom] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const selfId = useRef(`${performance.timeOrigin}-${Math.round(performance.now())}`);
  /** Read inside the channel handler, which is bound once and never re-bound. */
  const stateRef = useRef(state);
  stateRef.current = state;

  // Restore position from the URL hash and the timer from this tab's session,
  // so an accidental refresh mid-talk does not send her back to slide 1.
  useEffect(() => setRoom(resolveRoom()), []);

  /*
    The phone teleprompter is a second DEVICE, so BroadcastChannel — which never
    leaves the browser — cannot reach it. `useRemoteSync` carries the same state
    over the network and applies it with the raw setter, exactly like a message
    from the other window.
  */
  const remote = useRemoteSync<DeckState>({
    room,
    role,
    selfId: selfId.current,
    onRemote: setState,
    getState: () => stateRef.current,
  });

  useEffect(() => {
    const fromHash = Number(window.location.hash.replace("#s", ""));
    const stored = sessionStorage.getItem(TIMER_STORAGE_KEY);
    setState((previous) => ({
      ...previous,
      index:
        Number.isInteger(fromHash) && fromHash > 0 && fromHash <= SLIDES_DATA.length ? fromHash - 1 : previous.index,
      ...(stored ? (JSON.parse(stored) as Partial<DeckState>) : {}),
    }));
  }, []);

  /*
    A window that joins ASKS where the talk is; it does not announce where it
    thinks the talk is. Opening the presenter view halfway through used to
    broadcast its own fresh state and send the projector back to slide 1 —
    in front of the audience.
  */
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<DeckMessage>) => {
      const message = event.data;
      if (!message || message.from === selfId.current) return;
      if (message.type === "hello") {
        channel.postMessage({ type: "state", from: selfId.current, state: stateRef.current });
        return;
      }
      // The raw setter, never `update`: a remote patch must not be echoed back,
      // or the two windows would ping-pong forever.
      setState(message.state);
    };

    channel.postMessage({ type: "hello", from: selfId.current });

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const publishRemote = remote.publish;
  const update = useCallback(
    (patch: Partial<DeckState> | ((previous: DeckState) => Partial<DeckState>)) => {
      setState((previous) => {
        const next = { ...previous, ...(typeof patch === "function" ? patch(previous) : patch) };
        channelRef.current?.postMessage({ type: "state", from: selfId.current, state: next });
        publishRemote(next);
        return next;
      });
    },
    [publishRemote],
  );

  // Persist what a refresh must not lose.
  useEffect(() => {
    window.history.replaceState(null, "", `#s${state.index + 1}`);
    sessionStorage.setItem(
      TIMER_STORAGE_KEY,
      JSON.stringify({ running: state.running, startedAt: state.startedAt, accumulatedMs: state.accumulatedMs }),
    );
  }, [state.index, state.running, state.startedAt, state.accumulatedMs]);

  return [state, update, { room, transport: remote.transport, status: remote.status }] as const;
}

/** Re-render on a cadence so the wall-clock reading stays current. */
function useTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(id);
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* Presenter window                                                    */
/* ------------------------------------------------------------------ */

/**
 * A phone screen dims and locks after ~30 seconds of not being touched, and a
 * teleprompter is read, not tapped. Wake Lock keeps it lit while the view is
 * visible and — this is the part that is easy to miss — has to be re-acquired
 * after every tab switch or incoming call, because the browser drops the lock
 * on visibility change without telling the page.
 */
function useScreenAwake() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) void lock.release();
        else sentinel = lock;
      } catch {
        // Denied or unsupported: the talk still works, the screen just sleeps.
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release();
    };
  }, []);
}

function PresenterView({
  state,
  update,
  onPrev,
  onNext,
  sync,
}: {
  state: DeckState;
  update: (patch: Partial<DeckState>) => void;
  onPrev: () => void;
  onNext: () => void;
  sync: { room: string | null; transport: SyncTransport; status: SyncStatus };
}) {
  const slide = SLIDES_DATA[state.index];
  const next = SLIDES_DATA[state.index + 1];
  useScreenAwake();
  useTick(state.running);
  const ms = elapsedMs(state);
  const standing = pace(slide, ms);

  return (
    <div className="presenter">
      <div className="presenter-top">
        <span className="presenter-clock">
          {formatClock(ms)}
          <small>/ {TOTAL_MINUTES}:00</small>
        </span>
        <span className={cx("presenter-pace", !slide.annex && `presenter-pace--${standing}`)}>
          {slide.annex ? (
            "Anexo · fora dos 40 minutos"
          ) : (
            <>
              Bloco {slide.block} · {slide.timeRange}
              {standing === "ahead" && " · adiantada"}
              {standing === "behind" && " · atrasada"}
              {standing === "ontime" && " · no ritmo"}
            </>
          )}
        </span>
        {/* She has to be able to tell, at a glance, whether the screen is still
            following her — a teleprompter that quietly stopped syncing is worse
            than one that never did. */}
        <span
          className={`presenter-sync presenter-sync--${sync.status}`}
          title={sync.transport === "lan" ? "Rede local" : sync.transport === "cloud" ? "Internet" : "Sem sincronia"}
        >
          <i aria-hidden="true" />
          {sync.status === "live" ? "Sincronizado" : sync.status === "connecting" ? "Conectando…" : "Sem sincronia"}
        </span>
        <div className="deck-chrome-group deck-chrome-group--end">
          <button
            className="deck-btn"
            type="button"
            onClick={() =>
              update(
                state.running
                  ? { running: false, accumulatedMs: ms, startedAt: null }
                  : { running: true, startedAt: Date.now() },
              )
            }
          >
            {state.running ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
            {state.running ? "Pausar" : "Iniciar"}
          </button>
          <button
            className="deck-btn"
            type="button"
            onClick={() => update({ running: false, startedAt: null, accumulatedMs: 0 })}
            aria-label="Zerar cronômetro"
          >
            <ArrowClockwise size={15} />
          </button>
          <button
            className="deck-btn"
            type="button"
            onClick={onPrev}
            disabled={state.index === 0}
            aria-label="Anterior"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <button
            className="deck-btn deck-btn--primary"
            type="button"
            onClick={onNext}
            disabled={state.index === SLIDES_DATA.length - 1}
          >
            Próximo <CaretRight size={15} weight="bold" />
          </button>
        </div>
      </div>

      <div className="presenter-body">
        <div className="presenter-panel">
          <h1 className="presenter-title">
            <span>
              {slideLabel(slide)} · {position(state.index).label}
            </span>
            {slide.title.pt}
          </h1>
          <div className="presenter-script">{slide.script}</div>
        </div>

        <div className="presenter-panel">
          <div className="presenter-card">
            <h4>Instrução de palco</h4>
            {slide.stageNote}
          </div>
          {slide.optionalCut && (
            <div className="presenter-card presenter-card--cut">
              <h4>Corte opcional — pule se o tempo apertar</h4>
              {slide.optionalCut}
            </div>
          )}
          {slide.media && (
            <div className="presenter-card">
              <h4>Mídia</h4>
              {slide.media.productionNote}
            </div>
          )}
          {next && (
            <div className="presenter-next">
              A seguir · {slideLabel(next)}
              <strong>{next.title.pt}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Phone only (see the media query): the desktop view already has these
          in the top bar, but a thumb does not reach up there. */}
      <div className="presenter-thumb">
        <button type="button" onClick={onPrev} disabled={state.index === 0} aria-label="Slide anterior">
          <CaretLeft size={22} weight="bold" />
        </button>
        <span>
          {state.index + 1} / {SLIDES_DATA.length}
        </span>
        <button
          type="button"
          className="presenter-thumb--next"
          onClick={onNext}
          disabled={state.index === SLIDES_DATA.length - 1}
          aria-label="Próximo slide"
        >
          Avançar
          <CaretRight size={22} weight="bold" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Projector window                                                    */
/* ------------------------------------------------------------------ */

export default function SlideDeck() {
  const searchParams = useSearchParams();
  const isPresenter = searchParams.get("apresentador") === "1";

  const [state, update, sync] = useDeckState(isPresenter ? "presenter" : "projector");
  const [fullscreen, setFullscreen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [scale, setScale] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const digitBuffer = useRef("");

  const slide = SLIDES_DATA[state.index];
  const total = SLIDES_DATA.length;
  useTick(state.running && !isPresenter);

  const go = useCallback(
    (nextIndex: number) => {
      const clamped = Math.min(Math.max(nextIndex, 0), total - 1);
      setDirection(clamped >= state.index ? "forward" : "back");
      update({ index: clamped });
    },
    [state.index, total, update],
  );

  const next = useCallback(() => go(state.index + 1), [go, state.index]);
  const prev = useCallback(() => go(state.index - 1), [go, state.index]);

  /* --- the canvas scale: one layout, every projector ---------------- */
  useLayoutEffect(() => {
    if (isPresenter) return;
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
  }, [isPresenter]);

  /* --- fullscreen --------------------------------------------------- */
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    rootRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* --- stage-clean: the toolbar leaves while she presents ------------ */
  useEffect(() => {
    if (!fullscreen || isPresenter) {
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
  }, [fullscreen, isPresenter]);

  /* --- the presenter window ----------------------------------------- */
  const openPresenter = useCallback(() => {
    window.open(
      `${window.location.pathname}?apresentador=1${window.location.hash}`,
      "medchina-apresentador",
      "width=1100,height=760",
    );
  }, []);

  /* --- keyboard ------------------------------------------------------ */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      // Never steal a browser shortcut: Ctrl+F used to toggle fullscreen.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === "Escape") {
        if (showConnect) setShowConnect(false);
        else if (showShortcuts) setShowShortcuts(false);
        else if (state.blackout) update({ blackout: false });
        return;
      }

      // A blackout is a deliberate pause: a stray click on the presenter remote
      // must not walk the deck forward behind the black screen.
      if (state.blackout && event.key !== "b" && event.key !== "B") {
        event.preventDefault();
        return;
      }

      if (/^\d$/.test(event.key)) {
        digitBuffer.current += event.key;
        return;
      }
      if (event.key === "Enter" && digitBuffer.current) {
        const wanted = Number(digitBuffer.current);
        digitBuffer.current = "";
        // Type the number printed in the roteiro, not the deck's own position.
        const found = SLIDES_DATA.findIndex((item) => item.roteiroSlide === wanted);
        go(found >= 0 ? found : wanted - 1);
        event.preventDefault();
        return;
      }

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
        case " ":
        case "PageDown":
          event.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          prev();
          break;
        case "Home":
          event.preventDefault();
          go(0);
          break;
        case "End":
          event.preventDefault();
          go(total - 1);
          break;
        case "f":
        case "F":
          event.preventDefault();
          toggleFullscreen();
          break;
        case "t":
        case "T":
          update({ dark: !state.dark });
          break;
        case "l":
        case "L":
          update({ lang: state.lang === "pt" ? "zh" : "pt" });
          break;
        case "b":
        case "B":
          event.preventDefault();
          update({ blackout: !state.blackout });
          break;
        case "n":
        case "N":
          openPresenter();
          break;
        case "c":
        case "C":
          setShowConnect((value) => !value);
          break;
        case "?":
        case "h":
        case "H":
          setShowShortcuts((value) => !value);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    go,
    next,
    openPresenter,
    prev,
    showConnect,
    showShortcuts,
    state.lang,
    state.blackout,
    state.dark,
    toggleFullscreen,
    total,
    update,
  ]);

  /* --- touch --------------------------------------------------------- */
  const onTouchStart = (event: TouchEvent) => {
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
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

  // Nothing gets clipped on stage — see `deck-fit.ts` for the rule, which the
  // exporter shares so a PDF page is fitted exactly like the projected slide.
  useLayoutEffect(() => {
    const section = slideRef.current;
    if (!section) return;
    section.style.setProperty("--fit", "1");
    const frame = requestAnimationFrame(() => fitSlide(section));
    return () => cancelAnimationFrame(frame);
  }, [slide.key, state.lang]);

  const ms = elapsedMs(state);
  const standing = useMemo(() => pace(slide, ms), [slide, ms]);

  if (isPresenter) {
    return <PresenterView state={state} update={update} onPrev={prev} onNext={next} sync={sync} />;
  }

  return (
    <div
      className={cx("deck", state.dark && "deck--dark", chromeHidden && "deck--clean")}
      data-lang={state.lang}
      lang={state.lang === "zh" ? "zh-Hans" : "pt-BR"}
      ref={rootRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="deck-ambience" aria-hidden="true">
        <span />
        <span />
      </div>

      <header className="deck-chrome deck-chrome--header">
        <Logo classNameFull="h-7 w-auto" classNameMobile="hidden" tone={state.dark ? "contrast" : "default"} />
        <p className="deck-context">
          <strong>{slideLabel(slide)}</strong>
          <span>
            Bloco {slide.block} · {slide.blockTitle.pt}
          </span>
        </p>

        <div className="deck-chrome-group deck-chrome-group--end">
          <span className={`deck-timer deck-timer--${standing === "ontime" ? "ok" : standing}`}>
            <Clock size={15} weight="duotone" aria-hidden="true" />
            <b>{formatClock(ms)}</b>
            <small>/ {TOTAL_MINUTES}:00</small>
            <button
              type="button"
              onClick={() =>
                update(
                  state.running
                    ? { running: false, accumulatedMs: ms, startedAt: null }
                    : { running: true, startedAt: Date.now() },
                )
              }
              aria-label={state.running ? "Pausar cronômetro" : "Iniciar cronômetro"}
            >
              {state.running ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
            <button
              type="button"
              onClick={() => update({ running: false, startedAt: null, accumulatedMs: 0 })}
              aria-label="Zerar cronômetro"
            >
              <ArrowClockwise size={14} />
            </button>
          </span>

          <button className="deck-btn" type="button" onClick={openPresenter}>
            <MonitorPlay size={15} weight="duotone" aria-hidden="true" />
            Modo apresentador
          </button>

          {/* The phone teleprompter: scan and it follows the deck. */}
          <button
            className={cx("deck-btn", sync.status === "live" && "deck-btn--linked")}
            type="button"
            onClick={() => setShowConnect(true)}
          >
            <DeviceMobile size={15} weight="duotone" aria-hidden="true" />
            Celular
            {sync.status === "live" && <i className="deck-btn-dot" aria-hidden="true" />}
          </button>

          {/* The PDF, in the language on screen — changeable on the export page. */}
          <a className="deck-btn" href={`/palestra/exportar?idioma=${state.lang}`} target="_blank" rel="noopener">
            <FilePdf size={15} weight="duotone" aria-hidden="true" />
            Exportar
          </a>

          {/* One language on screen at a time — this switches, it does not add. */}
          <div className="deck-langswitch" role="group" aria-label="Idioma dos slides">
            <Translate size={15} weight="duotone" aria-hidden="true" />
            <button type="button" onClick={() => update({ lang: "pt" })} aria-pressed={state.lang === "pt"}>
              PT
            </button>
            <button type="button" onClick={() => update({ lang: "zh" })} aria-pressed={state.lang === "zh"}>
              中文
            </button>
          </div>

          <button
            className="deck-btn deck-btn--icon"
            type="button"
            onClick={() => update({ dark: !state.dark })}
            aria-label={state.dark ? "Usar tema claro" : "Usar tema escuro"}
          >
            {state.dark ? <Sun size={15} weight="duotone" /> : <Moon size={15} weight="duotone" />}
          </button>

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
          // Advance only on the empty stage, so a click on a video control or a
          // link inside a slide does exactly what it says.
          if (event.target === stageRef.current) next();
        }}
      >
        <div className="deck-canvas" style={{ "--deck-scale": scale } as CSSProperties}>
          <section
            className="deck-slide"
            ref={slideRef}
            key={slide.key}
            data-direction={direction}
            aria-label={`${slideLabel(slide)}: ${slide.title.pt}`}
          >
            <SlideRenderer slide={slide} lang={state.lang} />
          </section>
        </div>
      </main>

      <footer className="deck-chrome deck-chrome--footer">
        <div className="deck-chrome-group">
          <button
            className="deck-btn deck-btn--icon"
            type="button"
            onClick={prev}
            disabled={state.index === 0}
            aria-label="Slide anterior"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <button
            className="deck-btn deck-btn--primary deck-btn--icon"
            type="button"
            onClick={next}
            disabled={state.index === total - 1}
            aria-label="Próximo slide"
          >
            <CaretRight size={15} weight="bold" />
          </button>
        </div>

        <span className="deck-counter">{position(state.index).label}</span>

        <div
          className="deck-progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TALK_SLIDES.length}
          aria-valuenow={position(state.index).step}
        >
          <i style={{ width: `${position(state.index).share * 100}%` }} />
        </div>

        <div className="deck-chrome-group deck-chrome-group--end">
          <label className="deck-context" htmlFor="deck-jump">
            Ir para
          </label>
          <select
            className="deck-select"
            id="deck-jump"
            value={state.index}
            onChange={(event) => go(Number(event.target.value))}
          >
            {SLIDES_DATA.map((item, index) => (
              <option key={item.key} value={index}>
                {slideLabel(item)} — {item.title.pt}
              </option>
            ))}
          </select>
          <button
            className="deck-btn deck-btn--icon"
            type="button"
            onClick={() => update({ blackout: true })}
            aria-label="Tela preta"
          >
            <EyeSlash size={15} />
          </button>
          <button
            className="deck-btn deck-btn--icon"
            type="button"
            onClick={() => setShowShortcuts(true)}
            aria-label="Atalhos de teclado"
          >
            <Question size={15} />
          </button>
        </div>
      </footer>

      {state.blackout && (
        <div
          className="deck-blackout"
          role="button"
          tabIndex={0}
          onClick={() => update({ blackout: false })}
          onKeyDown={(event) => event.key === "Enter" && update({ blackout: false })}
          aria-label="Retomar a apresentação"
        >
          {/* Deliberately empty: a stage pause is a black screen, not a place
              to leave a quote from one specific slide standing over every
              other moment of the talk. */}
          <div>
            <small>Pausa de palco · clique ou tecle B para retomar</small>
          </div>
        </div>
      )}

      {showConnect && sync.room && (
        <DeckConnect
          room={sync.room}
          transport={sync.transport}
          status={sync.status}
          onClose={() => setShowConnect(false)}
        />
      )}

      {showShortcuts && (
        <div className="deck-modal" onClick={() => setShowShortcuts(false)}>
          <div
            className="deck-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Atalhos de teclado"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>
              Atalhos
              <button
                className="deck-btn deck-btn--icon"
                type="button"
                style={{ float: "right" }}
                onClick={() => setShowShortcuts(false)}
                aria-label="Fechar"
              >
                <X size={14} />
              </button>
            </h2>
            <dl className="deck-shortcuts">
              <dt>Avançar / voltar</dt>
              <dd>
                <kbd>→</kbd> <kbd>←</kbd> <kbd>espaço</kbd>
              </dd>
              <dt>Ir para um slide do roteiro</dt>
              <dd>
                <kbd>12</kbd> <kbd>Enter</kbd>
              </dd>
              <dt>Modo apresentador (2ª tela)</dt>
              <dd>
                <kbd>N</kbd>
              </dd>
              <dt>Tela cheia</dt>
              <dd>
                <kbd>F</kbd>
              </dd>
              <dt>Tela preta</dt>
              <dd>
                <kbd>B</kbd>
              </dd>
              <dt>Alternar idioma dos slides</dt>
              <dd>
                <kbd>L</kbd>
              </dd>
              <dt>Tema claro / escuro</dt>
              <dd>
                <kbd>T</kbd>
              </dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
