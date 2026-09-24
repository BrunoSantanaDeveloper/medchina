"use client";

import { useTranslations } from "next-intl";

import { Button } from "@mui/material";

import { useOnboardingStatus } from "@/components/product/onboarding-status-provider";

/**
 * Where the workspace stands commercially, in the guided trail's header.
 *
 * Deliberately the template's quietest badge idiom — the same pastel `tiny`
 * span `ConsultationStatusChip` uses — because the trail's whole point is that
 * nothing competes with the task. It is a readout, never an offer: no upgrade
 * CTA, no countdown pressure. What it must not do is stay silent right after a
 * checkout, when she has paid and the product still looks free to her.
 *
 * Amber for "waiting on the provider", never red: an unconfirmed PIX is not a
 * failure and not a clinical risk, and red is reserved for both (root
 * CLAUDE.md). The state is read ONCE for the whole trail by
 * `OnboardingStatusProvider` (mounted in the onboarding shell), so this badge
 * and the trail's own copy can never disagree — this component only renders it.
 */
const TONE: Record<string, "primary" | "accent-1" | "accent-3" | "grey"> = {
  plan: "accent-1",
  pending_payment: "accent-3",
  trial: "primary",
  free: "grey",
};

export default function OnboardingStatusBadge({ className }: { className?: string }) {
  const t = useTranslations("product");
  const { status } = useOnboardingStatus();
  if (!status) return null;

  const label =
    status.kind === "plan"
      ? t("onboarding-badge-plan", { plan: status.planName ?? t("onboarding-badge-plan-unnamed") })
      : status.kind === "pending_payment"
        ? t("onboarding-badge-pending")
        : status.kind === "trial"
          ? status.daysLeft === null
            ? t("onboarding-badge-trial")
            : t("onboarding-badge-trial-days", { days: status.daysLeft })
          : t("onboarding-badge-free");
  // The badge is short by design; the full sentence reaches anyone who needs it.
  const title =
    status.kind === "pending_payment"
      ? t("onboarding-badge-pending-hint")
      : status.kind === "trial"
        ? t("onboarding-badge-trial-hint")
        : label;

  return (
    <Button
      component="span"
      role="presentation"
      tabIndex={-1}
      size="tiny"
      variant="pastel"
      color={TONE[status.kind]}
      title={title}
      aria-label={title}
      className={["pointer-events-none flex-none", className].filter(Boolean).join(" ")}
    >
      {label}
    </Button>
  );
}
