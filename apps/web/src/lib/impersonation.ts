import "server-only";

import { createAnonClient } from "@/lib/public-content";

/**
 * Support impersonation ("personificar"): a superadmin works inside a
 * professional's account to see a reported problem where it happens, without
 * her password and without signing the operator out.
 *
 * What each layer is responsible for:
 *  - packages/auth  — the parallel session cookie (which session is active).
 *  - migration 0057 — WHO/WHY/HOW LONG, and the fence that refuses clinical
 *    writes. That fence is in the database because clinical writes go from
 *    the browser straight to PostgREST and would never pass through here.
 *  - this file      — the settings, the reads the UI needs, and the shape of
 *    the record the operator and the professional both see.
 */

/** Hard cap on how long one support access may last. */
export const IMPERSONATION_DEFAULT_MINUTES = 30;

export type ImpersonationSettings = {
  maxMinutes: number;
};

/**
 * Duration comes from configurable data (platform_settings 'impersonation'
 * key), never a constant in code — same rule as trial days and plan limits.
 */
export async function getImpersonationSettings(): Promise<ImpersonationSettings> {
  const fallback: ImpersonationSettings = { maxMinutes: IMPERSONATION_DEFAULT_MINUTES };

  const supabase = createAnonClient();
  if (!supabase) return fallback;

  const { data, error } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "impersonation")
    .maybeSingle();
  if (error || !data?.value) return fallback;

  const value = data.value as { max_minutes?: unknown };
  const minutes = Number(value.max_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  // Even a misconfigured row cannot turn a visit into a tenancy.
  return { maxMinutes: Math.min(Math.round(minutes), 8 * 60) };
}

/**
 * The `session_id` claim of a Supabase access token — the same value the
 * database matches in `public.is_impersonated()`. Without it the write fence
 * cannot recognize the session, so callers must fail closed.
 */
export function sessionIdFromAccessToken(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
      session_id?: unknown;
    };
    return typeof json.session_id === "string" && json.session_id.length > 0 ? json.session_id : null;
  } catch {
    return null;
  }
}
