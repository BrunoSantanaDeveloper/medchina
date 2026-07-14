"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, LinearProgress, Typography } from "@mui/material";

import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMicrophone from "@/icons/nexture/ni-microphone";
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
        setError(insertError?.message ?? t("recorder-error"));
        setPhase("error");
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
    [orgId, patientId, consultationId, t],
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

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (consent === null) return null;

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
          </>
        )}
      </CardContent>
    </Card>
  );
}
