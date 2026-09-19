"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Chip, Tooltip, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiFingerprint from "@/icons/nexture/ni-fingerprint";
import { createClient } from "@flyee/auth/client";

type AccessRow = {
  id: string;
  userName: string | null;
  ip: string | null;
  userAgent: string | null;
  aal: string | null;
  createdAt: string;
};

/** Crude but scannable browser/OS summary out of a raw user-agent string. */
export const describeAgent = (agent: string | null) => {
  if (!agent) return null;
  const browser = /edg\//i.test(agent)
    ? "Edge"
    : /firefox\//i.test(agent)
      ? "Firefox"
      : /chrome\//i.test(agent)
        ? "Chrome"
        : /safari\//i.test(agent)
          ? "Safari"
          : null;
  const os = /windows/i.test(agent)
    ? "Windows"
    : /mac os x|macintosh/i.test(agent)
      ? "macOS"
      : /android/i.test(agent)
        ? "Android"
        : /iphone|ipad|ios/i.test(agent)
          ? "iOS"
          : /linux/i.test(agent)
            ? "Linux"
            : null;
  return [browser, os].filter(Boolean).join(" · ") || agent.slice(0, 40);
};

/**
 * Sign-in trail viewer: who authenticated, from where, with which assurance
 * level. The operator's job is scanning many events to spot the anomalous
 * one (odd IP, unexpected hour, aal1 where 2FA was expected).
 */
export default function AccessEventsAdmin() {
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("access_events")
      .select("id, ip, user_agent, aal, created_at, profiles(display_name)")
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
        userName: (row.profiles as unknown as { display_name: string | null } | null)?.display_name ?? null,
        ip: row.ip,
        userAgent: row.user_agent,
        aal: row.aal,
        createdAt: row.created_at,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const columns = useMemo<GridColDef<AccessRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "Quando",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AccessRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {new Date(params.row.createdAt).toLocaleString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "userName",
        headerName: "Profissional",
        flex: 1.2,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "Profissional desconhecida"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "ip",
        headerName: "IP",
        flex: 0.8,
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate font-mono">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        // The full user-agent stays the cell VALUE so the quick filter still
        // reaches it (the old plain-text filter searched the raw string); the
        // cell shows the scannable summary, with the raw string in a tooltip.
        field: "userAgent",
        headerName: "Dispositivo",
        flex: 1.2,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.value ?? ""}>
              <Typography variant="body2" className="text-text-secondary truncate">
                {describeAgent(params.value ?? null) ?? "—"}
              </Typography>
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "aal",
        headerName: "Autenticação",
        minWidth: 130,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={params.row.aal === "aal2" ? "2FA" : "senha"}
              size="small"
              color={params.row.aal === "aal2" ? "success" : "default"}
              variant="outlined"
            />
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
        <DataTable<AccessRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiFingerprint size="medium" />}
              title="Nenhum acesso registrado ainda"
              description="Toda nova sessão cai aqui automaticamente (trigger em auth.sessions, migração 0016). Se há acessos acontecendo e nada aparece, aplique a migração."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum acesso corresponde à sua busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
