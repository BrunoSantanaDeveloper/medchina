"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Chip, Tooltip, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationSupport from "@/icons/illustrations/illustration-support";
import { createClient } from "@flyee/auth/client";

type WaRow = {
  id: string;
  direction: string;
  toNumber: string | null;
  fromNumber: string | null;
  kind: string;
  text: string | null;
  template: string | null;
  status: string;
  error: string | null;
  provider: string | null;
  orgName: string | null;
  createdAt: string;
};

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  sent: "success",
  delivered: "success",
  read: "success",
  queued: "warning",
  scheduled: "warning",
  failed: "error",
};

/** The delivery enum as the operator reads it; an unknown value falls back to the raw one. */
const STATUS_LABEL: Record<string, string> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  queued: "na fila",
  scheduled: "agendada",
  failed: "falhou",
};

/** The old row's primary line: what was actually sent. */
const messageOf = (row: WaRow) => row.text ?? (row.template ? `template: ${row.template}` : row.kind);

/** Cross-tenant log of every WhatsApp message the dispatcher handled. */
export default function WaLogAdmin() {
  const [rows, setRows] = useState<WaRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("wa_messages")
      .select(
        "id, direction, to_number, from_number, kind, text, template, status, error, provider, created_at, organizations(name)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        direction: row.direction,
        toNumber: row.to_number,
        fromNumber: row.from_number,
        kind: row.kind,
        text: row.text,
        template: row.template,
        status: row.status,
        error: row.error,
        provider: row.provider,
        orgName: (row.organizations as unknown as { name: string } | null)?.name ?? null,
        createdAt: row.created_at,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const columns = useMemo<GridColDef<WaRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "Quando",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<WaRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {new Date(params.row.createdAt).toLocaleString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "direction",
        headerName: "Direção",
        minWidth: 120,
        renderCell: (params: GridRenderCellParams<WaRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={params.row.direction === "inbound" ? "entrada" : "saída"}
              size="small"
              color={params.row.direction === "inbound" ? "secondary" : "primary"}
              variant="outlined"
            />
          </Box>
        ),
      },
      {
        field: "message",
        headerName: "Mensagem",
        flex: 2,
        minWidth: 260,
        // The body must stay reachable by the quick filter, as it was by the
        // old plain-text filter — truncated here, full text in the tooltip.
        valueGetter: (_, row) => messageOf(row),
        renderCell: (params: GridRenderCellParams<WaRow, string>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.value ?? ""}>
              <Typography variant="body2" className="text-text-secondary truncate">
                {params.value}
              </Typography>
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "fromNumber",
        headerName: "De",
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<WaRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate font-mono">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "toNumber",
        headerName: "Para",
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<WaRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate font-mono">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "orgName",
        headerName: "Consultório",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<WaRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "provider",
        headerName: "Provedor",
        minWidth: 130,
        renderCell: (params: GridRenderCellParams<WaRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Situação",
        minWidth: 130,
        valueGetter: (_, row) => STATUS_LABEL[row.status] ?? row.status,
        renderCell: (params: GridRenderCellParams<WaRow, string>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.error ?? ""}>
              <Chip
                label={STATUS_LABEL[params.row.status] ?? params.row.status}
                size="small"
                color={STATUS_COLOR[params.row.status] ?? "default"}
                variant="outlined"
                className="capitalize"
              />
            </Tooltip>
          </Box>
        ),
      },
      {
        // The delivery error was a fragment of the old secondary line; kept as
        // its own column (hidden by default) so it stays readable/exportable.
        field: "error",
        headerName: "Erro",
        flex: 1.5,
        minWidth: 220,
        renderCell: (params: GridRenderCellParams<WaRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.value ?? ""}>
              <Typography variant="body2" className="text-text-secondary truncate font-mono">
                {params.value ?? "—"}
              </Typography>
            </Tooltip>
          </Box>
        ),
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
        <DataTable<WaRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          initialColumnVisibility={{ error: false }}
          noRowsOverlay={
            <EmptyState
              layout="row"
              illustration={<IllustrationSupport />}
              title="Nenhuma mensagem do WhatsApp ainda"
              description="Toda mensagem enviada ou recebida pelo dispatcher do WhatsApp (packages/whatsapp) fica registrada aqui com a situação de entrega."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma mensagem corresponde à sua busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
