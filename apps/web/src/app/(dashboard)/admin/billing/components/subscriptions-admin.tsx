"use client";

import { RowLine, RowText } from "./catalog-shared";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, Input, Select, Switch, Tooltip, Typography } from "@mui/material";

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

export default function SubscriptionsAdmin() {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [grantDraft, setGrantDraft] = useState<Record<string, string>>({});
  const [granting, setGranting] = useState<string | null>(null);
  const [plans, setPlans] = useState<AssignablePlan[]>([]);
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data }, { data: packs }, { data: planRows }] = await Promise.all([
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
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Superadmin kill-switch: suspends/reactivates access regardless of the
  // provider-side subscription state.
  const toggleSuspended = async (row: SubRow) => {
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
  };

  /**
   * Makes a workspace whole after an incident (a failed pipeline that still
   * billed, a support agreement). Goes through the guarded RPC because the
   * pack ledger has no client write path at all — and it lands in the audit
   * trail, which is the point: handing out paid capability is exactly the kind
   * of act that must be attributable afterwards.
   */
  const grantMinutes = async (row: SubRow) => {
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
  };

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
  const assignPlan = async (row: SubRow) => {
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
  };

  const visible = rows.filter(
    (row) =>
      !filter ||
      row.orgName.toLowerCase().includes(filter.toLowerCase()) ||
      row.planName.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Box className="flex flex-col gap-3">
      <FormControl className="outlined w-72" variant="standard" size="small">
        <Input
          placeholder="Filter by organization or plan"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </FormControl>

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

      {visible.map((row) => (
        <RowLine key={row.id}>
          <RowText
            primary={row.orgName}
            secondary={`${row.planName}${row.period ? ` · ${row.period}` : ""}${row.provider ? ` · ${row.provider}` : ""} · since ${new Date(row.createdAt).toLocaleDateString()}`}
          />
          <Chip
            label={row.status.replace("_", " ")}
            size="small"
            color={STATUS_COLOR[row.status] ?? "default"}
            variant="outlined"
            className="capitalize"
          />
          {row.adminSuspended && <Chip label="suspended" size="small" color="error" variant="outlined" />}
          {row.packMinutes > 0 && (
            <Chip label={`${row.packMinutes} extra min`} size="small" color="secondary" variant="outlined" />
          )}
          <FormControl className="outlined w-28" variant="standard" size="small">
            <Input
              placeholder="+ minutes"
              type="number"
              inputProps={{ min: 1, "aria-label": `Grant extra minutes to ${row.orgName}` }}
              value={grantDraft[row.orgId] ?? ""}
              onChange={(e) => setGrantDraft((draft) => ({ ...draft, [row.orgId]: e.target.value }))}
            />
          </FormControl>
          <Button size="small" disabled={granting === row.orgId} onClick={() => void grantMinutes(row)}>
            {granting === row.orgId ? "Granting…" : "Grant"}
          </Button>

          {/* Comped plan. Disabled rather than hidden when the provider owns
              the subscription, so the reason is visible instead of the control
              silently not being there. Downgrading is the same control: pick
              the free plan. */}
          <Tooltip
            title={
              row.providerManaged
                ? "Paid through a provider — change the plan at the provider, not here"
                : "Assign a plan without a checkout"
            }
          >
            <span>
              <FormControl className="outlined w-40" variant="standard" size="small" disabled={row.providerManaged}>
                <Select
                  native
                  value={planDraft[row.orgId] ?? ""}
                  onChange={(e) => setPlanDraft((draft) => ({ ...draft, [row.orgId]: e.target.value as string }))}
                  inputProps={{ "aria-label": `Assign a plan to ${row.orgName}` }}
                >
                  <option value="">Change plan…</option>
                  {plans
                    .filter((plan) => plan.id !== row.planId)
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
            disabled={row.providerManaged || assigning === row.orgId || !planDraft[row.orgId]}
            onClick={() => void assignPlan(row)}
          >
            {assigning === row.orgId ? "Applying…" : "Apply"}
          </Button>
          <Tooltip title={row.adminSuspended ? "Reactivate access" : "Suspend access"}>
            <Switch
              checked={!row.adminSuspended}
              onChange={() => toggleSuspended(row)}
              size="small"
              slotProps={{
                input: {
                  "aria-label": `${row.adminSuspended ? "Reactivate" : "Suspend"} access for ${row.orgName}`,
                },
              }}
            />
          </Tooltip>
        </RowLine>
      ))}
      {visible.length === 0 && (
        <Typography variant="body2" className="text-text-secondary">
          No subscriptions found.
        </Typography>
      )}
    </Box>
  );
}
