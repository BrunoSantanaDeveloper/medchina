"use client";

import { listUserAdminInfo, UserAdminInfo } from "../actions";
import { sinceDays } from "./account-overview";
import { usePersonActions } from "./person-actions";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiUsers from "@/icons/nexture/ni-users";
import { createClient } from "@flyee/auth/client";

type UserRow = {
  id: string;
  displayName: string;
  isSuperadmin: boolean;
  createdAt: string;
  orgCount: number;
};

/** The profile row plus the auth-side fields, so every scanned/searched value
 *  is reachable as a cell value (the quick filter reads values, not nodes). */
type UserTableRow = UserRow & {
  email: string | null;
  lastSignInAt: string | null;
  hasMfa: boolean;
  banned: boolean;
};

const isBanned = (info?: UserAdminInfo) =>
  Boolean(info?.bannedUntil && new Date(info.bannedUntil).getTime() > Date.now());

/** One source for the badge wording, so the cell, the quick filter and the CSV
 *  all say the same thing. They used to disagree: the cell read "bloqueada"
 *  while the searchable value was "banned", so searching what you SAW on the
 *  screen returned nothing. */
const BADGE_LABEL = { self: "você", superadmin: "superadmin", mfa: "2FA", banned: "bloqueada" } as const;

/**
 * One page, deliberately: this console is for scanning, not for paging. But a
 * cap that never says it capped turns the roster into a claim — from the 201st
 * professional on, the console would state that the platform has 200 and that
 * a search found nobody, indistinguishable from a legitimate empty result.
 * So ask for ONE row more than is shown: if it comes back, the list is short.
 */
const PAGE = 200;

