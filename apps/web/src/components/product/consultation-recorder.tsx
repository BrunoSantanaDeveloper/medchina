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
  Skeleton,
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
import {
  clearTabAlert,
  markTabAlert,
  notificationPermission,
  notifyCaptureFailure,
  requestNotificationPermission,
} from "@/lib/capture-alert";
import { getProductAction } from "@/lib/product-actions";
import { cn } from "@/lib/utils";
import { clearWebRecordingRequest, getOrCreateWebRecordingRequest } from "@/lib/web-recording-request";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Phase = "idle" | "recording" | "paused" | "uploading" | "processing" | "ready" | "error";
type ConsentState = { audio: boolean; ai: boolean };
type RecordingMode = "ai" | "audio_only";
/** A server-side capture left open with no local audio to recover from. */
type OrphanRecording = { id: string; status: string; createdAt: string };

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
  const [micPrimer, setMicPrimer] = useState<{ startTrial: boolean } | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);
  const [orphan, setOrphan] = useState<OrphanRecording | null>(null);
  const [discardingOrphan, setDiscardingOrphan] = useState(false);
  const [level, setLevel] = useState(0);
  /** Silence watchdog: the mic is open but nothing is reaching it. */
  const [silent, setSilent] = useState(false);

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
  // Elapsed time is derived from the wall clock, never from accumulated ticks:
  // a background tab throttles setInterval and would under-report the duration.
  const startedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const pausedAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const loudAtRef = useRef(0);

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
      if (!current) return;

      // No audio preserved locally. A row still OPEN on the server is then a
      // capture that died mid-flight (a reload, a closed tab, a refused
      // microphone). Nothing can be recovered from it, and while it stands the
      // server refuses every new capture — so it must be surfaced with a way
      // out instead of leaving the consultation permanently unable to record.
      if (!recovered) {
        const { data: open } = await createClient()
          .from("recordings")
          .select("id, status, created_at")
          .eq("consultation_id", consultationId)
          .in("status", ["recording", "local", "uploading"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!current || !open) return;
        setOrphan({ id: open.id as string, status: open.status as string, createdAt: open.created_at as string });
        return;
      }

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

  /**
   * Asks for notification permission only AFTER a capture succeeded — the
   * moment the value is proven and the ask makes sense. On page load it would
   * be reflexively dismissed, and a denied permission never prompts again.
   * Notifications are the channel that reaches her when her attention is on
   * the patient; they stay silent (there is a patient in the room).
   */
  useEffect(() => {
    if (phase !== "ready" || notificationPermission() !== "default") return;
    void requestNotificationPermission();
  }, [phase]);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const stopLevelMeter = useCallback(() => {
    if (levelFrameRef.current !== null) cancelAnimationFrame(levelFrameRef.current);
    levelFrameRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setLevel(0);
    setSilent(false);
  }, []);
  const releaseStream = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  /**
   * Live input level. This is the only honest proof that sound is reaching the
   * microphone — a running timer proves a timer runs, not that the consultation
   * is being captured. Doubles as a silence watchdog.
   */
  const startLevelMeter = useCallback((media: MediaStream) => {
    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      const context = new AudioContextCtor();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(media).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      loudAtRef.current = Date.now();
      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
        const normalized = Math.min(1, peak / 96);
        setLevel(normalized);
        if (normalized > 0.06) loudAtRef.current = Date.now();
        // A whole minute without any signal is a broken microphone, not a pause
        // in the conversation.
        setSilent(Date.now() - loudAtRef.current > 60_000);
        levelFrameRef.current = requestAnimationFrame(tick);
      };
      levelFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // A missing/blocked AudioContext must never prevent the capture itself.
      audioContextRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopTimer();
      stopLevelMeter();
      releaseStream();
      setSessionActive(false);
      clearTabAlert(document);
    },
    [releaseStream, setSessionActive, stopLevelMeter],
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

  /** Frees a dead capture so this consultation can be recorded again. */
  const discardOrphan = async () => {
    if (!orphan || discardingOrphan) return;
    setDiscardingOrphan(true);
    try {
      await setRecordingState(orphan.id, { action: "cancel", errorCode: "abandoned_capture" });
      setOrphan(null);
      setError(null);
      setPhase("idle");
      clearWebRecordingRequest(window.sessionStorage, consultationId);
      clientUploadId.current = null;
      onChanged?.();
    } catch {
      setError(t("recorder-orphan-discard-error"));
    } finally {
      setDiscardingOrphan(false);
    }
  };

  /**
   * The capture stopped without her asking — the microphone was unplugged, a
   * Bluetooth headset dropped, or the OS revoked the device. Her attention is
   * on the patient, so this must reach her OUTSIDE this tab.
   */
  const handleCaptureLoss = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
      // Flush whatever was captured; onstop uploads it so nothing is lost.
      mediaRecorder.current.stop();
    }
    stopTimer();
    stopLevelMeter();
    setSessionActive(false);
    setError(t("recorder-device-lost"));
    markTabAlert(document, t("recorder-alert-tab"));
    notifyCaptureFailure(t("recorder-alert-title"), t("recorder-alert-body"));
  }, [setSessionActive, stopLevelMeter, t]);

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
        // The audio is safe locally, but she must learn the send failed even if
        // she already moved on to the next patient.
        markTabAlert(document, t("recorder-alert-tab"));
        notifyCaptureFailure(t("recorder-alert-title"), t("recorder-alert-upload-body"));
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

  /**
   * Opens the microphone BEFORE any server state exists. Ordering matters: a
   * refused permission used to leave an open `recordings` row behind, and that
   * row made every later capture fail with `recording_already_open` — a
   * consultation permanently unable to record. No device, no row.
   */
  const start = async (startTrial = false) => {
    setError(null);
    setMicBlocked(false);
    setNearSizeLimit(false);
    setCaptureLimit(null);
    clearTabAlert(document);

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      // A hard block never prompts again — that needs address-bar instructions,
      // not a generic "check your browser".
      const denied =
        cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setMicBlocked(denied);
      setError(denied ? t("recorder-mic-blocked") : t("recorder-mic-unavailable"));
      setPhase("error");
      return;
    }

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
        if (code === "recording_already_open" && typeof beginBody?.recordingId === "string") {
          // Surface the blocker WITH its way out instead of a dead-end message.
          setOrphan({ id: beginBody.recordingId, status: "recording", createdAt: new Date().toISOString() });
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
        media.getTracks().forEach((track) => track.stop());
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
      media.getTracks().forEach((track) => track.stop());
      setError(t("recorder-error"));
      setPhase("error");
      return;
    }

    recordingId.current = startedRecordingId;
    recordingMode.current = mode;
    onChanged?.();

    try {
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
        stopLevelMeter();
        releaseStream();
        setSessionActive(false);
        const effectiveMime = recorder.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks.current, { type: effectiveMime });
        void upload(blob, secondsRef.current, effectiveMime);
      };
      // The device disappearing mid-session (unplugged, Bluetooth dropped, OS
      // revoked) is the silent failure this product cannot afford.
      media.getAudioTracks().forEach((track) => {
        track.onended = handleCaptureLoss;
        track.onmute = handleCaptureLoss;
      });
      mediaRecorder.current = recorder;
      recorder.start(1000);
      startedAtRef.current = Date.now();
      pausedTotalRef.current = 0;
      pausedAtRef.current = 0;
      secondsRef.current = 0;
      setSeconds(0);
      setPhase("recording");
      setSessionActive(true);
      startLevelMeter(media);
      timer.current = setInterval(() => {
        secondsRef.current = Math.floor((Date.now() - startedAtRef.current - pausedTotalRef.current) / 1000);
        setSeconds(secondsRef.current);
        if (secondsRef.current >= MAX_DURATION_SECONDS && mediaRecorder.current?.state !== "inactive") {
          setCaptureLimit("duration");
          stopTimer();
          mediaRecorder.current?.stop();
        }
      }, 1000);
    } catch {
      stopLevelMeter();
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
      setError(t("recorder-mic-unavailable"));
      setPhase("error");
      onChanged?.();
    }
  };

  /**
   * Explains what is about to happen before the browser's own prompt appears.
   * A bare permission dialog with no context is reflexively dismissed — and a
   * hard "Block" is unrecoverable without address-bar surgery.
   */
  const requestStart = async (startTrial = false) => {
    setError(null);
    if (typeof navigator.permissions?.query === "function") {
      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (status.state === "granted") {
          await start(startTrial);
          return;
        }
      } catch {
        // Firefox/Safari may not know this descriptor — fall through to the primer.
      }
    }
    setMicPrimer({ startTrial });
  };

  const pause = () => {
    mediaRecorder.current?.pause();
    stopTimer();
    pausedAtRef.current = Date.now();
    setPhase("paused");
  };
  const resume = () => {
    mediaRecorder.current?.resume();
    // Paused time is excluded from the elapsed clock, so the timer keeps
    // matching the audio that actually exists.
    if (pausedAtRef.current) pausedTotalRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = 0;
    loudAtRef.current = Date.now();
    timer.current = setInterval(() => {
      secondsRef.current = Math.floor((Date.now() - startedAtRef.current - pausedTotalRef.current) / 1000);
      setSeconds(secondsRef.current);
    }, 1000);
    setPhase("recording");
  };
  const finish = () => {
    stopTimer();
    setSessionActive(false);
    clearTabAlert(document);
    mediaRecorder.current?.stop();
  };
  const retryUpload = () => {
    const pending = pendingBlob.current;
    if (pending) void upload(pending.blob, pending.duration, pending.mime);
  };
  const confirmTrial = async () => {
    setStartingTrial(true);
    setTrialDialog(false);
    await requestStart(true);
    setStartingTrial(false);
    void reloadAllowance();
  };

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  // Reserve the space instead of vanishing: on a slow connection an absent card
  // reads as "recording is not available here".
  if (consents === null || allowanceLoading) {
    return (
      <Card component="section" aria-label={t("recorder-title")} aria-busy>
        <CardContent className="flex flex-col gap-3">
          <Skeleton variant="text" width={160} height={28} />
          <Skeleton variant="rounded" height={40} className="rounded-2xl" />
          <Skeleton variant="rounded" height={72} className="rounded-2xl" />
        </CardContent>
      </Card>
    );
  }

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
    <>
      <Card component="section">
        <CardContent className="flex flex-col gap-3">
          <Box className="flex flex-row items-center gap-2">
            <NiMicrophone size="medium" className="text-primary" />
            <Typography variant="h6" component="h2">
              {t("recorder-title")}
            </Typography>
          </Box>

          {/* A capture left open by a reload or a refused microphone blocks every
            new one at the server. Never a dead end: state it and offer the exit. */}
          {orphan && (
            <Alert severity="warning" className="neutral bg-background-paper/60! flex flex-col gap-2">
              <Typography variant="body2" className="font-semibold">
                {t("recorder-orphan-title")}
              </Typography>
              <Typography variant="body2" className="text-xs leading-5">
                {t("recorder-orphan-body", { time: new Date(orphan.createdAt).toLocaleTimeString() })}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                size="small"
                className="self-start"
                disabled={discardingOrphan}
                onClick={() => void discardOrphan()}
              >
                {discardingOrphan ? t("saving") : t("recorder-orphan-discard")}
              </Button>
            </Alert>
          )}

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
                    "flex flex-col gap-2 rounded-2xl px-3 py-2.5",
                    phase === "recording" ? "bg-accent-3/12" : "bg-grey-100",
                  )}
                  role="status"
                  aria-live="polite"
                >
                  <Box className="flex flex-row items-center gap-2">
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
                  {/* The level is the only honest proof that sound is arriving —
                    a running clock proves nothing about the microphone. */}
                  {phase === "recording" && (
                    <Box
                      className="bg-grey-100 h-1.5 w-full overflow-hidden rounded-full"
                      role="meter"
                      aria-label={t("recorder-level-label")}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(level * 100)}
                    >
                      <Box
                        className={cn(
                          "h-full rounded-full transition-all duration-100",
                          silent ? "bg-accent-3" : "bg-primary",
                        )}
                        style={{ width: `${Math.max(2, Math.round(level * 100))}%` }}
                      />
                    </Box>
                  )}
                  {phase === "recording" && silent && (
                    <Typography
                      variant="body2"
                      className="text-accent-3-dark dark:text-accent-3-light text-xs leading-5"
                    >
                      {t("recorder-silence-warning")}
                    </Typography>
                  )}
                </Box>
              )}

              {overrunning && <Alert severity="info">{t("recorder-overrun")}</Alert>}
              {nearingCaptureLimit && <Alert severity="info">{t("recorder-capture-limit-warning")}</Alert>}
              {captureLimit && (
                <Alert severity="info">
                  {captureLimit === "duration"
                    ? t("recorder-capture-limit-duration")
                    : t("recorder-capture-limit-size")}
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
              {error && (
                <Alert severity="error">
                  {error}
                  {/* A hard block never prompts again: say exactly where to undo it. */}
                  {micBlocked && (
                    <Typography variant="body2" className="mt-1 text-xs leading-5">
                      {t("recorder-mic-blocked-help")}
                    </Typography>
                  )}
                </Alert>
              )}

              <Box className="flex flex-row flex-wrap gap-2">
                {phase === "idle" && (
                  <Button
                    variant="contained"
                    color="primary"
                    disabled={Boolean(orphan)}
                    onClick={() => void requestStart()}
                  >
                    {t("recorder-start")}
                  </Button>
                )}
                {phase === "error" && pendingBlob.current && (
                  <Button variant="contained" color="primary" onClick={retryUpload}>
                    {t("recorder-retry-upload")}
                  </Button>
                )}
                {phase === "error" && !pendingBlob.current && (
                  <Button
                    variant="contained"
                    color="primary"
                    disabled={Boolean(orphan)}
                    onClick={() => void requestStart()}
                  >
                    {t("recorder-start")}
                  </Button>
                )}
                {phase === "ready" && (
                  <Button
                    variant="outlined"
                    color="primary"
                    disabled={Boolean(orphan)}
                    onClick={() => void requestStart()}
                  >
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

        {/* Context before the browser's own prompt. A bare permission dialog with
          no explanation is reflexively dismissed — and a hard block cannot be
          undone from inside the page. */}
        <Dialog open={micPrimer !== null} onClose={() => setMicPrimer(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{t("recorder-mic-primer-title")}</DialogTitle>
          <DialogContent className="flex flex-col gap-2">
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("recorder-mic-primer-body")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("recorder-mic-primer-note")}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button color="grey" onClick={() => setMicPrimer(null)}>
              {t("recorder-mic-primer-cancel")}
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={() => {
                const pending = micPrimer;
                setMicPrimer(null);
                void start(pending?.startTrial ?? false);
              }}
            >
              {t("recorder-mic-primer-confirm")}
            </Button>
          </DialogActions>
        </Dialog>
      </Card>

      {/* Capture state follows her down the page. The sidebar card scrolls away
        during a 50-minute session, and losing sight of "am I recording?" is
        exactly how a consultation goes unrecorded. */}
      {(phase === "recording" || phase === "paused") && (
        <Box
          className="bg-background-paper border-grey-100 fixed inset-x-3 bottom-3 z-50 flex flex-row flex-wrap items-center gap-3 rounded-2xl border px-4 py-2.5 shadow-lg sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-auto"
          role="status"
          aria-live="polite"
          aria-label={t("recorder-floating-label")}
        >
          <span
            aria-hidden
            className={cn(
              "h-2.5 w-2.5 flex-none rounded-full",
              phase === "recording" ? (silent ? "bg-accent-3" : "bg-accent-3 animate-pulse") : "bg-grey-500",
            )}
          />
          <Typography variant="body2" className="font-semibold">
            {phase === "recording" ? t("recorder-recording") : t("recorder-paused")}
          </Typography>
          <Typography variant="body2" className="font-mono tabular-nums">
            {mmss}
          </Typography>
          {phase === "recording" && (
            <Box className="bg-grey-100 h-1.5 w-16 overflow-hidden rounded-full" aria-hidden>
              <Box
                className={cn("h-full rounded-full transition-all duration-100", silent ? "bg-accent-3" : "bg-primary")}
                style={{ width: `${Math.max(2, Math.round(level * 100))}%` }}
              />
            </Box>
          )}
          <Box className="flex flex-row gap-1">
            <Button variant="text" color="grey" size="small" onClick={phase === "recording" ? pause : resume}>
              {phase === "recording" ? t("recorder-pause") : t("recorder-resume")}
            </Button>
            <Button variant="contained" color="primary" size="small" onClick={finish}>
              {t("recorder-finish")}
            </Button>
          </Box>
        </Box>
      )}
    </>
  );
}
