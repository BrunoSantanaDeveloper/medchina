"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, CircularProgress, Typography } from "@mui/material";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Recording = {
  id: string;
  status: string;
  durationSeconds: number | null;
  createdAt: string;
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
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setRecordings([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("recordings")
      .select("id, status, duration_seconds, created_at")
      .eq("consultation_id", consultationId)
      .order("created_at", { ascending: false });
    setRecordings(
      (data ?? []).map((row) => ({
        id: row.id,
        status: row.status,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
      })),
    );
  }, [consultationId]);

  useEffect(() => {
    load();
  }, [load]);

  const process = async (recordingId: string) => {
    setBusyId(recordingId);
    setError(null);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/process`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? t("recordings-process-error"));
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
            .select("status, error")
            .eq("id", recordingId)
            .maybeSingle();
          if (data && data.status !== "processing") {
            if (data.status === "failed") setError(data.error ?? t("recordings-process-error"));
            break;
          }
        }
      }
      await load();
      onProcessed();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("recordings-process-error"));
    } finally {
      setBusyId(null);
    }
  };

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

        {error && (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        )}

        <Box className="flex flex-col gap-2">
          {recordings.map((recording) => {
            const canProcess = recording.status === "uploaded" || recording.status === "failed";
            const isProcessing = recording.status === "processing" || busyId === recording.id;
            const duration = recording.durationSeconds
              ? `${String(Math.floor(recording.durationSeconds / 60)).padStart(2, "0")}:${String(recording.durationSeconds % 60).padStart(2, "0")}`
              : null;
            return (
              <Box
                key={recording.id}
                className="border-grey-100 flex flex-row items-center gap-3 rounded-2xl border px-3 py-2.5"
              >
                <Box className="min-w-0 flex-1">
                  <Typography variant="body2" className="text-text-primary font-medium">
                    {new Date(recording.createdAt).toLocaleString()}
                    {duration ? ` · ${duration}` : ""}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary text-xs">
                    {statusLabel(recording.status)}
                  </Typography>
                </Box>
                {isProcessing ? (
                  <CircularProgress size={20} />
                ) : recording.status === "ready" ? (
                  <span className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light rounded-full px-2.5 py-1 text-xs font-semibold">
                    {t("recordings-status-ready")}
                  </span>
                ) : canProcess ? (
                  <Button size="small" variant="contained" color="primary" onClick={() => process(recording.id)}>
                    {t("recordings-process")}
                  </Button>
                ) : null}
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
