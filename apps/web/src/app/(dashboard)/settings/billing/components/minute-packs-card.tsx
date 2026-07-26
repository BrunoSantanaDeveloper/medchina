"use client";

import { startPackCheckout } from "../actions";
import type { PlanRow } from "./use-billing";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, Grid, Typography } from "@mui/material";

import NiClock from "@/icons/nexture/ni-clock";
import type { AudioAllowance } from "@/lib/audio-allowance";
import { trackCommercialEvent } from "@/lib/product-events";

/**
 * À-la-carte minutes (migration 0055).
 *
 * The job: she ran out mid-cycle and wants to keep working today. So this is
 * three prices and a buy button, not a catalogue — and it is deliberately
 * placed BELOW the plan grid, because for most people upgrading the plan is
 * the better deal and should be seen first.
 *
 * It renders only when a pack can actually be bought (`packPurchasable`, which
 * the allowance computes and `startPackCheckout` enforces again). Showing a
 * disabled row to someone on Gratuito would advertise a thing they cannot have
 * and answer none of their questions.
 */
export default function MinutePacksCard({
  orgId,
  packs,
  allowance,
  canManage,
  checkoutAvailable,
  onPurchased,
}: {
  orgId: string;
  packs: PlanRow[];
  allowance: AudioAllowance | null;
  canManage: boolean;
  checkoutAvailable: boolean;
  onPurchased?: () => void;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [error, setError] = useState<"checkout" | "plan_required" | null>(null);
  const [workingPack, setWorkingPack] = useState<string | null>(null);
  const operationKeys = useRef(new Map<string, string>());
  const promptViewed = useRef(false);
  const purchasable = allowance?.packPurchasable === true;
  const visible = canManage && purchasable && packs.length > 0;

  useEffect(() => {
    if (!visible || promptViewed.current) return;
    promptViewed.current = true;
    trackCommercialEvent("upgrade.prompt_viewed", "billing", "audio_pack");
  }, [visible]);

  if (!visible) return null;

  const buy = async (pack: PlanRow) => {
    setError(null);
    setWorkingPack(pack.id);
    // The same key across retries, so a double click cannot become two
    // charges — the operation claim in the database dedups on it.
    const idempotencyKey = operationKeys.current.get(pack.id) ?? crypto.randomUUID();
    operationKeys.current.set(pack.id, idempotencyKey);
    const result = await startPackCheckout({ orgId, planId: pack.id, idempotencyKey });
    setWorkingPack(null);
    if (!result.url) {
      setError(result.error === "plan_required" ? "plan_required" : "checkout");
      // The gate may have changed under her (an expired subscription); let the
      // page re-read the truth rather than keep offering a dead button.
      onPurchased?.();
      return;
    }
    operationKeys.current.delete(pack.id);
    window.location.assign(result.url);
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Box>
            <Box className="flex flex-row items-center gap-2">
              <NiClock size="medium" className="text-primary" />
              <Typography variant="h5" component="h2" className="card-title mb-0">
                {t("packs-title")}
              </Typography>
            </Box>
            <Typography variant="body2" className="text-text-secondary mt-1 leading-6">
              {t("packs-body")}
            </Typography>
            {allowance && allowance.packMinutesRemaining > 0 && (
              <Typography variant="body2" className="text-text-primary mt-2 leading-6">
                {t("packs-current-balance", { minutes: allowance.packMinutesRemaining })}
              </Typography>
            )}
          </Box>

          {error === "plan_required" && <Alert severity="info">{t("packs-plan-required")}</Alert>}
          {error === "checkout" && <Alert severity="error">{t("billing-checkout-error")}</Alert>}
          {!checkoutAvailable && <Alert severity="info">{t("billing-provider-unavailable")}</Alert>}

          <Grid container spacing={2.5}>
            {packs.map((pack) => (
              <Grid key={pack.id} size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" className="h-full">
                  <CardContent className="flex h-full flex-col gap-2">
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={t("packs-minutes-chip", { minutes: pack.packMinutes })}
                      className="self-start"
                    />
                    <Typography variant="h4" component="p" className="text-text-primary mb-0 tabular-nums">
                      {new Intl.NumberFormat(locale, {
                        style: "currency",
                        currency: pack.currency,
                      }).format(pack.priceCents / 100)}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary leading-6">
                      {pack.description ?? t("packs-default-description")}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="primary"
                      fullWidth
                      className="mt-auto"
                      disabled={!checkoutAvailable || workingPack !== null}
                      onClick={() => {
                        trackCommercialEvent("upgrade.prompt_clicked", "billing", "audio_pack");
                        void buy(pack);
                      }}
                    >
                      {workingPack === pack.id ? t("billing-redirecting") : t("packs-buy")}
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Typography variant="body2" className="text-text-secondary text-xs leading-5">
            {t("packs-note")}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );
}
