"use client";

import SettingsMenu from "../components/settings-menu";
import { checkoutAvailability } from "./actions";
import CurrentSubscription from "./components/current-subscription";
import InvoicesCard from "./components/invoices-card";
import MinutePacksCard from "./components/minute-packs-card";
import PlansGrid from "./components/plans-grid";
import { useBilling } from "./components/use-billing";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, CircularProgress, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import AudioUsageCard from "@/components/product/audio-usage-card";
import LibraryUsageCard from "@/components/product/library-usage-card";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

export default function BillingSettings() {
  const t = useTranslations("product");
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const source = searchParams.get("source");
  const feature = searchParams.get("feature");
  const [openDrawer, setOpenDrawer] = useState(false);
  const [checkoutState, setCheckoutState] = useState<RemoteState<boolean, "check_failed">>(() => remoteLoading());
  const {
    configured,
    loading,
    orgsState,
    detailsState,
    loadFailed,
    refreshing,
    currentOrg,
    canManage,
    subscription,
    plans,
    packs,
    invoices,
    retry,
    refreshDetails,
  } = useBilling();
  const { allowance, trialParams, reload: reloadAllowance } = useAudioAllowance(currentOrg?.id ?? null);

  const loadCheckoutAvailability = useCallback(async () => {
    setCheckoutState(remoteLoading());
    try {
      setCheckoutState(remoteSuccess(await checkoutAvailability()));
    } catch {
      setCheckoutState(remoteError("check_failed"));
    }
  }, []);

  useEffect(() => {
    void loadCheckoutAvailability();
  }, [loadCheckoutAvailability]);

  const checkoutAvailable = checkoutState.status === "success" ? checkoutState.data : undefined;
  const detailsAvailable =
    detailsState.status === "success" ||
    ((detailsState.status === "loading" || detailsState.status === "error") && Boolean(detailsState.previous));

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size="auto" className="hidden pr-8 lg:flex">
        <SettingsMenu active="billing" />
      </Grid>
      <Grid size="grow" spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              {t("billing-title")}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("settings-home")}
              </Link>
              <Link color="inherit" href="/settings">
                {t("settings-title")}
              </Link>
              <Typography variant="body2">{t("settings-billing")}</Typography>
            </Breadcrumbs>
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                aria-label={t("settings-open-menu")}
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
              >
                <NiListCircle size="medium" />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {!configured && (
          <Grid size={12}>
            <Alert severity="info">{t("settings-unavailable")}</Alert>
          </Grid>
        )}
        {checkout === "success" && (
          <Grid size={12}>
            <Alert severity="info">{t("billing-checkout-processing")}</Alert>
          </Grid>
        )}
        {checkout === "canceled" && (
          <Grid size={12}>
            <Alert severity="info">{t("billing-checkout-canceled")}</Alert>
          </Grid>
        )}
        {source === "consultation" && feature === "clinical_reasoning" && (
          <Grid size={12}>
            <Alert severity="info">{t("billing-clinical-reasoning-context")}</Alert>
          </Grid>
        )}
        {/* She arrived here from a payment problem, not from shopping. Say so,
            so the plan grid below does not read as the answer to her question. */}
        {feature === "payment" && (
          <Grid size={12}>
            <Alert severity="warning" className="neutral">
              {t("billing-past-due-context")}
            </Alert>
          </Grid>
        )}
        {checkoutState.status === "error" && (
          <Grid size={12}>
            <Alert
              severity="error"
              action={<Button onClick={() => void loadCheckoutAvailability()}>{t("retry")}</Button>}
            >
              {t("billing-provider-check-error")}
            </Alert>
          </Grid>
        )}
        {checkoutState.status === "success" && checkoutAvailable === false && (
          <Grid size={12}>
            <Alert severity="info">{t("billing-provider-unavailable")}</Alert>
          </Grid>
        )}
        {loadFailed && (
          <Grid size={12}>
            <Alert severity="error" action={<Button onClick={() => void retry()}>{t("retry")}</Button>}>
              {t("billing-load-error")}
            </Alert>
          </Grid>
        )}
        {configured && loading && (
          <Grid size={12} aria-live="polite">
            <CircularProgress size={24} aria-label={t("loading")} />
          </Grid>
        )}
        {refreshing && (
          <Grid size={12} aria-live="polite">
            <CircularProgress size={18} aria-label={t("loading")} />
          </Grid>
        )}
        {configured && orgsState.status === "empty" && (
          <Grid size={12}>
            <Alert severity="info">{t("settings-practice-missing")}</Alert>
          </Grid>
        )}

        {currentOrg && detailsAvailable && (
          <>
            <Grid size={{ xs: 12, md: 6 }}>
              <AudioUsageCard showWhenEmpty />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <LibraryUsageCard />
            </Grid>
            <CurrentSubscription
              orgId={currentOrg.id}
              subscription={subscription}
              canManage={canManage}
              onChanged={refreshDetails}
            />
            <PlansGrid
              orgId={currentOrg.id}
              subscription={subscription}
              plans={plans}
              canManage={canManage}
              checkoutAvailable={checkoutState.status === "success" && checkoutAvailable === true}
              trialParams={trialParams}
            />
            {/* After the tiers on purpose: for most people an upgrade is the
                better deal, and a pack is the answer only once that has been
                considered and the cycle still ran out. */}
            <MinutePacksCard
              orgId={currentOrg.id}
              packs={packs}
              allowance={allowance}
              canManage={canManage}
              checkoutAvailable={checkoutState.status === "success" && checkoutAvailable === true}
              onPurchased={reloadAllowance}
            />
            <InvoicesCard invoices={invoices} />
          </>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="billing" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
