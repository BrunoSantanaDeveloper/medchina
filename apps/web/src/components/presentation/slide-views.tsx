"use client";

import {
  AI_LIMITS,
  ANNEX_CITATION,
  ANNEX_CORPUS,
  ANNEX_HONESTY,
  ANNEX_ISOLATION,
  ANNEX_RETURNS,
  ANNEX_RETURNS_NOTE,
  ANNEX_SCOPES,
  ANNEX_STAGES,
  type AnnexRow,
  ATTENTION_THIEVES,
  BRIDGE_LINE,
  CLOSING_LINE,
  CLOSING_PLEDGE,
  CONFUCIUS_CARD,
  CONGRESS_CARDS,
  CONSENT_CARD,
  CONSENT_ITEMS,
  CONTACT,
  CULTURES,
  DATA_PROTECTIONS,
  DUTY_NOTE,
  ETHICAL_DISCLAIMER,
  EVIDENCE,
  FLOW_STEPS,
  FOUNDERS,
  FOUR_EXAMINATIONS,
  FREE_TIER_PLEDGE,
  GUARANTEES,
  GUARANTEES_NOTE,
  HYPOTHESIS_COLUMNS,
  HYPOTHESIS_FRAMING,
  INFORMATION_LAYERS,
  INVITATION_CARD,
  LAW_FACTS,
  LAW_GROUPS,
  LAW_GROUPS_NOTE,
  LAW_QUOTE,
  LAYERS_NOTE,
  LGPD_NOTE,
  LIBRARY_STEPS,
  MILESTONES,
  MILESTONES_NOTE,
  MOTTO,
  MOTTO_EM,
  OFFLINE_NOTE,
  OWN_PROTOCOLS_NOTE,
  PAPER_DECISION,
  PAPER_PAINS,
  PAPER_SEARCH,
  PATIENT_NOTE,
  PLATFORM_STATS,
  SURVEY_CONCLUSION,
  SURVEY_STATS,
  SUS_FOOTNOTE,
  SUS_STATS,
  TIMELINE_BARRIER,
  TIMELINE_EVENTS,
  TRACE_PRINCIPLES,
  V1_GALLERY,
  V1_MILESTONES,
} from "./slides-data";
import { AmbientMedia, Bi, DeckLang, GalleryFrame, SlideData } from "./types";
import { CSSProperties, useEffect, useRef, useState } from "react";

import Logo from "@/components/logo/logo";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowRight,
  Books,
  Buildings,
  Certificate,
  ChatCircleText,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  CloudCheck,
  Coins,
  Ear,
  Eye,
  Fingerprint,
  GraduationCap,
  Handshake,
  Heart,
  Info,
  ListNumbers,
  LockKey,
  MagnifyingGlass,
  MapPin,
  MicrophoneStage,
  MinusCircle,
  MoonStars,
  NotePencil,
  Play,
  PlayCircle,
  Prohibit,
  Rocket,
  Scales,
  SealCheck,
  ShieldCheck,
  Sparkle,
  Stethoscope,
  TrendUp,
  UsersThree,
  WarningCircle,
  Waveform,
} from "@phosphor-icons/react";

/**
 * Class names are composed here rather than with `${cond ? " mod" : ""}`
 * template literals: `prettier-plugin-tailwindcss` normalises whitespace INSIDE
 * class strings, which silently eats the leading space and glues two class
 * names together.
 */
const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** Stagger index for the entry choreography (see `.deck-reveal`). */
const at = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

/* ------------------------------------------------------------------ */
/* Flags — SVG, because emoji flags render as the letters "BR"/"CN" on  */
/* Windows, which is the platform most AV booths run.                   */
/* ------------------------------------------------------------------ */

function FlagBR({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 70 49" role="img" aria-label="Brasil">
      <rect width="70" height="49" fill="#009b3a" />
      <path d="M35 5 66 24.5 35 44 4 24.5Z" fill="#fedf00" />
      <circle cx="35" cy="24.5" r="11" fill="#002776" />
      <path d="M24.8 20.4a24 24 0 0 1 20.4 6" fill="none" stroke="#fff" strokeWidth="2.6" />
    </svg>
  );
}

