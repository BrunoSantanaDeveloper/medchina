"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import InfoHint from "@/components/product/info-hint";
import TranscriptViewer from "@/components/product/transcript-viewer";
import NiListCheck from "@/icons/nexture/ni-list-check";
import { cn } from "@/lib/utils";
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
  /** Set mid-'processing' by a non-terminal transient failure — "retrying". */
  errorCode: string | null;
  transcriptionId: string | null;
  audioPath: string | null;
};

/** One status, one visual language. Red stays reserved for risk (PRD §16): a
 * failed capture is attention (terracotta), never alarm. */
const STATUS_TONE: Record<string, string> = {
  ready: "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light",
  failed: "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
  recording: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
  processing: "bg-primary/12 text-primary",
  uploading: "bg-primary/12 text-primary",
  uploaded: "bg-primary/12 text-primary",
};

/** A destructive confirmation that names its own consequence. */
type Confirmation = { kind: "discard" | "delete-audio"; recordingId: string; status: string };

/** A failure stamped at one of these stages happened INSIDE the pipeline: the
 * audio is intact and running it again is meaningful. A capture/upload failure
 * has no audio to reprocess. */
const PROCESSING_FAILURE_STAGES = ["transcription", "extraction", "apply"];

/** Capture statuses that are still OPEN — the microphone may be running right
 * now. Discarding one of these can throw away audio being recorded, which is a
 * different act (and a different loss) from clearing a failed attempt. */
