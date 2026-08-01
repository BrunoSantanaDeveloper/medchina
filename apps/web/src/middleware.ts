import { type NextRequest, NextResponse } from "next/server";

import { DEFAULTS } from "@/config";
import { IMPERSONATION_MARKER_COOKIE, parseImpersonationMarker } from "@flyee/auth";
import { updateSession } from "@flyee/auth/middleware";
import { sanitizeInternalNext } from "@flyee/clinical";

// Prefixes reachable without a session. Everything else requires auth
// once Supabase is configured (without it, the middleware no-ops and the
// whole template stays browsable). Every route under app/(marketing) must
// be listed here.
const PUBLIC_PREFIXES = [
  "/auth",
  "/consentir",
  "/api/public/consent",
  // QR "record from your phone" — token-authorized, no login (migration 0053).
  "/gravar",
  "/api/public/capture",
  // One-click email unsubscribe (token in the query, no login) — trial drip.
  "/api/public/unsubscribe",
  // Leaving a support impersonation only DELETES session cookies, so it must
  // work even when the session it is ending is already gone — otherwise the
  // way out redirects to sign-in and the operator is stuck.
  "/api/impersonation/exit",
  // Provider callbacks that authenticate THEMSELVES (Asaas token / Stripe
  // signature / Inngest signing key), so they must NOT hit the auth redirect.
  "/api/webhooks",
  "/api/inngest",
  "/verify",
  "/planos",
  "/como-funciona",
  "/recursos",
  "/seguranca",
  "/migracao",
  "/sobre",
  "/contato",
  "/legal",
  "/ajuda",
  "/blog",
  // SEO surfaces crawlers hit anonymously.
  "/sitemap.xml",
  "/robots.txt",
  "/opengraph-image",
  "/.well-known",
];

const isPublic = (pathname: string) =>
  pathname === "/" || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/** Where a support impersonation ends (also the operator's way back). */
const IMPERSONATION_EXIT = "/api/impersonation/exit";

/**
 * Surfaces a support session must not reach (migration 0057 decided the scope:
 * read everything, write only settings, billing and the agenda).
 *
 * The database is what actually refuses clinical writes — they leave the
 * browser straight for PostgREST and never pass through this middleware. What
 * this list adds is (a) the two things Postgres cannot see, credentials and
 * platform admin, and (b) a readable refusal instead of a raw 42501 for the
 * API routes that do come through Next.
 */
const IMPERSONATION_BLOCKED_PREFIXES = [
  // Credential takeover: password, email and 2FA changes go to GoTrue, not to
  // Postgres, so no trigger can fence them.
  "/settings/security",
  // Platform administration is the operator's own account's business.
  "/admin",
];

/** API routes whose non-GET methods start or write clinical work. */
const IMPERSONATION_READONLY_API = [
  "/api/consultations",
  "/api/recordings",
  "/api/transcriptions",
  "/api/patients",
  "/api/ai",
];

export async function middleware(request: NextRequest) {
  const { response, user, needsMfa, impersonating } = await updateSession(request);
  const { pathname, search } = request.nextUrl;
  const requestedPath = `${pathname}${search}`;

  if (impersonating && pathname !== IMPERSONATION_EXIT) {
    const marker = parseImpersonationMarker(request.cookies.get(IMPERSONATION_MARKER_COOKIE)?.value);

    // The support session died (revoked, or its refresh token expired). Drop
    // the parallel cookies so the very next request reads the operator's own
    // session again — being impersonated must never strand anyone signed out.
    if (!user || !marker) {
      const back = NextResponse.redirect(new URL(IMPERSONATION_EXIT, request.url));
      back.cookies.delete(IMPERSONATION_MARKER_COOKIE);
      return back;
    }

    // A support access is a visit, not a tenancy.
    if (marker.expiresAt <= Date.now()) {
      return NextResponse.redirect(new URL(`${IMPERSONATION_EXIT}?reason=expired`, request.url));
    }

    if (IMPERSONATION_BLOCKED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      return NextResponse.redirect(new URL(DEFAULTS.appRoot, request.url));
    }

    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      IMPERSONATION_READONLY_API.some((prefix) => pathname.startsWith(prefix))
    ) {
      return NextResponse.json(
        {
          error: "impersonation_read_only",
          message: "Support sessions cannot write clinical data. Leave the session to act as yourself.",
        },
        { status: 403 },
      );
    }
  }

  // Licensed template references stay useful in development, but are not
  // product destinations and cannot be reached in a production deployment.
  if (
    process.env.NODE_ENV === "production" &&
    ["/ui", "/docs", "/applications"].some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.redirect(new URL(DEFAULTS.appRoot, request.url));
  }

  // Users with a verified TOTP factor must complete the challenge before
  // reaching anything protected (their session is still AAL1).
  if (user && needsMfa && !isPublic(pathname)) {
    const twoFactor = new URL("/auth/two-factor", request.url);
    twoFactor.searchParams.set("next", sanitizeInternalNext(requestedPath));
    return NextResponse.redirect(twoFactor);
  }

  // Signed-in users don't need the sign-in/sign-up screens.
  if (user && !needsMfa && (pathname.startsWith("/auth/sign-in") || pathname.startsWith("/auth/sign-up"))) {
    const destination = sanitizeInternalNext(request.nextUrl.searchParams.get("next"), DEFAULTS.appRoot);
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (!user && !isPublic(pathname)) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("next", sanitizeInternalNext(requestedPath));
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static assets and image optimization; run everywhere else.
    "/((?!_next/static|_next/image|favicon|images|initial-loader|assets|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
