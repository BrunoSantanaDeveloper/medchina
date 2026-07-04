import { createServiceClient } from "@gogo/auth/service";

/**
 * Plan fields safe to expose on public (unauthenticated) pages — no provider
 * refs, no internal limits payload beyond what marketing needs.
 */
export type PublicPlan = {
  slug: string;
  name: string;
  description: string | null;
  kind: "recurring" | "credits";
  period: "weekly" | "monthly" | "yearly" | null;
  priceCents: number;
  currency: string;
  creditAmount: number | null;
  trialDays: number;
  isFree: boolean;
  limits: Record<string, number>;
  sort: number;
};

/**
 * Lists active plans for the public pricing page. Server-only: the `plans`
 * table is readable by authenticated users only (RLS), so this goes through
 * the service-role client — read-only, safe fields only.
 *
 * Returns `null` when Supabase is not configured (fresh clone), so callers
 * MUST fall back to placeholder content and keep the page browsable.
 */
export async function listPublicPlans(): Promise<PublicPlan[] | null> {
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase
    .from("plans")
    .select("slug, name, description, kind, period, price_cents, currency, credit_amount, trial_days, is_free, limits, sort")
    .eq("is_active", true)
    .order("sort", { ascending: true });

  if (error || !data) return null;

  return data.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    kind: row.kind,
    period: row.period,
    priceCents: row.price_cents,
    currency: row.currency,
    creditAmount: row.credit_amount,
    trialDays: row.trial_days,
    isFree: row.is_free,
    limits: (row.limits ?? {}) as Record<string, number>,
    sort: row.sort,
  }));
}
