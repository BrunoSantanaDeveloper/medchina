"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationConfigure from "@/icons/illustrations/illustration-configure";
import NiBug from "@/icons/nexture/ni-bug";
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
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detail, setDetail] = useState<FailureRow | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase.rpc("admin_processing_failures", { limit_count: 200 });
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(Array.isArray(data) ? (data as FailureRow[]) : []);
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const columns = useMemo<GridColDef<FailureRow>[]>(
    () => [
      {
        field: "created_at",
        headerName: "Quando",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<FailureRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {new Date(params.row.created_at).toLocaleString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "patient_name",
        headerName: "Paciente",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<FailureRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "org_name",
        headerName: "Consultório",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<FailureRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "failure_stage",
        headerName: "Etapa",
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<FailureRow, string | null>) => (
          // No colour on the chip: every row in this grid is a failure, so red
          // would mark nothing here and would spend the one signal that has to
          // stay scarce. The stage is a place, not a severity.
          <Box className="flex h-full items-center">
            {params.value ? (
              <Chip label={params.value} size="small" variant="outlined" />
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                —
              </Typography>
            )}
          </Box>
        ),
      },
      {
        field: "error_code",
        headerName: "Código",
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<FailureRow, string | null>) => (
          <Box className="flex h-full items-center">
            {params.value ? (
              <Chip label={params.value} size="small" variant="outlined" />
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                —
              </Typography>
            )}
          </Box>
        ),
      },
      {
        field: "provider_error",
        headerName: "Erro do provedor",
        flex: 2,
        minWidth: 260,
        // Truncated in the cell, full text in the tooltip — and reachable by
        // the quick filter, exactly as the old plain-text filter allowed.
        renderCell: (params: GridRenderCellParams<FailureRow, string | null>) => {
          const message = params.value?.trim();
          return (
            <Box className="flex h-full items-center">
              <Tooltip title={message ?? ""}>
                <Typography variant="body2" className="text-text-secondary truncate font-mono">
                  {message || "— nenhuma mensagem crua registrada"}
                </Typography>
              </Tooltip>
            </Box>
          );
        },
      },
      {
        // Both identifiers stay in the cell VALUE so a support request quoting
        // either id still finds its row through the quick filter.
        field: "recording_id",
        headerName: "IDs",
        minWidth: 160,
        valueGetter: (_, row) => [row.recording_id, row.consultation_id].filter(Boolean).join(" "),
        renderCell: (params: GridRenderCellParams<FailureRow, string>) => (
          <Box className="flex h-full items-center">
            <Tooltip
              title={`recording_id: ${params.row.recording_id} · consultation_id: ${params.row.consultation_id ?? "—"}`}
            >
              <Typography variant="body2" className="text-text-secondary truncate font-mono">
                {params.row.recording_id.slice(0, 8)}…
              </Typography>
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => [
          <GridActionsCellItem
            key="detail"
            icon={<NiBug size="medium" />}
            label="Ver detalhe da falha"
            onClick={() => setDetail(params.row)}
            showInMenu
          />,
        ],
      },
    ],
    [],
  );

  return (
    <Box className="flex flex-col gap-3">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<FailureRow>
          rows={rows}
          columns={columns}
          getRowId={(row) => row.recording_id}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              layout="row"
              illustration={<IllustrationConfigure />}
              title="Nenhuma falha de processamento"
              description="Gravações cujo pipeline de IA falhou (transcrição, extração ou aplicação) aparecem aqui com o erro cru do provedor — nada para investigar agora."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma falha corresponde à sua busca.
            </Typography>
          }
        />
      )}

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {[detail?.patient_name, detail?.org_name].filter(Boolean).join(" · ") || "Detalhe da falha"}
        </DialogTitle>
        <DialogContent>
          <Box className="flex flex-col gap-3 pt-1">
            <Typography variant="body2" className="text-text-secondary">
              {detail
                ? [
                    new Date(detail.created_at).toLocaleString(),
                    detail.mode,
                    detail.captured_on ? `via ${detail.captured_on}` : null,
                    detail.status,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : ""}
            </Typography>
            <Box className="bg-background-default/50 flex flex-col gap-2 rounded-lg p-3">
              <Box>
                <Typography variant="body2" className="text-text-secondary text-xs font-semibold">
                  Erro do provedor {detail?.transcription_status ? `(transcrição: ${detail.transcription_status})` : ""}
                </Typography>
                <Typography component="pre" variant="body2" className="font-mono break-words whitespace-pre-wrap">
                  {detail?.provider_error?.trim() ||
                    "— nenhuma mensagem crua registrada (veja os logs da Vercel / Inngest nesse horário)"}
                </Typography>
              </Box>
              <Box className="text-text-secondary flex flex-col gap-0.5 font-mono text-xs">
                <span>recording_id: {detail?.recording_id ?? "—"}</span>
                <span>consultation_id: {detail?.consultation_id ?? "—"}</span>
                <span>org_id: {detail?.org_id ?? "—"}</span>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setDetail(null)}>
            Fechar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
