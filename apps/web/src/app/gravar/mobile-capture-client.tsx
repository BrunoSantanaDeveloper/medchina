"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, LinearProgress, Typography } from "@mui/material";

import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPause from "@/icons/nexture/ni-pause";
import NiSquare from "@/icons/nexture/ni-square";
import { isCaptureLinkToken } from "@/lib/capture-link-token";
import {
  appendCaptureChunk,
  beginCaptureStore,
  clearCapture,
  recoverCapture,
  requestPersistentStorage,
} from "@/lib/mobile-capture-store";
import { cn } from "@/lib/utils";

type Phase =
  | "loading"
  | "invalid"
  | "network"
  | "blocked"
  | "idle"
  | "recovered"
  | "recording"
  | "paused"
  | "uploading"
  | "done"
  | "error";
type Resolved = {
  patientFirstName: string | null;
  consultationEditable: boolean;
  audioConsent: boolean;
  mode: "ai" | "audio_only";
  recordingStatus: string | null;
};

const MAX_DURATION_SECONDS = 120 * 60;
const BUCKET = "transcriptions";
// Speech needs little: 32 kbps mono opus keeps an hour near ~14 MB, which
// protects the upload on clinic wifi AND the transcription provider limits.
const AUDIO_BITS_PER_SECOND = 32_000;
const SILENCE_WARNING_MS = 60_000;

const bestMime = () => {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((mime) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) ?? "";
};

/** sessionStorage key for the clientUploadId, scoped to this link's token. */
const uploadIdKey = (token: string) => `medchina-capture-upload:${token.slice(0, 16)}`;

/**
 * The same URL `uploadToSignedUrl` builds, assembled here from the browser's
 * own public Supabase URL — the phone must reach the storage host it knows,
 * not whatever origin the server resolved.
 */
