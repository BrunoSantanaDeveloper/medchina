import { type NextRequest, NextResponse } from "next/server";

import { COOKIE_KEYS } from "@/constants";
import { liveEventService } from "@/lib/live-event";
import { hashEventToken, isEventTokenShape } from "@/lib/live-event-shared";
import { hasJsonContentType, hasOnlyKeys, hasSameOrigin, readBoundedJsonObject } from "@/lib/patient-consent-session";

/**
 * The room's heartbeat: while the video plays, the page reports the minute
 * (docs/PAGINA-EVENTO.md §10). This is what presence and time watched are
 * measured from — YouTube gives no viewer list.
 *
 * Same-origin JSON only, a tiny body, one key. The registration is the cookie's;
 * the server credits at most two minutes per beat whatever `seconds` says, and
 * writes to `live_event_presence` (not versioned — one row per viewer, updated
 * every minute). Answers 204 whether or not anything was recorded: a beat from
 * someone without a registration is not an error, and must not tell anyone
 * whether a token exists.
 */
export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request) || !hasJsonContentType(request)) {
    return new NextResponse(null, { status: 400 });
  }
  const body = await readBoundedJsonObject(request, 256);
  if (!body || !hasOnlyKeys(body, ["seconds"])) return new NextResponse(null, { status: 400 });
  const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? Math.round(body.seconds) : 0;

  const token = request.cookies.get(COOKIE_KEYS.liveEvent)?.value;
  const service = liveEventService();
  if (isEventTokenShape(token) && service) {
    await service.rpc("touch_live_event_registration", {
      target_token_hash: hashEventToken(token),
      target_kind: "presence",
      target_seconds: Math.max(0, Math.min(seconds, 120)),
    });
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
