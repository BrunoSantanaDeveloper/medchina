import type { NextRequest } from "next/server";

import { getLiveEvent, liveEventService } from "@/lib/live-event";
import { EVENT_SIGNUP, eventRedirect, readEventToken } from "@/lib/live-event-route";
import { hashEventToken, LIVE_EVENT_SLUG } from "@/lib/live-event-shared";

/**
 * "Entrar no grupo de avisos": marks the click (the closest signal to joining
 * that exists — WhatsApp confirms nothing) and redirects to the Community
 * invite.
 *
 * A redirect route instead of a JS beacon: it works without JavaScript, cannot
 * lose the race against the navigation, and keeps the invite link out of the
 * page's HTML — the invite never circulates to people who did not register
 * (docs/PAGINA-EVENTO.md §6). A plain `<a>`, never next/link, so nothing
 * prefetches it.
 */
export async function GET(request: NextRequest) {
  const { token, fromQuery } = readEventToken(request);
  if (!token) return eventRedirect(request, EVENT_SIGNUP);

  const [event, service] = [await getLiveEvent(LIVE_EVENT_SLUG), liveEventService()];
  if (!event?.group_invite_url || !service) return eventRedirect(request, EVENT_SIGNUP);

  const { data } = await service.rpc("touch_live_event_registration", {
    target_token_hash: hashEventToken(token),
    target_kind: "group",
    target_seconds: 0,
  });
  const result = (data ?? {}) as { ok?: boolean; event_slug?: string };
  if (!result.ok || result.event_slug !== event.slug) return eventRedirect(request, EVENT_SIGNUP);

  return eventRedirect(request, event.group_invite_url, fromQuery ? token : null);
}
