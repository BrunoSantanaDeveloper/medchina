import { createAnonClient } from "@/lib/public-content";

/**
 * Brazilian consumer law (CDC art. 49) gives seven days to withdraw from a
 * purchase made outside a physical store. Our guarantee can be longer, never
 * shorter — a configured value below this would be void anyway, so it is
 * clamped rather than trusted.
 */
export const GUARANTEE_MINIMUM_DAYS = 7;

/**
 * How many days the money-back guarantee lasts.
 *
 * Read from `platform_settings` ('guarantee') so the number on the public page
 * and the number the refund flow will enforce come from ONE place — a page
 * promising 7 days while the system counts 5 is the kind of drift that turns a
 * risk-reversal promise into a complaint.
 *
 * Deliberately has no admin console: extending a legal commitment should be a
 * deliberate act, and shortening it below the statutory floor is impossible by
 * construction.
 */
export async function getGuaranteeDays(): Promise<number> {
  const supabase = createAnonClient();
  if (!supabase) return GUARANTEE_MINIMUM_DAYS;

  const { data, error } = await supabase.from("platform_settings").select("value").eq("key", "guarantee").maybeSingle();
  if (error || !data?.value) return GUARANTEE_MINIMUM_DAYS;

  const configured = Number((data.value as { days?: unknown }).days);
  if (!Number.isFinite(configured)) return GUARANTEE_MINIMUM_DAYS;
  return Math.max(GUARANTEE_MINIMUM_DAYS, Math.floor(configured));
}
