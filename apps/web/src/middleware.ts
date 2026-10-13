import { type NextRequest, NextResponse } from "next/server";

import { DEFAULTS } from "@/config";
import { COOKIE_KEYS } from "@/constants";
import { ATTRIBUTION_COOKIE_MAX_AGE, encodeAttribution, readAttributionFromUrl } from "@/lib/attribution";
import { encodeCampaignCookie, hasCampaign, LAST_CAMPAIGN_MAX_AGE, pickCampaignParams } from "@/lib/campaign-params";
import { detectLocale, LOCALE_COOKIE_MAX_AGE } from "@/lib/locale-detection";
import { COUPON_COOKIE_MAX_AGE, COUPON_PARAM, normalizeCouponCode } from "@/lib/offer-link";
import { IMPERSONATION_MARKER_COOKIE, parseImpersonationMarker } from "@flyee/auth";
import { updateSession } from "@flyee/auth/middleware";
import { sanitizeInternalNext } from "@flyee/clinical";

// Prefixes reachable without a session. Everything else requires auth
// once Supabase is configured (without it, the middleware no-ops and the
// whole template stays browsable). Every route under app/(marketing) must
// be listed here.
const PUBLIC_PREFIXES = [
  "/assets/medir-shell",
  "/auth",
  "/consentir",
  "/api/public/consent",
  // QR "record from your phone" — token-authorized, no login (migration 0053).
  "/gravar",
  "/api/public/capture",
  // The patient's own copy of a document her practitioner issued —
  // token-authorized, no login (migration 0064).
  "/documento",
  "/api/public/document",
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
  // MCP connectors (docs/MCP-CONECTORES.md): the OAuth endpoints authenticate
  // by their own means (registration is open by spec; the token endpoint
  // verifies PKCE/secret), and /api/mcp validates its Bearer token in-route.
  // /oauth/authorize is deliberately NOT here — the consent screen needs the
  // session.
  "/api/oauth",
  "/api/mcp",
  "/verify",
  // Offer pages (route group `(funil)`): reached by a link the operator sends
  // or by a paid ad, deliberately noindex and absent from the sitemap
  // (docs/FUNIL.md D10), but they must still open without a session.
  "/fundadores",
  "/assinar",
  // The live events (docs/PAGINA-EVENTO.md, migration 0113): same (funil)
  // contract — noindex, out of the sitemap. The first keeps its own address;
  // every later one lives under /ao-vivo/<slug>. Plus their public API (sign-up
  // marks, presence, state, e-mail unsubscribe), each route authenticated by
  // its own token.
  "/lei-15345",
  "/ao-vivo",
  "/api/public/evento",
  // The congress authority page (docs/PAGINA-CHINA.md): its own route group,
  // `(autoridade)`, and — unlike the offer pages — INDEXED and in the sitemap.
  "/china",
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
  "/palestra",
  // The pitch deck (NVIDIA Inception application): opened from a form or a
  // link, by someone who has no account here. noindex, absent from the sitemap.
  "/pitch",
  // Slide sync for the phone teleprompter (docs: components/presentation).
  // No session by design: the deck itself is public and the endpoint only
  // fans a slide index out to whoever holds the room code.
  "/api/public/palestra",
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
  // Authorizing an external assistant mints credentials that OUTLIVE the
  // support visit — a support session must never leave a standing connection
  // to the professional's workspace behind.
  "/oauth",
];

/** API routes whose non-GET methods start or write clinical work. */
const IMPERSONATION_READONLY_API = [
  "/api/consultations",
  "/api/recordings",
  "/api/transcriptions",
  "/api/patients",
  "/api/ai",
];

/**
 * Where an account that still owes its WhatsApp confirmation is held, and the
 * few places it may go before that (migration 0122).
 *
 * Such an account is, in practice, a campaign sign-up: it was created without
 * a confirmation so that nothing would stand between the ad and the payment.
 * So the checkout stays open to it — both doors of it — and everything else
 * waits. After a payment the checkout sends her to /onboarding, which is not
 * on this list: that is exactly where the confirmation is asked for.
 *
 * Server actions post to the page they were called from, so the checkout's own
 * actions pass with it. API routes are held too (403, not a redirect): the
 * trial and the recorder must not start behind a screen she never reached.
 */
const WHATSAPP_CONFIRMATION = "/auth/whatsapp";
const WHATSAPP_PENDING_ALLOWED = ["/assinatura", "/settings/billing", "/api/impersonation/exit"];

