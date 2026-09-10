"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { Box, Button, Card, Slide, Typography } from "@mui/material";

import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import { ANALYTICS_ENABLED, getStoredConsent, optOutOfAnalytics, storeConsent } from "@/lib/analytics";

/**
 * Cookie NOTICE (opt-out). Analytics loads by default on the marketing site
 * (see `marketing-trackers.tsx`); this banner informs and lets the visitor opt
 * out. Renders only when a tracker is configured AND the visitor has not yet
 * answered for the current CONSENT_VERSION. "Entendi" acknowledges (tracking
 * stays on); "Recusar análises" opts out (sets the cookie + disables the SDKs).
 *
 * Not a modal on purpose: it must not trap focus or block the page.
 *
 * **Its footprint is a conversion decision, not a styling one.** As a tall
 * card with stacked buttons it covered the price and the primary CTA of
 * `/fundadores` on a 375px screen, and the CTA on a 1440px one — and a first
 * visit is exactly what every campaign link produces. So it is a slim bar: one
 * sentence, buttons inline beside the text from `sm` up, pinned to the bottom
 * edge. Both actions are real `<button>` elements; the acknowledge action used
 * to be an `<a>` with no `href`, which kept it out of the tab order entirely.
 */
export default function CookieConsent() {
  const t = useTranslations("marketing");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return;
    // Show until the visitor has acknowledged/opted out for this version.
    if (!getStoredConsent()) setOpen(true);
  }, []);

  if (!ANALYTICS_ENABLED || !open) return null;

  const acknowledge = () => {
    storeConsent(true);
    setOpen(false);
  };

  const optOut = () => {
    storeConsent(false);
    optOutOfAnalytics();
    setOpen(false);
  };

  return (
    <Slide direction="up" in={open}>
      <Card
        component="section"
        aria-label={t("cookie-consent-title")}
        className="shadow-darker-sm! fixed right-3 bottom-3 left-3 z-50 flex flex-col gap-2.5 p-3 sm:right-5 sm:bottom-5 sm:left-auto sm:max-w-2xl sm:flex-row sm:items-center sm:gap-5 sm:p-5"
      >
        <Box className="flex items-start gap-3">
          <Box className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <NiShieldCheck size="small" />
          </Box>
          <Box className="flex flex-col gap-0.5">
            <Typography variant="subtitle2" component="h2">
              {t("cookie-consent-title")}
            </Typography>
            <Typography variant="caption" className="text-text-secondary leading-snug">
              {t("cookie-consent-description")}{" "}
              <Link href="/legal/privacidade" className="text-primary underline">
                {t("cookie-consent-privacy")}
              </Link>
            </Typography>
          </Box>
        </Box>
        <Box className="flex shrink-0 gap-2">
          <Button
            variant="contained"
            size="small"
            className="flex-1 whitespace-nowrap sm:flex-none"
            onClick={acknowledge}
          >
            {t("cookie-consent-accept")}
          </Button>
          <Button
            variant="outlined"
            color="grey"
            size="small"
            className="flex-1 whitespace-nowrap sm:flex-none"
            onClick={optOut}
          >
            {t("cookie-consent-reject")}
          </Button>
        </Box>
      </Card>
    </Slide>
  );
}
