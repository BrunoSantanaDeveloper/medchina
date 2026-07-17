"use client";

import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiDuplicate from "@/icons/nexture/ni-duplicate";
import NiPhone from "@/icons/nexture/ni-phone";
import NiRefresh from "@/icons/nexture/ni-refresh";

type DialogState = "idle" | "creating" | "waiting" | "completed" | "expired" | "error";
type SessionStatus = "pending" | "completed" | "expired" | "cancelled" | "invalidated";

type Session = {
  id: string;
  expiresAt: string;
  url: string;
  qrDataUrl: string;
};

type CreateResponse = {
  ok?: boolean;
  sessionId?: string;
  token?: string;
  expiresAt?: string;
  code?: string;
  error?: { code?: string };
};

type StatusResponse = {
  ok?: boolean;
  status?: SessionStatus;
  expiresAt?: string;
  code?: string;
  error?: { code?: string };
};

type ConsentCollectionDialogProps = {
  open: boolean;
  patientId: string;
  patientName?: string | null;
  consultationId?: string | null;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
};

const responseCode = (body: { code?: string; error?: { code?: string } }) => body.code ?? body.error?.code;

const formatCountdown = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/**
 * Keeps consent collection inside the clinical task. The raw bearer token is
 * returned once, rendered only in a URL fragment and never sent in a GET URL.
 */
