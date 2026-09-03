import "server-only";

import { notifyUsers } from "@/lib/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversionOfferTrigger = "first_consultation" | "usage_80";

/**
 * Opens the time-boxed offer for one of the two high-intent moments
 * (migration 0088), and tells her it exists.
 *
 * Called from paths that have ALREADY succeeded — a finalized consultation, a
 * recorded minute — so it can never throw: a commercial nudge must not be able
 * to fail clinical work that is already committed. Every eligibility rule lives
 * in the RPC, so both callers behave identically.
 *
 * The bell only rings for `first_consultation`. The 80% moment already sends
 * its own usage alert (`lib/usage.ts`), and two notifications seconds apart
 * about the same thing reads as a system nagging her, not helping her.
 */
export async function openConversionOffer(
  supabase: SupabaseClient,
  orgId: string,
  trigger: ConversionOfferTrigger,
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc("open_conversion_offer", {
      target_org: orgId,
      target_trigger: trigger,
    });
    if (error) return;
    if ((data as { opened?: boolean } | null)?.opened !== true) return;

    if (trigger !== "first_consultation") return;

    const { data: members } = await supabase.from("memberships").select("user_id").eq("org_id", orgId);
    const userIds = (members ?? []).map((row) => row.user_id as string);
    if (userIds.length === 0) return;

    // Stored text, written in the default locale at creation — same contract as
    // every other notification row.
    await notifyUsers(userIds, {
      type: "billing",
      title: "Seu primeiro prontuário está fechado",
      body: "Preparamos uma condição para você seguir com o Pro. Ela vale por tempo limitado — veja no início.",
      href: "/inicio",
    });
  } catch {
    // The consultation is finalized and the minutes are recorded. Neither is
    // worth rolling back over an offer.
  }
}
