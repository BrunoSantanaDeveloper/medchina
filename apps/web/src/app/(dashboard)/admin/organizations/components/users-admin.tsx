"use client";

import { listUserAdminInfo, resetUserMfa, setUserBanned, UserAdminInfo } from "../actions";
import DeleteAccountDialog from "./delete-account-dialog";
import ImpersonateDialog from "./impersonate-dialog";
import SuperadminDialog from "./superadmin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Chip, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiCrown from "@/icons/nexture/ni-crown";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiShield from "@/icons/nexture/ni-shield";
import NiShieldCross from "@/icons/nexture/ni-shield-cross";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUserCross from "@/icons/nexture/ni-user-cross";
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

const badgesOf = (row: UserTableRow, selfId: string | null) =>
  [
    row.id === selfId ? "you" : null,
    row.isSuperadmin ? "superadmin" : null,
    row.hasMfa ? "2FA" : null,
    row.banned ? "banned" : null,
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
  const [selfId, setSelfId] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<UserTableRow | null>(null);
  const [roleChange, setRoleChange] = useState<{ row: UserTableRow; grant: boolean } | null>(null);
  const [deleting, setDeleting] = useState<UserTableRow | null>(null);

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
        displayName: row.display_name ?? "Unnamed user",
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

  const toggleBan = useCallback(
    async (row: UserTableRow) => {
      setError(null);
      const result = await setUserBanned(row.id, !row.banned);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
    },
    [refresh],
  );

  // Recovery path for a user locked out at the 2FA step-up (lost device).
  const handleResetMfa = useCallback(
    async (row: UserTableRow) => {
      setError(null);
      const result = await resetUserMfa(row.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
    },
    [refresh],
  );

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
        headerName: "User",
        flex: 2,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.displayName}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              since {new Date(params.row.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "email",
        headerName: "Email",
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
        headerName: "Orgs",
        type: "number",
        minWidth: 90,
      },
      {
        // A real date value, so sorting orders by time instead of by the
        // formatted string.
        field: "lastSignInAt",
        headerName: "Last sign-in",
        type: "date",
        minWidth: 150,
        valueGetter: (_, row) => (row.lastSignInAt ? new Date(row.lastSignInAt) : null),
      },
      {
        field: "badges",
        headerName: "State",
        flex: 1,
        minWidth: 200,
        sortable: false,
        valueGetter: (_, row) => badgesOf(row, selfId),
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full flex-row flex-wrap items-center gap-1">
            {params.row.id === selfId && <Chip label="you" size="small" color="primary" variant="outlined" />}
            {params.row.isSuperadmin && <Chip label="superadmin" size="small" color="warning" variant="outlined" />}
            {params.row.hasMfa && <Chip label="2FA" size="small" color="success" variant="outlined" />}
            {params.row.banned && <Chip label="banned" size="small" color="error" variant="outlined" />}
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
        // The auth-side actions need the service role: without it the kebab
        // offers only what RLS alone can authorize (the platform role, whose
        // gate lives in the database — migration 0096).
        getActions: (params) => {
          const row = params.row;
          const canImpersonate = Boolean(serviceAvailable) && row.id !== selfId && !row.isSuperadmin && !row.banned;
          const canResetMfa = Boolean(serviceAvailable) && row.hasMfa;
          const canBan = Boolean(serviceAvailable) && row.id !== selfId;
          // Never on yourself, in either direction — the database refuses it
          // too, so offering it would only produce an error.
          const canChangeRole = row.id !== selfId;
          // Irreversible, and service-role backed (files go through the Storage
          // API). A superadmin has to lose the role first — the database
          // refuses otherwise, so the menu does not offer it.
          const canDelete = Boolean(serviceAvailable) && row.id !== selfId && !row.isSuperadmin;
          return [
            ...(canImpersonate
              ? [
                  <GridActionsCellItem
                    key="impersonate"
                    icon={<NiEyeOpen size="medium" />}
                    label="Impersonate"
                    onClick={() => setImpersonating(row)}
                    showInMenu
                  />,
                ]
              : []),
            ...(canResetMfa
              ? [
                  <GridActionsCellItem
                    key="reset-mfa"
                    icon={<NiShieldCross size="medium" />}
                    label="Reset 2FA (lost-device recovery)"
                    onClick={() => handleResetMfa(row)}
                    showInMenu
                  />,
                ]
              : []),
            ...(canChangeRole
              ? [
                  <GridActionsCellItem
                    key="superadmin"
                    icon={row.isSuperadmin ? <NiShield size="medium" /> : <NiCrown size="medium" />}
                    label={row.isSuperadmin ? "Remove platform superadmin" : "Make platform superadmin"}
                    onClick={() => setRoleChange({ row, grant: !row.isSuperadmin })}
                    showInMenu
                  />,
                ]
              : []),
            ...(canBan
              ? [
                  <GridActionsCellItem
                    key="ban"
                    icon={row.banned ? <NiUserCheck size="medium" /> : <NiUserCross size="medium" />}
                    label={row.banned ? "Unban from the platform" : "Ban from the platform"}
                    onClick={() => toggleBan(row)}
                    showInMenu
                  />,
                ]
              : []),
            ...(canDelete
              ? [
                  <GridActionsCellItem
                    key="delete"
                    icon={<NiBinEmpty size="medium" />}
                    label="Delete account and all data"
                    onClick={() => setDeleting(row)}
                    showInMenu
                  />,
                ]
              : []),
          ];
        },
      },
    ],
    [handleResetMfa, selfId, serviceAvailable, toggleBan],
  );

  return (
    <Box className="flex flex-col gap-3">
      {serviceAvailable === false && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Set SUPABASE_SERVICE_ROLE_KEY to show emails, last sign-in and enable impersonation, 2FA reset, ban/unban and
          account deletion.
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
              title="No users yet"
              description="Every account created through sign-up appears here, with its organizations and auth state."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No users match your search.
            </Typography>
          }
        />
      )}

      <ImpersonateDialog
        open={Boolean(impersonating)}
        userId={impersonating?.id ?? ""}
        userName={impersonating?.displayName ?? ""}
        onClose={() => setImpersonating(null)}
      />

      <SuperadminDialog
        open={Boolean(roleChange)}
        userId={roleChange?.row.id ?? ""}
        userName={roleChange?.row.displayName ?? ""}
        grant={roleChange?.grant ?? false}
        onClose={() => setRoleChange(null)}
        onDone={() => {
          setRoleChange(null);
          refresh();
        }}
      />

      {/* Mounted only while open and keyed by user: every account starts from
          a fresh count of what it holds, never from the previous one's. */}
      {deleting && (
        <DeleteAccountDialog
          key={deleting.id}
          userId={deleting.id}
          userName={deleting.displayName}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            refresh();
          }}
        />
      )}
    </Box>
  );
}
