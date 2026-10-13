"use client";

import type { SignupWhatsAppStatus } from "./actions";
import Link from "next/link";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { type ReactNode, useEffect, useState } from "react";

import { Alert, AlertTitle, Box, Button, CircularProgress, Typography } from "@mui/material";

import { BRAND } from "@/brand";
import NiArrowLeft from "@/icons/nexture/ni-arrow-left";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { whatsappDeepLink } from "@/lib/whatsapp-link";

export type WhatsAppConfirmationProps = {
  code: string;
  /** The platform's WhatsApp number, digits with the country code. */
  number: string;
  status: SignupWhatsAppStatus;
  /** Why she is being asked. Defaults to the sign-up's wording. */
  intro?: string;
  /** What follows the confirmation is in progress (the account being created, or the app opening). */
  creating: boolean;
  /** Said while `creating`. Defaults to "creating your account". */
  creatingLabel?: string;
  /** Creating the account failed after the confirmation — retrying is safe. */
  createFailed?: boolean;
  onRetryCreate?: () => void;
  /** Said when the number already belongs to another account. Defaults to the sign-up's wording. */
  phoneTakenText?: string;
  /**
   * Sign-in link that keeps her `next` — the way out when her number already
   * has an account. Without it (she is already signed in), the way out is a
   * new code, sent from another number.
   */
  signInHref?: string;
  onNewCode: () => void;
  /** Back to the form. Absent where there is no form behind this screen. */
  onBack?: () => void;
  footer?: ReactNode;
};

/**
 * She sends a code from her own WhatsApp, and the screen moves on the moment it
 * arrives (migration 0122). Two places show it: the sign-up, where the account
 * is only created once the message lands, and /auth/whatsapp, where an account
 * that came from a campaign confirms after paying.
 *
 * The button opens WhatsApp with the message already written — on a phone that
 * is one tap and "send". On a computer the same link becomes a QR code for the
 * phone's camera, because that is where her WhatsApp is. The screen never asks
 * her to come back and press anything: it notices on its own.
 */
export default function WhatsAppConfirmation({
  code,
  number,
  status,
  intro,
  creating,
  creatingLabel,
  createFailed = false,
  onRetryCreate,
  phoneTakenText,
  signInHref,
  onNewCode,
  onBack,
  footer,
}: WhatsAppConfirmationProps) {
  const t = useTranslations("auth");
  const link = whatsappDeepLink(number, t("signup-whatsapp-message", { brand: BRAND.name, code }));
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!link) return;
    QRCode.toDataURL(link, { margin: 1, width: 220, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      // Without the picture the button still works; the QR is a convenience.
      .catch(() => setQr(null));
    return () => {
      cancelled = true;
    };
  }, [link]);

  const waiting = status.status === "pending" || status.status === "retry";
  const over = status.status === "expired" || status.status === "unknown";

  return (
    <Box className="flex flex-col gap-8">
      <Box className="flex flex-col">
        <Typography variant="h1" component="h1" className="mb-2">
          {t("signup-whatsapp-title")}
        </Typography>
        <Typography variant="body1" className="text-text-primary">
          {intro ?? t("signup-whatsapp-body", { brand: BRAND.name })}
        </Typography>
      </Box>

      {waiting && (
        <Box className="flex flex-col gap-5">
          <Box className="flex flex-col items-center gap-1">
            <Typography variant="body2" className="text-text-secondary">
              {t("signup-whatsapp-code-label")}
            </Typography>
            <Typography
              variant="h3"
              component="p"
              className="font-semibold tracking-[0.3em]"
              aria-label={code.split("").join(" ")}
            >
              {code}
            </Typography>
          </Box>

          {link ? (
            <Button
              variant="contained"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<NiMessageDots size="medium" />}
            >
              {t("signup-whatsapp-open")}
            </Button>
          ) : (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t("signup-whatsapp-unavailable")}
            </Alert>
          )}

          {qr && (
            <Box className="hidden flex-col items-center gap-2 md:flex">
              <img src={qr} alt={t("signup-whatsapp-qr-alt")} width={180} height={180} className="rounded-lg" />
              <Typography variant="body2" className="text-text-secondary max-w-xs text-center">
                {t("signup-whatsapp-qr-hint")}
              </Typography>
            </Box>
          )}

          <Box className="flex items-center justify-center gap-2" role="status" aria-live="polite">
            <CircularProgress size={16} aria-hidden />
            <Typography variant="body2" className="text-text-secondary">
              {t("signup-whatsapp-waiting")}
            </Typography>
          </Box>
        </Box>
      )}

      {status.status === "confirmed" && (
        <Box role="status" aria-live="polite" className="flex flex-col gap-3">
          {createFailed ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              <AlertTitle variant="subtitle2">{t("signup-failed")}</AlertTitle>
              <Typography variant="body2" className="text-text-primary">
                {t("signup-whatsapp-create-failed")}
              </Typography>
            </Alert>
          ) : (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {t("signup-whatsapp-confirmed", { phone: status.phoneHint ?? "" })}
            </Alert>
          )}
          {createFailed ? (
            <Button variant="contained" onClick={onRetryCreate} startIcon={<NiRefresh size="medium" />}>
              {t("signup-whatsapp-retry")}
            </Button>
          ) : (
            creating && (
              <Box className="flex items-center justify-center gap-2">
                <CircularProgress size={16} aria-hidden />
                <Typography variant="body2" className="text-text-secondary">
                  {creatingLabel ?? t("signup-whatsapp-creating")}
                </Typography>
              </Box>
            )
          )}
        </Box>
      )}

      {status.status === "phone_taken" && (
        <Box role="status" aria-live="polite" className="flex flex-col gap-3">
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {phoneTakenText ?? t("signup-whatsapp-phone-taken", { brand: BRAND.name })}
          </Alert>
          {signInHref ? (
            <Button variant="contained" href={signInHref} LinkComponent={Link}>
              {t("signup-whatsapp-sign-in")}
            </Button>
          ) : (
            <Button variant="contained" onClick={onNewCode} startIcon={<NiRefresh size="medium" />}>
              {t("signup-whatsapp-new-code")}
            </Button>
          )}
        </Box>
      )}

      {over && (
        <Box role="status" aria-live="polite" className="flex flex-col gap-3">
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("signup-whatsapp-expired")}
          </Alert>
          <Button variant="contained" onClick={onNewCode} startIcon={<NiRefresh size="medium" />}>
            {t("signup-whatsapp-new-code")}
          </Button>
        </Box>
      )}

      {!creating && onBack && (
        <Button variant="text" color="grey" onClick={onBack} startIcon={<NiArrowLeft size="medium" />}>
          {t("signup-whatsapp-back")}
        </Button>
      )}
      {!creating && footer}
    </Box>
  );
}
