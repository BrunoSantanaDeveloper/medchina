"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import { TONE } from "@/components/marketing/tone";
import { DEFAULTS } from "@/config";
import NiAi from "@/icons/nexture/ni-ai";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiUsers from "@/icons/nexture/ni-users";
import { getOnboardingFlowKey, isOnboardingEnabled } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { completeStep, type FlowKey, getOnboardingState } from "@flyee/onboarding";

/**
 * The start choice (PRD §6.4) — the first screen after a brand-new account.
 * The user picks HOW she wants to begin; the app then takes her straight into
 * that path instead of dropping her on an empty dashboard.
 *
 * The trial NEVER starts here (PRD §5.7): choosing "record a real AI
 * consultation" only routes to the setup, it does not consume anything.
 *
 * Self-guarding: a user who already chose (or is already activated) is sent to
 * the app home, where the checklist keeps nudging the remaining steps.
 */
type Choice = {
  key: string;
  href: string;
  icon: React.ReactNode;
  tone: keyof typeof TONE;
};

const CHOICES: Choice[] = [
  { key: "manual", href: "/pacientes/novo", icon: <NiUsers size="large" />, tone: "accent-1" },
  { key: "demo", href: "/como-funciona", icon: <NiAi size="large" />, tone: "accent-4" },
  { key: "ai", href: "/settings", icon: <NiMicrophone size="large" />, tone: "accent-3" },
];

export default function Onboarding() {
  const router = useRouter();
  const t = useTranslations("product");
  const [flowKey, setFlowKey] = useState<FlowKey | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = async () => {
      if (!isSupabaseConfigured || !isOnboardingEnabled) {
        router.replace(DEFAULTS.appRoot);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth/sign-in");
        return;
      }
      const key = await getOnboardingFlowKey(supabase, user.id);
      const state = await getOnboardingState(supabase, key);
      if (state.completedAt || state.completedSteps.includes("welcome")) {
        router.replace(DEFAULTS.appRoot);
        return;
      }
      setFlowKey(key);
      setReady(true);
    };
    check();
  }, [router]);

  const choose = async (href: string) => {
    if (!flowKey || busy) return;
    setBusy(true);
    // "welcome" only records that the start choice was made — the real
    // activation steps stay derived from live clinical state.
    await completeStep(createClient(), flowKey, "welcome");
    router.push(href);
    router.refresh();
  };

  const skip = async () => {
    if (!flowKey || busy) return;
    setBusy(true);
    await completeStep(createClient(), flowKey, "welcome");
    router.push(DEFAULTS.appRoot);
    router.refresh();
  };

  if (!ready) return null;

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Box className="flex w-full max-w-3xl flex-col items-center gap-8 py-10">
        <Logo classNameMobile="hidden" />

        <Box className="flex flex-col items-center gap-2 text-center">
          <Typography variant="h1" component="h1">
            {t("start-title")}
          </Typography>
          <Typography variant="body1" className="text-text-secondary max-w-xl leading-6">
            {t("start-subtitle")}
          </Typography>
        </Box>

        <Box className="grid w-full gap-4 md:grid-cols-3">
          {CHOICES.map((choice) => {
            const tone = TONE[choice.tone];
            return (
              <Card
                key={choice.key}
                component="button"
                onClick={() => choose(choice.href)}
                disabled={busy}
                className="hover:shadow-darker-sm cursor-pointer text-left transition-shadow disabled:opacity-60"
              >
                <CardContent className="flex h-full flex-col gap-3">
                  <span
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-2xl [&_svg]:h-6 [&_svg]:w-6",
                      tone.softBg,
                      tone.text,
                    )}
                  >
                    {choice.icon}
                  </span>
                  <Typography variant="h6" component="h2" className="text-text-primary">
                    {t(`start-${choice.key}-title`)}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary flex-1 leading-5">
                    {t(`start-${choice.key}-body`)}
                  </Typography>
                  <Box className="text-primary flex flex-row items-center gap-1 text-sm font-semibold">
                    {t(`start-${choice.key}-cta`)}
                    <NiChevronRightSmall size="small" />
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>

        <Box className="flex flex-col items-center gap-1">
          <Button variant="text" color="grey" onClick={skip} disabled={busy}>
            {t("start-skip")}
          </Button>
          <Typography variant="body2" className="text-text-secondary text-center">
            {t("start-trial-note")}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