const signedUploadUrl = (path: string, uploadToken: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}?token=${encodeURIComponent(uploadToken)}`;

/**
 * Upload to the signed URL with REAL progress events — fetch reports none, and
 * a determinate bar frozen at 0% for minutes reads as "stuck" on clinic wifi.
 * The request mirrors what `uploadToSignedUrl` sends for a Blob (PUT +
 * multipart with cacheControl), so this only adds progress, not a new
 * server contract.
 */
function putWithProgress(url: string, blob: Blob, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", blob);

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // The signed token already authorizes overwriting, which is what makes a
    // resumed upload after a failed attempt land on the same object.
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("storage_upload_failed"));
    };
    xhr.onerror = () => reject(new Error("storage_upload_failed"));
    xhr.ontimeout = () => reject(new Error("storage_upload_failed"));
    xhr.send(form);
  });
}

/**
 * Audio capture over a QR bearer token — no login, no app. Mirrors the
 * essentials of the desktop recorder (mic before server state, wall-clock
 * timer, level meter as honest proof, server-confirmed upload) and adds the
 * durability a phone needs: chunks persisted to IndexedDB as they arrive
 * (reload/crash never loses the audio), a screen wake lock while recording,
 * suspension detection when the OS freezes the tab, and real upload progress.
 * With an 'ai'-mode link the delivered audio enters the clinical pipeline —
 * the phone on the table is the microphone of the automatic anamnesis.
 */
export default function MobileCaptureClient() {
  const t = useTranslations("product");
  const [phase, setPhase] = useState<Phase>("loading");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [warningKey, setWarningKey] = useState<string | null>(null);
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
  const secondsRef = useRef(0);
  const lastSoundAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const pendingBlob = useRef<{ blob: Blob; duration: number; mime: string } | null>(null);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;

  const call = useCallback(async (path: string, payload: Record<string, unknown>) => {
    const response = await fetch(`/api/public/capture/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.current, ...payload }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; [k: string]: unknown };
    return { ok: response.ok && body.ok === true, status: response.status, body };
  }, []);

  const resolve = useCallback(async () => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!isCaptureLinkToken(raw)) {
      setPhase("invalid");
      return;
    }
    token.current = raw;
    let result: Awaited<ReturnType<typeof call>>;
    try {
      result = await call("resolve", {});
    } catch {
      // Clinic wifi drops: distinguish "no connection" from "dead link" so a
      // retry is offered instead of a dead end.
      setPhase("network");
      return;
    }
    if (!result.ok) {
      setPhase("invalid");
      return;
    }
    const body = result.body;
    const context: Resolved = {
      patientFirstName: (body.patientFirstName as string | null) ?? null,
      consultationEditable: body.consultationEditable === true,
      audioConsent: body.audioConsent === true,
      mode: body.mode === "ai" ? "ai" : "audio_only",
      recordingStatus: (body.recordingStatus as string | null) ?? null,
    };
    setResolved(context);
    if (!context.consultationEditable || !context.audioConsent) {
      setPhase("blocked");
      return;
    }

    // A crashed/reloaded page may hold unsent audio for this link's
    // consultation — offer it back before anything else. The recording row is
    // idempotent on clientUploadId, so even a FRESH QR for the same
    // consultation can deliver it.
    const storedUploadId = window.sessionStorage.getItem(uploadIdKey(raw));
    if (storedUploadId) {
      const recovered = await recoverCapture(storedUploadId);
      if (recovered) {
        clientUploadId.current = storedUploadId;
        setPhase("recovered");
        return;
      }
    }

    // A capture already delivered on this consultation shows as done rather
    // than inviting a second one.
    if (context.recordingStatus === "ready" || context.recordingStatus === "uploaded") setPhase("done");
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
  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }, []);
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Denied or unsupported — the on-screen "keep this open" hint covers it.
    }
  }, []);

  useEffect(
    () => () => {
      stopTimers();
      stopLevelMeter();
      releaseStream();
      releaseWakeLock();
    },
    [releaseStream, releaseWakeLock, stopLevelMeter],
  );

  // The OS releases the wake lock (and iOS may suspend the recorder) whenever
  // the tab hides. On return: re-arm the lock and detect a silent gap — a
  // recorder that died while hidden must surface, never pretend to record.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (phaseRef.current === "recording") {
        void requestWakeLock();
        if (mediaRecorder.current && mediaRecorder.current.state === "inactive") {
          setWarningKey("capture-mobile-gap-warning");
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [requestWakeLock]);

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
        const value = Math.min(1, peak / 96);
        if (value > 0.04) lastSoundAtRef.current = Date.now();
        setLevel(value);
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

        await putWithProgress(signedUploadUrl(path, urlResult.body.token as string), blob, setUploadProgress);
        setUploadProgress(1);

        const confirmed = await call("state", { action: "uploaded", audioPath: path });
        if (!confirmed.ok) throw new Error(String(confirmed.body.code ?? "state_failed"));
        pendingBlob.current = null;
        if (clientUploadId.current) void clearCapture(clientUploadId.current);
        if (token.current) window.sessionStorage.removeItem(uploadIdKey(token.current));
        setWarningKey(null);
        setPhase("done");
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        setErrorKey(code === "capture_link_invalid" ? "capture-mobile-link-lost" : "capture-mobile-upload-error");
        setPhase("error");
      }
    },
    [call],
  );

  const sendRecovered = useCallback(async () => {
    const uploadId = clientUploadId.current;
    if (!uploadId) return;
    const recovered = await recoverCapture(uploadId);
    if (!recovered) {
      setPhase("idle");
      return;
    }
    setErrorKey(null);
    // Idempotent: replays into the SAME recording row when it already exists.
    try {
      const begun = await call("begin", { clientUploadId: uploadId });
      if (!begun.ok) {
        setErrorKey(begun.body.code === "recording_already_open" ? "capture-mobile-open" : "capture-mobile-error");
        setPhase("error");
        return;
      }
    } catch {
      setErrorKey("capture-mobile-network-error");
      setPhase("error");
      return;
    }
    void upload(recovered.blob, recovered.approxSeconds, recovered.mime);
  }, [call, upload]);

  const start = async () => {
    setErrorKey(null);
    setWarningKey(null);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setErrorKey("capture-mobile-mic-denied");
      setPhase("error");
      return;
    }

    const uploadId = clientUploadId.current ?? crypto.randomUUID();
    clientUploadId.current = uploadId;
    let begun: Awaited<ReturnType<typeof call>>;
    try {
      begun = await call("begin", { clientUploadId: uploadId });
    } catch {
      // Network died AFTER the mic opened — release it, or the light stays on
      // with the UI stuck in idle.
      media.getTracks().forEach((track) => track.stop());
      setErrorKey("capture-mobile-network-error");
      setPhase("error");
      return;
    }
    if (!begun.ok) {
      media.getTracks().forEach((track) => track.stop());
      setErrorKey(begun.body.code === "recording_already_open" ? "capture-mobile-open" : "capture-mobile-error");
      setPhase("error");
      return;
    }

    try {
      if (token.current) window.sessionStorage.setItem(uploadIdKey(token.current), uploadId);
      void requestPersistentStorage();
      stream.current = media;
      chunks.current = [];
      const mime = bestMime();
      const options: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITS_PER_SECOND };
      if (mime) options.mimeType = mime;
      const recorder = new MediaRecorder(media, options);
      const effectiveMime = recorder.mimeType || mime || "audio/webm";
      void beginCaptureStore(uploadId, effectiveMime);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
          // Durable as it arrives: a killed tab loses at most one second.
          void appendCaptureChunk(uploadId, event.data);
        }
      };
      recorder.onstop = () => {
        stopLevelMeter();
        releaseStream();
        releaseWakeLock();
        void upload(new Blob(chunks.current, { type: effectiveMime }), secondsRef.current, effectiveMime);
      };
      media.getAudioTracks().forEach((track) => {
        track.onended = () => {
          // Device lost (call came in, bluetooth dropped, OS revoked the mic):
          // deliver what exists instead of recording silence forever.
          if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
            setWarningKey("capture-mobile-device-lost");
            stopTimers();
            mediaRecorder.current.stop();
          }
        };
      });
      mediaRecorder.current = recorder;
      recorder.start(1000);
      startedAtRef.current = Date.now();
      pausedTotalRef.current = 0;
      pausedAtRef.current = 0;
      lastSoundAtRef.current = Date.now();
      secondsRef.current = 0;
      setSeconds(0);
      setPhase("recording");
      startLevelMeter(media);
      void requestWakeLock();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current - pausedTotalRef.current) / 1000);
        secondsRef.current = elapsed;
        setSeconds(elapsed);
        if (
          lastSoundAtRef.current > 0 &&
          Date.now() - lastSoundAtRef.current > SILENCE_WARNING_MS &&
          phaseRef.current === "recording"
        ) {
          setWarningKey("capture-mobile-silence-warning");
        }
        if (elapsed >= MAX_DURATION_SECONDS && mediaRecorder.current?.state !== "inactive") {
          stopTimers();
          mediaRecorder.current?.stop();
        }
      }, 1000);
      // Keep the 15-min token alive across a long consultation. A dead link is
      // NOT fatal (the audio is persisted locally) but the professional should
      // know a fresh QR will be needed to deliver.
      heartbeat.current = setInterval(
        () => {
          void call("state", { action: "heartbeat" })
            .then((result) => {
              if (!result.ok && result.status === 410) setWarningKey("capture-mobile-link-lost");
            })
            .catch(() => undefined);
        },
        5 * 60 * 1000,
      );
    } catch {
      releaseStream();
      releaseWakeLock();
      void call("state", { action: "cancel", errorCode: "microphone_unavailable" }).catch(() => undefined);
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
    lastSoundAtRef.current = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current - pausedTotalRef.current) / 1000);
      secondsRef.current = elapsed;
      setSeconds(elapsed);
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
  const recordAnother = () => {
    // A consultation captured in parts: new idempotency key, same link.
    clientUploadId.current = null;
    if (token.current) window.sessionStorage.removeItem(uploadIdKey(token.current));
    setWarningKey(null);
    setErrorKey(null);
    void start();
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

  if (phase === "network") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 py-7!">
          <Typography variant="h5" component="h1">
            {t("capture-mobile-network-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("capture-mobile-network-error")}
          </Typography>
          <Button variant="contained" color="primary" onClick={() => void resolve()}>
            {t("retry")}
          </Button>
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

  const aiMode = resolved?.mode === "ai";

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
          {aiMode && phase !== "done" && (
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("capture-mobile-ai-hint")}
            </Typography>
          )}
        </Box>

        {phase === "done" ? (
          <>
            <Alert severity="success" icon={<NiCheckSquare />}>
              {aiMode ? t("capture-mobile-done-ai") : t("capture-mobile-done")}
            </Alert>
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("capture-mobile-done-hint")}
            </Typography>
            {!aiMode && (
              <Button
                variant="outlined"
                color="primary"
                size="large"
                fullWidth
                startIcon={<NiMicrophone size="tiny" />}
                onClick={recordAnother}
              >
                {t("capture-mobile-another")}
              </Button>
            )}
          </>
        ) : phase === "recovered" ? (
          <>
            <Alert severity="info">{t("capture-mobile-recovered")}</Alert>
            <Button variant="contained" color="primary" size="large" fullWidth onClick={() => void sendRecovered()}>
              {t("capture-mobile-resume")}
            </Button>
            <Button
              variant="outlined"
              color="grey"
              size="large"
              fullWidth
              onClick={() => {
                const uploadId = clientUploadId.current;
                if (uploadId) void clearCapture(uploadId);
                if (token.current) window.sessionStorage.removeItem(uploadIdKey(token.current));
                clientUploadId.current = null;
                setPhase("idle");
              }}
            >
              {t("capture-mobile-discard-recovered")}
            </Button>
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
                {phase === "recording" && (
                  <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                    {t("capture-mobile-screen-hint")}
                  </Typography>
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

            {warningKey && <Alert severity="warning">{t(warningKey)}</Alert>}
            {errorKey && (
              <Alert severity="error">
                {t(errorKey)}
                {errorKey === "capture-mobile-mic-denied" && (
                  <Typography variant="body2" component="span" className="mt-1 block text-xs leading-5">
                    {t("capture-mobile-mic-denied-help")}
                  </Typography>
                )}
              </Alert>
            )}

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
