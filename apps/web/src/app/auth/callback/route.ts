import { NextResponse } from "next/server";

import { DEFAULTS } from "@/config";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getMetaClientContext } from "@/lib/meta-capi-context";
import { resolvePostAuthDestination } from "@/lib/onboarding";
import { createClient } from "@flyee/auth/server";
import { sanitizeInternalNext } from "@flyee/clinical";

/** A brand-new account confirms within minutes; a returning session (e.g. a
 * password recovery link) has an old created_at — so this window isolates
 * the sign-up conversion without firing on every callback. */
const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

/**
 * OAuth and email-link callback: exchanges the auth code for a session and
 * redirects. An explicit `next` (a page the user was bounced from) wins;
 * otherwise onboarding decides between the setup flow and the app root.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) {
        // Meta CAPI — CompleteRegistration, once per brand-new account (dedup
        // by user id). Covers email-confirmation and first-time OAuth; the
        // created-at window skips returning sessions like password recovery.
        const createdAtMs = data.user.created_at ? new Date(data.user.created_at).getTime() : 0;
        if (createdAtMs && Date.now() - createdAtMs < NEW_ACCOUNT_WINDOW_MS) {
          const metaContext = await getMetaClientContext(`${origin}/auth/callback`);
          await sendMetaConversion({
            eventName: "CompleteRegistration",
            eventId: data.user.id,
            email: data.user.email,
            externalId: data.user.id,
            ...metaContext,
          });
        }
        // OAuth is sign-in AND sign-up: a first-time Google/GitHub user is
        // provisioned here but never filled the sign-up form, so they have no
        // organization (the handle_new_user trigger only creates one when the
        // signup metadata carries a company). Send them to complete setup.
        const { data: membership } = await supabase
          .from("memberships")
          .select("org_id")
          .eq("user_id", data.user.id)
          .limit(1)
          .maybeSingle();
        if (!membership) {
          const safeNext = requestedNext ? sanitizeInternalNext(requestedNext) : null;
          // An invite supplies the user's single MVP workspace after explicit
          // confirmation, so creating a second personal workspace would be wrong.
          if (safeNext?.startsWith("/invite/")) {
            return NextResponse.redirect(`${origin}${safeNext}`);
          }
          const completeProfile = new URL("/auth/complete-profile", origin);
          if (safeNext) completeProfile.searchParams.set("next", safeNext);
          return NextResponse.redirect(completeProfile);
        }
        // Preserve the exact protected destination only after account setup is
        // complete; first-time OAuth users carry it through complete-profile.
        if (requestedNext) {
          return NextResponse.redirect(`${origin}${sanitizeInternalNext(requestedNext)}`);
        }
        const next = await resolvePostAuthDestination(supabase, data.user.id);
        return NextResponse.redirect(`${origin}${next}`);
      }
      return NextResponse.redirect(`${origin}${DEFAULTS.appRoot}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_callback_failed`);
}
