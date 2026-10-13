"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useState } from "react";

import { Box, Button } from "@mui/material";

import Logo from "@/components/logo/logo";
import OnboardingStatusBadge from "@/components/product/onboarding-status-badge";
import { OnboardingStatusProvider } from "@/components/product/onboarding-status-provider";
import { DEFAULTS } from "@/config";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { getOnboardingFlowKey, markPreparationStarted, type PrepStepKey } from "@/lib/onboarding";
import { trackPreparationEvent } from "@/lib/product-events";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * What the page tells the frame about itself: which step is on screen (so
 * leaving can say WHERE she left) and whether the way out still belongs in the
 * header (the finished screen has its own, and two exits side by side read as
 * two different things).
 */
type ExitState = { step: PrepStepKey | null; hidden: boolean };
const PreparationExitContext = createContext<(exit: ExitState) => void>(() => undefined);

/** The page reports the step on screen; the frame's "fazer depois" uses it. */
export function usePreparationExit() {
  return useContext(PreparationExitContext);
}

/**
 * The preparation's frame: the ONLY chrome between sign-up and the app.
 *
 * `/onboarding` is a top-level route, outside `app/(dashboard)`, so there is no
 * nav rail, no header, no command palette here — not hidden by CSS, absent by
 * routing. Nothing on screen competes with the step at hand.
 *
 * What it still carries, because leaving them out would be a trap rather than a
 * simplification:
 *
 *  - the commercial state, as one quiet badge (trial running / payment being
 *    confirmed / plan contracted). Right after checkout this is the difference
 *    between "my payment went through" and silence;
 *  - a visible way out. A setup with no exit is a cage. "Fazer depois" leaves
 *    for the app at any point, and it RECORDS that she left: the auth entry
 *    points stop sending her back here (it used to record nothing, so skipping
 *    meant meeting this screen again at every sign-in), and the event says from
 *    which step. Coming back is one link, offered on the home and on
 *    /primeiros-passos, and every answer already given is still there.
 */
export default function OnboardingShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("product");
  const router = useRouter();
  const { orgId } = useCurrentOrg();
  const [exit, setExit] = useState<ExitState>({ step: null, hidden: false });
  const [leaving, setLeaving] = useState(false);

  const report = useCallback((next: ExitState) => {
    setExit((current) => (current.step === next.step && current.hidden === next.hidden ? current : next));
  }, []);

  const leave = useCallback(async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      if (isSupabaseConfigured) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          trackPreparationEvent("onboarding.exited", exit.step ?? undefined);
          await markPreparationStarted(supabase, await getOnboardingFlowKey(supabase, user.id));
        }
      }
    } catch {
      // Leaving must never fail: the worst case is being offered the
      // preparation again at the next sign-in.
    }
    router.push(DEFAULTS.appRoot);
  }, [exit.step, leaving, router]);

  return (
    // One reader of the commercial state for the badge AND the steps, so the
    // header and a step cannot contradict each other.
    <OnboardingStatusProvider orgId={orgId}>
      <PreparationExitContext.Provider value={report}>
        <Box className="bg-waves flex min-h-screen w-full flex-col bg-cover bg-center">
          <Box
            component="header"
            className="mx-auto flex w-full max-w-4xl flex-none items-center justify-between gap-3 px-4 pt-5 pb-2"
          >
            <Box className="flex min-w-0 items-center gap-3">
              <Logo classNameFull="h-[27px] w-auto" classNameMobile="hidden" />
              <OnboardingStatusBadge />
            </Box>
            {!exit.hidden && (
              <Button
                variant="text"
                color="grey"
                size="small"
                className="flex-none"
                disabled={leaving}
                onClick={() => void leave()}
              >
                {t("prep-exit")}
              </Button>
            )}
          </Box>
          <Box component="main" className="flex w-full flex-1 items-start justify-center px-4 pt-2 pb-10">
            {children}
          </Box>
        </Box>
      </PreparationExitContext.Provider>
    </OnboardingStatusProvider>
  );
}
