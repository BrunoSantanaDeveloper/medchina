"use client";

import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogContent,
  Typography,
} from "@mui/material";

import ConsultationStepHeader from "@/components/product/consultation-step-header";
import DialogHeader from "@/components/product/dialog-header";
import InfoHint from "@/components/product/info-hint";
import NiPhone from "@/icons/nexture/ni-phone";

/**
 * "Gravar pelo celular" — a QR the professional shows in the room. Scanning it
 * opens the capture-only web page (`/gravar`) authorized by a short-lived
 * bearer token; the phone records audio with no login and no app install.
 *
 * The token is minted only when she opens the dialog (never on page load), is
 * scoped to THIS consultation and audio only, and expires in 15 minutes. The
 * raw token stays in the URL fragment of the QR — this component holds it only
 * long enough to render the code.
 */
export default function MobileCaptureHandoff({ consultationId }: { consultationId: string }) {
  const t = useTranslations("product");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    setQrDataUrl(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/capture-link`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        url?: string;
        expiresAt?: string;
      };
      if (!response.ok || !body.ok || !body.url) {
        setErrorKey(
          body.code === "audio_consent_required"
            ? "capture-qr-consent-error"
            : body.code === "consultation_finalized"
              ? "capture-qr-finalized-error"
              : "capture-qr-error",
        );
        return;
      }
      // The raw token lives only inside this data URL, never in app state or logs.
      const dataUrl = await QRCode.toDataURL(body.url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
      setQrDataUrl(dataUrl);
      setExpiresAt(body.expiresAt ?? null);
    } catch {
      setErrorKey("capture-qr-error");
    } finally {
      setLoading(false);
    }
  }, [consultationId]);

  // Revoke the link when the dialog closes, so a scanned-but-unused QR cannot
  // linger as a valid credential.
  const revoke = useCallback(() => {
    void fetch(`/api/consultations/${consultationId}/capture-link`, { method: "DELETE" }).catch(() => undefined);
  }, [consultationId]);

  useEffect(() => {
    if (open) void generate();
  }, [open, generate]);

  const close = () => {
    setOpen(false);
    setQrDataUrl(null);
    setExpiresAt(null);
    revoke();
  };

  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <ConsultationStepHeader
          step={1}
          icon={<NiPhone size="medium" />}
          title={t("capture-qr-title")}
          hint={t("capture-qr-hint")}
          trailing={<InfoHint label={t("capture-qr-note")} className="ml-auto" />}
        />
        <Button
          variant="outlined"
          color="primary"
          fullWidth
          startIcon={<NiPhone size="tiny" />}
          onClick={() => setOpen(true)}
        >
          {t("capture-qr-open")}
        </Button>
      </CardContent>

      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogHeader title={t("capture-qr-dialog-title")} closeLabel={t("close")} onClose={close} />
        <DialogContent className="flex flex-col items-center gap-3 py-5!">
          <Typography variant="body2" className="text-text-secondary self-stretch leading-6">
            {t("capture-qr-dialog-body")}
          </Typography>

          {loading && <CircularProgress aria-label={t("loading")} className="my-6" />}

          {errorKey && (
            <Alert
              severity="error"
              className="self-stretch"
              action={<Button onClick={() => void generate()}>{t("retry")}</Button>}
            >
              {t(errorKey)}
            </Alert>
          )}

          {qrDataUrl && (
            <>
              <Box className="border-grey-100 rounded-3xl border bg-white p-3">
                {/* A data-URI QR — next/image adds nothing over a plain <img> here. */}
                <img src={qrDataUrl} alt={t("capture-qr-alt")} width={240} height={240} className="block h-60 w-60" />
              </Box>
              {expiresLabel && (
                <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                  {t("capture-qr-expires", { time: expiresLabel })}
                </Typography>
              )}
              <Typography variant="body2" className="text-text-secondary self-stretch text-xs leading-5">
                {t("capture-qr-dialog-hint")}
              </Typography>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
