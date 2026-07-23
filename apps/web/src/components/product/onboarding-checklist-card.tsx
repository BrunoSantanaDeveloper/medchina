"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Box, Button } from "@mui/material";

import OnboardingChecklist from "@/components/product/onboarding-checklist";
import {
  type ActivationFacts,
  buildOnboardingSteps,
  getActivationFacts,
  getOnboardingFlowKey,
  isOnboardingEnabled,
} from "@/lib/onboarding";
import { getProductAction } from "@/lib/product-actions";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { dismissFlow, type FlowKey, getOnboardingState, type OnboardingStateRow } from "@flyee/onboarding";

const GETTING_STARTED_HREF = getProductAction("getting-started").href;

/**
 * Drop-in activation card for the app home: reads the user's onboarding state
 * AND the live clinical facts the steps are derived from (has a patient? has a
 * finalized consultation?), so the checklist reflects reality rather than
 * clicks. Renders nothing when onboarding is not declared, Supabase is
 * unconfigured, the flow is complete, or the user dismissed it — safe to mount
 * unconditionally.
 */
export default function OnboardingChecklistCard({
  title,
  className,
  fallback = null,
}: {
  title?: string;
  className?: string;
  fallback?: ReactNode;
}) {
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

  const activated = facts.hasProfileName && facts.hasPatient && facts.hasFinalizedConsultation;
  if (state.dismissed || state.completedAt || activated) return fallback;

  // Step titles/descriptions are declared as i18n keys (lib/onboarding.ts).
  const steps = buildOnboardingSteps(facts).map((step) => ({
    ...step,
    title: t(step.title),
    description: step.description ? t(step.description) : undefined,
  }));

  return (
    <Box className="flex flex-col gap-2">
      <OnboardingChecklist title={title} steps={steps} state={state} onDismiss={handleDismiss} className={className} />
      <Button LinkComponent={Link} href={GETTING_STARTED_HREF} variant="text" size="small" className="self-start">
        {t("getting-started-view-all")}
      </Button>
    </Box>
  );
}
