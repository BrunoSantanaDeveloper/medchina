"use client";

import { getBackupFiles, triggerBackup } from "../actions";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, CircularProgress, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationStorage from "@/icons/illustrations/illustration-storage";
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

/** The status enum as the operator reads it; an unknown value falls back to the raw one. */
const STATUS_LABEL: Record<string, string> = {
  success: "concluído",
  error: "erro",
  running: "rodando",
};

/** What started the run, in words. */
const TRIGGER_LABEL: Record<string, string> = {
  cron: "automático",
  manual: "manual",
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
    ? (row.error ?? "Falhou")
    : [
        `${row.tableCount} tabelas`,
        `${row.rowCount.toLocaleString()} linhas`,
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
        ? "Backup na fila — ele roda em segundo plano e aparece abaixo quando terminar. Atualize em instantes."
        : "Backup concluído (rodou direto, sem fila). Veja a execução mais recente abaixo.",
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
    if (result.data.length === 0) setInfo("Esta execução não tem arquivos armazenados.");
  }, []);

  const columns = useMemo<GridColDef<RunRow>[]>(
    () => [
      {
        field: "startedAt",
        headerName: "Início",
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
        headerName: "Resultado",
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
        headerName: "Origem",
        minWidth: 120,
        valueGetter: (_, row) => TRIGGER_LABEL[row.triggeredBy] ?? row.triggeredBy,
        renderCell: (params: GridRenderCellParams<RunRow, RunRow["triggeredBy"]>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={TRIGGER_LABEL[params.row.triggeredBy] ?? params.row.triggeredBy}
              size="small"
              variant="outlined"
            />
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Situação",
        minWidth: 120,
        valueGetter: (_, row) => STATUS_LABEL[row.status] ?? row.status,
        renderCell: (params: GridRenderCellParams<RunRow, RunRow["status"]>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={STATUS_LABEL[params.row.status] ?? params.row.status}
              size="small"
              color={STATUS_COLOR[params.row.status]}
              variant="outlined"
            />
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
              label="Baixar arquivos"
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
                Backups automáticos
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {lastSuccess
                  ? `Último backup concluído em ${new Date(lastSuccess.startedAt).toLocaleString()} · ${lastSuccess.tableCount} tabelas · ${formatBytes(lastSuccess.totalBytes)}`
                  : "Nenhum backup concluído até agora. A rotina noturna roda às 03:00 UTC; você também pode rodar um agora."}
              </Typography>
            </Box>
          }
          actions={
            <Button variant="contained" size="small" onClick={handleRunNow} disabled={running}>
              {running ? "Iniciando…" : "Rodar backup agora"}
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              layout="row"
              illustration={<IllustrationStorage />}
              title="Nenhum backup ainda"
              description="Cada execução exporta todas as tabelas para o bucket privado de backups. Rode uma agora ou espere a rotina noturna — ela precisa de DATABASE_URL e SUPABASE_SERVICE_ROLE_KEY configuradas."
              action={{ label: "Rodar backup agora", onClick: handleRunNow }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma execução corresponde à sua busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
