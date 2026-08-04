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
  // Purchased minutes are an allowance too. Keying this on the CYCLE limit
  // alone meant a workspace that had bought a pack and then cancelled its plan
  // read "this practice has no AI minutes" while the recorder happily recorded
  // — money already paid, made invisible by the screen that exists to report
  // it. Same for a past_due workspace past its grace window.
  const packBalance = allowance?.packMinutesRemaining ?? 0;
  const hasAllowance = Boolean(allowance && (allowance.minutesLimit > 0 || packBalance > 0));
  /** Minutes she owns outright, with no cycle behind them. */
  const packOnly = Boolean(allowance && allowance.minutesLimit === 0 && packBalance > 0);
  // A failed renewal is not an exhausted allowance and is not an upgrade
  // opportunity: it is answered by fixing the payment method, so it gets its
  // own branch instead of borrowing the "buy more minutes" copy.
  const paymentBlocked = allowance?.reason === "past_due_blocked";
  const inGracePeriod = allowance?.reason === "past_due_grace";
  const promptVisible = Boolean(
    allowance &&
      !allowance.suspended &&
      !paymentBlocked &&
      ((hasAllowance && (allowance.percent >= 80 || !allowance.canStart)) || (!hasAllowance && showWhenEmpty)),
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
  // The one question this card exists to answer. It is NOT "did she use it
  // all": the Pro trial also closes on elapsed days, so a workspace can be
  // refused at 1% consumption.
  const blocked = !allowance.canStart;
  const trialOver = allowance.reason === "trial_over" || (isTrial && blocked);

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

        {packOnly ? (
          <>
            <Box className="flex flex-row items-baseline gap-2">
              <Typography variant="h3" component="p" className="text-text-primary mb-0 tabular-nums">
                {allowance.packMinutesRemaining}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("usage-pack-only-remaining")}
              </Typography>
            </Box>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("usage-pack-only-body")}
            </Typography>
            {allowance.dunning && (
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
                {t("usage-past-due-pack")}
              </Alert>
            )}
            <Button
              variant="outlined"
              color="primary"
              href={BILLING_HREF}
              className="self-start"
              onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "usage", "audio")}
            >
              {t("usage-see-plans")}
            </Button>
          </>
        ) : !hasAllowance ? (
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
                {blocked
                  ? // "297 restantes" promises minutes she can no longer
                    // reach. They were not used — that is the true statement.
                    t("usage-unused-of", { limit: allowance.minutesLimit })
                  : hasPack
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
                // "0 dias restantes" is true but reads as a countdown still
                // running. Once the trial has actually closed, say that.
                trialOver
                  ? t("usage-trial-caption-over", { used: allowance.minutesUsed })
                  : isTrial
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
                  // Calling this share "available" while the recorder refuses
                  // to start is the same false promise as the headline, only
                  // in smaller type.
                  label: blocked ? t("usage-segment-unused") : t("usage-segment-available"),
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

            {/* PRD §5.8: alert at 80/95/100 — here as state, not just a bell.
                But consumption is NOT the only way to end up unable to record:
                the Pro trial closes on days OR minutes, whichever comes first,
                so an expired trial can sit at 1% used. Keying this block on
                `percent` alone showed a healthy meter and no warning at all to
                someone the recorder was already refusing — the two screens
                told the same person opposite things. `canStart` is the
                authority; percent only picks the wording. */}
            {blocked ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {trialOver ? t("usage-trial-over") : t("usage-limit-over")}
              </Alert>
            ) : allowance.percent >= 100 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {/* "New recordings are unavailable" would simply be false while
                    a purchased pack is still covering her. */}
                {hasPack
                  ? t("usage-limit-over-pack", { minutes: allowance.packMinutesRemaining })
                  : t("usage-limit-over")}
              </Alert>
            ) : nearLimit ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("usage-near-limit", { percent: allowance.percent })}
              </Alert>
            ) : null}

            {/* Being unable to record is the state that most needs a way out,
                and it was the one state with no button: the CTA hung off
                `percent >= 80`, which an expired trial never reaches. */}
            {(blocked || allowance.percent >= 80) && (
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
