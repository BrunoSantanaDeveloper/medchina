"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { Alert, Box, Button, Card, CardContent, LinearProgress, Typography } from "@mui/material";

import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiClock from "@/icons/nexture/ni-clock";
import { trialDaysLeft } from "@/lib/audio-allowance";
import { getProductAction } from "@/lib/product-actions";
import { trackCommercialEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";

const BILLING_HREF = `${getProductAction("billing").href}?source=usage&feature=audio`;

/**
 * Audio minutes: what is left, and what happens when it runs out (PRD §5.8 —
 * "O sistema exibirá consumo de minutos na web").
 *
 * The job is one question ("can I still record, and for how long?"), so this is
 * a single answer with a bar, not a usage table.
 *
 * Two deliberate choices:
 *  - it stays SILENT on the home when the workspace has no minutes at all: the
 *    trial is offered where the professional actually starts a consultation
 *    (PRD §5.7), not as a nag on every visit (PRD §7.4 asks for controlled
 *    frequency). `showWhenEmpty` opts in for the billing page, where "you have
 *    no AI minutes" is the answer the page exists to give;
 *  - running out is amber, never red. Red is reserved for clinical risk and
 *    failure (docs/DESIGN.md); a commercial limit is not either.
 */
export default function AudioUsageCard({ showWhenEmpty = false }: { showWhenEmpty?: boolean }) {
  const t = useTranslations("product");
  const { orgId } = useCurrentOrg();
  const { allowance, loading } = useAudioAllowance(orgId);
  const promptViewed = useRef(false);
  const hasAllowance = Boolean(allowance && allowance.minutesLimit > 0);
  const promptVisible = Boolean(
    allowance &&
      !allowance.suspended &&
      ((hasAllowance && allowance.percent >= 80) || (!hasAllowance && showWhenEmpty)),
  );

  useEffect(() => {
    if (!promptVisible || promptViewed.current) return;
    promptViewed.current = true;
    trackCommercialEvent("upgrade.prompt_viewed", "usage", "audio");
  }, [promptVisible]);

  if (loading || !allowance) return null;

  if (!hasAllowance && !showWhenEmpty) return null;

  const isTrial = allowance.source === "trial";
  const daysLeft = isTrial ? trialDaysLeft(allowance) : null;
  const nearLimit = allowance.percent >= 80;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <NiClock size="medium" className="text-primary" />
          <Typography variant="h6" component="h2">
            {t("usage-title")}
          </Typography>
        </Box>

        {!hasAllowance ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {allowance.suspended ? t("usage-suspended") : t("usage-none")}
            </Typography>
            {!allowance.suspended && (
              <Button
                variant="outlined"
                color="primary"
                href={BILLING_HREF}
                className="self-start"
                onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "usage", "audio")}
              >
                {t("usage-see-plans")}
              </Button>
            )}
          </>
        ) : (
          <>
            <Box className="flex flex-row items-baseline gap-2">
              <Typography variant="h3" component="p" className="text-text-primary mb-0 tabular-nums">
                {allowance.minutesRemaining}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("usage-remaining-of", { limit: allowance.minutesLimit })}
              </Typography>
            </Box>

            <LinearProgress
              variant="determinate"
              value={Math.min(allowance.percent, 100)}
              color={nearLimit ? "warning" : "primary"}
              aria-label={t("usage-title")}
            />

            <Typography variant="body2" className={cn("text-text-secondary text-xs leading-5")}>
              {isTrial
                ? t("usage-trial-caption", { used: allowance.minutesUsed, days: daysLeft ?? 0 })
                : t("usage-plan-caption", { used: allowance.minutesUsed, plan: allowance.planName ?? "" })}
            </Typography>

            {/* PRD §5.8: alert at 80/95/100 — here as state, not just a bell. */}
            {allowance.percent >= 100 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {isTrial ? t("usage-trial-over") : t("usage-limit-over")}
              </Alert>
            ) : nearLimit ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("usage-near-limit", { percent: allowance.percent })}
              </Alert>
            ) : null}

            {allowance.percent >= 80 && (
              <Button
                variant="contained"
                color="primary"
                href={BILLING_HREF}
                className="self-start"
                onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "usage", "audio")}
              >
                {t("usage-upgrade")}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
