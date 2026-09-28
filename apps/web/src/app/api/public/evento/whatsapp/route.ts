import type { NextRequest } from "next/server";

import { liveEventService } from "@/lib/live-event";
import { aboutEvent } from "@/lib/live-event-common";
import { eventFallback, eventRedirect, rememberFrom, resolveRegistration } from "@/lib/live-event-route";
import { hashEventToken } from "@/lib/live-event-shared";
import { whatsappDeepLink } from "@/lib/whatsapp-link";

/**
 * "Receber o link no meu WhatsApp": SHE starts the conversation with the event's
 * number (configured in /admin/eventos). That proves the number is hers, and it
 * turns the team's later messages into replies instead of unsolicited messages
 * from a number she never saved — the pattern WhatsApp restricts
 * (docs/PAGINA-EVENTO.md §0.2). Marks `whatsapp_started_at`, so the console
 * prioritizes these people for the 1:1. The message names the event; after the
 * live it asks for the recording (§11).
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveRegistration(request);
  const service = liveEventService();
  if (!resolved || !service) return eventRedirect(request, eventFallback(request));

  const { event } = resolved;
  const about = aboutEvent(event);
  const message =
    event.state === "encerrado"
      ? `Oi! Quero receber a gravação do ao vivo ${about} por aqui.`
      : `Oi! Me inscrevi no ao vivo ${about} e quero receber o link por aqui.`;
  const link = whatsappDeepLink(event.owner_phone, message);
  if (!link) return eventRedirect(request, eventFallback(request));

  const { data } = await service.rpc("touch_live_event_registration", {
    target_token_hash: hashEventToken(resolved.token),
    target_kind: "whatsapp",
    target_seconds: 0,
  });
  if (!(data as { ok?: boolean } | null)?.ok) return eventRedirect(request, eventFallback(request));

  return eventRedirect(request, link, rememberFrom(resolved));
}
