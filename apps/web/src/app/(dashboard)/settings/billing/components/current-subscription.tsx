"use client";

import { cancelSubscription } from "../actions";
import { formatMoney, InvoiceRow, SubscriptionInfo } from "./use-billing";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, Grid, Typography } from "@mui/material";

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  active: "success",
  trialing: "warning",
  past_due: "error",
};

type Props = {
  orgId: string;
  subscription: SubscriptionInfo | null;
  invoices: InvoiceRow[];
  creditBalance: number;
  canManage: boolean;
  onChanged: () => void;
};

export default function CurrentSubscription({
  orgId,
  subscription,
  invoices,
  creditBalance,
  canManage,
  onChanged,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const handleCancel = async () => {
    setError(null);
    setWorking(true);
    const result = await cancelSubscription(orgId);
    setWorking(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onChanged();
  };

  const now = new Date();
  const paidThisMonth = invoices
    .filter((invoice) => {
      if (invoice.status !== "paid" || !invoice.paidAt) return false;
      const paid = new Date(invoice.paidAt);
      return paid.getMonth() === now.getMonth() && paid.getFullYear() === now.getFullYear();
    })
    .reduce((sum, invoice) => sum + invoice.amountCents, 0);
  const paidThisYear = invoices
    .filter(
      (invoice) =>
        invoice.status === "paid" && invoice.paidAt && new Date(invoice.paidAt).getFullYear() === now.getFullYear(),
    )
    .reduce((sum, invoice) => sum + invoice.amountCents, 0);

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent>
          <Typography variant="h5" component="h5" className="card-title">
            Subscription
          </Typography>

          {subscription?.adminSuspended && (
            <Alert severity="error" className="neutral bg-background-paper/60! mb-4">
              This subscription has been suspended by the platform administrators. Contact support.
            </Alert>
          )}
          {error && (
            <Alert severity="error" className="neutral bg-background-paper/60! mb-4">
              {error}
            </Alert>
          )}

          {!subscription ? (
            <Typography variant="body1" className="text-text-secondary">
              No active subscription.
            </Typography>
          ) : (
            <Box className="flex flex-col gap-4">
              <Box className="flex flex-row flex-wrap items-center gap-3">
                <Typography variant="h6" component="h6">
                  {subscription.planName}
                </Typography>
                <Chip
                  label={subscription.status.replace("_", " ")}
                  size="small"
                  color={STATUS_COLOR[subscription.status] ?? "default"}
                  variant="outlined"
                  className="capitalize"
                />
                {subscription.period && (
                  <Chip label={subscription.period} size="small" variant="outlined" className="capitalize" />
                )}
                {subscription.modules.map((module) => (
                  <Chip key={module.id} label={module.name} size="small" variant="outlined" />
                ))}
              </Box>

              <Box className="text-text-secondary flex flex-col gap-1">
                {subscription.trialEndsAt && new Date(subscription.trialEndsAt) > now && (
                  <Typography variant="body2">
                    Trial ends {new Date(subscription.trialEndsAt).toLocaleDateString()}
                  </Typography>
                )}
                {subscription.currentPeriodEnd && (
                  <Typography variant="body2">
                    Current period ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                  </Typography>
                )}
                <Typography variant="body2">Credit balance: {creditBalance}</Typography>
                <Typography variant="body2">
                  Spent this month: {formatMoney(paidThisMonth)} — this year: {formatMoney(paidThisYear)}
                </Typography>
              </Box>

              {canManage && !subscription.isFree && (
                <Box>
                  <Button variant="outlined" size="medium" color="error" onClick={handleCancel} disabled={working}>
                    Cancel subscription
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
