"use client";

import { createBrowserClient } from "@supabase/ssr";

import {
  authCookieName,
  IMPERSONATION_MARKER_COOKIE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "./config";

/** True when this browser is inside a support impersonation (migration 0057). */
export function isImpersonating(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((cookie) => cookie.startsWith(`${IMPERSONATION_MARKER_COOKIE}=`));
}

/**
 * Supabase client for Client Components. Safe to call per render — the
 * underlying instance is memoized by @supabase/ssr.
 *
 * During a support impersonation it reads the parallel session cookie, so
 * every screen behaves exactly as it does for the impersonated user. The
 * memoized singleton is fine because entering and leaving an impersonation
 * always goes through a full page load.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: authCookieName(isImpersonating()) },
  });
}
