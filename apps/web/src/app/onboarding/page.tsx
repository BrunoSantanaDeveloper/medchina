"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Card, CardContent, Chip, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import { DEFAULTS } from "@/config";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiUsers from "@/icons/nexture/ni-users";
import { getOnboardingFlowKey, isOnboardingEnabled } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import {
  completeStep,
  type FlowKey,
  getOnboardingState,
  type OnboardingStateRow,
  selectTrack,
} from "@flyee/onboarding";

type Track = NonNullable<OnboardingStateRow["selectedTrack"]>;
type Choice = { key: Track; icon: React.ReactNode };

/**
 * The scripted "demo" track was removed: it described the result in prose
 * instead of showing it, and the page itself pointed at the clinical library
 * as "the real demo". Seeing the AI without a patient is now the library's
 * job, invited from /primeiros-passos. `selectedTrack` still accepts "demo"
 * (template vocabulary + rows stored before this change) — callers normalise
 * that legacy value instead of offering it.
 */
const CHOICES: Choice[] = [
  { key: "manual", icon: <NiUsers size="large" /> },
  { key: "ai", icon: <NiMicrophone size="large" /> },
];

/** Initial choice and permanent re-entry point; choosing a track never starts the trial. */
export default function Onboarding() {
  const router = useRouter();
  const t = useTranslations("product");
  const [flowKey, setFlowKey] = useState<FlowKey | null>(null);
  const [selected, setSelected] = useState<Track | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!isSupabaseConfigured || !isOnboardingEnabled) {
        router.replace(DEFAULTS.appRoot);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/auth/sign-in?next=${encodeURIComponent("/onboarding")}`);
        return;
      }
      const key = await getOnboardingFlowKey(supabase, user.id);
      const state = await getOnboardingState(supabase, key);
      setFlowKey(key);
      setSelected(state.selectedTrack);
      setReady(true);
    };
    load();
  }, [router]);

  const choose = async (track: Track) => {
    if (!flowKey || busy) return;
    setBusy(true);
    const supabase = createClient();
    await selectTrack(supabase, flowKey, track);
    await completeStep(supabase, flowKey, "welcome");
    router.push(`/primeiros-passos?trilha=${track}`);
    router.refresh();
  };

  if (!ready) return null;

  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Box className="flex w-full max-w-4xl flex-col items-center gap-8 py-10">
        <Logo classNameMobile="hidden" />
        <Box className="flex max-w-2xl flex-col items-center gap-2 text-center">
          <Typography variant="h1" component="h1">
            {t("start-title")}
          </Typography>
          <Typography variant="body1" className="text-text-secondary leading-6">
            {t("start-subtitle")}
          </Typography>
        </Box>

        <Box className="grid w-full gap-4 md:grid-cols-3">
          {CHOICES.map((choice) => {
            const active = selected === choice.key;
            return (
              <Card
                key={choice.key}
                component="button"
                onClick={() => choose(choice.key)}
                disabled={busy}
                className={cn(
                  "hover:shadow-darker-sm cursor-pointer text-left transition-shadow disabled:opacity-60",
                  active && "outline-primary outline-2",
                )}
              >
                <CardContent className="flex h-full flex-col gap-3">
                  <Box className="flex items-start justify-between gap-2">
                    <span className="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-2xl">
                      {choice.icon}
                    </span>
                    {active && <Chip size="small" color="primary" label={t("start-selected")} />}
                  </Box>
                  <Typography variant="h6" component="h2">
                    {t(`start-${choice.key}-title`)}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary flex-1 leading-5">
                    {t(`start-${choice.key}-body`)}
                  </Typography>
                  <Box className="text-primary dark:text-primary-light flex items-center gap-1 text-sm font-semibold">
                    {t(`start-${choice.key}-cta`)} <NiChevronRightSmall size="small" />
                  </Box>
                </CardContent>
              </Card>
            );
          })}
        </Box>

        <Box className="flex flex-col items-center gap-1">
          <Button variant="text" color="grey" onClick={() => router.push(DEFAULTS.appRoot)} disabled={busy}>
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
