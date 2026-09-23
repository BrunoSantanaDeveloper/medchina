"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button } from "@mui/material";

import Logo from "@/components/logo/logo";
import OnboardingStatusBadge from "@/components/product/onboarding-status-badge";
import RecordingSessionProvider from "@/components/product/recording-session-provider";
import { DEFAULTS } from "@/config";
import { useCurrentOrg } from "@/hooks/use-current-org";

/**
 * The guided trail's frame: the ONLY chrome between sign-up and the first
 * finalized record.
 *
 * `/onboarding` is a top-level route, outside `app/(dashboard)`, so there is no
 * nav rail, no header, no command palette here — not hidden by CSS, absent by
 * routing. That is the point: until the first consultation is signed, nothing
 * on screen competes with the step at hand.
 *
 * What it still carries, because leaving them out would be a trap rather than a
 * simplification:
 *
 *  - the commercial state, as one quiet badge (trial running / payment being
 *    confirmed / plan contracted). Right after checkout this is the difference
 *    between "my payment went through" and silence;
 *  - a visible way out. A guided flow with no exit is a cage; "pular guia"
 *    leaves for the app at any point and the trail stays exactly where she left
 *    it, because every step is derived from real data (has profile / has
 *    patient / has finalized consultation), never from click-tracking. Coming
 *    back is one link, offered on the app home and on /primeiros-passos.
 */
export default function OnboardingShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("product");
  const { orgId } = useCurrentOrg();

  return (
    // The trail records real audio in its AI track, and `useRecordingSession`
    // THROWS when the context is missing — the provider lives in the dashboard
    // layout, which by design is not above this route. Mounting it here is the
    // whole cost of that: it renders no layout of its own.
    //
    // It also arms the navigation guard, so "pular guia" is intercepted while a
    // capture is running. That is the correct behaviour, not a side effect:
    // leaving mid-recording is how audio is lost.
    <RecordingSessionProvider>
      <Box className="bg-waves flex min-h-screen w-full flex-col bg-cover bg-center">
        <Box
          component="header"
          className="mx-auto flex w-full max-w-4xl flex-none items-center justify-between gap-3 px-4 pt-5 pb-2"
        >
          <Box className="flex min-w-0 items-center gap-3">
            <Logo classNameFull="h-[27px] w-auto" classNameMobile="hidden" />
            <OnboardingStatusBadge orgId={orgId} />
          </Box>
          <Button
            LinkComponent={Link}
            href={DEFAULTS.appRoot}
            variant="text"
            color="grey"
            size="small"
            className="flex-none"
          >
            {t("onboarding-skip-guide")}
          </Button>
        </Box>
        <Box component="main" className="flex w-full flex-1 items-start justify-center px-4 pt-2 pb-10">
          {children}
        </Box>
      </Box>
    </RecordingSessionProvider>
  );
}