function FlagCN({ size = 26 }: { size?: number }) {
  const stars = [
    { x: 21, y: 7.5 },
    { x: 26, y: 12.5 },
    { x: 26, y: 19.5 },
    { x: 21, y: 24.5 },
  ];
  return (
    <svg width={size} height={size * 0.7} viewBox="0 0 70 49" role="img" aria-label="中国">
      <rect width="70" height="49" fill="#de2910" />
      <circle cx="11" cy="14" r="7" fill="#ffde00" />
      {stars.map((star) => (
        <circle key={`${star.x}-${star.y}`} cx={star.x} cy={star.y} r="2.1" fill="#ffde00" />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

interface ViewProps {
  slide: SlideData;
  lang: DeckLang;
}

function Head({ slide, lang, center }: ViewProps & { center?: boolean }) {
  return (
    <header className={cx("deck-head", "deck-reveal", center && "deck-head--center")} style={at(0)}>
      <span className="deck-eyebrow">{slide.kicker[lang]}</span>
      <h2 className="deck-title">{slide.title[lang]}</h2>
      {slide.subtitle && <p className="deck-sub">{slide.subtitle[lang]}</p>}
    </header>
  );
}

/** A stat card, in the deck's one stat vocabulary. */
function Stat({
  value,
  label,
  note,
  tone = "primary",
  lang,
  index,
  small,
  wide,
  icon: Icon,
  meter,
}: {
  value: Bi;
  label: Bi;
  note: Bi;
  tone?: string;
  lang: DeckLang;
  index: number;
  small?: boolean;
  wide?: boolean;
  icon?: PhosphorIcon;
  meter?: { value: number; total: number; caption: Bi };
}) {
  return (
    <article
      className={cx(
        "deck-stat",
        `deck-stat--${tone}`,
        "deck-reveal",
        small && "deck-stat--sm",
        wide && "deck-stat--wide",
      )}
      style={at(index)}
    >
      {Icon && (
        <span className="deck-stat-icon">
          <Icon size={20} weight="duotone" aria-hidden="true" />
        </span>
      )}
      <b>{value[lang]}</b>
      {meter && (
        <span className="deck-meter">
          <span className="deck-meter-track">
            <i style={{ width: `${(meter.value / meter.total) * 100}%` }} />
          </span>
          <small>{meter.caption[lang]}</small>
        </span>
      )}
      <span>{label[lang]}</span>
      <small>{note[lang]}</small>
    </article>
  );
}

/**
 * The survey, plotted.
 *
 * Four percentages that share one base (3.800 respondents) were four separate
 * cards, which made the reader compare them in their head — and the argument IS
 * the comparison: almost nobody had a system, almost everybody wanted one. One
 * axis, one baseline, and the gap is visible in a second.
 *
 * Colour: one hue for the four bars, with the 6,8% in the DS's attention tone —
 * emphasis, not a category. The pair was checked with the dataviz validator
 * against the deck surface (mint↔coral: CVD ΔE 9.3, normal-vision 28.3); the
 * brand jade FAILED the chroma floor as a fill (0.079 — "reads gray"), which is
 * why the bars run jade→mint rather than flat jade. Both tones sit under 3:1
 * against the surface, so every bar carries a visible value label — that is the
 * required relief, not decoration.
 */
function SurveyChart({ lang }: { lang: DeckLang }) {
  return (
    <div className="deck-bars">
      {SURVEY_STATS.map((stat, index) => (
        <div
          className={cx("deck-bar-row", stat.tone === "attention" && "deck-bar-row--attention", "deck-reveal")}
          key={stat.value.pt}
          style={at(index + 1)}
        >
          <span className="deck-bar-label">{stat.label[lang]}</span>
          <b className="deck-bar-value">{stat.value[lang]}</b>
          <span className="deck-bar-track">
            <i style={{ width: `${stat.percent}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** How long an asset gets to prove it exists before the slide moves on. */
const ASSET_PROBE_MS = 1500;

/**
 * Is this asset actually there?
 *
 * The deck ships without the photos, the 2021 screenshots and the three
 * testimony videos — they are dropped in before the talk. Every slide has to
 * look composed either way, which makes "does this file exist?" a rendering
 * decision, and the media events are the wrong instrument for it:
 *
 * - `next dev` answers a missing `/videos/...` with 200 and an HTML body, so
 *   `<video>` never fires `error` — it shows a black rectangle forever;
 * - requests for missing files under `/images/...` were observed hanging in
 *   dev, so neither `load` nor `error` ever fires;
 * - a server-rendered `<img>` can fail before React attaches its handler.
 *
 * Asking the server directly, with a deadline, settles all three. An asset
 * that cannot answer in a second and a half is not going on a projector.
 */
function useAssetAvailable(url: string, kind: "image" | "video") {
  // A source served off this origin is never probed. A cross-origin HEAD needs
  // CORS headers the host may not send, and a blocked probe is indistinguishable
  // from a missing file — it would hide a video that is perfectly there. Those
  // are trusted here and checked by the element's own `error` event instead,
  // which does work cross-origin. The probe exists for LOCAL files, where the
  // three failure modes above have no other instrument.
  const remote = /^https?:\/\//i.test(url);

  // Optimistic for images: render at once, retract if the probe says missing.
  // Pessimistic for video: a missing file must never show a black player.
  const [available, setAvailable] = useState(kind === "image" || remote);

  useEffect(() => {
    if (remote) {
      setAvailable(true);
      return;
    }

    let settled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ASSET_PROBE_MS);

    fetch(url, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (settled) return;
        const type = response.headers.get("content-type") ?? "";
        setAvailable(response.ok && type.startsWith(`${kind}/`));
      })
      .catch(() => {
        if (!settled) setAvailable(false);
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      settled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, kind, remote]);

  return available;
}

/** Founder portrait: a real photo when there is one, the monogram until then. */
function Portrait({ photo, monogram }: { photo: string; monogram: string }) {
  const available = useAssetAvailable(photo, "image");
  return <span className="deck-portrait">{available ? <img src={photo} alt="" decoding="async" /> : monogram}</span>;
}

/**
 * A CSS-drawn skeleton of one v1 screen — the Landing DS precedent is the
 * home, which draws an entire phone UI out of markup. It stands in until the
 * real 2021 screenshot is dropped in, and it means slide 11 shows four small
 * product windows instead of four empty rectangles.
 */
function Sketch({ kind }: { kind: GalleryFrame["sketch"] }) {
  if (kind === "agenda") {
    return (
      <div className="deck-sketch deck-sketch--agenda" aria-hidden="true">
        {Array.from({ length: 21 }).map((_, cell) => (
          <i key={cell} />
        ))}
      </div>
    );
  }
  if (kind === "financeiro") {
    return (
      <div className="deck-sketch deck-sketch--financeiro" aria-hidden="true">
        {[42, 68, 34, 88, 58].map((height) => (
          <i key={height} style={{ "--h": `${height}%` } as CSSProperties} />
        ))}
      </div>
    );
  }
  if (kind === "cadastro") {
    return (
      <div className="deck-sketch deck-sketch--cadastro" aria-hidden="true">
        <span className="deck-sketch-avatar" />
        <span className="deck-sketch-line" style={{ width: "72%" }} />
        <span className="deck-sketch-line" style={{ width: "56%" }} />
        <span className="deck-sketch-line" style={{ width: "64%" }} />
        <span className="deck-sketch-pill" />
      </div>
    );
  }
  return (
    <div className="deck-sketch deck-sketch--anamnese" aria-hidden="true">
      <span className="deck-sketch-line deck-sketch-line--label" style={{ width: "38%" }} />
      <span className="deck-sketch-input" />
      <span className="deck-sketch-line deck-sketch-line--label" style={{ width: "46%" }} />
      <span className="deck-sketch-input deck-sketch-input--filled" />
      <span className="deck-sketch-line deck-sketch-line--label" style={{ width: "30%" }} />
      <span className="deck-sketch-input" />
    </div>
  );
}

/**
 * A product screenshot in a little window frame (traffic-light dots + body),
 * echoing the home's flow visuals. `sketch` fills the body until the real
 * file exists.
 */
function WindowShot({
  src,
  alt,
  caption,
  sketch,
  lang,
  index,
}: {
  src: string;
  alt: string;
  caption?: Bi;
  sketch?: GalleryFrame["sketch"];
  lang: DeckLang;
  index: number;
}) {
  const available = useAssetAvailable(src, "image");

  return (
    <figure className="deck-window deck-reveal" style={at(index)}>
      <span className="deck-window-bar" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="deck-window-body">
        {available ? <img src={src} alt={alt} decoding="async" /> : sketch ? <Sketch kind={sketch} /> : null}
      </div>
      {caption && (
        <figcaption>
          <span>{caption[lang]}</span>
        </figcaption>
      )}
    </figure>
  );
}

/**
 * A testimony video. Drop the file at `media.sourceUrl` and it plays; until
 * then the frame names the speaker and their role — never the fact that a file
 * is missing, which is a production detail and belongs in the speaker notes.
 */
function VideoBlock({ slide, lang }: ViewProps) {
  const media = slide.media;
  const probed = useAssetAvailable(media?.sourceUrl ?? "", "video");
  // The only signal left for an off-origin source: the element failed to load
  // it. On stage that is usually the venue's wi-fi, not a missing file, and
  // either way the slide owes the room a composed frame rather than a black
  // rectangle with a broken-media icon in it.
  const [failed, setFailed] = useState(false);

  if (media?.kind !== "testimony") return null;

  return (
    <div className="deck-video deck-reveal" style={at(1)}>
      {!probed || failed ? (
        <div className="deck-video-standby">
          <span className="deck-video-standby-icon">
            <PlayCircle size={40} weight="duotone" aria-hidden="true" />
          </span>
          <strong>{media.speaker[lang]}</strong>
          <span>{media.role[lang]}</span>
        </div>
      ) : (
        <video
          src={media.sourceUrl}
          controls
          playsInline
          preload="auto"
          aria-label={media.label[lang]}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/**
 * Does this machine ask for less movement?
 *
 * The CSS kill switch at the bottom of `palestra.css` stops the deck's own
 * animations, but a looping screencast is not an animation CSS can stop - and
 * it is exactly the kind of motion the preference is about. Read once, at
 * mount: the projector's setting does not change mid-talk, and re-rendering a
 * playing `<video>` on a media-query event would restart it.
 */
function usePrefersCalm() {
  const [calm, setCalm] = useState(false);

  useEffect(() => {
    setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return calm;
}

/**
 * The product, running behind the narration.
 *
 * Not the testimony player above, and the difference is the whole point: this
 * one has no controls, no sound and no end - it starts itself when the slide
 * arrives, loops until she moves on, and never becomes the thing the room is
 * waiting for. Only the current slide is mounted, so entering the slide starts
 * it and leaving stops it; there is no hidden video playing three slides away.
 *
 * Three things it refuses to fake:
 *
 * - **the speed is projected**, because a consultation replayed at speed with
 *   no word about it claims a pace the product does not have;
 * - **a blocked autoplay says so** with a play affordance, instead of standing
 *   frozen on frame one and leaving her to wonder why nothing moves;
 * - **`prefers-reduced-motion` is honoured** by handing her the controls rather
 *   than by hiding the clip - on a machine that asked for less movement a loop
 *   she did not start is the wrong default, and an empty frame is worse.
 */
function AmbientShot({ media, lang, index }: { media: AmbientMedia; lang: DeckLang; index: number }) {
  const available = useAssetAvailable(media.sourceUrl, "video");
  const calm = usePrefersCalm();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || calm) return;

    // Muted autoplay is allowed everywhere this deck can run, but a policy or
    // an extension can still refuse it. `play()` is the only honest test.
    const attempt = element.play();
    if (!attempt) return;
    attempt.then(() => setBlocked(false)).catch(() => setBlocked(true));
  }, [available, calm]);

  return (
    <figure
      className="deck-window deck-window--video deck-reveal"
      style={{ ...at(index), "--shot-aspect": media.aspect } as CSSProperties}
    >
      <span className="deck-window-bar" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="deck-window-body">
        {available ? (
          <video
            ref={videoRef}
            src={media.sourceUrl}
            muted
            loop={!calm}
            controls={calm}
            playsInline
            preload="auto"
            aria-label={media.label[lang]}
          />
        ) : (
          <div className="deck-video-standby">
            <span className="deck-video-standby-icon">
              <PlayCircle size={34} weight="duotone" aria-hidden="true" />
            </span>
            <strong>{media.standby[lang]}</strong>
          </div>
        )}
        {available && blocked && (
          <button
            className="deck-window-play"
            type="button"
            onClick={() => {
              void videoRef.current?.play();
              setBlocked(false);
            }}
            aria-label={media.label[lang]}
          >
            <Play size={26} weight="fill" aria-hidden="true" />
          </button>
        )}
      </div>
      <figcaption>
        <span>{media.caption[lang]}</span>
      </figcaption>
    </figure>
  );
}

/**
 * One annex answer.
 *
 * All four of the congress organisation's questions have the same shape — a
 * term and what it means — so they get one renderer rather than four layouts
 * that would drift apart the first time any of them is edited.
 */
function AnnexList({
  rows,
  lang,
  from = 1,
  dense,
}: {
  rows: AnnexRow[];
  lang: DeckLang;
  from?: number;
  /**
   * A smaller reading size for the answer with the most to say.
   *
   * Set deliberately rather than left to the fit guard: the guard scales the
   * WHOLE slide, title included, so a slide that overflows arrives with its
   * hierarchy flattened. Choosing the body size keeps the heading where it was.
   */
  dense?: boolean;
}) {
  return (
    <dl className={cx("deck-annex", dense && "deck-annex--dense")}>
      {rows.map((row, index) => (
        <div className="deck-annex-row deck-reveal" key={row.term.pt} style={at(from + index)}>
          <dt className="deck-annex-term">
            {row.term[lang]}
            {row.tag && <em>{row.tag[lang]}</em>}
          </dt>
          <dd className="deck-annex-body">
            {row.heading && <strong>{row.heading[lang]}</strong>}
            <span>{row.body[lang]}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* The slides                                                          */
/* ------------------------------------------------------------------ */

export function SlideRenderer({ slide, lang }: ViewProps) {
  const pt = lang === "pt";

  switch (slide.key) {
    /* ---------------------------------------------------------- */
    case "cover":
      return (
        <div className="deck-slide-inner deck-slide-inner--center deck-cover">
          <div className="deck-reveal" style={at(0)}>
            <Logo classNameFull="h-14 w-auto" classNameMobile="hidden" />
          </div>
          <div className="deck-cover-flags deck-reveal" style={at(1)}>
            <FlagBR />
            <span>{pt ? "Brasil" : "巴西"}</span>
            <em>·</em>
            <span>{pt ? "China" : "中国"}</span>
            <FlagCN />
          </div>
          <h1 className="deck-reveal" style={at(2)}>
            {slide.title[lang]}
          </h1>
          <p className="deck-sub deck-reveal" style={at(3)}>
            {slide.subtitle?.[lang]}
          </p>
          <div className="deck-cover-credits deck-reveal" style={at(4)}>
            <div>
              <span>{pt ? "Palestrante" : "演讲人"}</span>
              <strong>Debora Giovanella</strong>
              <small>
                {pt ? "Fundadora do MedChina · Terapeuta desde 2017" : "MedChina 创始人 · 2017年起执业的中医治疗师"}
              </small>
            </div>
            <div>
              <span>{pt ? "Plataforma" : "研发团队"}</span>
              <strong>MedChina</strong>
              <small>
                {pt ? "Prontuário e apoio ao raciocínio clínico para MTC" : "面向中医的电子病历与临床推理辅助平台"}
              </small>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "founders":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--2">
              {FOUNDERS.map((founder, index) => (
                <article
                  className={cx(
                    "deck-card",
                    "deck-founder",
                    "deck-reveal",
                    founder.accent === "secondary" && "deck-founder--secondary",
                  )}
                  key={founder.name}
                  style={at(index + 1)}
                >
                  <div className="deck-founder-top">
                    <Portrait photo={founder.photo} monogram={founder.monogram} />
                    <div>
                      <strong>{founder.name}</strong>
                      <span className="deck-founder-role">{founder.role[lang]}</span>
                      <span className="deck-founder-line">{founder.line[lang]}</span>
                    </div>
                  </div>
                  <ul className="deck-list">
                    {founder.facts.map((fact) => (
                      <li key={fact.pt}>
                        <Check size={17} weight="bold" aria-hidden="true" />
                        <p>{fact[lang]}</p>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "timeline":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-timeline">
              {TIMELINE_EVENTS.map((event, index) => (
                <div
                  className={cx("deck-timeline-item", "deck-reveal", event.emphasis && "deck-timeline-item--emphasis")}
                  key={event.year}
                  style={at(index + 1)}
                >
                  <b>{event.year}</b>
                  <span>{event.label[lang]}</span>
                  <p>{event.body[lang]}</p>
                </div>
              ))}
            </div>
            <div className="deck-note deck-reveal" style={at(6)}>
              <ClockCounterClockwise size={22} weight="duotone" aria-hidden="true" />
              <p>{TIMELINE_BARRIER[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "milestones":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--4">
              {MILESTONES.map((milestone, index) => (
                <article
                  className={cx(
                    "deck-card",
                    "deck-milestone",
                    "deck-reveal",
                    milestone.emphasis && "deck-card--accent",
                  )}
                  key={milestone.year}
                  style={at(index + 1)}
                >
                  <b className="deck-milestone-year">{milestone.year}</b>
                  <span className="deck-milestone-label">{milestone.label[lang]}</span>
                  <p>{milestone.body[lang]}</p>
                </article>
              ))}
            </div>
            <div className="deck-note deck-reveal" style={at(5)}>
              <Scales size={22} weight="duotone" aria-hidden="true" />
              <p>{MILESTONES_NOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "sus-numbers":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {SUS_STATS.map((stat, index) => (
                <Stat
                  key={stat.value.pt}
                  value={stat.value}
                  label={stat.label}
                  note={stat.note}
                  tone={stat.tone}
                  wide={stat.wide}
                  small={!stat.wide}
                  lang={lang}
                  index={index + 1}
                />
              ))}
            </div>
            <div className="deck-note deck-reveal" style={at(6)}>
              <Info size={22} weight="duotone" aria-hidden="true" />
              <p>{SUS_FOOTNOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "law":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--split deck-grid--stretch deck-law-grid">
              <article className="deck-card deck-reveal" style={at(2)}>
                <span className="deck-card-icon">
                  <Scales size={22} weight="duotone" aria-hidden="true" />
                </span>
                <h3>{pt ? "A lei assegura o exercício a quatro grupos" : "该法保障四类人群的执业权"}</h3>
                <ul className="deck-list">
                  {LAW_GROUPS.map((group) => (
                    <li key={group.pt}>
                      <Check size={17} weight="bold" aria-hidden="true" />
                      <p>{group[lang]}</p>
                    </li>
                  ))}
                </ul>
                <div className="deck-note">
                  <Info size={20} weight="duotone" aria-hidden="true" />
                  <p>{LAW_GROUPS_NOTE[lang]}</p>
                </div>
              </article>

              <div className="deck-grid">
                {LAW_FACTS.map((fact, index) => (
                  <Stat
                    key={fact.value.pt}
                    value={fact.value}
                    label={fact.label}
                    note={fact.note}
                    tone={fact.tone}
                    icon={UsersThree}
                    small
                    lang={lang}
                    index={index + 3}
                  />
                ))}
                <blockquote className="deck-quote deck-reveal" style={at(4)}>
                  <p>{LAW_QUOTE[lang]}</p>
                </blockquote>
              </div>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "cultures":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--2">
              {CULTURES.map((column, index) => (
                <article className="deck-card deck-reveal" key={column.flag} style={at(index + 1)}>
                  <div className="deck-culture-head">
                    {column.flag === "cn" ? <FlagCN size={32} /> : <FlagBR size={32} />}
                    <div>
                      <strong>{column.title[lang]}</strong>
                      <span>{column.subtitle[lang]}</span>
                    </div>
                  </div>
                  <ul className="deck-list">
                    {column.items.map((item) => (
                      <li key={item.pt}>
                        <ArrowRight size={16} weight="bold" aria-hidden="true" />
                        <p>{item[lang]}</p>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <div className="deck-note deck-reveal" style={at(3)}>
              <ChatCircleText size={22} weight="duotone" aria-hidden="true" />
              <p>{PATIENT_NOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "paper":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              <article className="deck-card deck-reveal" style={at(1)}>
                <span className="deck-card-icon">
                  <ClockCounterClockwise size={22} weight="duotone" aria-hidden="true" />
                </span>
                <h3>{pt ? "A ficha de papel" : "纸质卡片"}</h3>
                <ul className="deck-list">
                  {PAPER_PAINS.map((pain) => (
                    <li key={pain.pt}>
                      <MapPin size={16} weight="duotone" aria-hidden="true" />
                      <p>{pain[lang]}</p>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="deck-card deck-reveal" style={at(2)}>
                <span className="deck-card-icon">
                  <Eye size={22} weight="duotone" aria-hidden="true" />
                </span>
                <h3>{pt ? "Os prontuários que existiam" : "当时市面上的病历系统"}</h3>
                <ul className="deck-list">
                  {PAPER_SEARCH.map((item) => (
                    <li key={item.pt}>
                      <MapPin size={16} weight="duotone" aria-hidden="true" />
                      <p>{item[lang]}</p>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="deck-card deck-card--accent deck-reveal" style={at(3)}>
                <span className="deck-card-icon">
                  <Sparkle size={22} weight="duotone" aria-hidden="true" />
                </span>
                <h3>{pt ? "A decisão" : "那个决定"}</h3>
                <p>{PAPER_DECISION[lang]}</p>
              </article>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "congress":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {CONGRESS_CARDS.map((card, index) => (
                <Stat
                  key={card.value.pt}
                  value={card.value}
                  label={card.label}
                  note={card.note}
                  tone={card.tone}
                  icon={[MicrophoneStage, UsersThree, Coins][index]}
                  small
                  lang={lang}
                  index={index + 1}
                />
              ))}
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "survey":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <SurveyChart lang={lang} />
            <div className="deck-note deck-reveal" style={at(5)}>
              <Info size={22} weight="duotone" aria-hidden="true" />
              <p>
                <strong>{SURVEY_CONCLUSION[lang]}</strong>
              </p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "version-one":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--4">
              {V1_GALLERY.map((frame, index) => (
                <WindowShot
                  key={frame.src}
                  src={frame.src}
                  alt={frame.caption.pt}
                  caption={frame.caption}
                  sketch={frame.sketch}
                  lang={lang}
                  index={index + 1}
                />
              ))}
            </div>
            <div className="deck-grid deck-grid--3 deck-v1-milestones">
              {V1_MILESTONES.map((milestone, index) => (
                <Stat
                  key={milestone.value.pt}
                  value={milestone.value}
                  label={milestone.label}
                  note={milestone.note}
                  tone={milestone.tone}
                  small
                  lang={lang}
                  index={index + 5}
                />
              ))}
            </div>
            <blockquote className="deck-quote deck-reveal deck-v1-pledge" style={at(8)}>
              <p>{FREE_TIER_PLEDGE[lang]}</p>
            </blockquote>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "platform-today":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--split">
              {/*
                The anamnese screen, not the hero composite: the composite is a
                tall portrait built for the home's hero, and a 16:10 crop of it
                lands on the white gap between the two devices — the slide
                showed a blank card. The anamnese capture is 16:9 and is the
                product itself.
              */}
              <WindowShot
                src="/images/plataforma.jpg"
                alt={pt ? "A plataforma em produção" : "生产环境中的平台"}
                caption={{ pt: "A plataforma em produção", zh: "生产环境中的平台" }}
                lang={lang}
                index={1}
              />
              <div className="deck-grid">
                {PLATFORM_STATS.map((stat, index) => (
                  <Stat
                    key={stat.value.pt}
                    value={stat.value}
                    label={stat.label}
                    note={stat.note}
                    tone={stat.tone}
                    icon={[UsersThree, SealCheck, Rocket][index]}
                    meter={stat.meter}
                    small
                    lang={lang}
                    index={index + 2}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "testimony-user":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <VideoBlock slide={slide} lang={lang} />
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    /*
      The slide where the platform starts being presented - so the platform is
      on it, running. The motto and the three thieves of attention make the
      claim on the left; a consultation plays itself out on the right while she
      says it. The clip is scenery, not a demo: she never turns to it, and the
      three numbered cards became a list so the frame could be big enough to
      read from the back of the hall.
    */
    case "motto":
      return (
        <div className="deck-slide-inner">
          <span className="deck-eyebrow deck-reveal" style={at(0)}>
            {slide.kicker[lang]}
          </span>
          <h2 className="deck-title deck-title--lead deck-reveal" style={at(1)}>
            {MOTTO[lang]}
            <em>{MOTTO_EM[lang]}</em>
          </h2>
          {/* Problem on the left, product on the right, in that reading order. */}
          <div className="deck-grid deck-motto">
            <ul className="deck-motto-list">
              {ATTENTION_THIEVES.map((item, index) => {
                const ThiefIcon = [Eye, Ear, MoonStars][index];
                return (
                  <li className="deck-motto-row deck-reveal" key={item.pt} style={at(index + 3)}>
                    <span className="deck-card-icon">
                      <ThiefIcon size={20} weight="duotone" aria-hidden="true" />
                    </span>
                    <p>{item[lang]}</p>
                  </li>
                );
              })}
            </ul>
            {slide.media?.kind === "ambient" && <AmbientShot media={slide.media} lang={lang} index={2} />}
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "flow":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-flow">
              {FLOW_STEPS.map((step, index) => (
                <article className="deck-flow-step deck-reveal" key={step.step} style={at(index + 1)}>
                  <div className="deck-flow-shot">
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
                      {step.label[lang]}
                    </span>
                    <h3>{step.title[lang]}</h3>
                    <p>{step.body[lang]}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="deck-note deck-reveal" style={at(4)}>
              <CloudCheck size={22} weight="duotone" aria-hidden="true" />
              <p>{OFFLINE_NOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "traceability":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--split deck-grid--stretch">
              {/*
                The worked example, end to end: the authorised excerpt with the
                extracted stretches highlighted, a small player row, and the
                three organised fields — one clear, one flagged, one honestly
                empty. The three rows ARE the three principles on the right.
              */}
              <div className="deck-evidence deck-reveal" style={at(1)}>
                <div className="deck-evidence-top">
                  <span>
                    <ChatCircleText size={16} weight="duotone" aria-hidden="true" /> {EVIDENCE.speaker[lang]}
                  </span>
                  <time>{EVIDENCE.timestamp}</time>
                </div>
                <blockquote>
                  <p>
                    “
                    {EVIDENCE.quote[lang].map((segment, position) =>
                      segment.m ? <mark key={position}>{segment.t}</mark> : <span key={position}>{segment.t}</span>,
                    )}
                    ”
                  </p>
                </blockquote>
                <div className="deck-player" aria-hidden="true">
                  <span className="deck-player-play">
                    <Play size={13} weight="fill" />
                  </span>
                  <span className="deck-player-copy">
                    <strong>{EVIDENCE.player[lang]}</strong>
                  </span>
                  <Waveform size={58} weight="duotone" />
                  <time>{EVIDENCE.duration}</time>
                </div>
                <div className="deck-evidence-arrow">
                  <span />
                  <Sparkle size={16} weight="duotone" aria-hidden="true" />
                  {EVIDENCE.organized[lang]}
                  <span />
                </div>
                {EVIDENCE.fields.map((field, index) => {
                  const FieldIcon = [MoonStars, TrendUp, Stethoscope][index];
                  const StateIcon =
                    field.tone === "clear" ? CheckCircle : field.tone === "attention" ? WarningCircle : MinusCircle;
                  return (
                    <div
                      className={cx("deck-evidence-field", `deck-evidence-field--${field.tone}`)}
                      key={field.label.pt}
                    >
                      <FieldIcon size={20} weight="duotone" aria-hidden="true" />
                      <div>
                        <span className="deck-evidence-heading">
                          <strong>{field.label[lang]}</strong>
                          <em>
                            <StateIcon size={13} weight="fill" aria-hidden="true" /> {field.state[lang]}
                          </em>
                        </span>
                        <p>{field.value[lang]}</p>
                        {field.source && (
                          <span className="deck-evidence-source">
                            <Play size={11} weight="fill" aria-hidden="true" />
                            {pt ? `Ouvir origem · ${field.source}` : `回放出处 · ${field.source}`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="deck-evidence-footer">
                  <SealCheck size={18} weight="duotone" aria-hidden="true" />
                  <span>{EVIDENCE.footer[lang]}</span>
                </div>
              </div>

              <div className="deck-grid">
                {TRACE_PRINCIPLES.map((principle, index) => {
                  const PrincipleIcon = [Fingerprint, MinusCircle, WarningCircle][index];
                  return (
                    <article
                      className={cx("deck-principle", `deck-principle--${index + 1}`, "deck-reveal")}
                      key={principle.index}
                      style={at(index + 2)}
                    >
                      <span className="deck-principle-icon">
                        <PrincipleIcon size={20} weight="duotone" aria-hidden="true" />
                      </span>
                      <div>
                        <strong>{principle.title[lang]}</strong>
                        <p>{principle.body[lang]}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    /*
      Not in the printed roteiro. It exists because the deck could describe
      what the AI produces and had nowhere to say who CHECKS it — and "the
      software checks, not the model" is the strongest sentence the product
      owns. Four cards, because there are exactly four rules and each is
      enforced in `lib/clinical-extraction.ts`; a fifth would be padding.
    */
    case "guarantees":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-grid deck-grid--2">
              {GUARANTEES.map((rule, index) => {
                const RuleIcon = [MagnifyingGlass, Stethoscope, MinusCircle, WarningCircle][index];
                return (
                  <article className="deck-card deck-guarantee deck-reveal" key={rule.index} style={at(index + 1)}>
                    <span className="deck-card-icon">
                      <RuleIcon size={22} weight="duotone" aria-hidden="true" />
                    </span>
                    <b>{rule.index}</b>
                    <h3>{rule.title[lang]}</h3>
                    <p>{rule.body[lang]}</p>
                  </article>
                );
              })}
            </div>
            <div className="deck-note deck-reveal" style={at(5)}>
              <SealCheck size={22} weight="duotone" aria-hidden="true" />
              <p>{GUARANTEES_NOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "hypotheses":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--3">
              {HYPOTHESIS_COLUMNS.map((column, index) => (
                <article
                  className={cx("deck-column", `deck-column--${column.tone}`, "deck-reveal")}
                  key={column.tone}
                  style={at(index + 1)}
                >
                  <span className="deck-column-title">
                    {column.tone === "support" && <Check size={15} weight="bold" aria-hidden="true" />}
                    {column.tone === "attention" && <TrendUp size={15} weight="bold" aria-hidden="true" />}
                    {column.tone === "missing" && <Eye size={15} weight="bold" aria-hidden="true" />}
                    {column.title[lang]}
                  </span>
                  <ul>
                    {column.items.map((item) => (
                      <li key={item.pt}>{item[lang]}</li>
                    ))}
                  </ul>
                  {column.note && <p className="deck-column-note">{column.note[lang]}</p>}
                </article>
              ))}
            </div>

            {/*
              The four layers and the ethical clause are what the room has to
              leave with. The two supporting notes sit side by side (the deck's
              two-band pattern, see the library slide) so the disclaimer is the
              only full-width band — stacked, the three bands read as equals
              and the one that matters most disappeared among them.
            */}
            <div className="deck-layers deck-reveal" style={at(4)}>
              {INFORMATION_LAYERS.map((layer, index) => (
                <div className="deck-layer" key={layer.pt}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>{layer[lang]}</span>
                </div>
              ))}
            </div>

            <div className="deck-grid deck-grid--2 deck-hypotheses-notes">
              <div className="deck-note deck-reveal" style={at(5)}>
                <Sparkle size={22} weight="duotone" aria-hidden="true" />
                <p>{HYPOTHESIS_FRAMING[lang]}</p>
              </div>
              <div className="deck-note deck-reveal" style={at(6)}>
                <SealCheck size={22} weight="duotone" aria-hidden="true" />
                <p>{LAYERS_NOTE[lang]}</p>
              </div>
            </div>

            <div className="deck-disclaimer deck-reveal" style={at(7)}>
              <ShieldCheck size={26} weight="duotone" aria-hidden="true" />
              <p>{`“${ETHICAL_DISCLAIMER[lang]}”`}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    /*
      The library, on its own: the life of one citation, told in the order it
      happens. That sequence is the claim the room will doubt, and the only
      thing this slide argues; the size of the acervo is a number for the
      annex, where someone can read it instead of watching it go by.
    */
    case "library":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            {/*
              Three steps across, in the order a citation actually travels.
              They were a narrow column beside the corpus card; with the card
              gone they take the width, and the arrows between them carry the
              sequence the vertical rail used to carry.
            */}
            <ol className="deck-steps">
              {LIBRARY_STEPS.map((step, index) => {
                const StepIcon = [MagnifyingGlass, ListNumbers, SealCheck][index];
                return (
                  <li className="deck-step deck-reveal" key={step.index} style={at(index + 1)}>
                    <span className="deck-card-icon">
                      <StepIcon size={26} weight="duotone" aria-hidden="true" />
                    </span>
                    <b>{step.index}</b>
                    <h3>{step.title[lang]}</h3>
                    <p>{step.body[lang]}</p>
                  </li>
                );
              })}
            </ol>

            <div className="deck-note deck-reveal" style={at(4)}>
              <NotePencil size={22} weight="duotone" aria-hidden="true" />
              <p>{OWN_PROTOCOLS_NOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    /*
      Consent and protection, split from the library so each gets a slide it
      can be read on. The consent card shows the two authorizations as two
      separate items, because "one for recording, another for AI" is the
      design, and a sentence hides it.
    */
    case "consent-security":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-grid deck-security">
              <article className="deck-card deck-card--accent deck-reveal" style={at(1)}>
                <span className="deck-card-icon">
                  <ShieldCheck size={22} weight="duotone" aria-hidden="true" />
                </span>
                <h3>{CONSENT_CARD.title[lang]}</h3>
                <p>{CONSENT_CARD.body[lang]}</p>
                <ul className="deck-consents">
                  {CONSENT_ITEMS.map((item, index) => {
                    const ConsentIcon = [MicrophoneStage, Sparkle][index];
                    return (
                      <li key={item.index}>
                        <ConsentIcon size={18} weight="duotone" aria-hidden="true" />
                        <span>
                          <strong>{item.title[lang]}</strong>
                          {item.body[lang]}
                        </span>
                        <em>{lang === "pt" ? `Autorização ${item.index}` : `授权 ${item.index}`}</em>
                      </li>
                    );
                  })}
                </ul>
                <p className="deck-consent-refusal">
                  <Heart size={16} weight="duotone" aria-hidden="true" />
                  {CONSENT_CARD.refusal[lang]}
                </p>
              </article>

              <div className="deck-protections">
                {DATA_PROTECTIONS.map((item, index) => {
                  const ProtectionIcon = [LockKey, Fingerprint, Prohibit, Buildings][index];
                  return (
                    <div className="deck-protection deck-reveal" key={item.index} style={at(index + 2)}>
                      <span className="deck-card-icon">
                        <ProtectionIcon size={20} weight="duotone" aria-hidden="true" />
                      </span>
                      <div>
                        <h3>{item.title[lang]}</h3>
                        <p>{item.body[lang]}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="deck-note deck-reveal" style={at(6)}>
              <Scales size={22} weight="duotone" aria-hidden="true" />
              <p>{LGPD_NOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "four-examinations":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body">
            <div className="deck-exams">
              {FOUR_EXAMINATIONS.map((exam, index) => (
                <article
                  className={cx("deck-exam", "deck-reveal", exam.assisted && "deck-exam--assisted")}
                  key={exam.glyph}
                  style={at(index + 1)}
                >
                  <span className="deck-exam-glyph">{exam.glyph}</span>
                  <strong>{exam.pinyin}</strong>
                  <span className="deck-exam-meaning">{exam.meaning[lang]}</span>
                  <small>{exam.note[lang]}</small>
                </article>
              ))}
            </div>
            <div className="deck-grid deck-grid--2 deck-exams-foot">
              <div className="deck-note deck-reveal" style={at(5)}>
                <Stethoscope size={22} weight="duotone" aria-hidden="true" />
                <p>{AI_LIMITS[lang]}</p>
              </div>
              <div className="deck-note deck-reveal" style={at(6)}>
                <Certificate size={22} weight="duotone" aria-hidden="true" />
                <p>{DUTY_NOTE[lang]}</p>
              </div>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "bridge":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-grid deck-grid--2">
              <article className="deck-card deck-reveal" style={at(1)}>
                <span className="deck-card-icon">
                  <GraduationCap size={22} weight="duotone" aria-hidden="true" />
                </span>
                <h3>{CONFUCIUS_CARD.title[lang]}</h3>
                <p>{CONFUCIUS_CARD.body[lang]}</p>
              </article>
              <article className="deck-card deck-card--accent deck-reveal" style={at(2)}>
                <span className="deck-card-icon">
                  <Handshake size={22} weight="duotone" aria-hidden="true" />
                </span>
                <h3>{INVITATION_CARD.title[lang]}</h3>
                <p>{INVITATION_CARD.body[lang]}</p>
              </article>
            </div>
            <div className="deck-note deck-reveal" style={at(3)}>
              <Buildings size={22} weight="duotone" aria-hidden="true" />
              <p>{BRIDGE_LINE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "annex-stages":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <AnnexList rows={ANNEX_STAGES} lang={lang} />
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "annex-scope":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <AnnexList rows={ANNEX_SCOPES} lang={lang} />
            <div className="deck-note deck-reveal" style={at(4)}>
              <LockKey size={22} weight="duotone" aria-hidden="true" />
              <p>{ANNEX_ISOLATION[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "annex-returns":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <AnnexList rows={ANNEX_RETURNS} lang={lang} dense />
            <div className="deck-note deck-reveal" style={at(7)}>
              <SealCheck size={22} weight="duotone" aria-hidden="true" />
              <p>{ANNEX_RETURNS_NOTE[lang]}</p>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "annex-corpus":
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} />
          <div className="deck-body">
            <div className="deck-corpus deck-reveal" style={at(1)}>
              {ANNEX_CORPUS.map((row) => (
                <div
                  className={cx(
                    "deck-corpus-row",
                    row.total && "deck-corpus-row--total",
                    row.pending && "deck-corpus-row--pending",
                  )}
                  key={row.what.pt}
                >
                  <span className="deck-corpus-n">{row.n}</span>
                  <span className="deck-corpus-what">{row.what[lang]}</span>
                </div>
              ))}
            </div>
            <div className="deck-grid deck-grid--2 deck-annex-notes">
              <div className="deck-note deck-reveal" style={at(2)}>
                <Books size={22} weight="duotone" aria-hidden="true" />
                <p>{ANNEX_CITATION[lang]}</p>
              </div>
              {/* The paragraph that answers "but the model read the whole
                  internet, didn't it?" — kept as written, because hedging it
                  would cost exactly the credibility it buys. */}
              <div className="deck-note deck-reveal" style={at(3)}>
                <Scales size={22} weight="duotone" aria-hidden="true" />
                <p>{ANNEX_HONESTY[lang]}</p>
              </div>
            </div>
          </div>
        </div>
      );

    /* ---------------------------------------------------------- */
    case "closing":
      return (
        <div className="deck-slide-inner deck-slide-inner--center deck-closing">
          <div className="deck-reveal" style={at(0)}>
            <Logo classNameFull="h-14 w-auto" classNameMobile="hidden" />
          </div>
          <p className="deck-thanks deck-reveal" style={at(1)}>
            谢谢
            <span>{pt ? "Obrigada · Xièxie" : "Xièxie · Obrigada"}</span>
          </p>
          <blockquote className="deck-quote deck-closing-quote deck-reveal" style={at(2)}>
            <p>{CLOSING_LINE[lang]}</p>
          </blockquote>
          <div className="deck-contact deck-reveal" style={at(3)}>
            <span className="deck-qr">
              <img src="/images/palestra/qr-medchina.svg" alt={`QR code · ${CONTACT.site}`} />
            </span>
            <div className="deck-contact-lines">
              <strong>MedChina · Debora Giovanella</strong>
              <a href={CONTACT.siteUrl}>{CONTACT.site}</a>
              <span>{CONTACT.email}</span>
              <small>{CONTACT.city[lang]}</small>
            </div>
          </div>
          <p className="deck-sub deck-closing-pledge deck-reveal" style={at(4)}>
            {CLOSING_PLEDGE[lang]}
          </p>
        </div>
      );

    /* ---------------------------------------------------------- */
    default:
      return (
        <div className="deck-slide-inner">
          <Head slide={slide} lang={lang} center />
          <div className="deck-body" />
        </div>
      );
  }
}
