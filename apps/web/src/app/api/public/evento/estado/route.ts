import { type NextRequest, NextResponse } from "next/server";

import { getLiveEvent } from "@/lib/live-event";

/**
 * The event's state, for pages opened before the start (live-room.tsx:
 * LiveStateWatcher). The state ONLY — no stream, no invite, no counts — and a
 * draft reads as "no event", so this cannot announce an event before the
 * operator opens it. Cached briefly at the edge: hundreds of open pages polling
 * every 30 seconds hit the database once per 15.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("e") ?? "";
  const event = /^[a-z0-9][a-z0-9-]{2,59}$/.test(slug) ? await getLiveEvent(slug) : null;
  const state = event && event.state !== "rascunho" ? event.state : null;
  return NextResponse.json(
    { state },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15" } },
  );
}
