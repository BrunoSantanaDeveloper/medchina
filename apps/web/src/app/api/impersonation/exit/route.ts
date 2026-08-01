import { type NextRequest, NextResponse } from "next/server";

import { stopImpersonation } from "@/lib/impersonation-actions";

/**
 * The single way out of a support impersonation — used by the banner's
 * button and by the middleware when the visit expires or its session dies.
 *
 * A GET route rather than a form action because the middleware has to be able
 * to redirect into it, and because it must work even from a page rendered
 * under a session that is already gone.
 */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason") === "expired" ? "expired" : "operator";
  await stopImpersonation(reason);

  // Back to where impersonation is started, with the operator's own session —
  // which was never touched.
  const destination = new URL("/admin/organizations", request.url);
  destination.searchParams.set("impersonation", reason === "expired" ? "expired" : "ended");
  return NextResponse.redirect(destination);
}
