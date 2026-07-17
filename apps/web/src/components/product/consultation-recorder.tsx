"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import { type PersistedWebRecording, useRecordingSession } from "@/components/product/recording-session-provider";
import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import { trialDaysLeft } from "@/lib/audio-allowance";
import { recordAudit } from "@/lib/audit";
import { getProductAction } from "@/lib/product-actions";
import { cn } from "@/lib/utils";
import { clearWebRecordingRequest, getOrCreateWebRecordingRequest } from "@/lib/web-recording-request";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Phase = "idle" | "recording" | "paused" | "uploading" | "processing" | "ready" | "error";
type ConsentState = { audio: boolean; ai: boolean };
type RecordingMode = "ai" | "audio_only";

const responseCode = (body: unknown): string | undefined => {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  return error && typeof error === "object" ? String((error as { code?: unknown }).code ?? "") : undefined;
};

const bestMime = () => {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "";
};

const sha256 = async (blob: Blob) => {
  if (!crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const MAX_DURATION_SECONDS = 120 * 60;
const MAX_SIZE_BYTES = 512 * 1024 * 1024;
const BILLING_HREF = getProductAction("billing").href;

/** Recoverable, consented browser capture backed by the recording state RPCs. */
export default function ConsultationRecorder({
  orgId,
  patientId,
  consultationId,
  audioConsent,
  aiConsent,
  onRequestConsent,
  onChanged,
}: {
  orgId: string;
  patientId: string;
  consultationId: string;
  audioConsent?: boolean;
  aiConsent?: boolean;
  onRequestConsent?: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("product");
  const {
    setActive: setSessionActive,
    persist: persistSession,
    recover: recoverSession,
    remove: removeSession,
    uploadTus,
  } = useRecordingSession();
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [nearSizeLimit, setNearSizeLimit] = useState(false);
  const [captureLimit, setCaptureLimit] = useState<"duration" | "size" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mode, setMode] = useState<RecordingMode>("ai");
  const { allowance, trialParams, loading: allowanceLoading, reload: reloadAllowance } = useAudioAllowance(orgId);
  const [trialDialog, setTrialDialog] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const bytesRef = useRef(0);
  const recordingId = useRef<string | null>(null);
  const recordingMode = useRef<RecordingMode>("ai");
  const clientUploadId = useRef<string | null>(null);
  const pendingBlob = useRef<{ blob: Blob; duration: number; mime: string } | null>(null);

  const pollUntilSettled = useCallback(
    async (id: string) => {
      setPhase("processing");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const { data } = await createClient().from("recordings").select("status,error_code").eq("id", id).maybeSingle();
        if (data?.status === "ready") {
          setPhase("ready");
          onChanged?.();
          return;
        }
        if (data?.status === "failed") {
          setError(t("recorder-processing-error"));
          setPhase("error");
          onChanged?.();
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      }
      setError(t("recorder-processing-later"));
      setPhase("processing");
    },
    [onChanged, t],
  );

  const requestProcessing = useCallback(
    async (id: string) => {
      setPhase("processing");
      const response = await fetch(`/api/recordings/${id}/process`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = responseCode(body);
        if (!code || !["processing_already_claimed"].includes(code)) throw new Error(code ?? "processing_failed");
      }
      await pollUntilSettled(id);
    },
    [pollUntilSettled],
  );

  useEffect(() => {
    let current = true;
    void recoverSession(consultationId).then(async (recovered) => {
      if (!current || !recovered) return;
      const { data } = await createClient()
        .from("recordings")
        .select("status, mode")
        .eq("id", recovered.recordingId)
        .maybeSingle();
      if (!current) return;
      const recoveredMode = data?.mode === "audio_only" || recovered.mode === "audio_only" ? "audio_only" : "ai";
      recordingMode.current = recoveredMode;
      setMode(recoveredMode);
      recordingId.current = recovered.recordingId;
      if (data?.status === "ready") {
        await removeSession(recovered.recordingId);
        setPhase("ready");
        return;
      }
      if (data?.status === "uploaded" || data?.status === "processing") {
        await removeSession(recovered.recordingId);
        if (recoveredMode === "audio_only") {
          setPhase("ready");
          return;
        }
        void requestProcessing(recovered.recordingId).catch(() => {
          setError(t("recorder-processing-error"));
          setPhase("error");
        });
        return;
      }
      pendingBlob.current = { blob: recovered.blob, duration: recovered.duration, mime: recovered.mime };
      setError(t("recorder-recovered"));
      setPhase("error");
    });
    return () => {
      current = false;
    };
  }, [consultationId, recoverSession, removeSession, requestProcessing, t]);

  useEffect(() => {
    if (audioConsent !== undefined && aiConsent !== undefined) {
      setConsents({ audio: audioConsent, ai: aiConsent });
      return;
    }
    const check = async () => {
      if (!isSupabaseConfigured) {
        setConsents({ audio: false, ai: false });
        return;
      }
      const supabase = createClient();
      const [{ data: audio }, { data: ai }] = await Promise.all([
        supabase.rpc("has_active_consent", {
          target_org: orgId,
          target_patient: patientId,
          term_slug: "audio-recording",
        }),
        supabase.rpc("has_active_consent", {
          target_org: orgId,
          target_patient: patientId,
          term_slug: "ai-processing",
        }),
      ]);
      setConsents({ audio: Boolean(audio), ai: Boolean(ai) });
    };
    void check();
  }, [aiConsent, audioConsent, orgId, patientId]);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const releaseStream = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(
    () => () => {
      stopTimer();
      releaseStream();
      setSessionActive(false);
    },
    [setSessionActive],
  );

  const setRecordingState = useCallback(async (id: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/recordings/${id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseCode(result) ?? "recording_invalid_state");
    return result;
  }, []);

  const upload = useCallback(
    async (blob: Blob, duration: number, mime: string) => {
      const id = recordingId.current;
      if (!id) return;
      pendingBlob.current = { blob, duration, mime };
      setPhase("uploading");
      setUploadProgress(0);
      setError(null);
      let uploadConfirmed = false;
      try {
        const checksum = await sha256(blob);
        if (!checksum) throw new Error("checksum_unavailable");
        const persistedRecording: PersistedWebRecording = {
          recordingId: id,
          consultationId,
          orgId,
          duration,
          mime,
          checksumSha256: checksum,
          createdAt: new Date().toISOString(),
          mode: recordingMode.current,
          blob,
        };
        await persistSession(persistedRecording);
        clearWebRecordingRequest(window.sessionStorage, consultationId);
        clientUploadId.current = null;
        await setRecordingState(id, {
          action: "local",
          durationSeconds: duration,
          sizeBytes: blob.size,
          mime,
          checksumSha256: checksum,
        });
        await setRecordingState(id, { action: "uploading" });

        const extension = mime.includes("mp4") ? "m4a" : "webm";
        const path = `${orgId}/${id}.${extension}`;
        const supabase = createClient();
        await uploadTus(persistedRecording, path, setUploadProgress);

        await setRecordingState(id, { action: "uploaded", audioPath: path });
        uploadConfirmed = true;
        await recordAudit(supabase, "recording.uploaded", {
          orgId,
          entityType: "recording",
          entityId: id,
          metadata: { consultationId, durationSeconds: duration },
        });
        pendingBlob.current = null;
        await removeSession(id);
        onChanged?.();
        if (recordingMode.current === "ai") {
          try {
            await requestProcessing(id);
          } catch {
            setError(t("recorder-processing-error"));
            setPhase("error");
          }
        } else {
          setPhase("ready");
        }
      } catch {
        if (!uploadConfirmed) {
          await setRecordingState(id, {
            action: "failed",
            failureStage: "upload",
            errorCode: "storage_upload_failed",
          }).catch(() => undefined);
        }
        setError(uploadConfirmed ? t("recorder-processing-error") : t("recorder-error"));
        setPhase("error");
        onChanged?.();
      }
    },
    [
      consultationId,
      onChanged,
      orgId,
      persistSession,
      removeSession,
      requestProcessing,
      setRecordingState,
      t,
      uploadTus,
    ],
  );

  const start = async (startTrial = false) => {
    setError(null);
    setNearSizeLimit(false);
    setCaptureLimit(null);
    const uploadId =
      clientUploadId.current ??
      getOrCreateWebRecordingRequest(window.sessionStorage, consultationId, () => crypto.randomUUID());
    clientUploadId.current = uploadId;

    let startedRecordingId: string;
    try {
      const beginResponse = await fetch(`/api/consultations/${consultationId}/recordings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          clientUploadId: uploadId,
          startTrial: mode === "ai" && startTrial,
          capturedOn: "web",
        }),
      });
      const beginBody = await beginResponse.json().catch(() => ({}));
      if (!beginResponse.ok) {
        const code = responseCode(beginBody);
        if (code === "consent_required" || code === "audio_consent_required" || code === "ai_consent_required") {
          onRequestConsent?.();
        }
        setError(
          code === "audio_allowance_exhausted"
            ? t("recorder-limit-body")
            : code === "trial_not_started"
              ? t("recorder-trial-body", trialParams)
              : code === "recording_already_open"
                ? t("recorder-open-recording")
                : t("recorder-error"),
        );
        setPhase("error");
        void reloadAllowance();
        clearWebRecordingRequest(window.sessionStorage, consultationId);
        clientUploadId.current = null;
        return;
      }
      if (typeof beginBody.recordingId !== "string" || !beginBody.recordingId) {
        throw new Error("invalid_begin_response");
      }
      startedRecordingId = beginBody.recordingId;
    } catch {
      // Ambiguous network/response failures retain the exact idempotency key.
      // A retry can recover a server commit whose response never arrived.
      setError(t("recorder-error"));
      setPhase("error");
      return;
    }

    recordingId.current = startedRecordingId;
    recordingMode.current = mode;
    onChanged?.();

    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      chunks.current = [];
      bytesRef.current = 0;
      const mime = bestMime();
      const recorder = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
          bytesRef.current += event.data.size;
          if (bytesRef.current >= MAX_SIZE_BYTES * 0.9) setNearSizeLimit(true);
          if (bytesRef.current >= MAX_SIZE_BYTES) {
            setCaptureLimit("size");
            stopTimer();
            recorder.stop();
          }
        }
      };
      recorder.onstop = () => {
        releaseStream();
        setSessionActive(false);
        const effectiveMime = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type: effectiveMime });
        void upload(blob, secondsRef.current, effectiveMime);
      };
      mediaRecorder.current = recorder;
      recorder.start(1000);
      secondsRef.current = 0;
      setSeconds(0);
      setPhase("recording");
      setSessionActive(true);
      timer.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
        if (secondsRef.current >= MAX_DURATION_SECONDS && mediaRecorder.current?.state !== "inactive") {
          setCaptureLimit("duration");
          stopTimer();
          mediaRecorder.current?.stop();
        }
      }, 1000);
    } catch {
      releaseStream();
      setSessionActive(false);
      let cancelled = false;
      if (recordingId.current) {
        try {
          await setRecordingState(recordingId.current, {
            action: "cancel",
            errorCode: "microphone_unavailable",
          });
          cancelled = true;
        } catch {
          // Keep the request id: the cancellation response may have been lost.
        }
      }
      if (cancelled) {
        clearWebRecordingRequest(window.sessionStorage, consultationId);
        clientUploadId.current = null;
      }
      recordingId.current = null;
      setError(t("recorder-mic-denied"));
      setPhase("error");
      onChanged?.();
    }
  };

  const pause = () => {
    mediaRecorder.current?.pause();
    stopTimer();
    setPhase("paused");
  };
  const resume = () => {
    mediaRecorder.current?.resume();
    timer.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    setPhase("recording");
  };
  const finish = () => {
    stopTimer();
    setSessionActive(false);
    mediaRecorder.current?.stop();
  };
  const retryUpload = () => {
    const pending = pendingBlob.current;
    if (pending) void upload(pending.blob, pending.duration, pending.mime);
  };
  const confirmTrial = async () => {
    setStartingTrial(true);
    setTrialDialog(false);
    await start(true);
    setStartingTrial(false);
    void reloadAllowance();
  };

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (consents === null || allowanceLoading) return null;

  const capturing = phase === "recording" || phase === "paused" || phase === "uploading" || phase === "processing";
  const needsTrial = mode === "ai" && !capturing && allowance?.trialAvailable === true && !allowance.canStart;
  const exhausted =
    mode === "ai" && !capturing && allowance !== null && !allowance.canStart && !allowance.trialAvailable;
  const overrunning =
    mode === "ai" &&
    phase === "recording" &&
    allowance !== null &&
    allowance.minutesLimit > 0 &&
    seconds > allowance.minutesRemaining * 60;
  const nearingCaptureLimit = phase === "recording" && (seconds >= MAX_DURATION_SECONDS - 10 * 60 || nearSizeLimit);
  const hasRequiredConsent = consents.audio && (mode === "audio_only" || consents.ai);
  const modeLocked = capturing || Boolean(pendingBlob.current) || Boolean(clientUploadId.current);

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <NiMicrophone size="medium" className="text-primary" />
          <Typography variant="h6" component="h2">
            {t("recorder-title")}
          </Typography>
        </Box>

        <Box className="flex flex-col gap-1.5">
          <Typography variant="body2" className="text-text-secondary font-medium">
            {t("capture-mode-title")}
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={mode}
            onChange={(_, value: RecordingMode | null) => {
              if (!value || modeLocked) return;
              setMode(value);
              setError(null);
            }}
            disabled={modeLocked}
            aria-label={t("capture-mode-title")}
          >
            <ToggleButton value="ai">{t("capture-mode-ai")}</ToggleButton>
            <ToggleButton value="audio_only">{t("capture-mode-audio")}</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="body2" className="text-text-secondary text-xs leading-5">
            {mode === "ai" ? t("capture-mode-ai-hint") : t("capture-mode-audio-hint")}
          </Typography>
        </Box>

        {!hasRequiredConsent ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {consents.audio ? t("recorder-no-ai-consent") : t("recorder-no-consent")}
            </Typography>
            <Button variant="outlined" color="primary" onClick={onRequestConsent} className="self-start">
              {t("recorder-grant-consent")}
            </Button>
          </>
        ) : needsTrial ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("recorder-trial-body", trialParams)}
            </Typography>
            <Button variant="contained" color="primary" onClick={() => setTrialDialog(true)} className="self-start">
              {t("recorder-trial-start")}
            </Button>
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("recorder-trial-note")}
            </Typography>
          </>
        ) : exhausted ? (
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {allowance?.suspended ? t("recorder-suspended-body") : t("recorder-limit-body")}
            </Typography>
            {!allowance?.suspended && (
              <Button variant="contained" color="primary" href={BILLING_HREF} className="self-start">
                {t("recorder-limit-cta")}
              </Button>
            )}
          </>
        ) : (
          <>
            {(phase === "recording" || phase === "paused") && (
              <Box
                className={cn(
                  "flex flex-row items-center gap-2 rounded-2xl px-3 py-2.5",
                  phase === "recording" ? "bg-accent-3/12" : "bg-grey-100",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2.5 w-2.5 flex-none rounded-full",
                    phase === "recording" ? "bg-accent-3 animate-pulse" : "bg-grey-500",
                  )}
                />
                <Typography variant="body2" className="font-semibold">
                  {phase === "recording" ? t("recorder-recording") : t("recorder-paused")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary ml-auto font-mono tabular-nums">
                  {mmss}
                </Typography>
              </Box>
            )}

            {overrunning && <Alert severity="info">{t("recorder-overrun")}</Alert>}
            {nearingCaptureLimit && <Alert severity="info">{t("recorder-capture-limit-warning")}</Alert>}
            {captureLimit && (
              <Alert severity="info">
                {captureLimit === "duration" ? t("recorder-capture-limit-duration") : t("recorder-capture-limit-size")}
              </Alert>
            )}
            {phase === "uploading" && (
              <Box className="flex flex-col gap-2">
                <Typography variant="body2" className="text-text-secondary">
                  {t("recorder-uploading")}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={Math.round(uploadProgress * 100)}
                  aria-label={t("recorder-uploading")}
                />
              </Box>
            )}
            {phase === "processing" && (
              <Box className="flex flex-col gap-2" role="status" aria-live="polite">
                <Typography variant="body2" className="text-text-secondary">
                  {t("recorder-processing")}
                </Typography>
                <LinearProgress />
              </Box>
            )}
            {phase === "ready" && (
              <Alert severity="success" icon={<NiCheckSquare />}>
                {mode === "ai" ? t("recorder-ready") : t("recorder-audio-ready")}
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}

            <Box className="flex flex-row flex-wrap gap-2">
              {phase === "idle" && (
                <Button variant="contained" color="primary" onClick={() => void start()}>
                  {t("recorder-start")}
                </Button>
              )}
              {phase === "error" && pendingBlob.current && (
                <Button variant="contained" color="primary" onClick={retryUpload}>
                  {t("recorder-retry-upload")}
                </Button>
              )}
              {phase === "error" && !pendingBlob.current && (
                <Button variant="contained" color="primary" onClick={() => void start()}>
                  {t("recorder-start")}
                </Button>
              )}
              {phase === "ready" && (
                <Button variant="outlined" color="primary" onClick={() => void start()}>
                  {t("recorder-record-again")}
                </Button>
              )}
              {phase === "recording" && (
                <>
                  <Button variant="outlined" color="grey" onClick={pause}>
                    {t("recorder-pause")}
                  </Button>
                  <Button variant="contained" color="primary" onClick={finish}>
                    {t("recorder-finish")}
                  </Button>
                </>
              )}
              {phase === "paused" && (
                <>
                  <Button variant="outlined" color="grey" onClick={resume}>
                    {t("recorder-resume")}
                  </Button>
                  <Button variant="contained" color="primary" onClick={finish}>
                    {t("recorder-finish")}
                  </Button>
                </>
              )}
            </Box>

            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("recorder-note")}
            </Typography>
            {mode === "ai" && allowance && allowance.minutesLimit > 0 && (
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {allowance.source === "trial"
                  ? t("recorder-trial-remaining", {
                      minutes: allowance.minutesRemaining,
                      days: trialDaysLeft(allowance) ?? 0,
                    })
                  : t("recorder-remaining", { minutes: allowance.minutesRemaining })}
              </Typography>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={trialDialog} onClose={() => setTrialDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("recorder-trial-title")}</DialogTitle>
        <DialogContent className="flex flex-col gap-2">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("recorder-trial-explain", trialParams)}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("recorder-trial-note")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setTrialDialog(false)} disabled={startingTrial}>
            {t("recorder-trial-cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={() => void confirmTrial()} disabled={startingTrial}>
            {t("recorder-trial-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
