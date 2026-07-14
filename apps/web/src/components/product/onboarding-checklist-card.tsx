"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import OnboardingChecklist from "@/components/product/onboarding-checklist";
import {
  type ActivationFacts,
  buildOnboardingSteps,
  getActivationFacts,
  getOnboardingFlowKey,
  isOnboardingEnabled,
} from "@/lib/onboarding";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { dismissFlow, type FlowKey, getOnboardingState, type OnboardingStateRow } from "@flyee/onboarding";

/**
 * Drop-in activation card for the app home: reads the user's onboarding state
 * AND the live clinical facts the steps are derived from (has a patient? has a
 * finalized consultation?), so the checklist reflects reality rather than
 * clicks. Renders nothing when onboarding is not declared, Supabase is
 * unconfigured, the flow is complete, or the user dismissed it — safe to mount
 * unconditionally.
 */
export default function OnboardingChecklistCard({ title, className }: { title?: string; className?: string }) {
  const t = useTranslations("product");
  const [flowKey, setFlowKey] = useState<FlowKey | null>(null);
  const [state, setState] = useState<OnboardingStateRow | null>(null);
  const [facts, setFacts] = useState<ActivationFacts | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured || !isOnboardingEnabled) return;
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const key = await getOnboardingFlowKey(supabase, user.id);
      setFlowKey(key);
      const [onboardingState, activationFacts] = await Promise.all([
        getOnboardingState(supabase, key),
        getActivationFacts(supabase, user.id),
      ]);
      setState(onboardingState);
      setFacts(activationFacts);
    };
    load();
  }, []);

  const handleDismiss = useCallback(async () => {
    if (!flowKey) return;
    setState((current) => (current ? { ...current, dismissed: true } : current));
    await dismissFlow(createClient(), flowKey);
  }, [flowKey]);

  if (!state || !facts) return null;

  // Step titles/descriptions are declared as i18n keys (lib/onboarding.ts).
  const steps = buildOnboardingSteps(facts).map((step) => ({
    ...step,
    title: t(step.title),
    description: step.description ? t(step.description) : undefined,
  }));

  return (
    <OnboardingChecklist title={title} steps={steps} state={state} onDismiss={handleDismiss} className={className} />
  );
}
