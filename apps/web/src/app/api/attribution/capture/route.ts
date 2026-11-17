import { NextResponse } from "next/server";

import { captureSignupAttribution } from "@/app/auth/attribution-actions";

/**
 * Writes the campaign attribution onto the workspace a sign-up just created.
 *
 * A route and not a server action, and the reason is specific. A server action
 * POSTs to the page it was called from, and the page here is `/auth/sign-up`,
 * which the middleware redirects away the instant a session exists ("signed-in
 * users don't need the sign-up screen"). Calling it from the sign-up page right
 * after `signUp` therefore produced a 307 where React expected an action
 * result, and the form died with "an unexpected response was received from the
 * server" — the account created, the navigation lost. Measured, not guessed.
 *
 * This path has no such rule: it is authenticated like everything outside
 * `PUBLIC_PREFIXES`, so only a signed-in caller reaches it, and the org is
 * resolved from that session rather than from the request body — a route is a
 * public endpoint, and an org id in the payload would let anyone stamp
 * attribution onto someone else's workspace.
 *
 * Always 204: attribution is a report, not a guarantee, and a sign-up must
 * never fail because a marketing dimension could not be stored. A write that
 * fails is logged inside `persistSignupAttribution`.
 */
export async function POST(): Promise<NextResponse> {
  await captureSignupAttribution();
  return new NextResponse(null, { status: 204 });
}
