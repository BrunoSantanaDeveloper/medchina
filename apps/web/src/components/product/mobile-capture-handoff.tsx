"use client";

import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import InfoHint from "@/components/product/info-hint";
import NiAi from "@/icons/nexture/ni-ai";
import NiPhone from "@/icons/nexture/ni-phone";
import { getProductAction } from "@/lib/product-actions";
import { trackCommercialEvent } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { createClient } from "@flyee/auth/client";

type CaptureMode = "ai" | "audio_only";

// A capture the workspace cannot afford is answered by a plan, not a retry.
type CommercialBlock = "trial" | "exhausted";

const BILLING_HREF = `${getProductAction("billing").href}?source=capture_qr&feature=audio`;

type LiveStatus =
  | { kind: "none" }
  | { kind: "waiting"; expiresAt: string }
  | { kind: "recording"; startedAt: string | null }
  | { kind: "uploading" }
  | { kind: "delivered"; mode: CaptureMode }
  | { kind: "processing_failed" }
  | { kind: "failed" };

/**
 * "Gravar pelo celular" — a QR the professional shows in the room. Scanning it
 * opens the capture-only web page (`/gravar`) authorized by a short-lived
 * bearer token; the phone records audio with no login and no app install.
 * With the patient's ai-processing consent the link can carry mode 'ai', so
 * the phone on the table becomes the microphone of the automatic anamnesis.
 *
 * The token is minted only when she opens the dialog (never on page load), is
 * scoped to THIS consultation, and expires in 15 minutes. The raw token stays
 * in the URL fragment of the QR — this component holds it only long enough to
 * render the code (and to copy the link on request).
 *
 * Closing the dialog NEVER revokes the link: the professional must get back to
 * the chart while the phone keeps recording (a revoke here once made in-flight
 * audio irrecoverable). The link simply expires; the live status below the
 * button keeps her informed without reopening the dialog.
 *
 * Renders CHROME-LESS (no Card, no step badge) — it is an alternate METHOD
 * for the recording step, so it mounts inside ConsultationRecorder's card via
 * its `secondaryCapture` slot.
 */
