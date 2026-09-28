import type { NextRequest } from "next/server";

import { liveEventService } from "@/lib/live-event";
import { deviceFromUserAgent } from "@/lib/live-event-common";
import { eventFallback, eventRedirect, rememberFrom, resolveRegistration } from "@/lib/live-event-route";
import { hashEventToken } from "@/lib/live-event-shared";

/**
 * "Entrar no grupo de avisos": marks the click (the closest signal to joining
 * that exists — WhatsApp confirms nothing), counts the class of device of her
 * first click for the event (an aggregate, never stored on her), and redirects
 * to the event's Community invite.
 *
 * A redirect route instead of a JS beacon: it works without JavaScript, cannot
 * lose the race against the navigation, and keeps the invite link out of the
 * page's HTML — the invite never circulates to people who did not register
 * (docs/PAGINA-EVENTO.md §6). A plain `<a>`, never next/link, so nothing
 * prefetches it. The event comes from the token (`?i=`) or, for the cookie, from
 * `?e=<slug>`.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveRegistration(request);
  const service = liveEventService();
  if (!resolved?.event.group_invite_url || !service) return eventRedirect(request, eventFallback(request));

  const { data } = await service.rpc("touch_live_event_registration", {
    target_token_hash: hashEventToken(resolved.token),
    target_kind: "group",
    target_seconds: 0,
    target_device: deviceFromUserAgent(request.headers.get("user-agent")),
  });
  if (!(data as { ok?: boolean } | null)?.ok) return eventRedirect(request, eventFallback(request));

  return eventRedirect(request, resolved.event.group_invite_url, rememberFrom(resolved));
}
