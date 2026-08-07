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
        className="shadow-darker-sm! fixed bottom-5 left-5 z-50 flex max-w-md flex-col gap-4 p-5 max-sm:right-5 max-sm:max-w-none"
      >
        <Box className="flex items-start gap-3">
          <Box className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
            <NiShieldCheck size="medium" />
          </Box>
          <Box className="flex flex-col gap-1">
            <Typography variant="h6" component="h2">
              {t("cookie-consent-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("cookie-consent-description")}{" "}
              <Link href="/legal/privacidade" className="text-primary underline">
                {t("cookie-consent-privacy")}
              </Link>
            </Typography>
          </Box>
        </Box>
        <Box className="flex gap-2 max-sm:flex-col">
          <a className="button button--sm" onClick={acknowledge}>
            {t("cookie-consent-accept")}
          </a>
          <Button variant="outlined" color="grey" className="flex-1" onClick={optOut}>
            {t("cookie-consent-reject")}
          </Button>
        </Box>
      </Card>
    </Slide>
  );
}