export default function MobileCaptureHandoff({ consultationId }: { consultationId: string }) {
  const t = useTranslations("product");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Every QR capture feeds the AI (there is no "record just to store audio"
  // outcome — the manual anamnesis is the non-AI path), so there is no mode to
  // choose. `commercialBlock` is set when the block is a plan/minutes one,
  // which is answered by upgrading, not by retrying.
  const [commercialBlock, setCommercialBlock] = useState<CommercialBlock | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState(false);
  const [status, setStatus] = useState<LiveStatus>({ kind: "none" });
  const [elapsed, setElapsed] = useState<string | null>(null);
  const watchSession = useRef(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    setCommercialBlock(null);
    setQrDataUrl(null);
    setLinkUrl(null);
    setCopied(false);
    setInProgress(false);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/capture-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "ai" }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        url?: string;
        expiresAt?: string;
      };
      if (!response.ok || !body.ok || !body.url) {
        if (body.code === "capture_in_progress") {
          // The phone is mid-capture on an earlier link — show its progress
          // instead of killing it with a new credential.
          setInProgress(true);
          watchSession.current = true;
          return;
        }
        // A plan/minutes block is a commercial moment, not an error: it gets
        // a CTA, not a "try again".
        if (body.code === "trial_not_started") {
          setCommercialBlock("trial");
          trackCommercialEvent("upgrade.prompt_viewed", "consultation", "audio");
          return;
        }
        if (body.code === "audio_allowance_exhausted") {
          setCommercialBlock("exhausted");
          trackCommercialEvent("upgrade.prompt_viewed", "consultation", "audio");
          return;
        }
        setErrorKey(
          body.code === "audio_consent_required"
            ? "capture-qr-consent-error"
            : body.code === "ai_consent_required"
              ? "capture-qr-ai-consent-error"
              : body.code === "consultation_finalized"
                ? "capture-qr-finalized-error"
                : "capture-qr-error",
        );
        return;
      }
      // The raw token lives only inside this data URL (and the copy action),
      // never in app state beyond this dialog or in logs.
      const dataUrl = await QRCode.toDataURL(body.url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
      setQrDataUrl(dataUrl);
      setLinkUrl(body.url);
      setExpiresAt(body.expiresAt ?? null);
      watchSession.current = true;
    } catch {
      setErrorKey("capture-qr-error");
    } finally {
      setLoading(false);
    }
  }, [consultationId]);

  useEffect(() => {
    if (open) void generate();
  }, [open, generate]);

  // Live status of the phone's session: the professional generated a bearer
  // credential and deserves to see what it is doing — connected, recording,
  // uploading, delivered — without keeping a modal in front of the chart.
  const refreshStatus = useCallback(async () => {
    const supabase = createClient();
    const { data: session } = await supabase
      .from("capture_link_sessions")
      .select("id, mode, expires_at, recording_id")
      .eq("consultation_id", consultationId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!session) {
      setStatus((current) => (current.kind === "delivered" || current.kind === "failed" ? current : { kind: "none" }));
      if (!open) watchSession.current = false;
      return;
    }
    if (!session.recording_id) {
      setStatus({ kind: "waiting", expiresAt: session.expires_at });
      return;
    }
    const { data: recording } = await supabase
      .from("recordings")
      .select("status, capture_started_at, audio_path")
      .eq("id", session.recording_id)
      .maybeSingle();
    const recordingStatus = recording?.status ?? null;
    if (recordingStatus === "recording") {
      setStatus({ kind: "recording", startedAt: recording?.capture_started_at ?? null });
    } else if (recordingStatus === "local" || recordingStatus === "uploading") {
      setStatus({ kind: "uploading" });
    } else if (recordingStatus === "uploaded" || recordingStatus === "processing" || recordingStatus === "ready") {
      setStatus({ kind: "delivered", mode: (session.mode as CaptureMode) ?? "audio_only" });
    } else if (recordingStatus === "failed") {
      // The SEND only failed if nothing reached storage. With an audio_path the
      // audio arrived and the failure is in PROCESSING — reprocessed from the
      // computer (Gravações), not "send again on the phone".
      setStatus(recording?.audio_path ? { kind: "processing_failed" } : { kind: "failed" });
    } else {
      setStatus({ kind: "waiting", expiresAt: session.expires_at });
    }
  }, [consultationId, open]);

  useEffect(() => {
    // One check on mount picks up a session from an earlier dialog (page
    // reload, second tab); then poll while there is something to watch.
    void refreshStatus();
    const interval = window.setInterval(() => {
      if (watchSession.current || open) void refreshStatus();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [open, refreshStatus]);

  // The "recording for mm:ss" readout, derived from the wall clock.
  useEffect(() => {
    if (status.kind !== "recording" || !status.startedAt) {
      setElapsed(null);
      return;
    }
    const startedAt = new Date(status.startedAt).getTime();
    const tick = () => {
      const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setElapsed(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [status]);

  const close = () => {
    // Deliberately no revoke: the phone may be recording (or about to). The
    // link expires on its own; the inline status keeps her informed.
    setOpen(false);
    setQrDataUrl(null);
    setLinkUrl(null);
    setCopied(false);
  };

  const copyLink = async () => {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 4000);
    } catch {
      // Clipboard denied — the QR remains the path.
    }
  };

  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : null;

  const statusLabel =
    status.kind === "waiting"
      ? t("capture-qr-status-waiting")
      : status.kind === "recording"
        ? t("capture-qr-status-recording", { time: elapsed ?? "00:00" })
        : status.kind === "uploading"
          ? t("capture-qr-status-uploading")
          : status.kind === "delivered"
            ? status.mode === "ai"
              ? t("capture-qr-status-delivered-ai")
              : t("capture-qr-status-delivered")
            : status.kind === "processing_failed"
              ? t("capture-qr-status-processing-failed")
              : status.kind === "failed"
                ? t("capture-qr-status-failed")
                : null;

  return (
    <>
      <Box className="border-grey-100 flex flex-col gap-1.5 border-t pt-3">
        <Box className="flex flex-row items-center gap-1.5">
          <NiPhone size="small" className="text-text-secondary" aria-hidden />
          <Typography variant="body2" className="text-text-primary font-medium">
            {t("capture-qr-title")}
          </Typography>
          <InfoHint label={t("capture-qr-note")} className="ml-auto" />
        </Box>
        {statusLabel && (
          <Box className="flex flex-row items-center gap-2" role="status" aria-live="polite">
            <span
              aria-hidden
              className={cn(
                "h-2 w-2 flex-none rounded-full",
                status.kind === "recording"
                  ? "bg-accent-3 animate-pulse"
                  : status.kind === "failed"
                    ? "bg-error"
                    : status.kind === "processing_failed"
                      ? "bg-accent-3"
                      : status.kind === "delivered"
                        ? "bg-success"
                        : "bg-grey-500",
              )}
            />
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {statusLabel}
            </Typography>
          </Box>
        )}
        <Button
          variant="outlined"
          color="primary"
          size="small"
          fullWidth
          startIcon={<NiPhone size="tiny" />}
          onClick={() => setOpen(true)}
        >
          {t("capture-qr-open")}
        </Button>
      </Box>

      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogHeader title={t("capture-qr-dialog-title")} closeLabel={t("close")} onClose={close} />
        <DialogContent className="flex flex-col items-center gap-3 py-5!">
          <Typography variant="body2" className="text-text-secondary self-stretch leading-6">
            {t("capture-qr-dialog-body")}
          </Typography>

          {loading && <CircularProgress aria-label={t("loading")} className="my-6" />}

          {inProgress && (
            <Alert severity="info" className="self-stretch">
              {t("capture-qr-in-progress")}
            </Alert>
          )}

          {/* A plan/minutes block is a moment to SELL the outcome, not an error
              to retry: name what she gets, then the one action that unlocks it.
              Never red — a commercial limit is not a clinical failure. */}
          {commercialBlock && (
            <Box className="border-primary/20 bg-primary/5 flex flex-col items-center gap-2 self-stretch rounded-2xl border p-4 text-center">
              <span
                aria-hidden
                className="bg-primary/12 text-primary flex h-11 w-11 items-center justify-center rounded-2xl [&_svg]:h-6 [&_svg]:w-6"
              >
                <NiAi size="medium" />
              </span>
              <Typography variant="subtitle1" className="text-text-primary">
                {t("capture-qr-upgrade-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {commercialBlock === "trial" ? t("capture-qr-upgrade-trial") : t("capture-qr-upgrade-exhausted")}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                href={BILLING_HREF}
                className="mt-1"
                onClick={() => trackCommercialEvent("upgrade.prompt_clicked", "consultation", "audio")}
              >
                {commercialBlock === "trial" ? t("capture-qr-upgrade-trial-cta") : t("capture-qr-upgrade-cta")}
              </Button>
            </Box>
          )}

          {errorKey && (
            <Alert
              severity="error"
              className="self-stretch"
              action={<Button onClick={() => void generate()}>{t("retry")}</Button>}
            >
              {t(errorKey)}
            </Alert>
          )}

          {statusLabel && (qrDataUrl || inProgress) && (
            <Alert severity={status.kind === "failed" ? "error" : "info"} className="self-stretch" icon={false}>
              {statusLabel}
            </Alert>
          )}

          {qrDataUrl && (
            <>
              <Box className="border-grey-100 rounded-3xl border bg-white p-3">
                {/* A data-URI QR — next/image adds nothing over a plain <img> here. */}
                <img src={qrDataUrl} alt={t("capture-qr-alt")} width={240} height={240} className="block h-60 w-60" />
              </Box>
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("capture-qr-mode-ai")}
              </Typography>
              <Button variant="outlined" color="grey" size="small" fullWidth onClick={() => void copyLink()}>
                {copied ? t("capture-qr-copied") : t("capture-qr-copy")}
              </Button>
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
    </>
  );
}
