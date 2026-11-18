import { createAnonClient } from "@/lib/public-content";

/**
 * Where the dated promotion lives (`platform_settings`, migration 0126). The
 * Black Friday 2026 is its first use; the next dated promotion is the same row
 * with other dates, not a new mechanism.
 */
export const PROMOTION_KEY = "promotion";

export type PromotionReason = "open" | "disabled" | "not_started" | "expired" | "not_configured";

export type PromotionSetting = {
  enabled?: boolean;
  label?: string | null;
  plan_slug?: string | null;
  compare_plan_slug?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  show_on_home?: boolean;
};

export type Promotion = {
  /** The event's name as the pages print it ("Black Friday"). */
  label: string;
  planSlug: string | null;
  /** Table plan whose price anchors the struck price. */
  comparePlanSlug: string | null;
  /** ISO instants. `endsAt` is always set on a configured promotion. */
  startsAt: string | null;
  endsAt: string | null;
  /** Whether the public home carries the strip and the promotion's card. */
  showOnHome: boolean;
  closed: boolean;
  reason: PromotionReason;
};

const parseInstant = (raw: unknown): Date | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * A dated promotion: one plan, one anchor, a START and an END.
 *
 * Kept apart from the paid-campaign offer (`lib/campaign-offer.ts`) on
 * purpose: the campaign sells its own line on /assinar before, during and after
 * a promotion, and pointing it at the promotion's plan for ten days would erase
 * the struck price its ads promise.
 *
 * Two rules the shape enforces, both from the consumer-protection floor every
 * offer page here follows (Decreto 7.962/2013 art. 2, V e VI):
 *
 *  - a promotion with no END is not configured. "Until when" is part of the
 *    offer, and a counter with no date is the fake scarcity this repo refuses;
 *  - the window is read against the clock on every request, so the page that
 *    announces it, the home that carries it and the checkout that sells it
 *    (`offerBlock`) open and close at the same instant.
 */
export function resolvePromotion(value: PromotionSetting | null | undefined, now: number = Date.now()): Promotion {
  const planSlug = typeof value?.plan_slug === "string" ? value.plan_slug.trim() : "";
  const compareSlug = typeof value?.compare_plan_slug === "string" ? value.compare_plan_slug.trim() : "";
  const label = typeof value?.label === "string" && value.label.trim() ? value.label.trim() : "Promoção";
  const startsAt = parseInstant(value?.starts_at);
  const endsAt = parseInstant(value?.ends_at);

  const reason: PromotionReason =
    !planSlug || !endsAt || (startsAt && startsAt.getTime() >= endsAt.getTime())
      ? "not_configured"
      : value?.enabled !== true
        ? "disabled"
        : startsAt && now < startsAt.getTime()
          ? "not_started"
          : now > endsAt.getTime()
            ? "expired"
            : "open";

  return {
    label,
    planSlug: planSlug || null,
    comparePlanSlug: compareSlug && compareSlug !== planSlug ? compareSlug : null,
    startsAt: startsAt ? startsAt.toISOString() : null,
    endsAt: endsAt ? endsAt.toISOString() : null,
    showOnHome: value?.show_on_home === true,
    closed: reason !== "open",
    reason,
  };
}

/**
 * Reads the promotion for a public page (no session).
 *
 * Null when Supabase is not configured or the read fails — callers MUST treat
 * that as "no promotion", never as an open one.
 */
export async function getPromotion(): Promise<Promotion | null> {
  const supabase = createAnonClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", PROMOTION_KEY)
    .maybeSingle();
  if (error) return null;
  return resolvePromotion((data?.value ?? null) as PromotionSetting | null);
}
