"use client";

import { getBackupFiles, triggerBackup } from "../actions";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, CircularProgress, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiArchive from "@/icons/nexture/ni-archive";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import { createClient } from "@flyee/auth/client";

type RunRow = {
  id: string;
  status: "running" | "success" | "error";
  triggeredBy: "cron" | "manual";
  startedAt: string;
  finishedAt: string | null;
  tableCount: number;
  rowCount: number;
  totalBytes: number;
  storagePrefix: string | null;
  error: string | null;
};

const STATUS_COLOR: Record<string, "success" | "error" | "warning"> = {
  success: "success",
  error: "error",
  running: "warning",
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
};

const duration = (start: string, end: string | null) => {
  if (!end) return null;
  const secs = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

/** The old row's secondary line: what the run produced, or why it failed. */
const summaryOf = (row: RunRow) =>
  row.status === "error"
    ? (row.error ?? "Failed")
    : [
        `${row.tableCount} tables`,
        `${row.rowCount.toLocaleString()} rows`,
        formatBytes(row.totalBytes),
        duration(row.startedAt, row.finishedAt),
      ]
        .filter(Boolean)
        .join(" · ");

/**
 * The operator's job here: know backups are actually happening, and grab
 * one when needed. So the screen leads with the last successful run, offers
 * the one action (run now), and lists the history for scanning/downloading.
 */
export default function BackupsAdmin() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("backup_runs")
      .select(
        "id, status, triggered_by, started_at, finished_at, table_count, row_count, total_bytes, storage_prefix, error",
      )
      .order("started_at", { ascending: false })
      .limit(100);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        status: row.status,
        triggeredBy: row.triggered_by,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        tableCount: row.table_count,
        rowCount: row.row_count,
        totalBytes: row.total_bytes,
        storagePrefix: row.storage_prefix,
        error: row.error,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRunNow = useCallback(async () => {
    setError(null);
    setInfo(null);
    setRunning(true);
    const result = await triggerBackup();
    setRunning(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInfo(
      result.data.mode === "queued"
        ? "Backup queued — it runs in the background and appears below when done. Refresh in a moment."
        : "Backup finished (ran inline). See the newest run below.",
    );
    refresh();
  }, [refresh]);

  const handleDownload = useCallback(async (prefix: string) => {
    setError(null);
    setDownloading(prefix);
    const result = await getBackupFiles(prefix);
    setDownloading(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Open each archive's signed URL — the browser downloads them.
    for (const file of result.data) {
      window.open(file.url, "_blank");
    }
    if (result.data.length === 0) setInfo("This run has no stored files.");
  }, []);

  const columns = useMemo<GridColDef<RunRow>[]>(
    () => [
      {
        field: "startedAt",
        headerName: "Started",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<RunRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {new Date(params.row.startedAt).toLocaleString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "summary",
        headerName: "Result",
        flex: 2,
        minWidth: 260,
        sortable: false,
        // The searched text must be reachable as the cell value, not only in
        // the rendered node — this is where a failure message lives.
        valueGetter: (_, row) => summaryOf(row),
        renderCell: (params: GridRenderCellParams<RunRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "triggeredBy",
        headerName: "Trigger",
        minWidth: 120,
        renderCell: (params: GridRenderCellParams<RunRow, RunRow["triggeredBy"]>) => (
          <Box className="flex h-full items-center">
            <Chip label={params.row.triggeredBy} size="small" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 120,
        renderCell: (params: GridRenderCellParams<RunRow, RunRow["status"]>) => (
          <Box className="flex h-full items-center">
            <Chip label={params.row.status} size="small" color={STATUS_COLOR[params.row.status]} variant="outlined" />
          </Box>
        ),
      },
      {
        // Download stays visible on the row (it was a visible button before):
        // grabbing an archive is the reason the operator opens this list.
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => {
          const prefix = params.row.storagePrefix;
          if (params.row.status !== "success" || !prefix) return [];
          const busy = downloading === prefix;
          return [
            <GridActionsCellItem
              key="download"
              icon={busy ? <CircularProgress size={14} /> : <NiDownloadCloud size="medium" />}
              label="Download archives"
              disabled={busy}
              onClick={() => handleDownload(prefix)}
            />,
          ];
        },
      },
    ],
    [downloading, handleDownload],
  );

  const lastSuccess = rows.find((row) => row.status === "success");

  return (
    <Box className="flex flex-col gap-4">
      {info && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {info}
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<RunRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          header={
            <Box>
              <Typography variant="h5" component="h2" className="card-title mb-1">
                Automatic backups
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {lastSuccess
                  ? `Last successful backup ${new Date(lastSuccess.startedAt).toLocaleString()} · ${lastSuccess.tableCount} tables · ${formatBytes(lastSuccess.totalBytes)}`
                  : "No successful backup recorded yet. The nightly job runs at 03:00 UTC; you can also run one now."}
              </Typography>
            </Box>
          }
          actions={
            <Button variant="contained" size="small" onClick={handleRunNow} disabled={running}>
              {running ? "Starting…" : "Run backup now"}
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              icon={<NiArchive size="medium" />}
              title="No backups yet"
              description="Each run exports every table to the private backups bucket. Start one now, or wait for the nightly job — it needs DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY set."
              action={{ label: "Run backup now", onClick: handleRunNow }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No backup runs match your search.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
