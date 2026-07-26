import { NextResponse } from "next/server";

import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";
import { createClient } from "@flyee/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Starts the Pro trial (PRD §5.7) server-side so the Meta CAPI StartTrial —
 * the anchor conversion — fires exactly when the RPC succeeds, and only then.
 * The trial start stays a deliberate professional action: this route just
 * moves it behind the server so the ad event cannot be spoofed from the
 * client. Authorization is unchanged — the RPC runs under the caller's RLS
 * session, same as the previous direct client call.
 */
export async function POST(request: Request) {
  let orgId: string | null = null;
  try {
    const body = (await request.json()) as { orgId?: string };
    orgId = typeof body.orgId === "string" ? body.orgId : null;
  } catch {
    return NextResponse.json({ error: "not_authorized" }, { status: 400 });
  }
  if (!orgId || !UUID.test(orgId)) return NextResponse.json({ error: "not_authorized" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("start_pro_trial", { target_org: orgId });
  if (error || !data) return NextResponse.json({ error: "allowance_unavailable" }, { status: 400 });

  // Meta CAPI — StartTrial (event_id = the org, since there is one trial per
  // workspace, so a retry deduplicates). No clinical data leaves the server.
  const metaContext = await getMetaClientContext(`${new URL(request.url).origin}/inicio`);
  await sendMetaConversion({
    eventName: "StartTrial",
    eventId: `trial:${orgId}`,
    email: user.email,
    externalId: orgId,
    ...metaContext,
  });
  // GA4 start_trial — stitched to the web session via the _ga client id.
  await sendGa4Event({ clientId: await getGaClientId(), eventName: "start_trial", eventId: `trial:${orgId}` });

  return NextResponse.json({ allowance: data });
}
