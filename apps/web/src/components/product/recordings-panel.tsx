"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from "@mui/material";

import TranscriptViewer from "@/components/product/transcript-viewer";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type Recording = {
  id: string;
  status: string;
  durationSeconds: number | null;
  createdAt: string;
  mode: "ai" | "audio_only";
  failureStage: string | null;
  transcriptionId: string | null;
  audioPath: string | null;
};

/**
 * The recordings captured for this consultation and their processing state.
 * From here the professional sends a recording through the AI pipeline
 * (transcription → draft anamnesis, PRD §10.2). Processing is a background job
 * (with an inline fallback), so this polls until it settles and then asks the
 * parent to reload the anamnesis the pipeline just drafted.
 */
export default function RecordingsPanel({
  consultationId,
  onProcessed,
}: {
  consultationId: string;
  onProcessed: () => void;
}) {
  const t = useTranslations("product");
  const [recordingsState, setRecordingsState] = useState<RemoteState<Recording[], "load_failed">>(() =>
    remoteLoading(),
  );
  const recordingsRef = useRef<Recording[] | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const load = useCallback(
    async (preservePrevious = true) => {
      if (!preservePrevious) recordingsRef.current = undefined;
      const previous = preservePrevious ? recordingsRef.current : undefined;
      setRecordingsState(remoteLoading(previous));
      if (!isSupabaseConfigured) {
        recordingsRef.current = undefined;
        setRecordingsState(remoteEmpty());
        return;
      }
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("recordings")
        .select("id, status, duration_seconds, created_at, mode, failure_stage, transcription_id, audio_path")
        .eq("consultation_id", consultationId)
        .order("created_at", { ascending: false });
      if (loadError) {
        setRecordingsState(remoteError("load_failed", previous));
        return;
      }
      const recordings = (data ?? []).map((row) => ({
        id: row.id,
        status: row.status,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
        mode: row.mode,
        failureStage: row.failure_stage,
        transcriptionId: row.transcription_id,
        audioPath: row.audio_path,
      }));
      recordingsRef.current = recordings.length === 0 ? undefined : recordings;
      setRecordingsState(recordings.length === 0 ? remoteEmpty() : remoteSuccess(recordings));
    },
    [consultationId],
  );

  const safeError = (code: unknown) => {
    if (code === "audio_consent_required" || code === "ai_consent_required" || code === "consent_required")
      return t("recordings-error-consent");
    if (code === "allowance_unavailable" || code === "audio_allowance_exhausted")
      return t("recordings-error-allowance");
    if (code === "recording_pending" || code === "processing_already_claimed") return t("recordings-error-pending");
    return t("recordings-process-error");
  };

  useEffect(() => {
    void load(false);
  }, [load]);

  const process = async (recordingId: string) => {
    setBusyId(recordingId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/process`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(safeError(body?.error?.code ?? body?.code));
        setBusyId(null);
        return;
      }
      // Job path: poll the row until it leaves 'processing'. Inline path is
      // already done when the request returns.
      if (body.queued) {
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const supabase = createClient();
          const { data } = await supabase
            .from("recordings")
            .select("status, error_code")
            .eq("id", recordingId)
            .maybeSingle();
          if (data && data.status !== "processing") {
            if (data.status === "failed") setActionError(safeError(data.error_code));
            break;
          }
        }
      }
      await load(true);
      onProcessed();
    } catch {
      setActionError(t("recordings-process-error"));
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (recordingId: string) => {
    if (!window.confirm(t("recordings-discard-confirm"))) return;
    setBusyId(recordingId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", errorCode: "discarded_after_failure" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setActionError(safeError(body?.error?.code ?? body?.code));
      else await load(true);
    } catch {
      setActionError(t("recordings-process-error"));
    } finally {
      setBusyId(null);
    }
  };

  const deleteAudio = async (recordingId: string) => {
    if (!window.confirm(t("recordings-delete-audio-confirm"))) return;
    setBusyId(recordingId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/audio`, { method: "DELETE" });
      if (!response.ok) {
        setActionError(t("recordings-delete-audio-error"));
        return;
      }
      setActionSuccess(t("recordings-delete-audio-success"));
      await load(true);
    } catch {
      setActionError(t("recordings-delete-audio-error"));
    } finally {
      setBusyId(null);
    }
  };

  const recordings =
    recordingsState.status === "success"
      ? recordingsState.data
      : recordingsState.status === "loading" || recordingsState.status === "error"
        ? recordingsState.previous
        : undefined;
  const initialLoading = recordingsState.status === "loading" && !recordings;
  const loadFailed = recordingsState.status === "error";
  const refreshing = recordingsState.status === "loading" && Boolean(recordings);

  if (initialLoading) {
    return <CircularProgress size={24} aria-label={t("loading")} />;
  }
  if (loadFailed && !recordings) {
    return (
      <Alert severity="error" action={<Button onClick={() => void load(false)}>{t("retry")}</Button>}>
        {t("recordings-load-error")}
      </Alert>
    );
  }
  if (!recordings || recordings.length === 0) return null;

  const statusLabel = (status: string) =>
    ({
      recording: t("recordings-status-recording"),
      local: t("recordings-status-local"),
      uploading: t("recordings-status-uploading"),
      uploaded: t("recordings-status-uploaded"),
      processing: t("recordings-status-processing"),
      ready: t("recordings-status-ready"),
      failed: t("recordings-status-failed"),
      cancelled: t("recordings-status-cancelled"),
    })[status] ?? status;

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Typography variant="h6" component="h2">
          {t("recordings-title")}
        </Typography>

        {loadFailed && (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={() => void load(true)}>{t("retry")}</Button>}
          >
            {t("recordings-load-error")}
          </Alert>
        )}

        {actionError && (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {actionError}
          </Alert>
        )}
        {actionSuccess && <Alert severity="success">{actionSuccess}</Alert>}

        <Box className="flex flex-col gap-2" aria-busy={refreshing} aria-live="polite">
          {refreshing && <CircularProgress size={18} aria-label={t("loading")} />}
          {recordings.map((recording) => {
            const canProcess =
              recording.mode === "ai" &&
              (recording.status === "uploaded" ||
                (recording.status === "failed" &&
                  ["transcription", "extraction", "apply"].includes(recording.failureStage ?? "")));
            const isProcessing = recording.status === "processing" || busyId === recording.id;
            const visibleStatus =
              recording.status === "ready" && recording.mode === "audio_only"
                ? t("recordings-status-audio-ready")
                : statusLabel(recording.status);
            const duration = recording.durationSeconds
              ? `${String(Math.floor(recording.durationSeconds / 60)).padStart(2, "0")}:${String(recording.durationSeconds % 60).padStart(2, "0")}`
              : null;
            return (
              <Box key={recording.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-3">
                <Box className="flex flex-row items-center gap-3">
                  <Box className="min-w-0 flex-1">
                    <Typography variant="body2" className="text-text-primary font-medium">
                      {new Date(recording.createdAt).toLocaleString()}
                      {duration ? ` · ${duration}` : ""}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary text-xs">
                      {visibleStatus}
                    </Typography>
                  </Box>
                  {isProcessing ? (
                    <CircularProgress size={20} aria-label={visibleStatus} />
                  ) : recording.status === "ready" ? (
                    <Box className="flex flex-wrap items-center justify-end gap-1">
                      <span className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light rounded-full px-2.5 py-1 text-xs font-semibold">
                        {visibleStatus}
                      </span>
                      {recording.mode === "audio_only" && recording.audioPath && (
                        <Button size="small" color="grey" onClick={() => void deleteAudio(recording.id)}>
                          {t("recordings-delete-audio")}
                        </Button>
                      )}
                    </Box>
                  ) : (
                    <Box className="flex flex-wrap items-center gap-1">
                      {canProcess && (
                        <Button size="small" variant="contained" color="primary" onClick={() => process(recording.id)}>
                          {t("recordings-process")}
                        </Button>
                      )}
                      {recording.status === "failed" && (
                        <Button size="small" variant="text" color="grey" onClick={() => discard(recording.id)}>
                          {t("recordings-discard")}
                        </Button>
                      )}
                    </Box>
                  )}
                </Box>
                {recording.status === "ready" && recording.transcriptionId && (
                  <TranscriptViewer
                    recordingId={recording.id}
                    transcriptionId={recording.transcriptionId}
                    consultationId={consultationId}
                  />
                )}
              </Box>
            );
          })}
        </Box>

        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("recordings-note")}
        </Typography>
      </CardContent>
    </Card>
  );
}
