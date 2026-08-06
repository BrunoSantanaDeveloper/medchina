"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Chip, Collapse, FormControl, Input, Typography } from "@mui/material";

import { RowLine, RowText } from "@/app/(dashboard)/admin/billing/components/catalog-shared";
import EmptyState from "@/components/product/empty-state";
import NiExclamationHexagon from "@/icons/nexture/ni-exclamation-hexagon";
import { createClient } from "@flyee/auth/client";

type FailureRow = {
  recording_id: string;
  created_at: string;
  status: string | null;
  failure_stage: string | null;
  error_code: string | null;
  mode: string | null;
  captured_on: string | null;
  consultation_id: string | null;
  org_id: string | null;
  org_name: string | null;
  patient_name: string | null;
  transcription_status: string | null;
  /** The RAW provider message — the reason you cannot see anywhere else. */
  provider_error: string | null;
};

/**
 * AI-pipeline failures across every workspace (RPC admin_processing_failures,
 * SECURITY DEFINER + superadmin gate). The job: a professional reported "the
 * recording won't process" — find that recording and read the REAL cause
 * (recordings.failure_stage/error_code + the raw transcriptions.error) without
 * their account and without reproducing it.
 */
export default function ProcessingFailuresAdmin() {
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase.rpc("admin_processing_failures", { limit_count: 200 });
    if (readError) {
      setError(readError.message);
      setLoaded(true);
      return;
    }
    setRows(Array.isArray(data) ? (data as FailureRow[]) : []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const visible = rows.filter((row) => {
    if (!filter) return true;
    const query = filter.toLowerCase();
    return [
      row.patient_name,
      row.org_name,
      row.failure_stage,
      row.error_code,
      row.provider_error,
      row.consultation_id,
      row.recording_id,
    ]
      .filter(Boolean)
      .some((value) => (value as string).toLowerCase().includes(query));
  });

  if (loaded && rows.length === 0 && !error) {
    return (
      <EmptyState
        icon={<NiExclamationHexagon size="medium" />}
        title="No processing failures"
        description="Recordings whose AI pipeline failed (transcription, extraction or apply) appear here with the raw provider error — nothing to investigate right now."
      />
    );
  }

  return (
    <Box className="flex flex-col gap-3">
      <FormControl className="outlined w-72" variant="standard" size="small">
        <Input
          placeholder="Filter by patient, org, stage, code or error"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </FormControl>

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {visible.map((row) => (
        <Box key={row.recording_id} className="flex flex-col">
          <Box
            className="cursor-pointer"
            onClick={() => setExpanded((current) => (current === row.recording_id ? null : row.recording_id))}
          >
            <RowLine>
              {row.failure_stage && <Chip label={row.failure_stage} size="small" color="error" variant="outlined" />}
              {row.error_code && <Chip label={row.error_code} size="small" variant="outlined" />}
              <RowText
                primary={[row.patient_name, row.org_name].filter(Boolean).join(" · ") || "—"}
                secondary={[
                  new Date(row.created_at).toLocaleString(),
                  row.mode,
                  row.captured_on ? `via ${row.captured_on}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </RowLine>
          </Box>
          <Collapse in={expanded === row.recording_id}>
            <Box className="bg-background-default/50 my-2 flex flex-col gap-2 rounded-lg p-3">
              <Box>
                <Typography variant="body2" className="text-text-secondary text-xs font-semibold">
                  Provider error {row.transcription_status ? `(transcription: ${row.transcription_status})` : ""}
                </Typography>
                <Typography component="pre" variant="body2" className="font-mono break-words whitespace-pre-wrap">
                  {row.provider_error?.trim() || "— no raw message stored (check Vercel / Inngest logs for this time)"}
                </Typography>
              </Box>
              <Box className="text-text-secondary flex flex-col gap-0.5 font-mono text-xs">
                <span>recording_id: {row.recording_id}</span>
                <span>consultation_id: {row.consultation_id ?? "—"}</span>
                <span>org_id: {row.org_id ?? "—"}</span>
              </Box>
            </Box>
          </Collapse>
        </Box>
      ))}
      {loaded && visible.length === 0 && rows.length > 0 && (
        <Typography variant="body2" className="text-text-secondary">
          No failures match the filter.
        </Typography>
      )}
    </Box>
  );
}