export default function ConsentCollectionDialog({
  open,
  patientId,
  patientName,
  consultationId,
  onClose,
  onCompleted,
}: ConsentCollectionDialogProps) {
  const t = useTranslations("product");
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [state, setState] = useState<DialogState>("idle");
  const [session, setSession] = useState<Session | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [errorKey, setErrorKey] = useState("consent-qr-create-error");
  const requestGeneration = useRef(0);
  const createInFlight = useRef(false);
  const completedSession = useRef<string | null>(null);

  const cancelSession = useCallback(
    async (target: Session | null) => {
      if (!target) return;
      await fetch(`/api/patients/${patientId}/consent-sessions/${target.id}`, {
        method: "DELETE",
      }).catch(() => undefined);
    },
    [patientId],
  );

  const createSession = useCallback(async () => {
    if (createInFlight.current) return;
    createInFlight.current = true;
    const generation = ++requestGeneration.current;
    setState("creating");
    setCopied(false);
    setCopyFailed(false);
    setErrorKey("consent-qr-create-error");

    try {
      const response = await fetch(`/api/patients/${patientId}/consent-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(consultationId ? { consultationId } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as CreateResponse;
      if (generation !== requestGeneration.current) return;

      if (!response.ok || !body.ok || !body.sessionId || !body.token || !body.expiresAt) {
        setErrorKey(responseCode(body) === "consent_term_missing" ? "consent-term-missing" : "consent-qr-create-error");
        setState("error");
        return;
      }

      const url = `${window.location.origin}/consentir#t=${encodeURIComponent(body.token)}`;
      const qrDataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 280,
      });
      if (generation !== requestGeneration.current) return;

      setSession({ id: body.sessionId, expiresAt: body.expiresAt, url, qrDataUrl });
      setNow(Date.now());
      setState("waiting");
    } catch {
      if (generation === requestGeneration.current) {
        setErrorKey("consent-qr-create-error");
        setState("error");
      }
    } finally {
      if (generation === requestGeneration.current) createInFlight.current = false;
    }
  }, [consultationId, patientId]);

  useEffect(() => {
    if (!open) {
      requestGeneration.current += 1;
      createInFlight.current = false;
      completedSession.current = null;
      setSession(null);
      setState("idle");
      setCopied(false);
      setCopyFailed(false);
      return;
    }
    if (state === "idle") void createSession();
  }, [createSession, open, state]);

  useEffect(() => {
    if (!open || state !== "waiting" || !session) return;

    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= new Date(session.expiresAt).getTime()) setState("expired");
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [open, session, state]);

  useEffect(() => {
    if (!open || state !== "waiting" || !session) return;
    let active = true;

    const poll = async () => {
      if (!active || document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/patients/${patientId}/consent-sessions/${session.id}`, {
          method: "GET",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as StatusResponse;
        if (!active) return;

        if (!response.ok || !body.ok) {
          if (responseCode(body) === "consent_session_expired") setState("expired");
          return;
        }
        if (body.status === "completed") {
          setState("completed");
          if (completedSession.current !== session.id) {
            completedSession.current = session.id;
            await onCompleted();
          }
        } else if (body.status === "expired" || body.status === "cancelled" || body.status === "invalidated") {
          setState("expired");
        }
      } catch {
        // A transient polling failure must not invalidate a still-usable QR.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onCompleted, open, patientId, session, state]);

  const remaining = useMemo(
    () => (session ? Math.max(0, new Date(session.expiresAt).getTime() - now) : 0),
    [now, session],
  );

  const copyLink = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      const input = document.createElement("textarea");
      input.value = session.url;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copiedFallback = document.execCommand("copy");
      input.remove();
      setCopied(copiedFallback);
      setCopyFailed(!copiedFallback);
    }
  };

  const regenerate = async () => {
    const previous = session;
    requestGeneration.current += 1;
    createInFlight.current = false;
    setSession(null);
    setState("idle");
    await cancelSession(previous);
  };

  const close = () => {
    requestGeneration.current += 1;
    if (state !== "completed") void cancelSession(session);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={state === "creating" ? undefined : close}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      aria-labelledby="consent-qr-dialog-title"
      aria-describedby="consent-qr-dialog-description"
    >
      <DialogTitle id="consent-qr-dialog-title" className="flex items-center gap-2">
        <NiPhone className="text-primary" aria-hidden />
        {t("consent-qr-dialog-title")}
      </DialogTitle>
      <DialogContent className="flex flex-col gap-4">
        <Typography id="consent-qr-dialog-description" variant="body2" className="text-text-secondary leading-6">
          {t("consent-qr-dialog-description", { patient: patientName ?? t("consent-qr-patient-fallback") })}
        </Typography>

        <Box role="status" aria-live="polite" aria-atomic="true" className="flex flex-col gap-4">
          {state === "creating" && (
            <Box className="flex flex-col gap-2 py-6">
              <Typography variant="body2">{t("consent-qr-creating")}</Typography>
              <LinearProgress aria-label={t("consent-qr-creating")} />
            </Box>
          )}

          {state === "waiting" && session && (
            <>
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("consent-qr-waiting")}
              </Alert>
              <Box className="flex flex-col items-center gap-3">
                {/* A real image is intentional here: camera readers need exact, unscaled QR pixels. */}
                {}
                <img
                  src={session.qrDataUrl}
                  alt={t("consent-qr-image-alt")}
                  width={280}
                  height={280}
                  className="border-grey-100 bg-background-paper h-auto w-full max-w-70 rounded-2xl border p-2"
                />
                <Typography variant="body2" className="text-text-secondary text-center">
                  {t("consent-qr-expires-in", { time: formatCountdown(remaining) })}
                </Typography>
              </Box>
              <Box className="border-grey-100 bg-background-default flex min-w-0 items-center gap-2 rounded-2xl border p-3">
                <Typography variant="body2" className="text-text-secondary min-w-0 flex-1 truncate">
                  {session.url}
                </Typography>
                <Button
                  variant="outlined"
                  color="grey"
                  onClick={copyLink}
                  startIcon={copied ? <NiCheck aria-hidden /> : <NiDuplicate aria-hidden />}
                  className="min-h-11 shrink-0"
                >
                  {t(copied ? "consent-qr-copied" : "consent-qr-copy")}
                </Button>
              </Box>
              {copyFailed && (
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t("consent-qr-copy-error")}
                </Alert>
              )}
            </>
          )}

          {state === "completed" && (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {t("consent-qr-completed")}
            </Alert>
          )}

          {state === "expired" && (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("consent-qr-expired")}
            </Alert>
          )}

          {state === "error" && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(errorKey)}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions className="flex-wrap">
        <Button color="grey" variant="text" onClick={close} className="min-h-11">
          {t(state === "completed" ? "close" : "cancel")}
        </Button>
        {(state === "expired" || state === "error") && (
          <Button
            variant="contained"
            color="primary"
            onClick={regenerate}
            startIcon={<NiRefresh aria-hidden />}
            className="min-h-11"
          >
            {t("consent-qr-regenerate")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
