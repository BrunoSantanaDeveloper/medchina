import "server-only";

import type { MetaClientContext } from "./meta-capi";
import { cookies, headers } from "next/headers";

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
    fbc: cookieStore.get("_fbc")?.value ?? null,
    clientIp,
    clientUserAgent: headerStore.get("user-agent"),
    eventSourceUrl: eventSourceUrl ?? null,
  };
}
