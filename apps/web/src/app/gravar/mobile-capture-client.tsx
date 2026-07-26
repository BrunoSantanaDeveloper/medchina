"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, LinearProgress, Typography } from "@mui/material";

import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPause from "@/icons/nexture/ni-pause";
import NiSquare from "@/icons/nexture/ni-square";
import { isCaptureLinkToken } from "@/lib/capture-link-token";
import { cn } from "@/lib/utils";
import { createClient } from "@flyee/auth/client";

type Phase = "loading" | "invalid" | "blocked" | "idle" | "recording" | "paused" | "uploading" | "done" | "error";
type Resolved = {
  patientFirstName: string | null;
  consultationEditable: boolean;
  audioConsent: boolean;
  recordingStatus: string | null;
};

const MAX_DURATION_SECONDS = 120 * 60;
const BUCKET = "transcriptions";

const bestMime = () => {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((mime) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) ?? "";
};

/**
 * Audio-only capture over a QR bearer token — no login, no app. Mirrors the
 * essentials of the desktop recorder (mic before server state, wall-clock
 * timer, level meter as honest proof, server-confirmed upload) but talks to
 * the token-scoped public endpoints instead of a Supabase session.
 */
export default function MobileCaptureClient() {
  const t = useTranslations("product");
  const [phase, setPhase] = useState<Phase>("loading");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);

  const token = useRef<string | null>(null);
  const clientUploadId = useRef<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const pausedAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const pendingBlob = useRef<{ blob: Blob; duration: number; mime: string } | null>(null);

  const call = useCallback(async (path: string, payload: Record<string, unknown>) => {
    const response = await fetch(`/api/public/capture/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.current, ...payload }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; [k: string]: unknown };
    return { ok: response.ok && body.ok === true, body };
  }, []);

  const resolve = useCallback(async () => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!isCaptureLinkToken(raw)) {
      setPhase("invalid");
      return;
    }
    token.current = raw;
    const { ok, body } = await call("resolve", {});
    if (!ok) {
      setPhase("invalid");
      return;
    }
    const context: Resolved = {
      patientFirstName: (body.patientFirstName as string | null) ?? null,
      consultationEditable: body.consultationEditable === true,
      audioConsent: body.audioConsent === true,
      recordingStatus: (body.recordingStatus as string | null) ?? null,
    };
    setResolved(context);
    if (!context.consultationEditable || !context.audioConsent) {
      setPhase("blocked");
      return;
    }
    // A capture already delivered on this consultation shows as done rather
    // than inviting a second one.
    if (context.recordingStatus === "ready") setPhase("done");
    else setPhase("idle");
  }, [call]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const stopTimers = () => {
    if (timer.current) clearInterval(timer.current);
    if (heartbeat.current) clearInterval(heartbeat.current);
    timer.current = null;
    heartbeat.current = null;
  };
  const stopLevelMeter = useCallback(() => {
    if (levelFrameRef.current !== null) cancelAnimationFrame(levelFrameRef.current);
    levelFrameRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setLevel(0);
  }, []);
  const releaseStream = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(
    () => () => {
      stopTimers();
      stopLevelMeter();
      releaseStream();
    },
    [releaseStream, stopLevelMeter],
  );

  const startLevelMeter = useCallback((media: MediaStream) => {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const context = new Ctor();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(media).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
        setLevel(Math.min(1, peak / 96));
        levelFrameRef.current = requestAnimationFrame(tick);
      };
      levelFrameRef.current = requestAnimationFrame(tick);
    } catch {
      audioContextRef.current = null;
    }
  }, []);

  const upload = useCallback(
    async (blob: Blob, duration: number, mime: string) => {
      pendingBlob.current = { blob, duration, mime };
      setPhase("uploading");
      setUploadProgress(0);
      setErrorKey(null);
      try {
        const durationSeconds = blob.size > 0 ? Math.max(1, duration) : duration;
        const local = await call("state", { action: "local", durationSeconds, sizeBytes: blob.size, mime });
        if (!local.ok) throw new Error(String(local.body.code ?? "state_failed"));
        const urlResult = await call("upload-url", { mime });
        if (!urlResult.ok || typeof urlResult.body.path !== "string" || typeof urlResult.body.token !== "string") {
          throw new Error(String(urlResult.body.code ?? "upload_unavailable"));
        }
        const path = urlResult.body.path as string;
        await call("state", { action: "uploading" });

        const { error: uploadError } = await createClient()
          .storage.from(BUCKET)
          .uploadToSignedUrl(path, urlResult.body.token as string, blob, { contentType: mime });
        if (uploadError) throw new Error("storage_upload_failed");
        setUploadProgress(1);

        const confirmed = await call("state", { action: "uploaded", audioPath: path });
        if (!confirmed.ok) throw new Error(String(confirmed.body.code ?? "state_failed"));
        pendingBlob.current = null;
        setPhase("done");
      } catch {
        setErrorKey("capture-mobile-upload-error");
        setPhase("error");
      }
    },
    [call],
  );

  const start = async () => {
    setErrorKey(null);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorKey("capture-mobile-mic-denied");
      setPhase("error");
      return;
    }

    const uploadId = clientUploadId.current ?? crypto.randomUUID();
    clientUploadId.current = uploadId;
    const begun = await call("begin", { clientUploadId: uploadId });
    if (!begun.ok) {
      media.getTracks().forEach((track) => track.stop());
      setErrorKey(begun.body.code === "recording_already_open" ? "capture-mobile-open" : "capture-mobile-error");
      setPhase("error");
      return;
    }

    try {
      stream.current = media;
      chunks.current = [];
      const mime = bestMime();
      const recorder = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onstop = () => {
        stopLevelMeter();
        releaseStream();
        const effectiveMime = recorder.mimeType || mime || "audio/webm";
        void upload(new Blob(chunks.current, { type: effectiveMime }), Math.floor(seconds), effectiveMime);
      };
      mediaRecorder.current = recorder;
      recorder.start(1000);
      startedAtRef.current = Date.now();
      pausedTotalRef.current = 0;
      pausedAtRef.current = 0;
      setSeconds(0);
      setPhase("recording");
      startLevelMeter(media);
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current - pausedTotalRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_DURATION_SECONDS && mediaRecorder.current?.state !== "inactive") {
          stopTimers();
          mediaRecorder.current?.stop();
        }
      }, 1000);
      // Keep the 15-min token alive across a long consultation.
      heartbeat.current = setInterval(() => void call("state", { action: "heartbeat" }), 5 * 60 * 1000);
    } catch {
      releaseStream();
      await call("state", { action: "cancel", errorCode: "microphone_unavailable" });
      setErrorKey("capture-mobile-mic-denied");
      setPhase("error");
    }
  };

  const pause = () => {
    mediaRecorder.current?.pause();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    pausedAtRef.current = Date.now();
    setPhase("paused");
  };
  const resume = () => {
    mediaRecorder.current?.resume();
    if (pausedAtRef.current) pausedTotalRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = 0;
    timer.current = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current - pausedTotalRef.current) / 1000));
    }, 1000);
    setPhase("recording");
  };
  const finish = () => {
    stopTimers();
    mediaRecorder.current?.stop();
  };
  const retryUpload = () => {
    const pending = pendingBlob.current;
    if (pending) void upload(pending.blob, pending.duration, pending.mime);
    else setPhase("idle");
  };

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (phase === "loading") {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10!">
          <CircularProgress aria-label={t("loading")} />
        </CardContent>
      </Card>
    );
  }

  if (phase === "invalid") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 py-7!">
          <Typography variant="h5" component="h1">
            {t("capture-mobile-invalid-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("capture-mobile-invalid-body")}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (phase === "blocked") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 py-7!">
          <Typography variant="h5" component="h1">
            {t("capture-mobile-blocked-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {resolved && !resolved.audioConsent ? t("capture-mobile-no-consent") : t("capture-mobile-not-editable")}
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-6!">
        <Box className="flex flex-col gap-1">
          <Typography variant="h5" component="h1" className="mb-0">
            {t("capture-mobile-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {resolved?.patientFirstName
              ? t("capture-mobile-subtitle-named", { name: resolved.patientFirstName })
              : t("capture-mobile-subtitle")}
          </Typography>
        </Box>

        {phase === "done" ? (
          <>
            <Alert severity="success" icon={<NiCheckSquare />}>
              {t("capture-mobile-done")}
            </Alert>
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("capture-mobile-done-hint")}
            </Typography>
          </>
        ) : (
          <>
            {(phase === "recording" || phase === "paused") && (
              <Box
                className={cn(
                  "flex flex-col gap-3 rounded-2xl px-4 py-4",
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
                  <Typography
                    variant="h5"
                    component="p"
                    className="text-text-primary mb-0 ml-auto font-mono tabular-nums"
                  >
                    {mmss}
                  </Typography>
                </Box>
                {phase === "recording" && (
                  <Box
                    className="bg-grey-100 h-2 w-full overflow-hidden rounded-full"
                    role="meter"
                    aria-label={t("recorder-level-label")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(level * 100)}
                  >
                    <Box
                      className="bg-primary h-full rounded-full transition-all duration-100"
                      style={{ width: `${Math.max(2, Math.round(level * 100))}%` }}
                    />
                  </Box>
                )}
              </Box>
            )}

            {phase === "uploading" && (
              <Box className="flex flex-col gap-2" role="status" aria-live="polite">
                <Typography variant="body2" className="text-text-secondary">
                  {t("recorder-uploading")}
                </Typography>
                <LinearProgress variant="determinate" value={Math.round(uploadProgress * 100)} />
              </Box>
            )}

            {errorKey && <Alert severity="error">{t(errorKey)}</Alert>}

            <Box className="flex flex-col gap-2">
              {phase === "idle" && (
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  color="primary"
                  startIcon={<NiMicrophone size="tiny" />}
                  onClick={() => void start()}
                >
                  {t("recorder-start")}
                </Button>
              )}
              {phase === "error" && (
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  color="primary"
                  startIcon={<NiMicrophone size="tiny" />}
                  onClick={pendingBlob.current ? retryUpload : () => void start()}
                >
                  {pendingBlob.current ? t("recorder-retry-upload") : t("recorder-start")}
                </Button>
              )}
              {phase === "recording" && (
                <Box className="flex flex-row gap-2">
                  <Button
                    variant="outlined"
                    size="large"
                    color="grey"
                    className="flex-1"
                    startIcon={<NiPause size="tiny" />}
                    onClick={pause}
                  >
                    {t("recorder-pause")}
                  </Button>
                  <Button
                    variant="contained"
                    size="large"
                    color="primary"
                    className="flex-1"
                    startIcon={<NiSquare size="tiny" />}
                    onClick={finish}
                  >
                    {t("recorder-finish")}
                  </Button>
                </Box>
              )}
              {phase === "paused" && (
                <Box className="flex flex-row gap-2">
                  <Button
                    variant="outlined"
                    size="large"
                    color="grey"
                    className="flex-1"
                    startIcon={<NiMicrophone size="tiny" />}
                    onClick={resume}
                  >
                    {t("recorder-resume")}
                  </Button>
                  <Button
                    variant="contained"
                    size="large"
                    color="primary"
                    className="flex-1"
                    startIcon={<NiSquare size="tiny" />}
                    onClick={finish}
                  >
                    {t("recorder-finish")}
                  </Button>
                </Box>
              )}
            </Box>

            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("capture-mobile-note")}
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  );
}
