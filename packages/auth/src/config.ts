export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * True when Supabase env vars are present. The template degrades gracefully
 * without them (auth middleware no-ops, pages surface a configuration hint)
 * so a fresh clone is browsable before any Supabase project exists.
 */
export const isSupabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/* ------------------------------------------------------------------ *
 * Support impersonation ("personificar")
 *
 * A support session lives in a SEPARATE auth cookie, so starting one
 * never overwrites the operator's own session and leaving one is just
 * deleting two cookies — there is no token to restore and therefore no
 * way to strand the operator signed out.
 *
 * Both cookies are plain (not httpOnly) because the browser Supabase
 * client has to read the session, exactly like the normal one. The
 * marker carries no authority: it only selects WHICH cookie holds the
 * session. Whether that session may write is decided by the database
 * (`public.is_impersonated()`, migration 0057), never here.
 * ------------------------------------------------------------------ */

/** Presence of this cookie means "read the session from the impersonation cookie". */
export const IMPERSONATION_MARKER_COOKIE = "mc-impersonating";

/** Supabase derives its cookie name from the project ref; mirror that for the parallel one. */
function projectRef(): string {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0] || "local";
  } catch {
    return "local";
  }
}

/** Storage/cookie key of the parallel (impersonated) session. */
export const impersonationCookieName = () => `sb-${projectRef()}-imp-auth-token`;

/**
 * Cookie name a Supabase client should use, or undefined for the default.
 * Passed as `cookieOptions.name` on every client entry point so a single
 * decision covers server components, route handlers, middleware and the
 * browser — the rest of the app stays unaware it is impersonating.
 */
export const authCookieName = (impersonating: boolean) =>
  impersonating ? impersonationCookieName() : undefined;

export type ImpersonationMarker = { sessionId: string; expiresAt: number };

/** `<session id>.<expiry epoch ms>` — readable by the middleware without a query. */
export const encodeImpersonationMarker = (sessionId: string, expiresAt: Date) =>
  `${sessionId}.${expiresAt.getTime()}`;

/**
 * Parses the marker. The expiry here is a convenience for cutting the visit
 * short without a round trip — it is NOT what keeps a support session from
 * writing clinical data. That is `public.is_impersonated()`, which fences the
 * session id permanently, so a tampered marker buys nothing.
 */
export function parseImpersonationMarker(value: string | undefined): ImpersonationMarker | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const sessionId = value.slice(0, separator);
  const expiresAt = Number(value.slice(separator + 1));
  if (!sessionId || !Number.isFinite(expiresAt)) return null;
  return { sessionId, expiresAt };
}
