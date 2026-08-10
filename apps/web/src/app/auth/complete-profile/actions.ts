"use server";

import { persistSignupAttribution } from "@/lib/signup-attribution";
import { createClient } from "@flyee/auth/server";

/**
 * Attaches the campaign attribution to the workspace an OAuth user just
 * created here.
 *
 * The e-mail sign-up path is covered by /auth/callback, which already has the
 * membership in hand. A first-time Google/GitHub user has no workspace at that
 * point — it is created on this screen — so without this second call every
 * social signup would land in the reports as "origem: unknown".
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
