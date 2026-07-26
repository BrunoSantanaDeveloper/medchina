"use client";

import { RowLine, RowText } from "./catalog-shared";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, Input, Switch, Tooltip, Typography } from "@mui/material";

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
};

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

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data }, { data: packs }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("id, org_id, status, admin_suspended, period, provider, created_at, organizations(name), plans(name)")
        .in("status", ["trialing", "active", "past_due", "incomplete"])
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("audio_minute_packs")
        .select("org_id, seconds_total, seconds_consumed")
        .or("expires_at.is.null,expires_at.gt." + new Date().toISOString()),
    ]);

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
