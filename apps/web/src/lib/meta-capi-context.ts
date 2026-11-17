import "server-only";

import { gaClientIdFromCookie } from "./ga4-mp";
import type { MetaClientContext } from "./meta-capi";
import { cookies, headers } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import { buildFbc } from "@/lib/meta-click";

/**
 * Pulls the Meta match signals out of the CURRENT request so a server-side
 * CAPI event attributes to the same visitor the browser Pixel saw:
 *  - `_fbp` / `_fbc` cookies set by the Pixel on the marketing site (same
 *    origin, so the authenticated app can still read them);
 *  - the client IP + User-Agent behind Vercel's proxy.
 *
 * Must be called inside a request scope (Server Action / route handler).
 */
export async function getMetaClientContext(eventSourceUrl?: string | null): Promise<MetaClientContext> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const forwardedFor = headerStore.get("x-forwarded-for");
  const clientIp = forwardedFor ? forwardedFor.split(",")[0]?.trim() || null : null;
  return {
    fbp: cookieStore.get("_fbp")?.value ?? null,
    // The Pixel's own `_fbc` first, ALWAYS: it is the authoritative value and
    // carries the Pixel's own subdomain index. Only when it is missing do we
    // build one from the click id the middleware captured — which is the case
    // whenever a blocker or tracking prevention stopped the Pixel from ever
    // running, and the reason real ad clicks were reaching Meta unmatched.
    fbc: cookieStore.get("_fbc")?.value ?? buildFbc(cookieStore.get(COOKIE_KEYS.fbclid)?.value),
    clientIp,
    clientUserAgent: headerStore.get("user-agent"),
    eventSourceUrl: eventSourceUrl ?? null,
  };
}

/**
 * GA4 `client_id` from the CURRENT request's `_ga` cookie (set by gtag on the
 * marketing site after consent). Null when absent — which is exactly when we
 * must NOT send a GA4 Measurement Protocol event. Request-scoped, like above.
 */
export async function getGaClientId(): Promise<string | null> {
  const cookieStore = await cookies();
  return gaClientIdFromCookie(cookieStore.get("_ga")?.value);
}
