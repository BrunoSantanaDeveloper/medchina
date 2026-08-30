"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiBuilding from "@/icons/nexture/ni-building";
import NiUsers from "@/icons/nexture/ni-users";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type LiveSub = { id: string; status: string; adminSuspended: boolean; planName: string };

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  liveSub: LiveSub | null;
};

type MemberRow = { userId: string; role: string; displayName: string; joinedAt: string };

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  active: "success",
  trialing: "warning",
  past_due: "error",
};

const LIVE_STATUSES = ["trialing", "active", "past_due"];

/** The searched text must be reachable as a cell value, not only in the node. */
const statusTextOf = (row: OrgRow) =>
  row.liveSub
    ? `${row.liveSub.status.replace("_", " ")}${row.liveSub.adminSuspended ? " suspended" : ""}`
    : "no subscription";

/**
 * The operator's job here really is scan/manage many tenants: find an org,
 * see its plan health and roster, and act (suspend / reactivate access).
 */
export default function OrgsAdmin() {
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [membersOrg, setMembersOrg] = useState<OrgRow | null>(null);
  const [members, setMembers] = useState<Record<string, MemberRow[]>>({});
  // Mirrors which rosters were already fetched so the column defs stay stable.
  const fetchedMembers = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("organizations")
      .select(
        "id, name, slug, created_at, memberships(count), subscriptions(id, status, admin_suspended, created_at, plans(name))",
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
      (data ?? []).map((row) => {
        const subs =
          (row.subscriptions as unknown as {
            id: string;
            status: string;
            admin_suspended: boolean;
            created_at: string;
            plans: { name: string } | null;
          }[]) ?? [];
        const live = subs
          .filter((sub) => LIVE_STATUSES.includes(sub.status))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          createdAt: row.created_at,
          memberCount: (row.memberships as unknown as { count: number }[])?.[0]?.count ?? 0,
          liveSub: live
            ? {
                id: live.id,
                status: live.status,
                adminSuspended: live.admin_suspended,
                planName: live.plans?.name ?? "Unknown plan",
              }
            : null,
        };
      }),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The roster is still fetched lazily — now when the dialog opens instead of
  // when the row expanded.
  const openMembers = useCallback(async (org: OrgRow) => {
    setMembersOrg(org);
    if (fetchedMembers.current.has(org.id)) return;
    fetchedMembers.current.add(org.id);
    const supabase = createClient();
    const { data } = await supabase
      .from("memberships")
      .select("user_id, role, created_at, profiles(display_name)")
      .eq("org_id", org.id)
      .order("created_at");
    setMembers((current) => ({
      ...current,
      [org.id]: (data ?? []).map((row) => ({
        userId: row.user_id,
        role: row.role,
        displayName:
          (row.profiles as unknown as { display_name: string | null } | null)?.display_name ?? "Unnamed user",
        joinedAt: row.created_at,
      })),
    }));
  }, []);

  // Superadmin kill-switch on the live subscription, same semantics as the
  // Billing console (access suspension independent of the provider state).
  const toggleSuspended = useCallback(
    async (org: OrgRow) => {
      if (!org.liveSub) return;
      setError(null);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ admin_suspended: !org.liveSub.adminSuspended })
        .eq("id", org.liveSub.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      recordAudit(supabase, org.liveSub.adminSuspended ? "admin.org.reactivated" : "admin.org.suspended", {
        orgId: org.id,
        entityType: "subscription",
        entityId: org.liveSub.id,
        metadata: { org: org.name },
      });
      refresh();
    },
    [refresh],
  );

  const columns = useMemo<GridColDef<OrgRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Organization",
        flex: 2,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<OrgRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.name}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              since {new Date(params.row.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "slug",
        headerName: "Slug",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<OrgRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.slug}
            </Typography>
          </Box>
        ),
      },
      {
        field: "plan",
        headerName: "Plan",
        flex: 1,
        minWidth: 140,
        valueGetter: (_, row) => row.liveSub?.planName ?? "no subscription",
        renderCell: (params: GridRenderCellParams<OrgRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip label={params.value} size="small" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 170,
        valueGetter: (_, row) => statusTextOf(row),
        renderCell: (params: GridRenderCellParams<OrgRow, string>) => {
          const sub = params.row.liveSub;
          if (!sub) {
            return (
              <Box className="flex h-full items-center">
                <Chip label="no subscription" size="small" variant="outlined" />
              </Box>
            );
          }
          return (
            <Box className="flex h-full flex-row items-center gap-1">
              <Chip
                label={sub.status.replace("_", " ")}
                size="small"
                color={STATUS_COLOR[sub.status] ?? "default"}
                variant="outlined"
                className="capitalize"
              />
              {sub.adminSuspended && <Chip label="suspended" size="small" color="error" variant="outlined" />}
            </Box>
          );
        },
      },
      {
        field: "memberCount",
        headerName: "Members",
        type: "number",
        minWidth: 110,
      },
      {
        // Suspend/reactivate is the audited kill-switch: it stays visible on
        // the row, never buried in the kebab.
        field: "access",
        headerName: "Access",
        minWidth: 110,
        type: "boolean",
        valueGetter: (_, row) => Boolean(row.liveSub && !row.liveSub.adminSuspended),
        renderCell: (params: GridRenderCellParams<OrgRow, boolean>) => {
          const sub = params.row.liveSub;
          if (!sub) return null;
          return (
            <Box className="flex h-full items-center">
              <Tooltip title={sub.adminSuspended ? "Reactivate access" : "Suspend access"}>
                <Switch
                  checked={!sub.adminSuspended}
                  onChange={() => toggleSuspended(params.row)}
                  size="small"
                  slotProps={{
                    input: {
                      "aria-label": sub.adminSuspended
                        ? `Reactivate access for ${params.row.name}`
                        : `Suspend access for ${params.row.name}`,
                    },
                  }}
                />
              </Tooltip>
            </Box>
          );
        },
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
            key="members"
            icon={<NiUsers size="medium" />}
            label="View members"
            onClick={() => openMembers(params.row)}
            showInMenu
          />,
        ],
      },
    ],
    [openMembers, toggleSuspended],
  );

  const roster = membersOrg ? members[membersOrg.id] : undefined;

  return (
    <Box className="flex flex-col gap-3">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<OrgRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiBuilding size="medium" />}
              title="No organizations yet"
              description="Organizations appear here as soon as users sign up. Each one starts on the free plan automatically."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No organizations match your search.
            </Typography>
          }
        />
      )}

      <Dialog open={Boolean(membersOrg)} onClose={() => setMembersOrg(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Members of {membersOrg?.name}</DialogTitle>
        <DialogContent>
          <Box className="flex flex-col gap-3 pt-1">
            {!roster && (
              <Typography variant="body2" className="text-text-secondary">
                Loading members…
              </Typography>
            )}
            {roster && roster.length === 0 && (
              <Typography variant="body2" className="text-text-secondary">
                This organization has no members.
              </Typography>
            )}
            {(roster ?? []).map((member) => (
              <Box key={member.userId} className="flex flex-row items-center gap-3">
                <Box className="flex min-w-0 flex-1 flex-col">
                  <Typography variant="body1" className="text-text-primary truncate font-medium">
                    {member.displayName}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary truncate">
                    joined {new Date(member.joinedAt).toLocaleDateString()}
                  </Typography>
                </Box>
                <Chip label={member.role} size="small" variant="outlined" className="capitalize" />
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setMembersOrg(null)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
