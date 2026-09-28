import { type NextRequest, NextResponse } from "next/server";

import { liveEventService } from "@/lib/live-event";
import { isEventSlug } from "@/lib/live-event-common";
import { resolveRegistration } from "@/lib/live-event-route";
import { hashEventToken } from "@/lib/live-event-shared";
import { hasJsonContentType, hasOnlyKeys, hasSameOrigin, readBoundedJsonObject } from "@/lib/patient-consent-session";

/**
 * The room's heartbeat: while the video plays, the page reports the minute
 * (docs/PAGINA-EVENTO.md §10). This is what presence and time watched are
 * measured from — YouTube gives no viewer list.
 *
 * Same-origin JSON only, a tiny body: the minute and the event the room
 * belongs to (the cookie holds one token per event; a room rendered before the
 * event was named falls back to the newest one). The server credits at most two
 * minutes per beat whatever `seconds` says, and only while that event is live;
 * it writes to `live_event_presence` (not versioned — one row per viewer,
 * updated every minute). Answers 204 whether or not anything was recorded: a
 * beat from someone without a registration is not an error, and must not tell
 * anyone whether a token exists.
 */
export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request) || !hasJsonContentType(request)) {
    return new NextResponse(null, { status: 400 });
  }
  const body = await readBoundedJsonObject(request, 256);
  if (!body || !hasOnlyKeys(body, ["seconds", "event"])) return new NextResponse(null, { status: 400 });
  const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? Math.round(body.seconds) : 0;
  const slug = isEventSlug(body.event) ? body.event : null;

  const service = liveEventService();
  const resolved = service ? await resolveRegistration(request, slug) : null;
  if (service && resolved) {
    await service.rpc("touch_live_event_registration", {
      target_token_hash: hashEventToken(resolved.token),
      target_kind: "presence",
      target_seconds: Math.max(0, Math.min(seconds, 120)),
    });
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
