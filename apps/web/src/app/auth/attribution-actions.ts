"use server";

import { persistSignupAttribution } from "@/lib/signup-attribution";
import { createClient } from "@flyee/auth/server";

/**
 * Attaches the campaign attribution to the workspace a sign-up just created.
 *
 * It used to live beside the OAuth complete-profile screen, on the assumption
 * that "the e-mail sign-up path is covered by /auth/callback". That assumption
 * was false in production and cost every row: the callback only runs when the
 * Supabase project demands an e-mail confirmation, and here it does not — every
 * account confirms within a second, so `signUp` returns a session and the page
 * navigates straight to `next`, never touching the callback. The table had
 * ZERO rows since the feature shipped on 10/08.
 *
 * So it moved up one level and is now called from BOTH sign-up endings: this is
 * the shared one, not the OAuth screen's private helper.
 *
 * The org is resolved from the caller's own session rather than passed in: a
 * server action is a public endpoint, and an org id in its arguments would let
 * anyone stamp attribution onto someone else's workspace.
 */
export async function captureSignupAttribution(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership?.org_id) return;

  await persistSignupAttribution(membership.org_id);
}
