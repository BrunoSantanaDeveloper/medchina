import type { NextRequest } from "next/server";

import { getRegistrationFromToken } from "@/lib/live-event";
import { EVENT_PAGE, eventRedirect } from "@/lib/live-event-route";
import { isEventTokenShape } from "@/lib/live-event-shared";

/**
 * The personal link (`/api/public/evento/entrar?i=<token>`), sent in the
 * confirmation and in the e-mails: it recreates the registration cookie on any
 * browser or device — Instagram's in-app browser and the iPhone's WhatsApp link
 * view do not share cookies with Chrome/Safari — and lands on the page WITHOUT
 * the token in the URL.
 *
 * An unknown, expired or malformed token just lands on the page: the answer is
 * the same either way, so a token cannot be probed.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("i");
  if (!isEventTokenShape(token)) return eventRedirect(request, EVENT_PAGE);
  const registration = await getRegistrationFromToken(null, token);
  return eventRedirect(request, EVENT_PAGE, registration ? token : null);
}
