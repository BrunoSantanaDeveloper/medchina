"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import UsageMeter from "@/components/product/usage-meter";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import NiClock from "@/icons/nexture/ni-clock";
import { graceDaysLeft, trialDaysLeft } from "@/lib/audio-allowance";
import { getProductAction } from "@/lib/product-actions";
import { trackCommercialEvent } from "@/lib/product-events";

const BILLING_HREF = `${getProductAction("billing").href}?source=usage&feature=audio`;
const PAYMENT_HREF = `${getProductAction("billing").href}?source=usage&feature=payment`;

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
  // A failed renewal is not an exhausted allowance and is not an upgrade
  // opportunity: it is answered by fixing the payment method, so it gets its
  // own branch instead of borrowing the "buy more minutes" copy.
  const paymentBlocked = allowance?.reason === "past_due_blocked";
  const inGracePeriod = allowance?.reason === "past_due_grace";
  const promptVisible = Boolean(
    allowance &&
      !allowance.suspended &&
      !paymentBlocked &&
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
  const graceLeft = graceDaysLeft(allowance);
  const hasPack = allowance.packMinutesRemaining > 0;
  const nearLimit = allowance.percent >= 80;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-3">
          <span
            aria-hidden
            className="bg-primary/10 text-primary flex h-10 w-10 flex-none items-center justify-center rounded-2xl [&_svg]:h-5 [&_svg]:w-5"
          >
            <NiClock size="medium" />
          </span>
          <Typography variant="h6" component="h2" className="mb-0">
            {t("usage-title")}
          </Typography>
        </Box>

        {!hasAllowance ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {allowance.suspended ? t("usage-suspended") : paymentBlocked ? t("usage-past-due") : t("usage-none")}
            </Typography>
            {!allowance.suspended && (
              <Button
                variant={paymentBlocked ? "contained" : "outlined"}
                color="primary"
                href={paymentBlocked ? PAYMENT_HREF : BILLING_HREF}
                className="self-start"
                onClick={() =>
                  trackCommercialEvent("upgrade.prompt_clicked", "usage", paymentBlocked ? "payment" : "audio")
                }
              >
                {paymentBlocked ? t("usage-fix-payment") : t("usage-see-plans")}
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
                {/* With a pack in play the total exceeds the cycle limit, so
                    "X of {limit}" would be arithmetically wrong. Name both
                    pools instead — they behave differently at renewal. */}
                {hasPack
                  ? t("usage-remaining-with-pack", {
                      cycle: allowance.cycleMinutesRemaining,
                      pack: allowance.packMinutesRemaining,
                    })
                  : t("usage-remaining-of", { limit: allowance.minutesLimit })}
              </Typography>
            </Box>

            {/* Used vs available, both named. Running low tints the consumed
                share amber — never red, which stays reserved for clinical risk
                and failure (docs/DESIGN.md); a commercial limit is neither. */}
            <UsageMeter
              ariaLabel={t("usage-title")}
              headline={t("usage-meter-headline", {
                used: allowance.minutesUsed,
                limit: allowance.minutesLimit,
              })}
              caption={
                isTrial
                  ? t("usage-trial-caption", { used: allowance.minutesUsed, days: daysLeft ?? 0 })
                  : t("usage-plan-caption", { used: allowance.minutesUsed, plan: allowance.planName ?? "" })
              }
              segments={[
                {
                  key: "used",
                  label: t("usage-segment-used"),
                  value: allowance.minutesUsed,
                  display: t("usage-minutes", { minutes: allowance.minutesUsed }),
                  tone: nearLimit ? "attention" : "primary",
                },
                {
                  key: "available",
                  label: t("usage-segment-available"),
                  value: Math.max(0, allowance.cycleMinutesRemaining),
                  display: t("usage-minutes", { minutes: Math.max(0, allowance.cycleMinutesRemaining) }),
                  tone: "empty",
                },
                // Purchased minutes are a distinct segment because they behave
                // differently: they do not reset at renewal, and they are only
                // touched once the cycle above is spent.
                ...(hasPack
                  ? [
                      {
                        key: "pack",
                        label: t("usage-segment-pack"),
                        value: allowance.packMinutesRemaining,
                        display: t("usage-minutes", { minutes: allowance.packMinutesRemaining }),
                        tone: "secondary" as const,
                      },
                    ]
                  : []),
              ]}
            />

            {/* The window is still open, so the minutes above are real — but
                they stop when it closes, and that deadline belongs next to
                them rather than only in a notification she may have missed. */}
            {inGracePeriod && (
              <Alert
                severity="warning"
                className="neutral bg-background-paper/60!"
                action={
                  <Button
                    size="small"
                    color="inherit"
                    href={PAYMENT_HREF}
                    onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "usage", "payment")}
                  >
                    {t("usage-fix-payment")}
                  </Button>
                }
              >
                {graceLeft !== null
                  ? t("usage-past-due-grace", { days: graceLeft })
                  : t("usage-past-due-grace-generic")}
              </Alert>
            )}

            {/* PRD §5.8: alert at 80/95/100 — here as state, not just a bell. */}
            {allowance.percent >= 100 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {/* "New recordings are unavailable" would simply be false while
                    a purchased pack is still covering her. */}
                {hasPack
                  ? t("usage-limit-over-pack", { minutes: allowance.packMinutesRemaining })
                  : isTrial
                    ? t("usage-trial-over")
                    : t("usage-limit-over")}
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
