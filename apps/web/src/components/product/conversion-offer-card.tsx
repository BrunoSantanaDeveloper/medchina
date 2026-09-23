"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import NiTag from "@/icons/nexture/ni-tag";
import { createClient } from "@flyee/auth/client";

type Offer = {
  trigger: "first_consultation" | "usage_80";
  expiresAt: string;
  couponCode: string | null;
};

/** Recomputed each tick from the SERVER deadline, never accumulated locally. */
function remainingParts(expiresAt: string, now: number) {
  const millis = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(millis) || millis <= 0) return null;
  const totalMinutes = Math.floor(millis / 60000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/**
 * The time-boxed offer, at the two moments intent peaks (migration 0088): right
 * after her first finalized record, and at 80% of the trial minutes.
 *
 * The countdown reads the deadline the DATABASE stamped when the offer opened.
 * It can only run down — reloading the page does not buy her more time, and
 * nothing here can invent a fresh window. That is the difference between real
 * urgency and the fake timer this whole mechanism was designed to avoid
 * (docs/FUNIL.md).
 *
 * WHY IT REFUSES TO RENDER WITHOUT A COUPON. `platform_settings.conversion_offers`
 * ships with `coupon_code: ''`, and `open_conversion_offer` will happily stamp a
 * window with no coupon on it. A countdown over an offer that changes no price
 * is exactly the fake timer above, wearing this mechanism's clothes: nothing
 * would actually expire, and "it goes back to the normal price" would be false.
 * So an offer with no coupon renders NOTHING, and turning the campaign on
 * without configuring a discount simply shows no card — instead of showing a
 * deadline that means nothing.
 *
 * Renders nothing when there is no live offer, when she has already dismissed
 * it, or once it expires while the tab is open.
 */
export default function ConversionOfferCard({ orgId }: { orgId: string | null }) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("current_conversion_offer", { target_org: orgId });
        if (cancelled || error) return;
        const row = data as { active?: boolean; trigger?: Offer["trigger"]; expires_at?: string; coupon_code?: string };
        if (row?.active !== true || !row.expires_at || !row.trigger) return;
        setOffer({ trigger: row.trigger, expiresAt: row.expires_at, couponCode: row.coupon_code ?? null });
      } catch {
        // A commercial card is never worth an error state on the app home.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [offer]);

  const dismiss = useCallback(async () => {
    setOffer(null);
    if (!orgId) return;
    try {
      await createClient().rpc("dismiss_conversion_offer", { target_org: orgId });
    } catch {
      // Closed on screen either way; the worst case is it returns next visit.
    }
  }, [orgId]);

  if (!offer) return null;
  // See the note above: no coupon means nothing expires, so there is nothing
  // honest to count down to.
  if (!offer.couponCode) return null;
  const remaining = remainingParts(offer.expiresAt, now);
  // Expired while she had the tab open: it goes away rather than sitting there
  // with a dead countdown inviting a click that would not honour it.
  if (!remaining) return null;

  const deadline = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(offer.expiresAt),
  );
  // `/assinar` is the offer page, and the middleware turns `?cupom=` on ANY
  // route into the 30-day cookie the checkout reads — so the discount survives
  // the trip through the page and into `/assinatura`.
  const href = `/assinar?cupom=${encodeURIComponent(offer.couponCode)}`;

  return (
    <Card component="section" className="border-primary overflow-hidden border">
      {/* The one deliberately loud surface in the app: a filled band. Everything
          clinical stays quiet, so a commercial moment can be visually distinct
          without competing with a patient's record for attention — and without
          borrowing red, which belongs to risk. */}
      <Box className="bg-primary text-text-contrast flex flex-row items-center gap-3 px-5 py-4">
        <span className="bg-text-contrast/15 flex h-10 w-10 flex-none items-center justify-center rounded-xl">
          <NiTag size="medium" />
        </span>
        <Box className="min-w-0 flex-1">
          <Typography variant="h5" component="h2" className="mb-0 leading-tight">
            {t(
              offer.trigger === "first_consultation"
                ? "conversion-offer-title-first-consultation"
                : "conversion-offer-title-usage",
            )}
          </Typography>
        </Box>
        {/* The number she is deciding against, at the size of the decision. */}
        <Box className="flex-none text-right">
          <Typography variant="h4" component="p" className="mb-0 leading-none">
            {t("conversion-offer-countdown", { hours: remaining.hours, minutes: remaining.minutes })}
          </Typography>
        </Box>
      </Box>

      <CardContent className="flex flex-col gap-3">
        <Typography variant="body2" className="text-text-secondary leading-6">
          {t(
            offer.trigger === "first_consultation"
              ? "conversion-offer-body-first-consultation"
              : "conversion-offer-body-usage",
          )}
        </Typography>

        {/* The honest part: a concrete instant, not just a ticking number. She
            can check it against her own clock. */}
        <Typography variant="body2" className="text-text-secondary">
          {t("conversion-offer-remaining", { hours: remaining.hours, minutes: remaining.minutes, deadline })}
        </Typography>

        <Box className="flex flex-row flex-wrap items-center gap-2">
          <Button variant="contained" size="large" href={href} LinkComponent={Link}>
            {t("conversion-offer-cta")}
          </Button>
          <Button variant="text" color="grey" onClick={() => void dismiss()}>
            {t("conversion-offer-dismiss")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
