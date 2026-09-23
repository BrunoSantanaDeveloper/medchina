"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
  const { allowance, loading } = useAudioAllowance(orgId);
  const [pending, setPending] = useState<PendingSubscription | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!orgId || !isSupabaseConfigured) {
        if (active) setPendingLoaded(true);
        return;
      }
      // `incomplete` is the provider's "charged, not confirmed" (migration
      // 0001's default). A failed read must not invent a pending payment, so
      // the error path leaves `pending` null and the badge falls back to what
      // the allowance already proves.
      const { data } = await createClient()
        .from("subscriptions")
        .select("plans(name)")
        .eq("org_id", orgId)
        .eq("status", "incomplete")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      const plan = data?.plans as { name?: string | null } | { name?: string | null }[] | null | undefined;
      const planName = Array.isArray(plan) ? (plan[0]?.name ?? null) : (plan?.name ?? null);
      setPending(data ? { planName } : null);
      setPendingLoaded(true);
    };
    load();
    return () => {
      active = false;
    };
  }, [orgId]);

  // Rendering a "Gratuito" badge for a second and then replacing it with
  // "Confirmando pagamento" is worse than rendering nothing: the first version
  // is the one she reads.
  if (loading || !pendingLoaded) return null;

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
