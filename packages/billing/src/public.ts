import { createServiceClient } from "@flyee/auth/service";
import type { CheckoutCoupon } from "./types";

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
    // Add-ons (à-la-carte packs) are not tiers: on a public pricing page they
    // would read as another plan to choose between.
    .eq("is_addon", false)
    // A limited offer (founders) is active and fully purchasable, but reached
    // by the link the operator sends — publishing its price next to the table
    // price would read as overcharging everybody else (0085).
    .eq("is_public", true)
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

/**
 * Resolves a campaign code for the PUBLIC pricing page.
 *
 * The authenticated checkout validates the same code through the customer's own
 * session (`validate_coupon`), but the pricing page has no session at all — and
 * a visitor arriving from a partner's post with `?cupom=` has to SEE the price
 * she was promised, or she concludes the code did not work and leaves. Reading
 * it here, service-role and read-only, is what lets the page show the discount
 * before anyone signs up.
 *
 * Returns null for an unknown, expired or exhausted code — the caller must say
 * so rather than silently rendering full prices.
 */
export async function resolvePublicCoupon(code: string): Promise<CheckoutCoupon | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(normalized)) return null;

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase.rpc("validate_coupon", { coupon_code: normalized });
  if (error) return null;
  const row = (data as { id: string; code: string; discount_type: string; discount_value: number }[] | null)?.[0];
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type as CheckoutCoupon["discountType"],
    discountValue: row.discount_value,
  };
}
