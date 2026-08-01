import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import {
  authCookieName,
  IMPERSONATION_MARKER_COOKIE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "./config";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Reads/writes the session cookies of the current request.
 *
 * When a support impersonation is active (migration 0057) the session is read
 * from the parallel cookie instead, so every caller downstream — RLS included
 * — sees the impersonated user without knowing anything about impersonation.
 * Pass `impersonate: false` to force the operator's OWN session (auditing an
 * impersonation must record the operator as the actor, not the user) or
 * `impersonate: true` to force the parallel one before the marker exists.
 */
export async function createClient(options: { impersonate?: boolean } = {}) {
  const cookieStore = await cookies();
  // true/false force the choice (the actions that start and stop an
  // impersonation need both sessions); undefined follows the marker cookie.
  const impersonating = options.impersonate ?? cookieStore.has(IMPERSONATION_MARKER_COOKIE);

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: authCookieName(impersonating) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component where cookies are read-only;
          // the middleware refresh keeps the session alive in that case.
        }
      },
    },
  });
}

/** Convenience: current authenticated user or null. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
