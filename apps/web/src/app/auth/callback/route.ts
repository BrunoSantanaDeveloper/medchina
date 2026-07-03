import { NextResponse } from "next/server";

import { DEFAULTS } from "@/config";
import { createClient } from "@gogo/auth/server";

/**
 * OAuth and email-link callback: exchanges the auth code for a session and
 * redirects to the requested page (default: app root).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? DEFAULTS.appRoot;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_callback_failed`);
}
