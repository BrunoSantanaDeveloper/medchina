"use client";

import { startCheckout } from "../actions";
import type { PlanRow, SubscriptionInfo } from "./use-billing";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, Grid, Typography } from "@mui/material";

export default function PlansGrid({
  orgId,
  subscription,
  plans,
  canManage,
  checkoutAvailable,
}: {
  orgId: string;
  subscription: SubscriptionInfo | null;
  plans: PlanRow[];
  canManage: boolean;
  checkoutAvailable: boolean;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [error, setError] = useState(false);
  const [workingPlan, setWorkingPlan] = useState<string | null>(null);
  const operationKeys = useRef(new Map<string, string>());

  if (!canManage) return null;
  const paidPlans = plans.filter((plan) => !plan.isFree && plan.kind === "recurring" && plan.period);
  if (!paidPlans.length) return null;

  const subscribe = async (plan: PlanRow) => {
    setError(false);
    setWorkingPlan(plan.id);
    const idempotencyKey = operationKeys.current.get(plan.id) ?? crypto.randomUUID();
    operationKeys.current.set(plan.id, idempotencyKey);
    const result = await startCheckout({ orgId, planId: plan.id, idempotencyKey });
    setWorkingPlan(null);
    if (!result.url) {
      setError(true);
      return;
    }
    operationKeys.current.delete(plan.id);
    window.location.assign(result.url);
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Box>
            <Typography variant="h5" component="h2" className="card-title">
              {t("billing-plans-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("billing-plans-body")}
            </Typography>
          </Box>
          {error && <Alert severity="error">{t("billing-checkout-error")}</Alert>}
          <Grid container spacing={2.5}>
            {paidPlans.map((plan) => {
              const current = subscription?.planId === plan.id;
              const price = new Intl.NumberFormat(locale, { style: "currency", currency: plan.currency }).format(
                plan.priceCents / 100,
              );
              return (
                <Grid key={plan.id} size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" className="h-full">
                    <CardContent className="flex h-full flex-col gap-3">
                      <Box className="flex flex-wrap items-center gap-2">
                        <Typography variant="h6" component="h3">
                          {plan.name}
                        </Typography>
                        {current && (
                          <Chip label={t("billing-current-chip")} size="small" color="success" variant="outlined" />
                        )}
                      </Box>
                      <Typography variant="h4" component="p">
                        {price}
                        <Typography component="span" variant="body2" className="text-text-secondary">
                          {" "}
                          {t(`billing-period-${plan.period}` as never)}
                        </Typography>
                      </Typography>
                      {plan.audioMinutes > 0 && (
                        <Typography variant="subtitle2" className="text-primary">
                          {t("billing-audio-minutes", {
                            minutes: new Intl.NumberFormat(locale).format(plan.audioMinutes),
                          })}
                        </Typography>
                      )}
                      {plan.description && (
                        <Typography variant="body2" className="text-text-secondary flex-1">
                          {plan.description}
                        </Typography>
                      )}
                      <Button
                        variant={current ? "outlined" : "contained"}
                        onClick={() => subscribe(plan)}
                        disabled={current || workingPlan !== null || !checkoutAvailable}
                      >
                        {current
                          ? t("billing-current-chip")
                          : workingPlan === plan.id
                            ? t("billing-redirecting")
                            : t("billing-choose-plan")}
                      </Button>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </CardContent>
      </Card>
    </Grid>
  );
}
