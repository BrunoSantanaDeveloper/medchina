"use client";

import { scheduleSubscriptionCancellation, undoSubscriptionCancellation } from "../actions";
import type { SubscriptionInfo } from "./use-billing";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";

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
  DialogTitle,
  Grid,
  Typography,
} from "@mui/material";

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  active: "success",
  trialing: "warning",
  past_due: "error",
};

export default function CurrentSubscription({
  orgId,
  subscription,
  canManage,
  onChanged,
}: {
  orgId: string;
  subscription: SubscriptionInfo | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);
  const cancellationKey = useRef<string | null>(null);
  const resumeKey = useRef<string | null>(null);
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale).format(new Date(value));

  const schedule = async () => {
    setWorking(true);
    setError(false);
    cancellationKey.current ??= crypto.randomUUID();
    const result = await scheduleSubscriptionCancellation(orgId, cancellationKey.current);
    setWorking(false);
    if (result.error) {
      setError(true);
      return;
    }
    cancellationKey.current = null;
    setConfirmOpen(false);
    onChanged();
  };

  const undo = async () => {
    setWorking(true);
    setError(false);
    resumeKey.current ??= crypto.randomUUID();
    const result = await undoSubscriptionCancellation(orgId, resumeKey.current);
    setWorking(false);
    if (result.error) {
      setError(true);
      return;
    }
    resumeKey.current = null;
    onChanged();
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h5" component="h2" className="card-title">
            {t("billing-current-title")}
          </Typography>
          {subscription?.adminSuspended && <Alert severity="error">{t("billing-suspended")}</Alert>}
          {error && <Alert severity="error">{t("billing-action-error")}</Alert>}

          {!subscription ? (
            <Typography variant="body1" className="text-text-secondary">
              {t("billing-no-subscription")}
            </Typography>
          ) : (
            <Box className="flex flex-col gap-4">
              <Box className="flex flex-wrap items-center gap-3">
                <Typography variant="h6" component="h3">
                  {subscription.planName}
                </Typography>
                <Chip
                  label={t(`billing-status-${subscription.status}` as never)}
                  size="small"
                  color={STATUS_COLOR[subscription.status] ?? "default"}
                  variant="outlined"
                />
              </Box>

              <Box className="text-text-secondary flex flex-col gap-1">
                {subscription.currentPeriodEnd && !subscription.cancelAtPeriodEnd && (
                  <Typography variant="body2">
                    {t("billing-renews-on", { date: formatDate(subscription.currentPeriodEnd) })}
                  </Typography>
                )}
              </Box>

              {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                <Alert
                  severity="warning"
                  action={
                    canManage ? (
                      <Button color="inherit" size="small" onClick={undo} disabled={working}>
                        {t("billing-undo-cancel")}
                      </Button>
                    ) : undefined
                  }
                >
                  {t("billing-cancel-scheduled", { date: formatDate(subscription.currentPeriodEnd) })}
                </Alert>
              )}

              {canManage && !subscription.isFree && !subscription.cancelAtPeriodEnd && (
                <Box>
                  <Button variant="outlined" color="error" onClick={() => setConfirmOpen(true)}>
                    {t("billing-cancel")}
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onClose={() => !working && setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("billing-cancel-dialog-title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" className="text-text-secondary">
            {t("billing-cancel-dialog-body", {
              date: subscription?.currentPeriodEnd
                ? formatDate(subscription.currentPeriodEnd)
                : t("billing-current-cycle"),
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmOpen(false)} disabled={working}>
            {t("billing-keep-plan")}
          </Button>
          <Button color="error" variant="contained" onClick={schedule} disabled={working}>
            {t("billing-confirm-cancel")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
