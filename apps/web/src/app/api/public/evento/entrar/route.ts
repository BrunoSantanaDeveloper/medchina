import type { NextRequest } from "next/server";

import { resolveEventToken } from "@/lib/live-event";
import { eventPath } from "@/lib/live-event-common";
import { eventRedirect } from "@/lib/live-event-route";
import { isEventTokenShape } from "@/lib/live-event-shared";

/**
 * The personal link (`/api/public/evento/entrar?i=<token>`), sent in the
 * confirmation and in the e-mails: it adds the registration to the cookie on any
 * browser or device — Instagram's in-app browser and the iPhone's WhatsApp link
 * view do not share cookies with Chrome/Safari — and lands on THAT event's page,
 * without the token in the URL.
 *
 * An unknown, expired or malformed token lands on the home: the answer is the
 * same either way, so a token cannot be probed.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("i");
  if (!isEventTokenShape(token)) return eventRedirect(request, "/");
  const registration = await resolveEventToken(token);
  if (!registration) return eventRedirect(request, "/");
  return eventRedirect(request, eventPath(registration.eventSlug), { token, slug: registration.eventSlug });
}
