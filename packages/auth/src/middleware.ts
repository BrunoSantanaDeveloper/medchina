import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  authCookieName,
  IMPERSONATION_MARKER_COOKIE,
  isSupabaseConfigured,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "./config";

export type SessionResult = {
  response: NextResponse;
  user: { id: string; email?: string } | null;
  /** True when the user enrolled a TOTP factor but this session has not passed it yet (AAL1 -> AAL2 pending). */
  needsMfa: boolean;
  /** True when this request is being served inside a support impersonation. */
  impersonating: boolean;
};

/**
 * Refreshes the Supabase session cookies for the current request and returns
 * the authenticated user (if any). Call from the app's middleware.ts.
 *
 * No-ops when Supabase is not configured so a fresh template clone stays
 * fully browsable.
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) {
    return { response, user: null, needsMfa: false, impersonating: false };
  }

  // A support impersonation keeps its session in a parallel cookie so the
  // operator's own session survives untouched (migration 0057).
  const impersonating = request.cookies.has(IMPERSONATION_MARKER_COOKIE);

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: authCookieName(impersonating) },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() (not getSession) — validates the JWT against Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 2FA enforcement: a password/OAuth session is AAL1; users with a verified
  // TOTP factor must step up to AAL2 before reaching protected pages.
  //
  // An impersonated session is created by the auth admin API and is AAL1 by
  // construction, with no way for the operator to pass the user's TOTP. The
  // step-up is skipped for it because the assurance was already established
  // on the OTHER side: starting an impersonation requires the superadmin's own
  // session to be AAL2 (see startImpersonation).
  let needsMfa = false;
  if (user && !impersonating) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    needsMfa = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";
  }

  return { response, user, needsMfa, impersonating };
}
