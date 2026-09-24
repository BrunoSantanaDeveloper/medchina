"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@mui/material";

import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { deriveOnboardingStatus, type PendingSubscription } from "@/lib/onboarding-status";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

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
 * CLAUDE.md). The state itself is derived in `lib/onboarding-status.ts` from
 * the allowance RPC plus the `incomplete` subscription row — this component
 * only renders it.
 */
const TONE: Record<string, "primary" | "accent-1" | "accent-3" | "grey"> = {
  plan: "accent-1",
  pending_payment: "accent-3",
  trial: "primary",
  free: "grey",
};

export default function OnboardingStatusBadge({ orgId, className }: { orgId: string | null; className?: string }) {
  const t = useTranslations("product");
  const { allowance, loading, reload: reloadAllowance } = useAudioAllowance(orgId);
  const [pending, setPending] = useState<PendingSubscription | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);

  /** Reads whether a charge is still waiting on the provider. Null = none. */
  const readPending = useCallback(async (): Promise<PendingSubscription | null | undefined> => {
    if (!orgId || !isSupabaseConfigured) return null;
    // `incomplete` is the provider's "charged, not confirmed" (migration 0001's
    // default). A failed read returns `undefined` — "unknown" — so it can never
    // invent a pending payment, nor clear one that is really there.
    const { data, error } = await createClient()
      .from("subscriptions")
      .select("plans(name)")
      .eq("org_id", orgId)
      .eq("status", "incomplete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return undefined;
    const plan = data?.plans as { name?: string | null } | { name?: string | null }[] | null | undefined;
    const planName = Array.isArray(plan) ? (plan[0]?.name ?? null) : (plan?.name ?? null);
    return data ? { planName } : null;
  }, [orgId]);

  useEffect(() => {
    let active = true;
    void readPending().then((result) => {
      if (!active) return;
      setPending(result ?? null);
      setPendingLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [readPending]);

  /**
   * While a payment is being confirmed, keep asking.
   *
   * This is the other half of "já paguei": she leaves the PIX screen before the
   * bank confirms, and the promise is that the plan is released by itself. The
   * WEBHOOK releases it; this only notices, so the badge stops saying
   * "confirmando pagamento" and names the plan without her reloading anything.
   * It stops by itself once nothing is pending, and skips hidden tabs.
   */
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (!active || document.visibilityState === "hidden") return;
      const result = await readPending();
      if (!active || result === undefined) return;
      if (result === null) {
        // Confirmed: the row left `incomplete`. The allowance is what knows the
        // plan's name, so it is re-read before the badge changes its word.
        await reloadAllowance();
        if (active) setPending(null);
      }
    }, 6_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pending, readPending, reloadAllowance]);

  // Rendering a "Gratuito" badge for a second and then replacing it with
  // "Confirmando pagamento" is worse than rendering nothing: the first version
  // is the one she reads.
  // Hidden only on the FIRST read. A re-read (the moment a payment confirms)
  // keeps showing the previous state instead of blinking out at exactly the
  // instant she is watching for the change.
  if (!pendingLoaded || (loading && !allowance)) return null;

  const status = deriveOnboardingStatus({ allowance, pending });
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
