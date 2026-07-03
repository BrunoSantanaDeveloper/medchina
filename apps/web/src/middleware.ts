import { type NextRequest, NextResponse } from "next/server";

import { DEFAULTS } from "@/config";
import { updateSession } from "@gogo/auth/middleware";

// Prefixes reachable without a session. Everything else requires auth
// once Supabase is configured (without it, the middleware no-ops and the
// whole template stays browsable).
const PUBLIC_PREFIXES = ["/auth", "/landing-page", "/verify"];

const isPublic = (pathname: string) =>
  pathname === "/" || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Signed-in users don't need the sign-in/sign-up screens.
  if (user && (pathname.startsWith("/auth/sign-in") || pathname.startsWith("/auth/sign-up"))) {
    return NextResponse.redirect(new URL(DEFAULTS.appRoot, request.url));
  }

  if (!user && !isPublic(pathname)) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("next", pathname);
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
