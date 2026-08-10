import "server-only";

import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import { type CampaignAttribution, decodeAttribution } from "@/lib/attribution";
import { createServiceClient } from "@flyee/auth/service";

/**
 * Moves the campaign attribution from the visitor's cookie onto the workspace,
 * once, at signup.
 *
 * Written with the service role because the row belongs to the platform, not to
 * the professional: she never sees it, and RLS gives her no write path to it
 * (migration 0086). ON CONFLICT DO NOTHING keeps the FIRST touch — this runs
 * from more than one entry point (e-mail confirmation and the OAuth
 * complete-profile step), and a second call must not rewrite history.
 *
 * Never throws and never blocks: a signup that succeeded must not fail because
 * a marketing dimension could not be stored.
 */
export async function persistSignupAttribution(orgId: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    const attribution = decodeAttribution(cookieStore.get(COOKIE_KEYS.attribution)?.value);
    if (!attribution) return;

    const service = createServiceClient();
    await service.from("signup_attribution").upsert(
      {
        org_id: orgId,
        origem: attribution.origem ?? null,
        onda: attribution.onda ?? null,
        utm_source: attribution.utm_source ?? null,
        utm_medium: attribution.utm_medium ?? null,
        utm_campaign: attribution.utm_campaign ?? null,
        utm_content: attribution.utm_content ?? null,
        utm_term: attribution.utm_term ?? null,
        referrer: attribution.referrer ?? null,
        landing_path: attribution.landing_path ?? null,
      },
      { onConflict: "org_id", ignoreDuplicates: true },
    );
  } catch {
    // Attribution is a report, not a guarantee. Losing one row is a gap in a
    // chart; failing here would be a professional who cannot finish signing up.
  }
}

/**
 * The campaign dimensions of a workspace, for enriching a conversion event.
 * Returns an empty object when there is nothing recorded, so callers can spread
 * it unconditionally.
 */
export async function readSignupAttribution(orgId: string): Promise<CampaignAttribution> {
  try {
    const service = createServiceClient();
    const { data } = await service
      .from("signup_attribution")
      .select("origem, onda, utm_source, utm_medium, utm_campaign")
      .eq("org_id", orgId)
      .maybeSingle();
    if (!data) return {};
    return {
      ...(data.origem ? { origem: data.origem } : {}),
      ...(data.onda ? { onda: data.onda } : {}),
      ...(data.utm_source ? { utm_source: data.utm_source } : {}),
      ...(data.utm_medium ? { utm_medium: data.utm_medium } : {}),
      ...(data.utm_campaign ? { utm_campaign: data.utm_campaign } : {}),
    };
  } catch {
    return {};
  }
}
