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
  const remaining = remainingParts(offer.expiresAt, now);
  // Expired while she had the tab open: it goes away rather than sitting there
  // with a dead countdown inviting a click that would not honour it.
  if (!remaining) return null;

  const deadline = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(offer.expiresAt),
  );
  const href = offer.couponCode
    ? `/settings/billing?cupom=${encodeURIComponent(offer.couponCode)}`
    : "/settings/billing";

  return (
    <Card component="section" variant="outlined" className="border-primary">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <span className="bg-primary/10 text-primary flex h-9 w-9 flex-none items-center justify-center rounded-xl">
            <NiTag size="medium" />
          </span>
          <Typography variant="h6" component="h2" className="mb-0">
            {t(
              offer.trigger === "first_consultation"
                ? "conversion-offer-title-first-consultation"
                : "conversion-offer-title-usage",
            )}
          </Typography>
        </Box>

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
          <Button variant="contained" href={href} LinkComponent={Link}>
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
