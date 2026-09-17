"use client";

import { RowLine, RowText } from "./catalog-shared";

import { Alert } from "@mui/material";

export type OfferPlanRow = {
  slug: string;
  name: string;
  period: string | null;
  price_cents: number;
  is_active: boolean;
  limits: Record<string, number> | null;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PERIOD_WORD: Record<string, string> = { yearly: "year", monthly: "month", weekly: "week" };

/**
 * What the visitor will actually SEE, resolved from the same plan rows the
 * landing page reads.
 *
 * Every offer console needs this and none of them should compute it twice: a
 * console that only writes settings hides its own typos, and the two failures
 * it hides are silent by nature — an anchor that never renders (wrong slug,
 * inactive plan, a price below the offer's) and an audio quota copied from a
 * monthly plan onto a yearly line, which delivers one twelfth of what the page
 * promises.
 */
export default function OfferPreview({
  plans,
  planSlug,
  compareSlug,
  label,
}: {
  plans: OfferPlanRow[];
  planSlug: string;
  compareSlug: string;
  /** Where these numbers show up, for the operator reading the line. */
  label: string;
}) {
  const plan = plans.find((row) => row.slug === planSlug.trim()) ?? null;
  const comparePlan = compareSlug.trim() ? (plans.find((row) => row.slug === compareSlug.trim()) ?? null) : null;

  // Mirrors the page exactly: a monthly anchor is annualized, a period mismatch
  // yields no anchor, and an anchor cheaper than the offer is dropped.
  const anchorCents =
    comparePlan && plan
      ? comparePlan.period === "monthly" && plan.period === "yearly"
        ? comparePlan.price_cents * 12
        : comparePlan.period === plan.period
          ? comparePlan.price_cents
          : 0
      : 0;
  const anchorRenders = Boolean(plan && comparePlan?.is_active && anchorCents > plan.price_cents);

  const minutes = Number(plan?.limits?.audio_minutes ?? 0);
  const proMinutes = Number(plans.find((row) => row.slug === "pro")?.limits?.audio_minutes ?? 0);
  const minutesLookShort = plan?.period === "yearly" && proMinutes > 0 && minutes > 0 && minutes < proMinutes * 12;

  if (!plan) {
    return (
      <RowLine>
        <RowText
          primary={planSlug.trim() ? `Plan "${planSlug.trim()}" not found in the catalog` : "No plan selected"}
          secondary={`${label} shows the closed state until an active plan is named here.`}
        />
      </RowLine>
    );
  }

  const periodWord = plan.period ? (PERIOD_WORD[plan.period] ?? "cycle") : "cycle";

  return (
    <>
      <RowLine>
        <RowText
          primary={`${label} shows ${BRL.format(plan.price_cents / 100)} per ${periodWord}${
            anchorRenders ? ` · struck ${BRL.format(anchorCents / 100)}` : " · NO struck price"
          }`}
          secondary={`Audio quota ${minutes} min per ${periodWord}${
            anchorRenders
              ? ""
              : comparePlan
                ? ` · anchor "${comparePlan.slug}" does not render (inactive, cheaper than the offer, or an incomparable period)`
                : " · no anchor plan set"
          }${plan.is_active ? "" : " · PLAN IS INACTIVE and cannot be bought"}`}
        />
      </RowLine>
      {minutesLookShort && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          The audio quota is spent over ONE BILLING CYCLE, and this plan bills yearly — so {minutes} min is the whole
          year, while the monthly Pro gives {proMinutes} min every month ({proMinutes * 12} per year). If this offer is
          sold as the complete Pro, set audio_minutes to {proMinutes * 12} in the Plans tab.
        </Alert>
      )}
    </>
  );
}
