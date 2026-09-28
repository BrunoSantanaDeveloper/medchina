import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { COOKIE_KEYS } from "@/constants";
import { findRegistrationForEvent, getLiveEvent, resolveEventToken } from "@/lib/live-event";
import { addEventToken, eventPath, isEventSlug, parseEventCookie } from "@/lib/live-event-common";
import { eventCookieOptions, isEventTokenShape, type LiveEventRow } from "@/lib/live-event-shared";

/**
 * Shared plumbing of the live events' public routes (app/api/public/evento/*).
 *
 * Every event goes through the same routes, so a route never assumes WHICH
 * event: the token says it. A token arrives from `?i=` — the personal link and
 * the confirmation QR carry it, because the phone that scans the QR does not
 * have the desktop browser's cookie — or from the cookie, which holds one token
 * per event this browser registered for; then `?e=<slug>` names the event the
 * button belongs to. A request with neither (a page rendered before events had
 * slugs in their links) falls back to the newest event in the cookie. When the
 * token came from the URL, the response also adds it to the cookie, so the next
 * visit needs no link.
 */
export type ResolvedRegistration = {
  token: string;
  fromQuery: boolean;
  registrationId: string;
  event: LiveEventRow;
};

function cookieTokens(request: NextRequest): string[] {
  return parseEventCookie(request.cookies.get(COOKIE_KEYS.liveEvent)?.value);
}

export async function resolveRegistration(
  request: NextRequest,
  slugHint?: string | null,
): Promise<ResolvedRegistration | null> {
  const fromQuery = request.nextUrl.searchParams.get("i");
  if (isEventTokenShape(fromQuery)) {
    const resolved = await resolveEventToken(fromQuery);
    if (!resolved) return null;
    const event = await getLiveEvent(resolved.eventSlug);
    return event ? { token: fromQuery, fromQuery: true, registrationId: resolved.registrationId, event } : null;
  }

  const slug = slugHint ?? request.nextUrl.searchParams.get("e");
  if (isEventSlug(slug)) {
    const event = await getLiveEvent(slug);
    if (!event) return null;
    const found = await findRegistrationForEvent(event.id, cookieTokens(request));
    return found ? { token: found.token, fromQuery: false, registrationId: found.registrationId, event } : null;
  }
  if (slug) return null;

  // No event named at all: the newest valid token in the cookie decides.
  for (const token of cookieTokens(request)) {
    const resolved = await resolveEventToken(token);
    if (!resolved) continue;
    const event = await getLiveEvent(resolved.eventSlug);
    if (event) return { token, fromQuery: false, registrationId: resolved.registrationId, event };
  }
  return null;
}

/**
 * A redirect that never leaks the token: no-store, and no Referer carried from
 * a URL that had `?i=` in it. `remember` puts that event's token in the
 * browser's cookie without pushing out the other events' tokens.
 */
export function eventRedirect(
  request: NextRequest,
  to: string,
  remember?: { token: string; slug: string } | null,
): NextResponse {
  const response = NextResponse.redirect(new URL(to, request.url), 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (remember) {
    response.cookies.set(
      COOKIE_KEYS.liveEvent,
      addEventToken(request.cookies.get(COOKIE_KEYS.liveEvent)?.value, remember.token, remember.slug),
      eventCookieOptions,
    );
  }
  return response;
}

/**
 * Where anything unrecognized lands: the named event's sign-up when the request
 * says which event it was, the home otherwise — the answer never tells whether a
 * token exists.
 */
export function eventFallback(request: NextRequest): string {
  const slug = request.nextUrl.searchParams.get("e");
  return isEventSlug(slug) ? `${eventPath(slug)}#inscricao` : "/";
}

/** Remember the token only when it came from the URL (the cookie already has it otherwise). */
export function rememberFrom(resolved: ResolvedRegistration): { token: string; slug: string } | null {
  return resolved.fromQuery ? { token: resolved.token, slug: resolved.event.slug } : null;
}
