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
import NiBraces from "@/icons/nexture/ni-braces";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import { createClient } from "@flyee/auth/client";

type AuditRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  actorName: string | null;
  orgName: string | null;
  createdAt: string;
};

const entityOf = (row: AuditRow) =>
  row.entityType ? `${row.entityType}${row.entityId ? ` · ${row.entityId}` : ""}` : "";

/**
 * Compliance viewer over the append-only audit trail (packages/audit).
 * The job is scan/inspect many events: filter, find the one that matters,
 * open its metadata.
 */
export default function AuditEventsAdmin() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("audit_events")
      .select("id, action, entity_type, entity_id, metadata, created_at, profiles(display_name), organizations(name)")
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
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        actorName: (row.profiles as unknown as { display_name: string | null } | null)?.display_name ?? null,
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

  const columns = useMemo<GridColDef<AuditRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "When",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AuditRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {new Date(params.row.createdAt).toLocaleString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "action",
        headerName: "Action",
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<AuditRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip label={params.row.action} size="small" color="primary" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "entity",
        headerName: "Entity",
        flex: 1.5,
        minWidth: 220,
        // The searched text must be reachable as the cell value, not only in
        // the rendered node.
        valueGetter: (_, row) => entityOf(row),
        renderCell: (params: GridRenderCellParams<AuditRow, string>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.value || ""}>
              <Typography variant="body2" className="text-text-secondary truncate font-mono">
                {params.value || "—"}
              </Typography>
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "actorName",
        headerName: "Actor",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<AuditRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "orgName",
        headerName: "Workspace",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<AuditRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
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
            key="metadata"
            icon={<NiBraces size="medium" />}
            label="View metadata"
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
        <DataTable<AuditRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiShieldCheck size="medium" />}
              title="No audit events yet"
              description="Events recorded through logAuditEvent (packages/audit) appear here — the trail is append-only, so nothing can be edited or deleted."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No events match your search.
            </Typography>
          }
        />
      )}

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detail?.action ?? "Event metadata"}</DialogTitle>
        <DialogContent>
          <Box className="flex flex-col gap-3 pt-1">
            <Typography variant="body2" className="text-text-secondary">
              {detail
                ? [entityOf(detail), detail.actorName, detail.orgName, new Date(detail.createdAt).toLocaleString()]
                    .filter(Boolean)
                    .join(" · ")
                : ""}
            </Typography>
            <Box className="bg-background-default/50 overflow-x-auto rounded-lg p-3">
              <Typography component="pre" variant="body2" className="font-mono whitespace-pre-wrap">
                {detail && Object.keys(detail.metadata).length > 0
                  ? JSON.stringify(detail.metadata, null, 2)
                  : "No metadata was recorded with this event."}
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setDetail(null)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
