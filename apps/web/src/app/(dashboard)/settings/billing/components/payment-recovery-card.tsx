"use client";

import { startPaymentRecovery } from "../actions";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from "@mui/material";

import NiCreditCard from "@/icons/nexture/ni-credit-card";

/**
 * The way OUT of a failed payment.
 *
 * She is here because a charge failed — a bell notification, the recorder or
 * the usage card sent her, all saying "update your payment". Her job on this
 * screen is exactly one thing: pay, before the grace window closes and the
 * recording stops mid-appointment. Success is landing on the provider's
 * payment page in one click. The plan grid further down answers a different
 * question (shopping) and must not be mistaken for this one, which is why this
 * card sits above it and states the deadline in days she can count.
 *
 * When the provider offers nothing actionable, that is said plainly rather
 * than rendered as an empty card — silence here reads as "nothing is wrong".
 */
export default function PaymentRecoveryCard({ orgId, graceEndsAt }: { orgId: string; graceEndsAt?: string | null }) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const daysLeft = graceEndsAt
    ? Math.max(0, Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;

  const recover = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await startPaymentRecovery(orgId);
      if (result.url) {
        // Leaving the app for the provider's hosted page — a full navigation,
        // not a new tab, so a mobile browser does not strand her in a popup.
        window.location.href = result.url;
        return;
      }
      setErrorKey(result.error === "not_needed" ? "billing-recovery-not-needed" : "billing-recovery-unavailable");
    } catch {
      setErrorKey("billing-recovery-unavailable");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card component="section" className="w-full">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <NiCreditCard size="small" className="text-text-secondary" aria-hidden />
          <Typography variant="h6" component="h2" className="mb-0">
            {t("billing-recovery-title")}
          </Typography>
        </Box>
        <Typography variant="body2" className="text-text-secondary leading-6">
          {daysLeft !== null ? t("billing-recovery-body-days", { days: daysLeft }) : t("billing-recovery-body")}
        </Typography>
        {errorKey && <Alert severity="info">{t(errorKey)}</Alert>}
        <Button
          variant="contained"
          color="primary"
          className="self-start"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} aria-hidden /> : <NiCreditCard size="tiny" />}
          onClick={() => void recover()}
        >
          {t("billing-recovery-action")}
        </Button>
      </CardContent>
    </Card>
  );
}
