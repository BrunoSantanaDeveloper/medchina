"use client";

import { abandonPendingCheckout } from "../actions";
import type { PendingCheckout } from "./use-billing";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  Typography,
} from "@mui/material";

import NiClock from "@/icons/nexture/ni-clock";

/**
 * The gap between paying and being activated.
 *
 * Who: a professional who just started a checkout — very often by boleto or
 * Pix, which confirm hours or days later. What she came to do: find out
 * whether her purchase went through. What success looks like: she leaves
 * knowing exactly which of the two states she is in, with a way to act on
 * either one.
 *
 * Before this card the screen simply said "no active plan" for the whole
 * waiting period, which reads as failure. Two things followed, both bad: a
 * second checkout (on Asaas, a second recurring charge), or an abandoned
 * subscription that stayed alive at the provider and billed her for something
 * she never contracted. So the card offers both real actions — finish paying,
 * or cancel the request — and never leaves her guessing.
 */
export default function PendingCheckoutCard({
  orgId,
  pending,
  onChanged,
}: {
  orgId: string;
  pending: PendingCheckout;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const format = useFormatter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);

  const cancel = async () => {
    setWorking(true);
    setError(false);
    const result = await abandonPendingCheckout(orgId, pending.id);
    setWorking(false);
    if (result.error) {
      setError(true);
      return;
    }
    setConfirming(false);
    onChanged();
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Box className="flex flex-wrap items-center gap-2">
            <NiClock size="medium" className="text-primary dark:text-primary-light" />
            <Typography variant="h5" component="h2" className="card-title mb-0">
              {t("billing-pending-title")}
            </Typography>
            <Chip label={t("billing-status-incomplete")} size="small" color="primary" variant="outlined" />
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {t("billing-pending-body", {
              plan: pending.planName,
              date: format.dateTime(new Date(pending.createdAt), { dateStyle: "short", timeStyle: "short" }),
            })}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("billing-pending-help")}
          </Typography>
          {error && <Alert severity="error">{t("billing-pending-cancel-error")}</Alert>}
          <Box className="flex flex-wrap gap-2">
            {pending.checkoutUrl && (
              <Button variant="contained" href={pending.checkoutUrl} target="_blank" rel="noopener noreferrer">
                {t("billing-pending-pay")}
              </Button>
            )}
            <Button variant="outlined" color="grey" onClick={() => setConfirming(true)} disabled={working}>
              {t("billing-pending-cancel")}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>{t("billing-pending-cancel-title")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("billing-pending-cancel-confirm")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirming(false)} disabled={working}>
            {t("cancel")}
          </Button>
          <Button variant="contained" onClick={() => void cancel()} disabled={working}>
            {t("billing-pending-cancel")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
