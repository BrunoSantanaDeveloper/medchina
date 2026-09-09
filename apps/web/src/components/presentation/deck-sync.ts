"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * Keeping the phone teleprompter and the projected deck on the same slide.
 *
 * `BroadcastChannel` (in slide-deck.tsx) already syncs two windows of the SAME
 * browser, which is all the desktop presenter view needed. A phone is a second
 * DEVICE, so it needs a transport that leaves the machine — and which transport
 * is right depends entirely on where the deck is being served from:
 *
 * - **`lan`** — the deck is open on a private address (the laptop serving it on
 *   the venue Wi-Fi, or on the phone's hotspot). Sync goes through this app's
 *   own SSE endpoint: no internet, no third party, lowest latency. This is the
 *   setup to prefer on stage abroad, and the hotspot variant survives the
 *   client-isolated guest Wi-Fi that congress venues often run.
 * - **`cloud`** — the deck is open on a public address (the Vercel deploy).
 *   There is no shared server memory there, so sync goes over Supabase Realtime
 *   broadcast, which the project already depends on. Needs internet on both
 *   devices.
 *
 * The choice is made from the hostname rather than by trying both, so the
 * status shown on screen is the truth about what is actually carrying the
 * state — a sync indicator that might be lying is worse than none.
 */
export type SyncTransport = "lan" | "cloud" | "none";

export type SyncStatus = "idle" | "connecting" | "live" | "error";

/** Ambiguous glyphs (0/O, 1/I) are out: this code gets read off a screen. */
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_STORAGE_KEY = "medchina-palestra-sala";

export function makeRoomCode(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

/** True for the addresses a phone on the same network can actually reach. */
export function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (/^127\./.test(hostname) || /^192\.168\./.test(hostname) || /^10\./.test(hostname)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

/**
 * `localhost` is reachable by the laptop and by nothing else, so a QR pointing
 * at it is a dead end. The panel uses this to say so instead of showing a code
 * that cannot work.
 */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || /^127\./.test(hostname);
}

export function pickTransport(hostname: string): SyncTransport {
  if (isPrivateHost(hostname)) return "lan";
  return isSupabaseConfigured ? "cloud" : "none";
}

/**
 * The room the projector and the phone share. The projector generates one and
 * keeps it for the session; the phone receives it in the QR's query string.
 */
export function resolveRoom(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("sala")?.toUpperCase();
  if (fromUrl && /^[A-Z0-9]{4,12}$/.test(fromUrl)) return fromUrl;

  const stored = sessionStorage.getItem(ROOM_STORAGE_KEY);
  if (stored) return stored;

  const created = makeRoomCode();
  sessionStorage.setItem(ROOM_STORAGE_KEY, created);
  return created;
}

interface RemoteMessage<S> {
  from: string;
  state: S;
}

/**
 * Cross-device half of the deck's shared state.
 *
 * `onRemote` is called with a state that came from the OTHER device and must be
 * applied with the raw setter — never re-published, or the two devices would
 * bounce the same state between them forever.
 *
 * `role` decides what a device does the moment it connects, and it is the whole
 * reason the phone can be opened mid-talk without disturbing the screen:
 *
 * - the **projector** is the source of truth. It publishes its state on
 *   connect, so the room holds the real position, and answers anyone who asks.
 * - the **presenter** (the phone) only ASKS. If it announced its own fresh
 *   state instead, scanning the QR at minute twenty would throw the projected
 *   deck back to slide 1 in front of the audience.
 *
 * Over `lan` the asking is implicit: the endpoint replays the room's last state
 * to every new subscriber, so a phone lands in place with no extra round trip.
 */
export function useRemoteSync<S>({
  room,
  selfId,
  role,
  onRemote,
  getState,
  enabled = true,
}: {
  room: string | null;
  selfId: string;
  role: "projector" | "presenter";
  onRemote: (state: S) => void;
  getState: () => S;
  enabled?: boolean;
}) {
  const [transport, setTransport] = useState<SyncTransport>("none");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const publishRef = useRef<((state: S) => void) | null>(null);
  /** The last state we sent, so a "hello" from a joining device can be answered. */
  const lastPublished = useRef<S | null>(null);
  /* Held in a ref so the effect below never re-runs (and re-connects) just
     because the parent re-rendered with a new closure. */
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;
  const getStateRef = useRef(getState);
  getStateRef.current = getState;

  useEffect(() => {
    if (!enabled || !room) return;

    const chosen = pickTransport(window.location.hostname);
    setTransport(chosen);
    if (chosen === "none") {
      setStatus("idle");
      return;
    }

    setStatus("connecting");

    /* ---------------- local network: this app's own SSE ---------------- */
    if (chosen === "lan") {
      const endpoint = `/api/public/palestra/sync?sala=${room}`;
      const source = new EventSource(endpoint);

      source.addEventListener("ready", () => {
        setStatus("live");
        // Seed the room with the truth so a phone that joins later is replayed
        // into the right slide even if nobody has navigated yet.
        if (role === "projector") publishRef.current?.(getStateRef.current());
      });
      source.addEventListener("state", (event) => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data) as RemoteMessage<S>;
          if (message.from !== selfId) onRemoteRef.current(message.state);
        } catch {
          // A truncated frame is not worth tearing the connection down for.
        }
      });
      // EventSource reconnects on its own; surface the gap while it does.
      source.onerror = () => setStatus((current) => (current === "live" ? "connecting" : "error"));

      publishRef.current = (state) => {
        void fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from: selfId, state } satisfies RemoteMessage<S>),
          keepalive: true,
        }).catch(() => setStatus("error"));
      };

      return () => {
        publishRef.current = null;
        source.close();
        setStatus("idle");
      };
    }

    /* ---------------- public host: Supabase Realtime ------------------- */
    const supabase = createClient();
    const channel = supabase.channel(`palestra:${room}`, { config: { broadcast: { self: false } } });

    channel.on("broadcast", { event: "state" }, ({ payload }) => {
      const message = payload as RemoteMessage<S>;
      if (message?.from !== selfId) onRemoteRef.current(message.state);
    });

    // A device that joins mid-talk asks where the talk is, exactly like the
    // BroadcastChannel handshake does between two windows.
    channel.on("broadcast", { event: "hello" }, ({ payload }) => {
      if (role !== "projector") return;
      if ((payload as { from?: string })?.from === selfId) return;
      publishRef.current?.(getStateRef.current());
    });

    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        setStatus("live");
        if (role === "projector") publishRef.current?.(getStateRef.current());
        else void channel.send({ type: "broadcast", event: "hello", payload: { from: selfId } });
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        setStatus("error");
      } else if (state === "CLOSED") {
        setStatus("idle");
      }
    });

    publishRef.current = (state) => {
      void channel.send({ type: "broadcast", event: "state", payload: { from: selfId, state } });
    };

    return () => {
      publishRef.current = null;
      void supabase.removeChannel(channel);
      setStatus("idle");
    };
  }, [room, selfId, role, enabled]);

  const publish = useCallback((state: S) => {
    lastPublished.current = state;
    publishRef.current?.(state);
  }, []);

  return { transport, status, publish };
}
