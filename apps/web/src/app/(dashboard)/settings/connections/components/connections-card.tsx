"use client";

import { Field, RowLine, RowText, SelectField } from "../../../admin/billing/components/catalog-shared";
import { createConnection, listAvailableConnectors, syncConnection } from "../actions";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Tooltip,
  Typography,
} from "@mui/material";

import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiPlus from "@/icons/nexture/ni-plus";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { createClient } from "@flyee/auth/client";

type ConnectionRow = {
  id: string;
  provider: string;
  name: string;
  status: string;
  last_synced_at: string | null;
  sync_error: string | null;
};

type AvailableConnector = { provider: string; name: string; secretFields: { key: string; label: string }[] };

type AddForm = { provider: string; name: string; secret: Record<string, string> };

const STATUS_COLOR: Record<string, "default" | "success" | "warning" | "error"> = {
  connected: "success",
  error: "error",
  disabled: "default",
};

export default function ConnectionsCard({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [available, setAvailable] = useState<AvailableConnector[]>([]);
  const [form, setForm] = useState<AddForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("connections")
      .select("id, provider, name, status, last_synced_at, sync_error")
      .eq("org_id", orgId)
      .order("created_at");
    setRows(data ?? []);
  }, [orgId]);

  useEffect(() => {
    refresh();
    listAvailableConnectors().then(setAvailable);
  }, [refresh]);

  const selectedConnector = available.find((connector) => connector.provider === form?.provider);

  const openAdd = () => {
    setError(null);
    const first = available[0];
    if (!first) return;
    setForm({ provider: first.provider, name: "", secret: {} });
  };

  const save = async () => {
    if (!form) return;
    setError(null);
    setBusy(true);
    try {
      const result = await createConnection({
        orgId,
        provider: form.provider,
        name: form.name,
        secret: form.secret,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const sync = async (id: string) => {
    setError(null);
    const result = await syncConnection(id);
    if (!result.ok) setError(result.error);
    refresh();
  };

  const remove = async (id: string) => {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("connections").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    refresh();
  };

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-3">
          <Box className="flex flex-row items-center gap-2">
            <Typography variant="h5" component="h2" className="card-title flex-1">
              Connections
            </Typography>
            <Button
              variant="outlined"
              size="small"
              color="grey"
              startIcon={<NiPlus size="small" />}
              onClick={openAdd}
              disabled={available.length === 0}
            >
              Add connection
            </Button>
          </Box>

          {available.length === 0 && rows.length === 0 && (
            <Typography variant="body2" className="text-text-secondary">
              No connectors are registered in this project. Implement one in the derived project and register it in
              src/lib/connectors.ts (see packages/connectors/README.md).
            </Typography>
          )}

          {rows.map((row) => (
            <RowLine key={row.id}>
              <RowText
                primary={row.name}
                secondary={`${row.provider}${row.last_synced_at ? ` · synced ${new Date(row.last_synced_at).toLocaleString()}` : " · never synced"}${row.sync_error ? ` · ${row.sync_error}` : ""}`}
              />
              <Chip label={row.status} size="small" variant="outlined" color={STATUS_COLOR[row.status] ?? "default"} />
              <Tooltip title="Sync now">
                <Button className="icon-only" size="small" color="grey" variant="text" onClick={() => sync(row.id)}>
                  <NiRefresh size="medium" />
                </Button>
              </Tooltip>
              <Tooltip title="Remove">
                <Button className="icon-only" size="small" color="grey" variant="text" onClick={() => remove(row.id)}>
                  <NiBinEmpty size="medium" />
                </Button>
              </Tooltip>
            </RowLine>
          ))}

          {error && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Add connection</DialogTitle>
        {form && (
          <DialogContent className="flex flex-col">
            <SelectField
              label="Provider"
              value={form.provider}
              options={available.map((connector) => ({ value: connector.provider, label: connector.name }))}
              onChange={(v) => setForm({ provider: v, name: form.name, secret: {} })}
            />
            <Field label="Name (optional)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            {selectedConnector?.secretFields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                value={form.secret[field.key] ?? ""}
                onChange={(v) => setForm({ ...form, secret: { ...form.secret, [field.key]: v } })}
              />
            ))}
            <Typography variant="body2" className="text-text-secondary">
              Credentials are validated with the provider and stored server-side only — they never reach the browser.
            </Typography>
          </DialogContent>
        )}
        <DialogActions>
          <Button color="grey" variant="text" onClick={() => setForm(null)}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={busy}>
            {busy ? "Validating..." : "Connect"}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