const OPEN_CAPTURE_STATUSES = ["recording", "local", "uploading"];

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
  refreshSignal,
  seekTo,
  readOnly = false,
}: {
  consultationId: string;
  onProcessed: () => void;
  /** Bumped by the parent when the consultation re-syncs (background job or a
   * capture that started on the phone) so this list reflects it without a
   * manual refresh. A no-flicker reload that keeps the current rows visible. */
  refreshSignal?: number;
  /**
   * A field's provenance asked to be HEARD. The audio lives behind the
   * transcript dialog this panel owns, so opening it at the right recording is
   * this panel's job — the chart has no business knowing which recording a
   * transcription belongs to.
   */
  seekTo?: { start: string; transcriptionId?: string; nonce: number };
  /**
   * The consultation is finalized. The transcript and its audio stay READABLE —
   * they are the evidence every AI-filled field points back to (PRD §13.1), and
   * hiding them once the record closes removed the proof at exactly the moment
   * an audit, a review or a challenge would ask for it. Everything that would
   * CHANGE a frozen record is gone.
   */
  readOnly?: boolean;
}) {
  const t = useTranslations("product");
  const [recordingsState, setRecordingsState] = useState<RemoteState<Recording[], "load_failed">>(() =>
    remoteLoading(),
  );
  const recordingsRef = useRef<Recording[] | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // Mounted only while open, so transcripts are fetched on demand instead of
  // for every recording in the list.
  const [transcriptFor, setTranscriptFor] = useState<{ recordingId: string; transcriptionId: string } | null>(null);

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
        .select(
          "id, status, duration_seconds, created_at, mode, failure_stage, error_code, transcription_id, audio_path",
        )
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
        errorCode: row.error_code,
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
    // A busy AI service and a definitive refusal are DIFFERENT facts: one says
    // "try again in a few minutes, the audio is safe"; the other says trying
    // again changes nothing and support is looking at it.
    if (code === "provider_unavailable") return t("recordings-error-provider-unavailable");
    if (code === "provider_rejected") return t("recordings-error-provider-rejected");
    // Migration 0092 stopped the merge from refusing a chart that moved while
    // the audio was processing, so this should no longer happen. A workspace on
    // an older database still can, and blaming "a temporary service problem"
    // for her own typing is exactly how the failure read before.
    if (code === "clinical_revision_conflict") return t("recordings-error-revision");
    return t("recordings-process-error");
  };

  useEffect(() => {
    void load(false);
  }, [load]);

  // Re-sync on the parent's tick (a background job settled, or a recording was
  // captured on the phone) without clearing the list first — the mount load
  // above owns the initial spinner.
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    void load(true);
  }, [refreshSignal, load]);

  // Open the transcript at the recording the provenance actually came from —
  // the answer carries its transcription id, so this never guesses. A request
  // that arrives before the list has loaded is honored once it does.
  const seekHandled = useRef<number | null>(null);
  useEffect(() => {
    if (!seekTo || seekHandled.current === seekTo.nonce) return;
    const recordings = recordingsRef.current ?? [];
    const match =
      recordings.find(
        (recording) => recording.transcriptionId && recording.transcriptionId === seekTo.transcriptionId,
      ) ?? recordings.find((recording) => recording.status === "ready" && recording.transcriptionId);
    if (!match?.transcriptionId) return;
    seekHandled.current = seekTo.nonce;
    setTranscriptFor({ recordingId: match.id, transcriptionId: match.transcriptionId });
  }, [seekTo, recordingsState]);

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
      // already done when the request returns. The horizon must OUTLIVE the
      // worst-case run (provider retries + fallback model, up to ~300s server
      // side) — a poll that gives up at 120s left the row visibly stuck.
      if (body.queued) {
        for (let attempt = 0; attempt < 110; attempt++) {
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

  const discard = async (recordingId: string, status: string) => {
    setBusyId(recordingId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          // The reason stays on the row for the audit, so it must name what
          // actually happened: a capture abandoned while still open is not a
          // failed attempt being cleared.
          errorCode: OPEN_CAPTURE_STATUSES.includes(status) ? "discarded_open_capture" : "discarded_after_failure",
        }),
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

  /** Discarding an OPEN capture and clearing a failed attempt are different
   * acts — the confirmation already distinguishes them, and the button that
   * opens it must not name a failure that never happened. The open case reuses
   * the recorder's own wording: it is the same act (free the consultation to
   * capture again) on a different surface. */
  const discardLabel = (status: string) =>
    OPEN_CAPTURE_STATUSES.includes(status) ? t("recorder-orphan-discard") : t("recordings-discard");

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
        {/* The hint belongs at the END of the title row, as in every other card
            in this column — as a sibling of the title it dropped onto a line of
            its own, reading as a stray icon with nothing to explain. */}
        <Box className="flex flex-row items-center gap-2">
          <Typography variant="h6" component="h2" className="mb-0">
            {t("recordings-title")}
          </Typography>
          <InfoHint label={t("recordings-note")} className="ml-auto" />
        </Box>
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
              !readOnly &&
              recording.mode === "ai" &&
              (recording.status === "uploaded" ||
                (recording.status === "failed" && PROCESSING_FAILURE_STAGES.includes(recording.failureStage ?? "")));
            // "Reprocessar" asserts an attempt that already happened. Only a row
            // that really went through the pipeline may say it — a stage the
            // pipeline itself stamped, or a transcript from an earlier run. A
            // freshly uploaded capture has never been processed, and offering
            // to "reprocess" it invented a first attempt she never made.
            const alreadyProcessed =
              PROCESSING_FAILURE_STAGES.includes(recording.failureStage ?? "") || Boolean(recording.transcriptionId);
            // A capture interrupted by a reload or a closed tab stays in an open
            // status forever and blocks every new one at the server. Discarding
            // must be reachable from ANY stuck status, not only from 'failed'.
            const canDiscard =
              !readOnly && (recording.status === "failed" || OPEN_CAPTURE_STATUSES.includes(recording.status));
            const isProcessing = recording.status === "processing" || busyId === recording.id;
            // A non-terminal transient failure stamps error_code on a row that
            // STAYS 'processing' while the job waits to retry. Saying only
            // "Processando…" there hid the fact something already went wrong
            // once; saying "Falha" would be a lie. This is the honest middle.
            const isRetrying = recording.status === "processing" && recording.errorCode === "provider_unavailable";
            const visibleStatus = isRetrying
              ? t("recordings-status-retrying")
              : recording.status === "ready" && recording.mode === "audio_only"
                ? t("recordings-status-audio-ready")
                : statusLabel(recording.status);
            const duration = recording.durationSeconds
              ? `${String(Math.floor(recording.durationSeconds / 60)).padStart(2, "0")}:${String(recording.durationSeconds % 60).padStart(2, "0")}`
              : null;
            return (
              <Box key={recording.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-3">
                <Box className="flex flex-row flex-wrap items-center gap-x-3 gap-y-2">
                  {/* One status, stated once: the chip is the single source of
                      truth (it used to be repeated as a caption below the date). */}
                  <Typography variant="body2" className="text-text-primary min-w-0 flex-1 font-medium tabular-nums">
                    {new Date(recording.createdAt).toLocaleString()}
                    {duration ? ` · ${duration}` : ""}
                  </Typography>
                  <Chip
                    size="small"
                    label={visibleStatus}
                    className={cn(
                      "text-xs font-semibold",
                      isRetrying
                        ? "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light"
                        : (STATUS_TONE[recording.status] ?? "bg-grey-100 text-text-secondary"),
                    )}
                  />
                  {isProcessing && <CircularProgress size={18} aria-label={visibleStatus} />}
                  <Box className="flex flex-wrap items-center gap-1">
                    {!isProcessing && canProcess && (
                      <Button size="small" variant="contained" color="primary" onClick={() => process(recording.id)}>
                        {alreadyProcessed ? t("recordings-process") : t("recordings-process-first")}
                      </Button>
                    )}
                    {!isProcessing && canDiscard && (
                      <Button
                        size="small"
                        variant="text"
                        color="grey"
                        onClick={() =>
                          setConfirmation({ kind: "discard", recordingId: recording.id, status: recording.status })
                        }
                      >
                        {discardLabel(recording.status)}
                      </Button>
                    )}
                    {!isProcessing &&
                      recording.status === "ready" &&
                      recording.mode === "audio_only" &&
                      recording.audioPath && (
                        <Button
                          size="small"
                          variant="text"
                          color="grey"
                          onClick={() =>
                            setConfirmation({
                              kind: "delete-audio",
                              recordingId: recording.id,
                              status: recording.status,
                            })
                          }
                        >
                          {t("recordings-delete-audio")}
                        </Button>
                      )}
                  </Box>
                </Box>
                {/* The transcript opens in a dialog: a dozen segments inlined
                    here made this column taller than the whole chart. */}
                {recording.status === "ready" && recording.transcriptionId && (
                  <Button
                    variant="outlined"
                    color="primary"
                    fullWidth
                    startIcon={<NiListCheck size="tiny" />}
                    onClick={() =>
                      setTranscriptFor({ recordingId: recording.id, transcriptionId: recording.transcriptionId! })
                    }
                  >
                    {t("transcript-open")}
                  </Button>
                )}
              </Box>
            );
          })}
        </Box>
      </CardContent>

      {transcriptFor && (
        <TranscriptViewer
          recordingId={transcriptFor.recordingId}
          transcriptionId={transcriptFor.transcriptionId}
          consultationId={consultationId}
          onClose={() => setTranscriptFor(null)}
          seekTo={
            seekTo && seekTo.nonce === seekHandled.current ? { start: seekTo.start, nonce: seekTo.nonce } : undefined
          }
        />
      )}

      {/* Destructive actions get a real dialog that names their consequence —
          discarding an OPEN capture can throw away audio still being recorded,
          which is a different loss from clearing a failed attempt. */}
      <Dialog open={confirmation !== null} onClose={() => setConfirmation(null)} maxWidth="xs" fullWidth>
        <DialogHeader
          title={
            confirmation?.kind === "delete-audio"
              ? t("recordings-delete-audio")
              : discardLabel(confirmation?.status ?? "")
          }
          closeLabel={t("close")}
          onClose={() => setConfirmation(null)}
        />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {confirmation?.kind === "delete-audio"
              ? t("recordings-delete-audio-confirm")
              : OPEN_CAPTURE_STATUSES.includes(confirmation?.status ?? "")
                ? t("recordings-discard-open-confirm")
                : t("recordings-discard-confirm")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmation(null)}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              const pending = confirmation;
              setConfirmation(null);
              if (!pending) return;
              if (pending.kind === "delete-audio") void deleteAudio(pending.recordingId);
              else void discard(pending.recordingId, pending.status);
            }}
          >
            {confirmation?.kind === "delete-audio"
              ? t("recordings-delete-audio")
              : discardLabel(confirmation?.status ?? "")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