export async function middleware(request: NextRequest) {
  const { response, user, needsMfa, impersonating } = await updateSession(request);
  const { pathname, search } = request.nextUrl;
  const requestedPath = `${pathname}${search}`;

  /**
   * `whatsapp_pending` is written by the database into the user's APP metadata
   * (a client cannot touch it) and arrives with the session's user, so this is
   * answered without a query. A support session is never held: the operator
   * has to be able to see the account she was asked about.
   */
  const whatsappPending =
    !impersonating &&
    (user as { app_metadata?: Record<string, unknown> } | null)?.app_metadata?.whatsapp_pending === true;

  /**
   * A campaign code (`?cupom=`) must reach the checkout, and between the click
   * and the checkout sit a sign-up, an e-mail confirmation and redirects that
   * all drop the query string. Capturing it here — before any of them — is the
   * only place that sees the original link on EVERY route.
   *
   * The newest link wins over an older stored code: typing a code in a URL is a
   * deliberate act, not passive attribution, and the last campaign she followed
   * is the offer she believes she is getting.
   */
  const linkCoupon = normalizeCouponCode(request.nextUrl.searchParams.get(COUPON_PARAM));

  /**
   * Campaign attribution (?origem/?onda/utm_*), captured on the FIRST touch and
   * never overwritten: the campaign that brought her earned the signup, and a
   * later visit through a bookmark must not take the credit. Persisted to the
   * workspace once the account exists (lib/signup-attribution.ts).
   */
  const linkAttribution = request.cookies.has(COOKIE_KEYS.attribution)
    ? null
    : readAttributionFromUrl(request.nextUrl, request.headers.get("referer"));

  /**
   * The LAST-touch campaign, the opposite rule: rewritten by every link that
   * carries one, because it credits the SALE, not the signup. The checkout
   * reads it when its own link has no campaign — a live event's button that
   * sends to /planos crosses a sign-up and the billing page, which drop the
   * query string (lib/campaign-params.ts, migration 0113).
   */
  const linkCampaign = pickCampaignParams(Object.fromEntries(request.nextUrl.searchParams));

  /**
   * First-visit language. The RENDER already resolves this from the request's
   * own headers (lib/locale-request.ts), so this is not what makes the page
   * appear in Chinese — it is what makes it STAY there: the cookie is the
   * visitor's language from here on, the thing the switcher overrides, and the
   * reason detection runs exactly once per visitor instead of on every request.
   *
   * Only for a page a browser is actually loading: a request that already
   * carries the cookie has been decided, a crawler is never switched (only
   * DEFAULTS.locale is indexable — docs/SEO.md), and an API call or asset has
   * no language to choose.
   */
  const detectedLocale =
    !request.cookies.has(COOKIE_KEYS.locale) &&
    request.method === "GET" &&
    (request.headers.get("accept") ?? "").includes("text/html")
      ? detectLocale({
          acceptLanguage: request.headers.get("accept-language"),
          country: request.headers.get("x-vercel-ip-country"),
          userAgent: request.headers.get("user-agent"),
        })
      : null;

  const withCoupon = <T extends NextResponse>(res: T): T => {
    if (linkCoupon) {
      res.cookies.set(COOKIE_KEYS.offerCoupon, linkCoupon, {
        path: "/",
        maxAge: COUPON_COOKIE_MAX_AGE,
        sameSite: "lax",
        // Read by the billing page to confirm the code visually. A coupon code
        // is public by nature — it is printed in the campaign itself.
        httpOnly: false,
      });
    }
    if (linkAttribution) {
      res.cookies.set(COOKIE_KEYS.attribution, encodeAttribution(linkAttribution), {
        path: "/",
        maxAge: ATTRIBUTION_COOKIE_MAX_AGE,
        sameSite: "lax",
        httpOnly: true,
      });
    }
    if (hasCampaign(linkCampaign)) {
      res.cookies.set(COOKIE_KEYS.lastCampaign, encodeCampaignCookie(linkCampaign), {
        path: "/",
        maxAge: LAST_CAMPAIGN_MAX_AGE,
        sameSite: "lax",
        httpOnly: true,
      });
    }
    if (detectedLocale) {
      // Read by the client (the switcher shows the active language), like the
      // locale cookie the logged-in switcher writes.
      res.cookies.set(COOKIE_KEYS.locale, detectedLocale, {
        path: "/",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax",
        httpOnly: false,
      });
      // The flag that makes the switch VISIBLE: the public page offers the way
      // back to Portuguese while it is set, and acknowledging or choosing a
      // language clears it (lib/locale-actions.ts).
      res.cookies.set(COOKIE_KEYS.localeAuto, detectedLocale, {
        path: "/",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax",
        httpOnly: false,
      });
    }
    return res;
  };

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
    return withCoupon(NextResponse.redirect(twoFactor));
  }

  // Signed-in users don't need the sign-in/sign-up screens.
  if (user && !needsMfa && (pathname.startsWith("/auth/sign-in") || pathname.startsWith("/auth/sign-up"))) {
    const destination = sanitizeInternalNext(request.nextUrl.searchParams.get("next"), DEFAULTS.appRoot);
    return withCoupon(NextResponse.redirect(new URL(destination, request.url)));
  }

  if (!user && !isPublic(pathname)) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("next", sanitizeInternalNext(requestedPath));
    return withCoupon(NextResponse.redirect(signIn));
  }

  // The account exists and may pay, but has not confirmed its WhatsApp yet.
  if (
    user &&
    whatsappPending &&
    !isPublic(pathname) &&
    !WHATSAPP_PENDING_ALLOWED.some((prefix) => pathname.startsWith(prefix))
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "whatsapp_confirmation_required",
          message: "Confirm your WhatsApp to start using the account.",
        },
        { status: 403 },
      );
    }
    const confirmation = new URL(WHATSAPP_CONFIRMATION, request.url);
    confirmation.searchParams.set("next", sanitizeInternalNext(requestedPath));
    return withCoupon(NextResponse.redirect(confirmation));
  }

  return withCoupon(response);
}

export const config = {
  matcher: [
    // Skip static assets and image optimization; run everywhere else.
    // `videos` belongs here for the same reason `images` does: a file under
    // `public/` has no session to refresh, and without it every <video> on a
    // public page (the congress deck) answered a 307 to /auth/sign-in.
    "/((?!_next/static|_next/image|favicon|images|videos|initial-loader|assets|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
