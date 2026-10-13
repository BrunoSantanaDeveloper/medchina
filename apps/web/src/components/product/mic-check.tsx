"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, LinearProgress, Typography } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiMicrophone from "@/icons/nexture/ni-microphone";

/**
 * "Is my microphone going to work?" — answered at her desk, before a patient
 * is in the room.
 *
 * The first recording used to be the first time the browser asked for the
 * microphone: with the patient already talking. A refused prompt, the wrong
 * input selected or a muted headset were all discovered there, and each one
 * costs a consultation. This runs the same permission request with nobody
 * waiting, shows the level moving, and says plainly what it found.
 *
 * It RECORDS NOTHING. The stream feeds an analyser and is thrown away: no
 * MediaRecorder, no upload, no row anywhere. That is also why it needs no
 * consent — there is no patient and no audio kept — and the note under the
 * button says so, because a microphone turning on with no explanation reads as
 * a recording.
 *
 * Shape: nothing in the catalog fits a live input level (UsageMeter is an
 * allowance, MetricBars a population), so the bar is MUI's own LinearProgress —
 * the primitive the recorder already uses for its upload progress.
 */

export type MicCheckResult = "heard" | "silent" | "blocked" | "unavailable";

type Phase = "idle" | "requesting" | "listening" | MicCheckResult;

/**
 * The longest it waits for sound before saying it heard nothing. Generous on
 * purpose: a Bluetooth headset switching to its microphone profile, or a
 * device waking up, can take several seconds to deliver the first sample —
 * measured: the first sound arrived after almost six seconds on a cold device.
 */
const LISTEN_MS = 10_000;
/** It never answers sooner than this, so she sees the bar move with her voice. */
const MIN_LISTEN_MS = 1_200;
/** Peak level (0–1) that counts as a voice, not room noise. */
const HEARD_LEVEL = 0.06;
/**
 * Frames with sound, COUNTED over the whole test, before it is believed. Not
 * consecutive: speech has gaps between syllables, and a rule of six frames in a
 * row rejected real signal whose bursts measured four or five. A click or a
 * bump is one to three frames, so it still does not pass.
 */
const HEARD_FRAMES = 10;

export default function MicCheck({ onResult }: { onResult?: (result: MicCheckResult) => void }) {
  const t = useTranslations("product");
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const release = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    frameRef.current = null;
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }, []);

  // Leaving the step mid-test must turn the microphone off, not leave the
  // browser's recording indicator lit on a screen that is no longer there.
  useEffect(() => release, [release]);

  const finish = useCallback(
    (result: MicCheckResult) => {
      release();
      setLevel(0);
      setPhase(result);
      onResult?.(result);
    },
    [onResult, release],
  );

  const start = useCallback(async () => {
    release();
    setLevel(0);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      finish("unavailable");
      return;
    }
    setPhase("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      // A refusal and a missing device are fixed in different places.
      finish(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "unavailable");
      return;
    }

    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      stream.getTracks().forEach((track) => track.stop());
      finish("unavailable");
      return;
    }

    streamRef.current = stream;
    const context = new AudioContextClass();
    contextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    let framesWithSound = 0;
    let lastPaint = 0;
    const startedAt = performance.now();
    setPhase("listening");

    const read = (now: number) => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      if (peak >= HEARD_LEVEL) framesWithSound += 1;
      // It works: say so now instead of making her talk for the full window.
      if (framesWithSound >= HEARD_FRAMES && now - startedAt >= MIN_LISTEN_MS) {
        finish("heard");
        return;
      }
      // ~12 paints a second is plenty for a level bar and spares the page a
      // state update on every animation frame.
      if (now - lastPaint > 80) {
        lastPaint = now;
        setLevel(peak);
      }
      frameRef.current = requestAnimationFrame(read);
    };
    frameRef.current = requestAnimationFrame(read);

    timerRef.current = window.setTimeout(() => finish("silent"), LISTEN_MS);
  }, [finish, release]);

  const busy = phase === "requesting" || phase === "listening";

  return (
    <Box className="flex flex-col gap-3">
      {phase === "listening" && (
        <Box className="flex flex-col gap-1.5" role="status" aria-live="polite">
          <Typography variant="body2" className="text-text-primary">
            {t("mic-check-listening")}
          </Typography>
          <LinearProgress
            variant="determinate"
            // Speech peaks well under full scale; the bar is stretched so a
            // normal voice visibly moves it.
            value={Math.min(100, Math.round(level * 250))}
            aria-label={t("mic-check-level-label")}
            className="h-2 rounded-full"
          />
        </Box>
      )}

      {phase === "heard" && (
        <Alert severity="success" icon={<NiCheck size="small" />} role="status">
          {t("mic-check-heard")}
        </Alert>
      )}
      {phase === "silent" && (
        <Alert severity="warning" className="neutral bg-background-paper/60!" role="status">
          {t("mic-check-silent")}
        </Alert>
      )}
      {phase === "blocked" && (
        <Alert severity="warning" className="neutral bg-background-paper/60!" role="status">
          <Typography variant="subtitle2" component="p" className="mb-0">
            {t("recorder-mic-blocked")}
          </Typography>
          <Typography variant="body2">{t("mic-check-blocked-help")}</Typography>
        </Alert>
      )}
      {phase === "unavailable" && (
        <Alert severity="warning" className="neutral bg-background-paper/60!" role="status">
          {t("recorder-mic-unavailable")}
        </Alert>
      )}

      <Box className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant={phase === "idle" ? "contained" : "outlined"}
          color={phase === "idle" ? "primary" : "grey"}
          size="small"
          startIcon={<NiMicrophone size="small" />}
          disabled={busy}
          onClick={() => void start()}
        >
          {phase === "requesting"
            ? t("mic-check-requesting")
            : phase === "idle"
              ? t("mic-check-start")
              : t("mic-check-again")}
        </Button>
        <Typography variant="body2" className="text-text-secondary">
          {t("mic-check-privacy")}
        </Typography>
      </Box>
    </Box>
  );
}
