import { NextRequest } from "next/server";

/**
 * Slide sync over the local network, for the phone teleprompter.
 *
 * Why this exists next to the Supabase Realtime transport: the talk is in a
 * congress hall abroad, and the safest way to run the deck there is from the
 * speaker's own laptop with no internet at all (every font, image and video is
 * local — see the presentation README). In that setup the phone and the laptop
 * can still reach each other over the LAN, or over the phone's own hotspot, so
 * the deck syncs with nothing but the two devices.
 *
 * The room registry is module state, which means it only fans out among clients
 * served by THIS Node process. That is exactly right for `next dev` / `next
 * start` on one machine, and exactly wrong on Vercel, where each request may
 * land on a different lambda: a client would connect, receive nothing, and see
 * a "connected" indicator that lies. So on Vercel the endpoint refuses up front
 * and the browser falls back to the Realtime transport instead of silently
 * desynchronising on stage.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serverless has no shared memory between invocations; say so instead of pretending. */
const IS_SERVERLESS = Boolean(process.env.VERCEL);

const ROOM_PATTERN = /^[A-Z0-9]{4,12}$/;
/** Proxies drop a silent connection; a comment line every 25s keeps it open. */
const KEEPALIVE_MS = 25_000;

interface Room {
  clients: Set<(chunk: string) => void>;
  /** The last state published, so a device that joins mid-talk lands in place. */
  last: string | null;
}

const rooms = new Map<string, Room>();

function roomOf(id: string): Room {
  const existing = rooms.get(id);
  if (existing) return existing;
  const room: Room = { clients: new Set(), last: null };
  rooms.set(id, room);
  return room;
}

function readRoom(request: NextRequest): string | null {
  const room = request.nextUrl.searchParams.get("sala")?.toUpperCase() ?? "";
  return ROOM_PATTERN.test(room) ? room : null;
}

function unavailable() {
  return Response.json(
    { error: "lan_sync_unavailable", detail: "Serverless deployment has no shared room state." },
    { status: 501 },
  );
}

/** Subscribe to a room. Each message is one `data:` line holding the deck state. */
export function GET(request: NextRequest) {
  if (IS_SERVERLESS) return unavailable();

  const id = readRoom(request);
  if (!id) return Response.json({ error: "invalid_room" }, { status: 400 });

  const room = roomOf(id);
  const encoder = new TextEncoder();

  let send: (chunk: string) => void = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      send = (chunk) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between the check and the write; the cancel
          // handler below is what actually cleans up.
        }
      };
      room.clients.add(send);

      // `retry` tells EventSource how long to wait before reconnecting, so a
      // dropped Wi-Fi frame costs a second rather than the rest of the talk.
      send(`retry: 2000\n\n`);
      send(`event: ready\ndata: {"ok":true}\n\n`);
      if (room.last) send(`event: state\ndata: ${room.last}\n\n`);

      keepalive = setInterval(() => send(`: keepalive\n\n`), KEEPALIVE_MS);
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      room.clients.delete(send);
      if (room.clients.size === 0) rooms.delete(id);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer streamed responses by default, which holds
      // every slide change until the buffer fills.
      "x-accel-buffering": "no",
    },
  });
}

/** Publish a state to everyone else in the room. */
export async function POST(request: NextRequest) {
  if (IS_SERVERLESS) return unavailable();

  const id = readRoom(request);
  if (!id) return Response.json({ error: "invalid_room" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const room = roomOf(id);
  const payload = JSON.stringify(body);
  room.last = payload;
  for (const send of room.clients) send(`event: state\ndata: ${payload}\n\n`);

  return Response.json({ ok: true, listeners: room.clients.size });
}
