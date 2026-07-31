import "server-only";

import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { sendTrialEmail, type TrialEmailKind } from "@flyee/email";
import { inngest } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Trial lifecycle email drip (PRD §7 activation loop; the "money" sequence for a
 * trial-first model). Triggered by `medchina/trial.started` when the Pro trial
 * begins, it walks four moments and RE-CHECKS state before each send, so a
 * professional who already subscribed or opted out is never emailed:
 *
 *   T+0        welcome — what the trial unlocked + path to the aha
 *   T+2 days   activation — only if she has NOT finalized a consultation yet
 *   end − 3d   expiring — upgrade invite, AND fires the `TrialExpiring`
 *              conversion so the "trial expiring" remarketing audience exists
 *   end        ended — what she keeps + invite back
 *
 * Requires Inngest (a scheduled drip has no inline fallback) and Resend to send;
 * both degrade silently when unconfigured. Emails are honest (the AI PREPARES a
 * draft, never diagnoses) and carry a one-click unsubscribe.
 */

/** Destination for each moment's primary CTA. */
const CTA_PATH: Record<TrialEmailKind, string> = {
  welcome: "/inicio",
  activation: "/pacientes/novo",
  expiring: "/settings/billing",
  ended: "/settings/billing",
};

type TrialContext = {
  endsAt: string | null;
  startedAt: string | null;
  name: string | null;
  optedOut: boolean;
  unsubscribeToken: string | null;
};

async function loadTrialContext(supabase: SupabaseClient, orgId: string, userId: string): Promise<TrialContext> {
  const [{ data: trial }, { data: profile }] = await Promise.all([
    supabase.from("pro_trials").select("started_at, ends_at").eq("org_id", orgId).maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name, lifecycle_email_opt_out, email_unsubscribe_token")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  return {
    endsAt: (trial?.ends_at as string | null) ?? null,
    startedAt: (trial?.started_at as string | null) ?? null,
    name: (profile?.display_name as string | null) ?? null,
    optedOut: Boolean(profile?.lifecycle_email_opt_out),
    unsubscribeToken: (profile?.email_unsubscribe_token as string | null) ?? null,
  };
}

/** Converted = the org is now on a PAID plan (allowance source flips to 'plan'). */
async function hasConverted(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await supabase.rpc("org_audio_allowance", { target_org: orgId });
  return (data as { source?: string } | null)?.source === "plan";
}

/** Activated = the aha (at least one finalized consultation). */
async function hasActivated(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { count } = await supabase
    .from("consultations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "finalized");
  return (count ?? 0) > 0;
}

/** Sends one drip email unless the professional converted or opted out. */
async function deliver(
  supabase: SupabaseClient,
  args: { orgId: string; userId: string; email: string; kind: TrialEmailKind },
): Promise<string> {
  if (!args.email) return "no-email";
  const ctx = await loadTrialContext(supabase, args.orgId, args.userId);
  if (ctx.optedOut) return "opted-out";
  if (await hasConverted(supabase, args.orgId)) return "converted";
  if (args.kind === "activation" && (await hasActivated(supabase, args.orgId))) return "already-activated";
  if (!ctx.unsubscribeToken) return "no-token";

  const result = await sendTrialEmail(args.email, {
    kind: args.kind,
    name: ctx.name ?? undefined,
    ctaUrl: `${BRAND.siteUrl}${CTA_PATH[args.kind]}`,
    unsubscribeUrl: `${BRAND.siteUrl}/api/public/unsubscribe?token=${ctx.unsubscribeToken}`,
  });
  return result.sent ? "sent" : (result.error ?? "not-configured");
}

/**
 * Meta CAPI + GA4 `TrialExpiring` — feeds the "trial expiring" remarketing
 * audience. Fired from the background drip (no request cookies), so it enriches
 * the match from `meta_attribution` (stored at trial start) and falls back to
 * the hashed org id + the professional's email.
 */
async function fireTrialExpiring(supabase: SupabaseClient, orgId: string, email: string): Promise<void> {
  try {
    const { data: attribution } = await supabase
      .from("meta_attribution")
      .select("fbp, fbc, email, client_ip, client_user_agent, ga_client_id")
      .eq("org_id", orgId)
      .maybeSingle();
    await sendMetaConversion({
      eventName: "TrialExpiring",
      eventId: `trial-expiring:${orgId}`,
      externalId: orgId,
      email: attribution?.email ?? email ?? null,
      fbp: attribution?.fbp ?? null,
      fbc: attribution?.fbc ?? null,
      clientIp: attribution?.client_ip ?? null,
      clientUserAgent: attribution?.client_user_agent ?? null,
      actionSource: "system_generated",
    });
    await sendGa4Event({
      clientId: attribution?.ga_client_id ?? null,
      eventName: "trial_expiring",
      eventId: `trial-expiring:${orgId}`,
    });
  } catch {
    // Best-effort — never fail the drip on a measurement hiccup.
  }
}

export const trialDripFunction = inngest.createFunction(
  { id: "trial-lifecycle-drip", retries: 2, concurrency: { limit: 10 } },
  { event: "medchina/trial.started" },
  async ({ event, step }) => {
    const { orgId, userId, email } = event.data;
    const supabase = createServiceClient();

    // The days-based end date anchors the schedule (the minutes dimension is
    // handled in-app by the allowance). Read it once, up front.
    const endsAt = await step.run("load-ends-at", async () => {
      const { data } = await supabase.from("pro_trials").select("ends_at").eq("org_id", orgId).maybeSingle();
      return (data?.ends_at as string | null) ?? null;
    });

    await step.run("welcome", () => deliver(supabase, { orgId, userId, email, kind: "welcome" }));

    await step.sleep("wait-activation", "2d");
    await step.run("activation", () => deliver(supabase, { orgId, userId, email, kind: "activation" }));

    if (endsAt) {
      const expiringAt = new Date(new Date(endsAt).getTime() - 3 * 24 * 60 * 60 * 1000);
      await step.sleepUntil("wait-expiring", expiringAt);
      await step.run("expiring", async () => {
        const outcome = await deliver(supabase, { orgId, userId, email, kind: "expiring" });
        // Only signal remarketing when we did NOT skip for conversion/opt-out.
        if (outcome === "sent") await fireTrialExpiring(supabase, orgId, email);
        return outcome;
      });

      await step.sleepUntil("wait-ended", new Date(endsAt));
      await step.run("ended", () => deliver(supabase, { orgId, userId, email, kind: "ended" }));
    }

    return { orgId };
  },
);

export const trialFunctions = [trialDripFunction];
