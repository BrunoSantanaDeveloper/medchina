import type { NextRequest } from "next/server";

import { getLiveEvent, liveEventService } from "@/lib/live-event";
import { EVENT_SIGNUP, eventRedirect, readEventToken } from "@/lib/live-event-route";
import { hashEventToken, LIVE_EVENT_SLUG } from "@/lib/live-event-shared";
import { whatsappDeepLink } from "@/lib/whatsapp-link";

const MESSAGE = "Oi! Me inscrevi no ao vivo sobre a Lei 15.345 e quero receber o link por aqui.";
// After the live the conversation is about the recording (docs/PAGINA-EVENTO.md §11).
const MESSAGE_AFTER = "Oi! Quero receber a gravação do ao vivo sobre a Lei 15.345 por aqui.";

/**
 * "Receber o link no meu WhatsApp": SHE starts the conversation with the event's
 * number (configured in /admin/leads). That proves the number is hers, and it
 * turns the team's later messages into replies instead of unsolicited messages
 * from a number she never saved — the pattern WhatsApp restricts
 * (docs/PAGINA-EVENTO.md §0.2). Marks `whatsapp_started_at`, so the console
 * prioritizes these people for the 1:1.
 */
export async function GET(request: NextRequest) {
  const { token, fromQuery } = readEventToken(request);
  if (!token) return eventRedirect(request, EVENT_SIGNUP);

  const event = await getLiveEvent(LIVE_EVENT_SLUG);
  const service = liveEventService();
  const link = event
    ? whatsappDeepLink(event.owner_phone, event.state === "encerrado" ? MESSAGE_AFTER : MESSAGE)
    : null;
  if (!event || !service || !link) return eventRedirect(request, EVENT_SIGNUP);

  const { data } = await service.rpc("touch_live_event_registration", {
    target_token_hash: hashEventToken(token),
    target_kind: "whatsapp",
    target_seconds: 0,
  });
  const result = (data ?? {}) as { ok?: boolean; event_slug?: string };
  if (!result.ok || result.event_slug !== event.slug) return eventRedirect(request, EVENT_SIGNUP);

  return eventRedirect(request, link, fromQuery ? token : null);
}
