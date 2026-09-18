"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { Alert, Box, Button, IconButton } from "@mui/material";

import { DEFAULTS } from "@/config";
import { COOKIE_KEYS, type LocaleOption } from "@/constants";
import { acknowledgeDetectedLocale, setClientLocale } from "@/i18n/locale";
import NiCross from "@/icons/nexture/ni-cross";
import { cn } from "@/lib/utils";

const readCookie = (name: string) =>
  document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/**
 * "We chose this language for you" — the promise the public home already makes
 * (components/marketing/home-language-notice.tsx), carried to the two surfaces
 * a professional actually arrives at: the sign-in screen and the app.
 *
 * It exists because the switch is automatic (Accept-Language, then IP country —
 * lib/locale-detection.ts) and a silent one is how somebody whose browser is set
 * to a language she does not read ends up in a chart she cannot navigate, with
 * no visible cause. The strip states the reason and offers Portuguese in one
 * click. It renders in the DETECTED language, the only one the reader here is
 * assumed to understand.
 *
 * The flag is read from the cookie instead of being passed down: both layouts
 * that mount this are client components, and the middleware writes it
 * non-httpOnly for exactly this reason. Reading it after mount keeps the server
 * and client renders identical.
 */
export default function LocaleAutoNotice({ className }: { className?: string }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [visible, setVisible] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const detected = readCookie(COOKIE_KEYS.localeAuto);
    // The same rule resolveRequestLocale applies: the flag counts only while it
    // names the language actually being read, and nobody is "switched" into the
    // language she would have been served anyway.
    setVisible(detected === locale && locale !== DEFAULTS.locale);
  }, [locale]);

  if (!visible) return null;

  // Both actions hide the strip immediately. Acknowledging only deletes a
  // cookie, which does not change the locale this component keys on — waiting
  // for the server round trip would leave a dismissed notice on screen.
  const keepLanguage = () => {
    setVisible(false);
    startTransition(() => {
      acknowledgeDetectedLocale();
    });
  };

  const switchToDefault = () => {
    setVisible(false);
    startTransition(() => {
      setClientLocale(DEFAULTS.locale as LocaleOption);
    });
  };

  return (
    <Box className={cn("mb-5", className)}>
      <Alert
        severity="info"
        aria-live="polite"
        action={
          <Box className="flex flex-row items-center gap-1">
            <Button color="inherit" size="small" onClick={switchToDefault} disabled={isPending}>
              {/* Named in the reader's language, but spoken as Portuguese. */}
              <span lang={DEFAULTS.locale}>{t("locale-auto-switch")}</span>
            </Button>
            <IconButton
              size="small"
              color="inherit"
              aria-label={t("locale-auto-dismiss")}
              onClick={keepLanguage}
              disabled={isPending}
            >
              <NiCross size="small" />
            </IconButton>
          </Box>
        }
      >
        {t("locale-auto-message")}
      </Alert>
    </Box>
  );
}
