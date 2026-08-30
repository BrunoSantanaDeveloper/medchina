"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, Input, Select, Switch, Tooltip, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type SubRow = {
  id: string;
  orgId: string;
  status: string;
  adminSuspended: boolean;
  period: string | null;
  provider: string | null;
  orgName: string;
  planName: string;
  createdAt: string;
  /** Unspent à-la-carte minutes, so a grant is never made blind. */
  packMinutes: number;
  planId: string;
  /** A provider-backed subscription cannot be re-planned from here. */
  providerManaged: boolean;
};

/** Tiers a workspace can be put on: real subscriptions, never add-ons. */
type AssignablePlan = { id: string; name: string; isFree: boolean };

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  active: "success",
  trialing: "warning",
  past_due: "error",
  incomplete: "default",
};

/** The old row's secondary line: which plan, on what terms, since when. */
const planLineOf = (row: SubRow) =>
  `${row.period ? `${row.period} · ` : ""}${row.provider ? `${row.provider} · ` : ""}since ${new Date(row.createdAt).toLocaleDateString()}`;

export default function SubscriptionsAdmin() {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [grantDraft, setGrantDraft] = useState<Record<string, string>>({});
  const [granting, setGranting] = useState<string | null>(null);
  const [plans, setPlans] = useState<AssignablePlan[]>([]);
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data, error: readError }, { data: packs }, { data: planRows }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select(
          "id, org_id, plan_id, status, admin_suspended, period, provider, provider_subscription_id, created_at, organizations(name), plans(name)",
        )
        .in("status", ["trialing", "active", "past_due", "incomplete"])
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("audio_minute_packs")
        .select("org_id, seconds_total, seconds_consumed")
        .or("expires_at.is.null,expires_at.gt." + new Date().toISOString()),
      // Assignable tiers only. An add-on is a one-off pack, not something a
      // workspace can be subscribed to — `set_org_plan` refuses those anyway,
      // so offering them here would only produce errors.
      supabase
        .from("plans")
        .select("id, name, is_free, is_addon, kind, period")
        .eq("is_active", true)
        .eq("is_addon", false)
        .eq("kind", "recurring")
        .not("period", "is", null)
        .order("sort"),
    ]);

    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }

    setPlans((planRows ?? []).map((plan) => ({ id: plan.id, name: plan.name, isFree: Boolean(plan.is_free) })));

    const remainingByOrg = new Map<string, number>();
    for (const pack of packs ?? []) {
      const left = Math.max(0, (pack.seconds_total as number) - (pack.seconds_consumed as number));
      remainingByOrg.set(pack.org_id as string, (remainingByOrg.get(pack.org_id as string) ?? 0) + left);
    }

    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        orgId: row.org_id,
        status: row.status,
        adminSuspended: row.admin_suspended,
        period: row.period,
        provider: row.provider,
        orgName: (row.organizations as unknown as { name: string } | null)?.name ?? "Unknown org",
        planName: (row.plans as unknown as { name: string } | null)?.name ?? "Unknown plan",
        createdAt: row.created_at,
        packMinutes: Math.floor((remainingByOrg.get(row.org_id) ?? 0) / 60),
        planId: row.plan_id,
        providerManaged: Boolean(row.provider_subscription_id),
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Superadmin kill-switch: suspends/reactivates access regardless of the
  // provider-side subscription state.
  const toggleSuspended = useCallback(
    async (row: SubRow) => {
      setError(null);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ admin_suspended: !row.adminSuspended })
        .eq("id", row.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      recordAudit(supabase, row.adminSuspended ? "admin.org.reactivated" : "admin.org.suspended", {
        entityType: "subscription",
        entityId: row.id,
        metadata: { org: row.orgName },
      });
      refresh();
    },
    [refresh],
  );

  /**
   * Makes a workspace whole after an incident (a failed pipeline that still
   * billed, a support agreement). Goes through the guarded RPC because the
   * pack ledger has no client write path at all — and it lands in the audit
   * trail, which is the point: handing out paid capability is exactly the kind
   * of act that must be attributable afterwards.
   */
  const grantMinutes = useCallback(
    async (row: SubRow) => {
      setError(null);
      const minutes = Number(grantDraft[row.orgId]);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        setError("Enter how many minutes to grant.");
        return;
      }
      setGranting(row.orgId);
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("grant_audio_minute_pack", {
        target_org: row.orgId,
        target_minutes: Math.floor(minutes),
        target_note: "Granted from the billing console",
      });
      setGranting(null);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setGrantDraft((draft) => ({ ...draft, [row.orgId]: "" }));
      refresh();
    },
    [grantDraft, refresh],
  );

  /**
   * Puts a workspace on a plan without a checkout — comped accounts, betas,
   * partners, the team's own workspace.
   *
   * Everything that makes this safe lives in `set_org_plan` (migration 0067):
   * update instead of insert, NULL period bounds so a comped plan still meters
   * itself, the free plan as the way to "remove" a plan, a refusal when the
   * subscription is provider-backed, and an audit event that records whether
   * the operator was assigning to their own workspace. The console only picks
   * the target and reports back.
   */
  const assignPlan = useCallback(
    async (row: SubRow) => {
      setError(null);
      setNotice(null);
      const planId = planDraft[row.orgId];
      if (!planId || planId === row.planId) {
        setError("Pick a different plan first.");
        return;
      }
      setAssigning(row.orgId);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("set_org_plan", {
        target_org: row.orgId,
        target_plan: planId,
        target_note: "Assigned from the billing console",
      });
      setAssigning(null);
      if (rpcError) {
        setError(
          rpcError.message.includes("provider_managed")
            ? "This workspace pays through a provider — changing the plan here would desync the charge from the entitlement. Cancel the provider subscription first."
            : rpcError.message,
        );
        return;
      }
      const result = data as { toPlan?: string; selfGrant?: boolean } | null;
      setNotice(
        `${row.orgName} is now on ${result?.toPlan ?? "the selected plan"}${result?.selfGrant ? " (your own workspace — recorded in the audit trail)" : ""}.`,
      );
      setPlanDraft((draft) => ({ ...draft, [row.orgId]: "" }));
      refresh();
    },
    [planDraft, refresh],
  );

  const columns = useMemo<GridColDef<SubRow>[]>(
    () => [
      {
        field: "orgName",
        headerName: "Organization",
        flex: 1.5,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<SubRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.orgName}
            </Typography>
          </Box>
        ),
      },
      {
        field: "planName",
        headerName: "Plan",
        flex: 1.5,
        minWidth: 220,
        // Period, provider and start date are searched and exported with the
        // plan name, even though the cell renders them on a second line.
        valueGetter: (_, row) => `${row.planName} · ${planLineOf(row)}`,
        renderCell: (params: GridRenderCellParams<SubRow, string>) => (
          <Box className="flex h-full min-w-0 flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.planName}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {planLineOf(params.row)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 170,
        valueGetter: (_, row) => `${row.status.replace("_", " ")}${row.adminSuspended ? " suspended" : ""}`,
        renderCell: (params: GridRenderCellParams<SubRow, string>) => (
          <Box className="flex h-full flex-row items-center gap-1">
            <Chip
              label={params.row.status.replace("_", " ")}
              size="small"
              color={STATUS_COLOR[params.row.status] ?? "default"}
              variant="outlined"
              className="capitalize"
            />
            {params.row.adminSuspended && <Chip label="suspended" size="small" color="error" variant="outlined" />}
          </Box>
        ),
      },
      {
        field: "packMinutes",
        headerName: "Extra minutes",
        type: "number",
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<SubRow, number>) => (
          <Box className="flex h-full items-center">
            {params.row.packMinutes > 0 ? (
              <Chip label={`${params.row.packMinutes} extra min`} size="small" color="secondary" variant="outlined" />
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                —
              </Typography>
            )}
          </Box>
        ),
      },
      {
        field: "grant",
        headerName: "Grant minutes",
        minWidth: 210,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<SubRow>) => (
          <Box className="flex h-full flex-row items-center gap-2">
            <FormControl className="outlined mb-0 w-24" variant="standard" size="small">
              <Input
                placeholder="+ minutes"
                type="number"
                inputProps={{ min: 1, "aria-label": `Grant extra minutes to ${params.row.orgName}` }}
                value={grantDraft[params.row.orgId] ?? ""}
                onChange={(e) => setGrantDraft((draft) => ({ ...draft, [params.row.orgId]: e.target.value }))}
              />
            </FormControl>
            <Button size="small" disabled={granting === params.row.orgId} onClick={() => void grantMinutes(params.row)}>
              {granting === params.row.orgId ? "Granting…" : "Grant"}
            </Button>
          </Box>
        ),
      },
      {
        // Comped plan. Disabled rather than hidden when the provider owns
        // the subscription, so the reason is visible instead of the control
        // silently not being there. Downgrading is the same control: pick
        // the free plan.
        field: "compedPlan",
        headerName: "Comped plan",
        minWidth: 280,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<SubRow>) => (
          <Box className="flex h-full flex-row items-center gap-2">
            <Tooltip
              title={
                params.row.providerManaged
                  ? "Paid through a provider — change the plan at the provider, not here"
                  : "Assign a plan without a checkout"
              }
            >
              <span>
                <FormControl
                  className="outlined mb-0 w-40"
                  variant="standard"
                  size="small"
                  disabled={params.row.providerManaged}
                >
                  <Select
                    native
                    value={planDraft[params.row.orgId] ?? ""}
                    onChange={(e) =>
                      setPlanDraft((draft) => ({ ...draft, [params.row.orgId]: e.target.value as string }))
                    }
                    inputProps={{ "aria-label": `Assign a plan to ${params.row.orgName}` }}
                  >
                    <option value="">Change plan…</option>
                    {plans
                      .filter((plan) => plan.id !== params.row.planId)
                      .map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                          {plan.isFree ? " (remove paid plan)" : ""}
                        </option>
                      ))}
                  </Select>
                </FormControl>
              </span>
            </Tooltip>
            <Button
              size="small"
              disabled={params.row.providerManaged || assigning === params.row.orgId || !planDraft[params.row.orgId]}
              onClick={() => void assignPlan(params.row)}
            >
              {assigning === params.row.orgId ? "Applying…" : "Apply"}
            </Button>
          </Box>
        ),
      },
      {
        // The kill-switch stays visible on the row, never buried in a menu.
        field: "adminSuspended",
        headerName: "Access",
        minWidth: 110,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<SubRow, boolean>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.adminSuspended ? "Reactivate access" : "Suspend access"}>
              <Switch
                checked={!params.row.adminSuspended}
                onChange={() => toggleSuspended(params.row)}
                size="small"
                slotProps={{
                  input: {
                    "aria-label": `${params.row.adminSuspended ? "Reactivate" : "Suspend"} access for ${params.row.orgName}`,
                  },
                }}
              />
            </Tooltip>
          </Box>
        ),
      },
    ],
    [assignPlan, assigning, grantDraft, grantMinutes, granting, planDraft, plans, toggleSuspended],
  );

  return (
    <Box className="flex flex-col gap-3">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {notice && (
        <Alert severity="success" className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<SubRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiCreditCard size="medium" />}
              title="No live subscriptions"
              description="Trialing, active, past-due and incomplete subscriptions show up here as workspaces start paying — with the kill-switch, minute grants and comped plans on each row."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No subscriptions match your search.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
