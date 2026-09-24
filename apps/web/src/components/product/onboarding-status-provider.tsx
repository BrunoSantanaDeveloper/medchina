"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import type { AudioAllowance } from "@/lib/audio-allowance";
import { deriveOnboardingStatus, type OnboardingStatus, type PendingSubscription } from "@/lib/onboarding-status";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type OnboardingStatusValue = {
  /** Null until the first read lands — never a guessed "free". */
  status: OnboardingStatus | null;
  allowance: AudioAllowance | null;
};

const OnboardingStatusContext = createContext<OnboardingStatusValue>({ status: null, allowance: null });

/**
 * ONE reader of the workspace's commercial state for the whole guided trail.
 *
 * Two surfaces need it — the badge in the header and the trail's own copy (the
 * step that would otherwise offer a free trial to someone who has just paid).
 * Each reading it separately meant two pollers ticking on different schedules,
 * and for a few seconds after a payment confirmed the badge said "Plano Pro"
 * while the step still said "being confirmed". Reading it once makes that
 * disagreement impossible rather than unlikely.
 *
 * While a charge is `incomplete` it keeps asking, because that is the promise
 * behind "já paguei": the WEBHOOK releases the plan, and this notices without
 * her reloading anything. It stops by itself once nothing is pending, and skips
 * hidden tabs.
 */
export function OnboardingStatusProvider({ orgId, children }: { orgId: string | null; children: React.ReactNode }) {
  const { allowance, loading, reload: reloadAllowance } = useAudioAllowance(orgId);
  const [pending, setPending] = useState<PendingSubscription | null>(null);
  const [pendingLoaded, setPendingLoaded] = useState(false);

  /** Null = nothing waiting. Undefined = the read failed, so nothing is known. */
  const readPending = useCallback(async (): Promise<PendingSubscription | null | undefined> => {
    if (!orgId || !isSupabaseConfigured) return null;
    // `incomplete` is the provider's "charged, not confirmed" (migration 0001's
    // default). A failed read must never invent a pending payment, nor clear
    // one that is really there — hence `undefined`, not null.
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

  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (!active || document.visibilityState === "hidden") return;
      const result = await readPending();
      if (!active || result === undefined) return;
      if (result === null) {
        // Confirmed: the row left `incomplete`. The allowance is what knows the
        // plan's name, so it is re-read before anything changes its word.
        await reloadAllowance();
        if (active) setPending(null);
      }
    }, 6_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pending, readPending, reloadAllowance]);

  const value = useMemo<OnboardingStatusValue>(() => {
    // Unknown only on the FIRST read. A re-read (the moment a payment
    // confirms) keeps the previous state instead of blinking out at exactly
    // the instant she is watching for the change.
    if (!pendingLoaded || (loading && !allowance)) return { status: null, allowance };
    return { status: deriveOnboardingStatus({ allowance, pending }), allowance };
  }, [allowance, loading, pending, pendingLoaded]);

  return <OnboardingStatusContext.Provider value={value}>{children}</OnboardingStatusContext.Provider>;
}

export function useOnboardingStatus(): OnboardingStatusValue {
  return useContext(OnboardingStatusContext);
}
