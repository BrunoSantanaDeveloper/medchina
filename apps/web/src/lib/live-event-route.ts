import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { COOKIE_KEYS } from "@/constants";
import { eventCookieOptions, isEventTokenShape, LIVE_EVENT_SLUG } from "@/lib/live-event-shared";

/**
 * Shared plumbing of the live event's public routes (app/api/public/evento/*).
 *
 * The token comes from the httpOnly cookie OR from `?i=` — the personal link and
 * the confirmation QR carry it, because the phone that scans the QR does not
 * have the desktop browser's cookie. When it comes from the URL, the response
 * also stores it as the cookie, so the next visit needs no link.
 */
export function readEventToken(request: NextRequest): { token: string | null; fromQuery: boolean } {
  const fromQuery = request.nextUrl.searchParams.get("i");
  if (isEventTokenShape(fromQuery)) return { token: fromQuery, fromQuery: true };
  const fromCookie = request.cookies.get(COOKIE_KEYS.liveEvent)?.value;
  return { token: isEventTokenShape(fromCookie) ? fromCookie : null, fromQuery: false };
}

/**
 * A redirect that never leaks the token: no-store, and no Referer carried from
 * a URL that had `?i=` in it.
 */
export function eventRedirect(request: NextRequest, to: string, cookieToken?: string | null): NextResponse {
  const response = NextResponse.redirect(new URL(to, request.url), 302);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (cookieToken) response.cookies.set(COOKIE_KEYS.liveEvent, cookieToken, eventCookieOptions);
  return response;
}

/** Where anything unrecognized lands: the page, at the sign-up. */
export const EVENT_PAGE = `/${LIVE_EVENT_SLUG}`;
export const EVENT_SIGNUP = `/${LIVE_EVENT_SLUG}#inscricao`;