const badgesOf = (row: UserTableRow, selfId: string | null) =>
  [
    row.id === selfId ? BADGE_LABEL.self : null,
    row.isSuperadmin ? BADGE_LABEL.superadmin : null,
    row.hasMfa ? BADGE_LABEL.mfa : null,
    row.banned ? BADGE_LABEL.banned : null,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * Platform-wide user roster: find a user, see how they use the platform
 * (orgs, last sign-in) and act (impersonate / reset 2FA / ban / delete). Auth-side
 * fields need the service role and degrade gracefully without it.
 */
export default function UsersAdmin() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [authInfo, setAuthInfo] = useState<Record<string, UserAdminInfo>>({});
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [selfId, setSelfId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setSelfId(user?.id ?? null);

    const { data, error: readError } = await supabase
      .from("profiles")
      .select("id, display_name, is_superadmin, created_at, memberships(count)")
      .order("created_at", { ascending: false })
      .limit(PAGE + 1);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    const page = data ?? [];
    setTruncated(page.length > PAGE);
    setRows(
      page.slice(0, PAGE).map((row) => ({
        id: row.id,
        displayName: row.display_name ?? "Profissional sem nome",
        isSuperadmin: row.is_superadmin,
        createdAt: row.created_at,
        orgCount: (row.memberships as unknown as { count: number }[])?.[0]?.count ?? 0,
      })),
    );

    const info = await listUserAdminInfo();
    if (info.ok) {
      setServiceAvailable(true);
      setAuthInfo(Object.fromEntries(info.data.map((entry) => [entry.id, entry])));
    } else {
      setServiceAvailable(info.error === "not-configured" ? false : null);
    }
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { buildItems, dialogs } = usePersonActions({ selfId, serviceAvailable, onChanged: refresh });

  const tableRows = useMemo<UserTableRow[]>(
    () =>
      rows.map((row) => {
        const info = authInfo[row.id];
        return {
          ...row,
          email: info?.email ?? null,
          lastSignInAt: info?.lastSignInAt ?? null,
          hasMfa: Boolean(info?.hasMfa),
          banned: isBanned(info),
        };
      }),
    [rows, authInfo],
  );

  const columns = useMemo<GridColDef<UserTableRow>[]>(
    () => [
      {
        field: "displayName",
        headerName: "Profissional",
        flex: 2,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.displayName}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              desde {new Date(params.row.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "email",
        headerName: "E-mail",
        flex: 2,
        minWidth: 200,
        valueGetter: (_, row) => row.email ?? "",
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.email ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "orgCount",
        headerName: "Consultórios",
        type: "number",
        minWidth: 90,
      },
      {
        // A real date value, so sorting orders by time instead of by the
        // formatted string.
        field: "lastSignInAt",
        headerName: "Último acesso",
        type: "date",
        minWidth: 150,
        valueGetter: (_, row) => (row.lastSignInAt ? new Date(row.lastSignInAt) : null),
        // An empty cell fused two different facts: "she signed up and never
        // came back" — the strongest support signal on this tab — and "the
        // auth lookup failed, so we do not know". Both used to render as
        // nothing. Say which one it is, and never claim "nunca acessou" on a
        // roster whose sign-in data never arrived.
        renderCell: (params: GridRenderCellParams<UserTableRow, Date | null>) => {
          const at = params.row.lastSignInAt;
          if (at) {
            return (
              <Box className="flex h-full items-center">
                <Typography variant="body2">{sinceDays(at)}</Typography>
              </Box>
            );
          }
          const known = serviceAvailable === true;
          return (
            <Box className="flex h-full items-center">
              <Typography variant="body2" className={known ? "text-accent-3" : "text-text-secondary"}>
                {known ? "nunca acessou" : "não verificado"}
              </Typography>
            </Box>
          );
        },
      },
      {
        field: "badges",
        headerName: "Situação",
        flex: 1,
        minWidth: 200,
        sortable: false,
        valueGetter: (_, row) => badgesOf(row, selfId),
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full flex-row flex-wrap items-center gap-1">
            {/* These two come from `profiles` and are always true or false. */}
            {params.row.id === selfId && (
              <Chip label={BADGE_LABEL.self} size="small" color="primary" variant="outlined" />
            )}
            {params.row.isSuperadmin && (
              <Chip label={BADGE_LABEL.superadmin} size="small" color="warning" variant="outlined" />
            )}
            {/* These two do not. `hasMfa` and `banned` are derived from the
                auth listing, and both collapse to false for EVERY row when
                that call fails — so drawing nothing would have the console
                swear that nobody has a second factor and nobody is blocked.
                Absence of an answer is not an answer. */}
            {serviceAvailable === true ? (
              <>
                {params.row.hasMfa && <Chip label={BADGE_LABEL.mfa} size="small" color="success" variant="outlined" />}
                {params.row.banned && <Chip label={BADGE_LABEL.banned} size="small" color="error" variant="outlined" />}
              </>
            ) : (
              // Same two words the "Último acesso" column uses in the same
              // situation, and short on purpose: this repeats on every row,
              // and the alert at the top of the tab spells out which fields
              // it covers.
              <Typography variant="body2" className="text-text-secondary">
                não verificado
              </Typography>
            )}
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
        // Every escalated action lives in `usePersonActions`, so this tab and
        // the accounts tab offer the same set with the same guards. They used
        // to exist only here, while the accounts tab identified its rows BY
        // the professional and offered none of them.
        getActions: (params) =>
          buildItems({
            userId: params.row.id,
            name: params.row.displayName,
            email: params.row.email,
            isSuperadmin: params.row.isSuperadmin,
            hasMfa: params.row.hasMfa,
            banned: params.row.banned,
          }),
      },
    ],
    [buildItems, selfId, serviceAvailable],
  );

  return (
    <Box className="flex flex-col gap-3">
      {serviceAvailable === false && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Defina SUPABASE_SERVICE_ROLE_KEY para ver e-mail, último acesso, 2FA e bloqueio, e para habilitar entrar como,
          redefinir 2FA, bloquear/desbloquear e excluir conta.
        </Alert>
      )}

      {/* A check that FAILED is not the same as a key that is missing, and it
          must not read as "these actions do not exist". */}
      {serviceAvailable === null && loaded && (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={<Button onClick={refresh}>Tentar de novo</Button>}
        >
          Não foi possível consultar a autenticação agora: e-mail, último acesso, 2FA e bloqueio aparecem como não
          verificados, e entrar como, redefinir 2FA, bloquear e excluir estão fora do menu. A lista de profissionais
          abaixo está completa — o que falta é o lado da autenticação.
        </Alert>
      )}

      {/* The cap has to announce itself. Without this the roster silently
          becomes a claim: "the platform has 200" and "your search found
          nobody" would be indistinguishable from the truth. */}
      {truncated && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Esta lista mostra as {PAGE} profissionais mais recentes e há mais cadastradas. A busca aqui só procura dentro
          destas {PAGE} — para achar alguém mais antiga, procure pela conta dela na aba Contas.
        </Alert>
      )}

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<UserTableRow>
          rows={tableRows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiUsers size="medium" />}
              title="Nenhuma profissional ainda"
              description="Toda conta criada pelo cadastro aparece aqui, com seus consultórios e o estado de autenticação."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma profissional corresponde à busca.
            </Typography>
          }
        />
      )}

      {dialogs}
    </Box>
  );
}
