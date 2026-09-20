"use client";

import SettingsMenu from "../components/settings-menu";
import { checkoutAvailability } from "./actions";
import BillingProfileCard from "./components/billing-profile-card";
import CurrentSubscription from "./components/current-subscription";
import InvoicesCard from "./components/invoices-card";
import MinutePacksCard from "./components/minute-packs-card";
import PaymentRecoveryCard from "./components/payment-recovery-card";
import PendingCheckoutCard from "./components/pending-checkout-card";
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
  // The offer she was sent by link (`?plan=pro-fundador`): the grid surfaces it
  // even when it is unlisted, and says so when the offer has ended.
  const offerSlug = searchParams.get("plan");
  const [openDrawer, setOpenDrawer] = useState(false);
  const [checkoutState, setCheckoutState] = useState<RemoteState<boolean, "check_failed">>(() => remoteLoading());
  // Set when the provider refused the checkout for a missing CPF/CNPJ, so the
  // form leads with WHY it is suddenly being asked for.
  const [needsBillingProfile, setNeedsBillingProfile] = useState(false);
  // Bumped when the fiscal form is saved while she is completing a purchase:
  // the plan grid watches it and opens the checkout without a second click.
  const [continueCheckout, setContinueCheckout] = useState(0);
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
    pendingCheckout,
    billingProfile,
    plans,
    packs,
    invoices,
    retry,
    refreshDetails,
  } = useBilling();
  const { allowance, trialParams, reload: reloadAllowance } = useAudioAllowance(currentOrg?.id ?? null);

  /**
   * She came from an offer page to BUY, not to administer a subscription.
   *
   * This screen is the settings hub — usage meters, packs, invoice history —
   * and every one of those blocks is a reason to stop and read on the last
   * step before paying. So when she arrives with a plan in the link and has
   * nothing to administer yet, the page shows only what completes the
   * purchase: the fiscal field the provider demands, and the plan. Nothing is
   * removed, only deferred: the full screen is one link away, and the moment a
   * subscription exists this mode stops applying by itself.
   */
  const checkoutFocus = Boolean(offerSlug) && canManage && !subscription;

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
              {checkoutFocus ? t("billing-checkout-focus-title") : t("billing-title")}
            </Typography>
            {/* Where she is in the path, not where she is in the site tree.
                Mid-purchase, a breadcrumb back to Settings is an exit; the step
                line is the thing that makes a short flow feel short. */}
            {checkoutFocus ? (
              <Typography variant="body2" className="text-text-secondary">
                {billingProfile.document ? t("billing-checkout-step-pay") : t("billing-checkout-step-profile")}
              </Typography>
            ) : (
              <Breadcrumbs>
                <Link color="inherit" href="/inicio">
                  {t("settings-home")}
                </Link>
                <Link color="inherit" href="/settings">
                  {t("settings-title")}
                </Link>
                <Typography variant="body2">{t("settings-billing")}</Typography>
              </Breadcrumbs>
            )}
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
            {/* First, because she is here to FIX a charge, not to shop. The
                plan grid below answers a different question and would read as
                the wrong answer if it came first. */}
            {/* Keyed on `dunning`, not on `reason`: a workspace with purchased
                minutes keeps recording while past_due, so `reason` reads
                'pack_only' and this card — her only way to pay — used to
                vanish for exactly the person holding an unpaid invoice. */}
            {canManage && allowance?.dunning && (
              <Grid size={12}>
                <PaymentRecoveryCard orgId={currentOrg.id} graceEndsAt={allowance.graceEndsAt} />
              </Grid>
            )}
            {/* Before the plan grid: she is waiting on a payment she already
                made, and a row of "choose a plan" buttons reads as proof it
                failed — which is what produced duplicate checkouts. */}
            {canManage && pendingCheckout && (
              <PendingCheckoutCard orgId={currentOrg.id} pending={pendingCheckout} onChanged={refreshDetails} />
            )}
            {canManage && (needsBillingProfile || !billingProfile.document) && (
              <BillingProfileCard
                orgId={currentOrg.id}
                profile={billingProfile}
                required={needsBillingProfile}
                // In checkout mode the button says where it goes, and going
                // there is the same click: saving the document was never a
                // destination, it was the provider's requirement.
                continuesToCheckout={checkoutFocus}
                onSaved={() => {
                  setNeedsBillingProfile(false);
                  if (checkoutFocus) setContinueCheckout((token) => token + 1);
                  void refreshDetails();
                }}
              />
            )}
            {!checkoutFocus && (
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
              </>
            )}
            <PlansGrid
              orgId={currentOrg.id}
              subscription={subscription}
              plans={plans}
              canManage={canManage}
              checkoutAvailable={checkoutState.status === "success" && checkoutAvailable === true}
              trialParams={trialParams}
              offerSlug={offerSlug}
              onBillingProfileRequired={() => setNeedsBillingProfile(true)}
              continueCheckout={continueCheckout}
            />
            {/* After the tiers on purpose: for most people an upgrade is the
                better deal, and a pack is the answer only once that has been
                considered and the cycle still ran out. */}
            {!checkoutFocus && (
              <>
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
            {/* Deferred, never removed: the settings she did not come for stay
                one click away, and the link drops the `plan` parameter so the
                full screen is what loads. */}
            {checkoutFocus && (
              <Grid size={12}>
                <Button variant="text" color="grey" LinkComponent={Link} href="/settings/billing">
                  {t("billing-checkout-all-settings")}
                </Button>
              </Grid>
            )}
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
