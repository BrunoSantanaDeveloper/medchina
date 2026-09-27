"use client";

import "@vidstack/react/player/styles/base.css";
import "@vidstack/react/player/styles/plyr/theme.css";

import { useEffect, useState } from "react";

import { plyrLayoutIcons } from "@/components/plugins/video-player-controls";
import { useHydrated } from "@/hooks/use-hydrated";
import { ArrowClockwise, Broadcast } from "@phosphor-icons/react";
import { MediaPlayer, MediaProvider } from "@vidstack/react";
import { PlyrLayout } from "@vidstack/react/player/layouts/plyr";

const HEARTBEAT_MS = 60_000;

/**
 * The event's video — live on the day, the recording afterwards
 * (docs/PAGINA-EVENTO.md §10, §11).
 *
 * vidstack's YouTube provider embeds from youtube-nocookie.com by default, and
 * `load="play"` keeps even that out of the page until she presses play: no
 * third-party frame, and no cookie, before a deliberate act (FUNIL.md:378).
 * `streamType="live"` is explicit because the YouTube provider does not detect
 * a live stream by itself and would show seek controls for a broadcast.
 *
 * While the video plays, a heartbeat reports the minute to the server. That is
 * what "presence" and "time watched" are measured from: YouTube gives no viewer
 * list, and the room IS this page. The server credits at most two minutes per
 * beat whatever the client sends.
 */
export default function LiveRoom({
  videoId,
  live,
  title,
  poster,
  trackPresence,
}: {
  videoId: string;
  live: boolean;
  title: string;
  poster: string;
  /** Only a recognized registration reports presence (the cookie decides server-side). */
  trackPresence: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  // vidstack's Plyr layout renders different classes on the server and on the
  // first client pass (a hydration mismatch React will not patch). The player
  // is interactive only, so it mounts after hydration; until then the poster
  // holds the same 16:9 box and nothing moves.
  const hydrated = useHydrated();

  useEffect(() => {
    if (!playing || !trackPresence) return;
    const beat = () => {
      void fetch("/api/public/evento/presenca", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seconds: HEARTBEAT_MS / 1000 }),
        keepalive: true,
      }).catch(() => undefined);
    };
    // The first beat marks attendance right away; then once a minute.
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [playing, trackPresence]);

  if (!hydrated) {
    return (
      <div className="event-player event-player--placeholder">
        <img src={poster} alt="" />
      </div>
    );
  }

  return (
    // The poster goes on the player, not in a <Poster>: the Plyr layout paints
    // its own `.plyr__poster` from the media's poster state (a second element
    // would sit loose under it), and a set poster also keeps the YouTube
    // provider from fetching its thumbnail from i.ytimg.com before play.
    <MediaPlayer
      className="event-player"
      title={title}
      src={`youtube/${videoId}`}
      poster={poster}
      load="play"
      streamType={live ? "live" : "on-demand"}
      playsInline
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
    >
      <MediaProvider />
      <PlyrLayout icons={plyrLayoutIcons} />
    </MediaPlayer>
  );
}

/**
 * A page opened before the start does not become the room by itself: the state
 * is read on the server. From ten minutes before `startsAt`, this asks the
 * server every 30 seconds (state only — no link, no count) and, when the room
 * opens, offers the one tap that reloads into it.
 */
export function LiveStateWatcher({ slug, startsAt }: { slug: string; startsAt: string }) {
  const [live, setLive] = useState(false);

  useEffect(() => {
    const startMs = new Date(startsAt).getTime();
    if (Number.isNaN(startMs)) return;
    // Local to this run of the effect (not a ref): React may run an effect,
    // clean it up and run it again, and a stale "stopped" flag would silence
    // the second run for good.
    let cancelled = false;
    let timer: number | undefined;

    const check = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/public/evento/estado?e=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const body = (await response.json()) as { state?: string };
        if (cancelled) return;
        if (body.state === "ao_vivo") {
          setLive(true);
          return;
        }
      } catch {
        // A missed poll is retried on the next tick.
      }
      if (!cancelled) timer = window.setTimeout(check, 30_000);
    };

    const wait = startMs - 10 * 60_000 - Date.now();
    timer = window.setTimeout(check, Math.max(0, wait));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug, startsAt]);

  if (!live) return null;
  return (
    <div className="event-live-banner" role="status">
      <Broadcast size={22} weight="duotone" aria-hidden="true" />
      <span>A transmissão começou.</span>
      <button type="button" className="button button--sm" onClick={() => window.location.reload()}>
        <ArrowClockwise size={16} aria-hidden="true" /> Toque para entrar
      </button>
    </div>
  );
}
