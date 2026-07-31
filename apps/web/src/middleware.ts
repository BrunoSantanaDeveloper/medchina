import { type NextRequest, NextResponse } from "next/server";

import { DEFAULTS } from "@/config";
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

export async function middleware(request: NextRequest) {
  const { response, user, needsMfa } = await updateSession(request);
  const { pathname, search } = request.nextUrl;
  const requestedPath = `${pathname}${search}`;

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
