"use client";

import { useDeckMode } from "./deck-mode";
import type { AmbientMedia, DeckLang } from "./types";
import { CSSProperties, useEffect, useRef, useState } from "react";

import { Play, PlayCircle } from "@phosphor-icons/react";

/**
 * Media that more than one deck shows: the asset probe and the product
 * screencast that runs behind the narration.
 *
 * Lifted out of `slide-views.tsx` so another deck (`/demonstracao`) can run
 * the same clip with the same honesty rules without importing the congress
 * deck renderer and every projected payload it carries.
 */

/** Stagger index for the entry choreography (see `.deck-reveal`). */
const at = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

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
export function useAssetAvailable(url: string, kind: "image" | "video") {
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
 * Not the testimony player (`VideoBlock` in slide-views.tsx), and the difference is the whole point: this
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
export function AmbientShot({ media, lang, index }: { media: AmbientMedia; lang: DeckLang; index: number }) {
  const mode = useDeckMode();
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
        {mode === "export" && media.poster ? (
          <img className="deck-window-still" src={media.poster} alt={media.label[lang]} decoding="sync" />
        ) : available && mode === "stage" ? (
          <video
            ref={videoRef}
            src={media.sourceUrl}
            poster={media.poster}
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
        {mode === "stage" && available && blocked && (
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
