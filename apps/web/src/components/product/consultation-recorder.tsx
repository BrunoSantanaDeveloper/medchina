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
  Typography,
} from "@mui/material";

import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import { trialDaysLeft } from "@/lib/audio-allowance";
import { recordAudit } from "@/lib/audit";
import { RECORDING_CONSENT_SLUG } from "@/lib/consents";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Phase = "idle" | "recording" | "paused" | "uploading" | "uploaded" | "error";

/**
 * Consented consultation recording, IN THE BROWSER (PRD §4.1 "gravação
 * opcional via navegador"; the mobile app is the primary capture surface).
 *
 * Two guarantees this component makes visible, both also enforced by the DB:
 *  - it never starts without an ACTIVE audio-recording consent for the patient
 *    (PRD §9.5) — the button is replaced by a link to the consent screen;
 *  - a recording is only "enviada" after the SERVER confirms the upload (PRD
 *    §12.4): the `recordings` row flips to 'uploaded' only after storage
 *    accepts the object.
 *
 * Audio lands in the private `transcriptions` bucket under <org_id>/<id>.webm,
 * ready for the transcription pipeline (0007) to pick up next.
 */
export default function ConsultationRecorder({
  orgId,
  patientId,
  consultationId,
}: {
  orgId: string;
  patientId: string;
  consultationId: string;
}) {
  const t = useTranslations("product");
  const [consent, setConsent] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const {
    allowance,
    trialParams,
    loading: allowanceLoading,
    reload: reloadAllowance,
    startTrial,
  } = useAudioAllowance(orgId);
  const [trialDialog, setTrialDialog] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Does the patient currently allow recording? Gates the whole UI.
  useEffect(() => {
    const check = async () => {
      if (!isSupabaseConfigured) {
        setConsent(false);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase.rpc("has_active_consent", {
        target_org: orgId,
        target_patient: patientId,
        term_slug: RECORDING_CONSENT_SLUG,
      });
      setConsent(Boolean(data));
    };
    check();
  }, [orgId, patientId]);

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
    },
    [],
  );

  const upload = useCallback(
    async (blob: Blob, durationSeconds: number) => {
      setPhase("uploading");
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // The DB trigger re-checks consent on insert, so a consent revoked
      // mid-recording still can't produce a stored recording.
      const { data: acceptance } = await supabase
        .from("consent_acceptances")
        .select("id")
        .eq("subject_type", "patient")
        .eq("subject_id", patientId)
        .is("revoked_at", null)
        .limit(1)
        .maybeSingle();

      const { data: recording, error: insertError } = await supabase
        .from("recordings")
        .insert({
          org_id: orgId,
          patient_id: patientId,
          consultation_id: consultationId,
          status: "uploading",
          mime: "audio/webm",
          duration_seconds: durationSeconds,
          size_bytes: blob.size,
          consent_acceptance_id: acceptance?.id ?? null,
          captured_on: "web",
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();

      if (insertError || !recording) {
        // The DB guard (migration 0024) is the real boundary — if it refused
        // between pressing record and finishing, say what happened instead of
        // showing a raw Postgres error.
        const message = insertError?.message ?? "";
        setError(
          message.includes("audio_allowance_exhausted")
            ? t("recorder-limit-body")
            : message.includes("trial_not_started")
              ? t("recorder-trial-body")
              : (insertError?.message ?? t("recorder-error")),
        );
        setPhase("error");
        void reloadAllowance();
        return;
      }

      const path = `${orgId}/${recording.id}.webm`;
      const { error: uploadError } = await supabase.storage
        .from("transcriptions")
        .upload(path, blob, { contentType: "audio/webm", upsert: false });

      if (uploadError) {
        // Keep the row as failed so nothing claims to be "sent".
        await supabase
          .from("recordings")
          .update({ status: "failed", error: uploadError.message })
          .eq("id", recording.id);
        setError(uploadError.message);
        setPhase("error");
        return;
      }

      // Server confirmed the object — only now is it "uploaded".
      await supabase.from("recordings").update({ status: "uploaded", audio_path: path }).eq("id", recording.id);
      recordAudit(supabase, "recording.uploaded", {
        orgId,
        entityType: "recording",
        entityId: recording.id,
        metadata: { consultationId, durationSeconds },
      });
      setPhase("uploaded");
    },
    [orgId, patientId, consultationId, t, reloadAllowance],
  );

  const start = async () => {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      chunks.current = [];
      const recorder = new MediaRecorder(media, { mimeType: "audio/webm" });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onstop = () => {
        releaseStream();
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        void upload(blob, seconds);
      };
      mediaRecorder.current = recorder;
      recorder.start();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch {
      setError(t("recorder-mic-denied"));
      setPhase("error");
    }
  };

  const pause = () => {
    mediaRecorder.current?.pause();
    stopTimer();
    setPhase("paused");
  };

  const resume = () => {
    mediaRecorder.current?.resume();
    timer.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    setPhase("recording");
  };

  const finish = () => {
    stopTimer();
    mediaRecorder.current?.stop();
  };

  const confirmTrial = async () => {
    setStartingTrial(true);
    const failure = await startTrial();
    setStartingTrial(false);
    setTrialDialog(false);
    if (failure) {
      setError(failure);
      setPhase("error");
    }
  };

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (consent === null || allowanceLoading) return null;

  // The consultation is already being recorded: no allowance state may take the
  // controls away mid-capture (PRD §5.8).
  const capturing = phase === "recording" || phase === "paused" || phase === "uploading";
  const needsTrial = !capturing && allowance?.trialAvailable === true && !allowance.canStart;
  const exhausted = !capturing && allowance !== null && !allowance.canStart && !allowance.trialAvailable;
  // Warn while it happens — the opposite of being cut off silently.
  const overrunning =
    phase === "recording" &&
    allowance !== null &&
    allowance.minutesLimit > 0 &&
    seconds > allowance.minutesRemaining * 60;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <NiMicrophone size="medium" className="text-primary" />
          <Typography variant="h6" component="h2">
            {t("recorder-title")}
          </Typography>
        </Box>

        {!consent ? (
          // Recording is gated on consent — offer the path to grant it, never a
          // dead end, and never block the manual consultation happening anyway.
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {t("recorder-no-consent")}
            </Typography>
            <Button
              variant="outlined"
              color="primary"
              href={`/pacientes/${patientId}/consentimentos`}
              className="self-start"
            >
              {t("recorder-grant-consent")}
            </Button>
          </>
        ) : needsTrial ? (
          // The path to value: the trial starts HERE, by a deliberate act, and
          // only for a real consultation (PRD §5.7/§7.5).
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
          // Out of minutes: manual care never stops, and the chart stays open —
          // only new AI capture waits for a plan (PRD §5.7).
          <>
            <Typography variant="body2" className="text-text-secondary leading-6">
              {allowance?.suspended ? t("recorder-suspended-body") : t("recorder-limit-body")}
            </Typography>
            {!allowance?.suspended && (
              <Button variant="contained" color="primary" href="/settings/billing" className="self-start">
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
                <Typography
                  variant="body2"
                  className={cn(
                    "font-semibold",
                    phase === "recording" ? "text-accent-3-dark dark:text-accent-3-light" : "text-text-secondary",
                  )}
                >
                  {phase === "recording" ? t("recorder-recording") : t("recorder-paused")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary ml-auto font-mono tabular-nums">
                  {mmss}
                </Typography>
              </Box>
            )}

            {/* Passing the limit never stops the capture (PRD §5.8): the audio
                is preserved and the professional is told, not cut off. */}
            {overrunning && (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("recorder-overrun")}
              </Alert>
            )}

            {phase === "uploading" && (
              <Box className="flex flex-col gap-2">
                <Typography variant="body2" className="text-text-secondary">
                  {t("recorder-uploading")}
                </Typography>
                <LinearProgress />
              </Box>
            )}

            {phase === "uploaded" && (
              <Alert severity="success" icon={<NiCheckSquare />} className="neutral bg-background-paper/60!">
                {t("recorder-uploaded")}
              </Alert>
            )}

            {error && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {error}
              </Alert>
            )}

            <Box className="flex flex-row flex-wrap gap-2">
              {(phase === "idle" || phase === "error" || phase === "uploaded") && (
                <Button variant="contained" color="primary" onClick={start}>
                  {phase === "uploaded" ? t("recorder-record-again") : t("recorder-start")}
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

            {/* What is left, stated plainly — the web is where consumption is
                shown (PRD §5.8). */}
            {allowance && allowance.minutesLimit > 0 && (
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
          <Button variant="contained" color="primary" onClick={confirmTrial} disabled={startingTrial}>
            {t("recorder-trial-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
