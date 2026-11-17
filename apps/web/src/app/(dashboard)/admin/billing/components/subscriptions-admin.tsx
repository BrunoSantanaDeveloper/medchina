"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, Input, Select, Switch, Tooltip, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
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

/** The status enum as the operator reads it; an unknown value falls back to the raw one. */
const STATUS_LABEL: Record<string, string> = {
  active: "ativa",
  trialing: "em trial",
  past_due: "inadimplente",
  incomplete: "incompleta",
  canceled: "cancelada",
};

/** The old row's secondary line: which plan, on what terms, since when. */
const planLineOf = (row: SubRow) =>
  `${row.period ? `${row.period} · ` : ""}${row.provider ? `${row.provider} · ` : ""}desde ${new Date(row.createdAt).toLocaleDateString()}`;

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
        orgName: (row.organizations as unknown as { name: string } | null)?.name ?? "Consultório desconhecido",
        planName: (row.plans as unknown as { name: string } | null)?.name ?? "Plano desconhecido",
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
        setError("Informe quantos minutos conceder.");
        return;
      }
      setGranting(row.orgId);
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("grant_audio_minute_pack", {
        target_org: row.orgId,
        target_minutes: Math.floor(minutes),
        target_note: "Concedido pelo console de faturamento",
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
        setError("Escolha um plano diferente primeiro.");
        return;
      }
      setAssigning(row.orgId);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("set_org_plan", {
        target_org: row.orgId,
        target_plan: planId,
        target_note: "Atribuído pelo console de faturamento",
      });
      setAssigning(null);
      if (rpcError) {
        setError(
          rpcError.message.includes("provider_managed")
            ? "Este consultório paga por um provedor — trocar o plano aqui descolaria a cobrança do que ela tem direito. Cancele a assinatura no provedor antes."
            : rpcError.message,
        );
        return;
      }
      const result = data as { toPlan?: string; selfGrant?: boolean } | null;
      setNotice(
        `${row.orgName} agora está no ${result?.toPlan ?? "plano selecionado"}${result?.selfGrant ? " (seu próprio consultório — registrado na trilha de auditoria)" : ""}.`,
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
        headerName: "Consultório",
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
        headerName: "Plano",
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
        headerName: "Situação",
        minWidth: 170,
        valueGetter: (_, row) =>
          `${STATUS_LABEL[row.status] ?? row.status.replace("_", " ")}${row.adminSuspended ? " suspensa" : ""}`,
        renderCell: (params: GridRenderCellParams<SubRow, string>) => (
          <Box className="flex h-full flex-row items-center gap-1">
            <Chip
              label={STATUS_LABEL[params.row.status] ?? params.row.status.replace("_", " ")}
              size="small"
              color={STATUS_COLOR[params.row.status] ?? "default"}
              variant="outlined"
              className="first-letter:uppercase"
            />
            {params.row.adminSuspended && <Chip label="suspensa" size="small" color="error" variant="outlined" />}
          </Box>
        ),
      },
      {
        field: "packMinutes",
        headerName: "Minutos extras",
        type: "number",
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<SubRow, number>) => (
          <Box className="flex h-full items-center">
            {params.row.packMinutes > 0 ? (
              <Chip label={`${params.row.packMinutes} min extras`} size="small" color="secondary" variant="outlined" />
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
        headerName: "Conceder minutos",
        minWidth: 210,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<SubRow>) => (
          <Box className="flex h-full flex-row items-center gap-2">
            <FormControl className="outlined mb-0 w-24" variant="standard" size="small">
              <Input
                placeholder="+ minutos"
                type="number"
                inputProps={{ min: 1, "aria-label": `Conceder minutos extras para ${params.row.orgName}` }}
                value={grantDraft[params.row.orgId] ?? ""}
                onChange={(e) => setGrantDraft((draft) => ({ ...draft, [params.row.orgId]: e.target.value }))}
              />
            </FormControl>
            <Button size="small" disabled={granting === params.row.orgId} onClick={() => void grantMinutes(params.row)}>
              {granting === params.row.orgId ? "Concedendo…" : "Conceder"}
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
        headerName: "Plano cortesia",
        minWidth: 280,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<SubRow>) => (
          <Box className="flex h-full flex-row items-center gap-2">
            <Tooltip
              title={
                params.row.providerManaged
                  ? "Pago por um provedor — troque o plano no provedor, não aqui"
                  : "Atribuir um plano sem checkout"
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
                    inputProps={{ "aria-label": `Atribuir um plano para ${params.row.orgName}` }}
                  >
                    <option value="">Trocar plano…</option>
                    {plans
                      .filter((plan) => plan.id !== params.row.planId)
                      .map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                          {plan.isFree ? " (remove o plano pago)" : ""}
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
              {assigning === params.row.orgId ? "Aplicando…" : "Aplicar"}
            </Button>
          </Box>
        ),
      },
      {
        // The kill-switch stays visible on the row, never buried in a menu.
        field: "adminSuspended",
        headerName: "Acesso",
        minWidth: 110,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<SubRow, boolean>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.adminSuspended ? "Reativar acesso" : "Suspender acesso"}>
              <Switch
                checked={!params.row.adminSuspended}
                onChange={() => toggleSuspended(params.row)}
                size="small"
                slotProps={{
                  input: {
                    "aria-label": `${params.row.adminSuspended ? "Reativar" : "Suspender"} acesso de ${params.row.orgName}`,
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
              layout="row"
              illustration={<IllustrationAccounts />}
              title="Nenhuma assinatura em andamento"
              description="Assinaturas em trial, ativas, inadimplentes e incompletas aparecem aqui conforme os consultórios começam a pagar — com o corte de acesso, a concessão de minutos e o plano cortesia em cada linha."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma assinatura corresponde à sua busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
