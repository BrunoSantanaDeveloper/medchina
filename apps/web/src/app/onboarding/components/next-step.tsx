"use client";

import { useTranslations } from "next-intl";

import { Alert, Box, Typography } from "@mui/material";

import { useOnboardingStatus } from "@/components/product/onboarding-status-provider";

/**
 * Step 4 of the preparation: when is the next appointment?
 *
 * This is the bridge. Everything before it happens at her desk; the first
 * consultation happens with a patient, on another day — and a preparation that
 * ends on "all set" with an empty agenda leaves that day to chance. Booking it
 * now is what makes the consultation show up, on the day, in the agenda and on
 * the home, where the consultation screen takes over the guidance.
 *
 * Booking is an operational action, and the first one starts the Pro trial
 * (migration 0084). That is said HERE, before the button — a trial that begins
 * as a side effect of saving an appointment is a clock she never saw start. It
 * is only said to someone it applies to: a paid plan, a payment being confirmed
 * or a trial already running all make it false.
 */
export default function NextStep() {
  const t = useTranslations("product");
  const { status, allowance, trialParams } = useOnboardingStatus();
  const startsTrial = status?.kind === "free" && allowance?.trialAvailable === true;

  return (
    <Box className="flex flex-col gap-3">
      <Typography variant="body1" className="text-text-secondary leading-6">
        {t("prep-next-body")}
      </Typography>
      {startsTrial && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {trialParams ? t("prep-next-trial-notice", trialParams) : t("prep-next-trial-notice-generic")}
        </Alert>
      )}
    </Box>
  );
}
