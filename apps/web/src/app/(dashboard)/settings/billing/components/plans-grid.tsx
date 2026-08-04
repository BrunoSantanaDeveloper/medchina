"use client";

import { startCheckout } from "../actions";
import type { PlanRow, SubscriptionInfo } from "./use-billing";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

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

import { derivePlanFeatures } from "@/lib/billing-plan-features";
import { trackCommercialEvent } from "@/lib/product-events";

export default function PlansGrid({
  orgId,
  subscription,
  plans,
  canManage,
  checkoutAvailable,
  trialParams,
  onBillingProfileRequired,
}: {
  orgId: string;
  subscription: SubscriptionInfo | null;
  plans: PlanRow[];
  canManage: boolean;
  checkoutAvailable: boolean;
  trialParams: { days: number; minutes: number } | null;
  /** Surfaces the fiscal-data form when the provider needs it to proceed. */
  onBillingProfileRequired?: () => void;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [workingPlan, setWorkingPlan] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PlanRow | null>(null);
  const operationKeys = useRef(new Map<string, string>());
  const promptViewed = useRef(false);
  const paidPlans = plans.filter((plan) => !plan.isFree && plan.kind === "recurring" && plan.period);
  const currentPlan = paidPlans.find((plan) => plan.id === subscription?.planId) ?? null;

  useEffect(() => {
    if (!canManage || paidPlans.length === 0 || promptViewed.current) return;
    promptViewed.current = true;
    trackCommercialEvent("upgrade.prompt_viewed", "billing", "plans");
  }, [canManage, paidPlans.length]);

  if (!canManage) return null;
  if (!paidPlans.length) return null;

  const subscribe = async (plan: PlanRow) => {
    setError(null);
    setConfirming(null);
    setWorkingPlan(plan.id);
    const idempotencyKey = operationKeys.current.get(plan.id) ?? crypto.randomUUID();
    operationKeys.current.set(plan.id, idempotencyKey);
    const result = await startCheckout({ orgId, planId: plan.id, idempotencyKey });
    setWorkingPlan(null);
    if (!result.url) {
      // Named causes, not one generic failure: a missing CPF/CNPJ is fixed by
      // the form right above, a suspension is not fixed by her at all, and
      // telling her to "try again" in either case wastes her time.
      setError(result.error ?? "unavailable");
      if (result.error === "billing_profile_required") onBillingProfileRequired?.();
      return;
    }
    operationKeys.current.delete(plan.id);
    window.location.assign(result.url);
  };

  /**
   * Switching plans starts a NEW subscription and retires the current one
   * immediately — no proration, at either provider. Whoever is mid-cycle is
   * throwing away days she already paid for, and until now nothing said so.
   * The confirmation is the honest minimum while scheduled plan changes do
   * not exist (see docs/BILLING-AUDIT.md A1).
   */
  const requestChange = (plan: PlanRow) => {
    trackCommercialEvent("upgrade.prompt_clicked", "billing", "plans");
    if (currentPlan && currentPlan.id !== plan.id) {
      setConfirming(plan);
      return;
    }
    void subscribe(plan);
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
            <Typography variant="body2" className="text-text-secondary mt-2 leading-6">
              {trialParams ? t("billing-trial-explanation", trialParams) : t("billing-trial-explanation-generic")}
            </Typography>
          </Box>
          {error === "billing_profile_required" && <Alert severity="warning">{t("billing-profile-required")}</Alert>}
          {error === "suspended" && <Alert severity="error">{t("billing-suspended-blocked")}</Alert>}
          {error === "plan_required" && <Alert severity="info">{t("packs-plan-required")}</Alert>}
          {error && !["billing_profile_required", "suspended", "plan_required"].includes(error) && (
            <Alert severity="error">{t("billing-checkout-error")}</Alert>
          )}
          <Grid container spacing={2.5}>
            {paidPlans.map((plan) => {
              const current = subscription?.planId === plan.id;
              const features = derivePlanFeatures(plan.limits);
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
                        {features.clinicalReasoning && (
                          <Chip label={t("billing-most-complete")} size="small" color="primary" />
                        )}
                      </Box>
                      <Typography variant="h4" component="p">
                        {price}
                        <Typography component="span" variant="body2" className="text-text-secondary">
                          {" "}
                          {t(`billing-period-${plan.period}` as never)}
                        </Typography>
                      </Typography>
                      <Typography variant="subtitle2" className="text-primary dark:text-primary-light">
                        {t(
                          features.clinicalReasoning
                            ? "billing-plan-profile-reasoning"
                            : "billing-plan-profile-documentation",
                        )}
                      </Typography>
                      <Box
                        component="ul"
                        className="text-text-secondary m-0 flex list-disc flex-col gap-1 pl-5 text-sm"
                      >
                        <li>
                          {t("billing-audio-minutes", {
                            minutes: new Intl.NumberFormat(locale).format(features.audioMinutes),
                          })}
                        </li>
                        <li>
                          {features.libraryMessages === null
                            ? t("billing-library-unlimited")
                            : t("billing-library-messages", {
                                messages: new Intl.NumberFormat(locale).format(features.libraryMessages),
                              })}
                        </li>
                        <li>
                          {t(
                            features.clinicalReasoning
                              ? "billing-reasoning-included"
                              : "billing-reasoning-not-included",
                          )}
                        </li>
                      </Box>
                      {plan.description && (
                        <Typography variant="body2" className="text-text-secondary flex-1">
                          {plan.description}
                        </Typography>
                      )}
                      {current || checkoutAvailable ? (
                        <Button
                          variant={current ? "outlined" : "contained"}
                          onClick={() => requestChange(plan)}
                          disabled={current || workingPlan !== null}
                        >
                          {current
                            ? t("billing-current-chip")
                            : workingPlan === plan.id
                              ? t("billing-redirecting")
                              : currentPlan
                                ? t("billing-switch-plan")
                                : t("billing-choose-plan")}
                        </Button>
                      ) : (
                        <Button
                          variant="outlined"
                          href="/contato?assunto=planos"
                          LinkComponent={Link}
                          onClick={() => trackCommercialEvent("billing.contact_clicked", "billing", "plans")}
                        >
                          {t("billing-contact-plan")}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </CardContent>
      </Card>

      {/* Switching is not an edit to the current subscription: it opens a new
          one and retires the old one on the spot. Neither provider credits the
          days already paid, so she has to be told before she pays, not after. */}
      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogTitle>{t("billing-switch-title", { plan: confirming?.name ?? "" })}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("billing-switch-warning", { current: currentPlan?.name ?? "", next: confirming?.name ?? "" })}
          </DialogContentText>
          {subscription?.currentPeriodEnd && (
            <DialogContentText className="mt-3">
              {t("billing-switch-period-note", {
                date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                  new Date(subscription.currentPeriodEnd),
                ),
              })}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirming(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" onClick={() => confirming && void subscribe(confirming)}>
            {t("billing-switch-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
