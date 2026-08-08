import { NextResponse } from "next/server";

import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Mirrors the allowlist in migration 0084; an unknown value degrades to "other". */
const ORIGINS = new Set(["recorder", "agenda", "import", "library", "patient", "other"]);

/**
 * Starts the Pro trial (PRD §5.7, broadened by migration 0084) server-side so
 * the Meta CAPI StartTrial — the anchor conversion — fires exactly when the RPC
 * really creates the trial, and only then.
 *
 * Since 0084 the trial starts at the first operational action of any kind, so
 * this route is called on ordinary saves (an appointment, an import) and NOT
 * only from a deliberate confirmation. That makes `trial_started` load-bearing:
 * the conversion, the GA4 event and the e-mail drip must fire on the real start
 * and never again, or attribution is inflated and the professional is mailed on
 * every appointment she books. Authorization is unchanged — the RPC runs under
 * the caller's RLS session.
 */
export async function POST(request: Request) {
  let orgId: string | null = null;
  let origin = "other";
  try {
    const body = (await request.json()) as { orgId?: string; origin?: string };
    orgId = typeof body.orgId === "string" ? body.orgId : null;
    if (typeof body.origin === "string" && ORIGINS.has(body.origin)) origin = body.origin;
  } catch {
    return NextResponse.json({ error: "not_authorized" }, { status: 400 });
  }
  if (!orgId || !UUID.test(orgId)) return NextResponse.json({ error: "not_authorized" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("start_pro_trial", { target_org: orgId, via: origin });
  if (error || !data) return NextResponse.json({ error: "allowance_unavailable" }, { status: 400 });

  // Only a real insert is a conversion. An already-running (or already-spent)
  // trial returns the allowance so the caller can render state, silently.
  if ((data as { trial_started?: boolean }).trial_started !== true) {
    return NextResponse.json({ allowance: data, started: false });
  }

  // Best-effort measurement + drip trigger — must NOT fail the trial start.
  try {
    const [metaContext, gaClientId] = await Promise.all([
      getMetaClientContext(`${new URL(request.url).origin}/inicio`),
      getGaClientId(),
    ]);
    // Stash the tracking signals now so the (browserless) TrialExpiring event
    // and a later Purchase can match on them. Only when a signal exists.
    if (metaContext.fbp || metaContext.fbc || gaClientId) {
      await createServiceClient()
        .from("meta_attribution")
        .upsert({
          org_id: orgId,
          fbp: metaContext.fbp ?? null,
          fbc: metaContext.fbc ?? null,
          email: user.email ?? null,
          client_ip: metaContext.clientIp ?? null,
          client_user_agent: metaContext.clientUserAgent ?? null,
          ga_client_id: gaClientId,
          updated_at: new Date().toISOString(),
        });
    }
    // Meta CAPI — StartTrial (event_id = the org, one trial per workspace, so a
    // retry deduplicates). No clinical data leaves the server.
    await sendMetaConversion({
      eventName: "StartTrial",
      eventId: `trial:${orgId}`,
      email: user.email,
      externalId: orgId,
      ...metaContext,
    });
    await sendGa4Event({ clientId: gaClientId, eventName: "start_trial", eventId: `trial:${orgId}` });
    // Kick off the trial lifecycle email drip (no-op without Inngest keys —
    // a scheduled drip has no sensible inline fallback).
    await sendEvent("medchina/trial.started", { orgId, userId: user.id, email: user.email ?? "" });
  } catch {
    // All of the above is best-effort; the trial started and must be returned.
  }

  return NextResponse.json({ allowance: data, started: true });
}
