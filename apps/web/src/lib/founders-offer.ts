import { createAnonClient } from "@/lib/public-content";

export type FoundersOfferReason = "open" | "disabled" | "expired" | "sold_out" | "not_configured";

export type FoundersOffer = {
  planSlug: string | null;
  seatsTotal: number;
  seatsTaken: number;
  seatsLeft: number;
  deadline: string | null;
  closed: boolean;
  reason: FoundersOfferReason;
};

/**
 * State of the limited founders offer (migration 0087).
 *
 * One source for two consumers that must never disagree: the counter on the
 * public landing page and the guard that refuses a checkout once the seats are
 * gone. A counter that only decorates the page still lets the 31st person
 * subscribe.
 *
 * Read through the anon client because the landing page has no session; the
 * RPC is SECURITY DEFINER and returns aggregate counts only.
 *
 * Returns null when Supabase is not configured (fresh clone) or the migration
 * has not run — callers MUST treat that as "no offer to show", never as an
 * open one.
 */
export async function getFoundersOffer(): Promise<FoundersOffer | null> {
  const supabase = createAnonClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("founders_offer");
  if (error || !data) return null;

  const row = data as {
    plan_slug?: string | null;
    seats_total?: number;
    seats_taken?: number;
    seats_left?: number;
    deadline?: string | null;
    closed?: boolean;
    reason?: string;
  };

  return {
    planSlug: row.plan_slug ?? null,
    seatsTotal: Number(row.seats_total ?? 0),
    seatsTaken: Number(row.seats_taken ?? 0),
    seatsLeft: Number(row.seats_left ?? 0),
    deadline: row.deadline ?? null,
    // Anything the database did not explicitly call open is closed: a bug in
    // this mapping must fail toward NOT selling a seat that does not exist.
    closed: row.closed !== false,
    reason: (row.reason as FoundersOfferReason) ?? "not_configured",
  };
}
