"use client";

import { CURRENCY_SYMBOLS, Field, SelectField } from "./catalog-shared";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import { CurrencyField } from "@/components/product/fields";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type PlanForm = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  period: string;
  /** Amount in currency units as a numeric string ("199.9"); converted to cents on save. */
  price: string;
  currency: string;
  credit_amount: number | "";
  credits_expire: boolean;
  trial_days: number;
  is_free: boolean;
  is_active: boolean;
  is_public: boolean;
  limits: string;
  sort: number;
};

/** One catalog row, flattened for the grid; `raw` is what the edit dialog reads. */
type PlanRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  period: string;
  price: string;
  trialDays: number;
  isFree: boolean;
  isActive: boolean;
  isPublic: boolean;
  raw: Record<string, unknown>;
};

const EMPTY: PlanForm = {
  slug: "",
  name: "",
  description: "",
  kind: "recurring",
  period: "monthly",
  price: "",
  currency: "BRL",
  credit_amount: "",
  credits_expire: false,
  trial_days: 0,
  is_free: false,
  is_active: true,
  is_public: true,
  limits: "{}",
  sort: 0,
};

/** The catalog flags a row carries, as searchable text (the chips render them). */
const flagsOf = (row: PlanRow) =>
  [row.isFree ? "free default" : null, row.isActive ? null : "inactive", row.isPublic ? null : "unlisted"]
    .filter(Boolean)
    .join(" ");

export default function PlansAdmin() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("plans").select("*").order("sort");
    if (readError) {
      setLoadError(readError.message);
      setLoaded(true);
      return;
    }
    setRows(data ?? []);
    setLoadError(null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openEdit = useCallback((row?: Record<string, unknown>) => {
    setError(null);
    if (!row) {
      setForm(EMPTY);
      return;
    }
    setForm({
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      description: (row.description as string) ?? "",
      kind: row.kind as string,
      period: (row.period as string) ?? "none",
      price: row.price_cents ? String((row.price_cents as number) / 100) : "",
      currency: row.currency as string,
      credit_amount: (row.credit_amount as number) ?? "",
      credits_expire: row.credits_expire as boolean,
      trial_days: row.trial_days as number,
      is_free: row.is_free as boolean,
      is_active: row.is_active as boolean,
      is_public: row.is_public !== false,
      limits: JSON.stringify(row.limits ?? {}, null, 2),
      sort: row.sort as number,
    });
  }, []);

  const save = async () => {
    if (!form) return;
    setError(null);
    let limits: unknown;
    try {
      limits = JSON.parse(form.limits || "{}");
    } catch {
      setError("Limits must be valid JSON.");
      return;
    }
    const supabase = createClient();
    const payload = {
      ...(form.id ? { id: form.id } : {}),
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description || null,
      kind: form.kind,
      period: form.period === "none" ? null : form.period,
      price_cents: Math.round(Number(form.price) * 100) || 0,
      currency: form.currency,
      credit_amount: form.credit_amount === "" ? null : Number(form.credit_amount),
      credits_expire: form.credits_expire,
      trial_days: Number(form.trial_days) || 0,
      is_free: form.is_free,
      is_active: form.is_active,
      is_public: form.is_public,
      limits,
      sort: Number(form.sort) || 0,
    };
    const { error: saveError } = await supabase.from("plans").upsert(payload);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, form.id ? "admin.billing.plan.updated" : "admin.billing.plan.created", {
      entityType: "plan",
      entityId: form.id ?? undefined,
      metadata: { slug: payload.slug },
    });
    setForm(null);
    refresh();
  };

  const gridRows = useMemo<PlanRow[]>(
    () =>
      rows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        slug: row.slug as string,
        kind: row.kind as string,
        period: (row.period as string) ?? "one-time",
        price: `${((row.price_cents as number) / 100).toFixed(2)} ${row.currency as string}`,
        trialDays: (row.trial_days as number) ?? 0,
        isFree: Boolean(row.is_free),
        isActive: Boolean(row.is_active),
        isPublic: row.is_public !== false,
        raw: row,
      })),
    [rows],
  );

  const columns = useMemo<GridColDef<PlanRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Plan",
        flex: 2,
        minWidth: 240,
        // The slug is searched and exported as part of the cell's value, even
        // though the cell renders it on its own line.
        valueGetter: (_, row) => `${row.name} (${row.slug})`,
        renderCell: (params: GridRenderCellParams<PlanRow, string>) => (
          <Box className="flex h-full min-w-0 flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.name}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.slug}
            </Typography>
          </Box>
        ),
      },
      { field: "kind", headerName: "Kind", minWidth: 120 },
      { field: "period", headerName: "Period", minWidth: 120 },
      { field: "price", headerName: "Price", minWidth: 140 },
      {
        field: "trialDays",
        headerName: "Trial",
        type: "number",
        minWidth: 100,
        valueFormatter: (value: number) => `${value ?? 0}d`,
      },
      {
        // "Unlisted" is sellable but off the catalog — a founders/partner offer
        // reached by /settings/billing?plan=<slug>. Not the same as inactive,
        // which is not sellable at all.
        field: "flags",
        headerName: "Catalog",
        minWidth: 220,
        sortable: false,
        valueGetter: (_, row) => flagsOf(row),
        renderCell: (params: GridRenderCellParams<PlanRow, string>) => (
          <Box className="flex h-full flex-row items-center gap-1">
            {params.row.isFree && <Chip label="free default" size="small" color="success" variant="outlined" />}
            {!params.row.isActive && <Chip label="inactive" size="small" variant="outlined" />}
            {!params.row.isPublic && <Chip label="unlisted" size="small" color="primary" variant="outlined" />}
            {params.value === "" && (
              <Typography variant="body2" className="text-text-secondary">
                —
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
        getActions: (params) => [
          <GridActionsCellItem
            key="edit"
            icon={<NiPen size="medium" />}
            label="Edit"
            onClick={() => openEdit(params.row.raw)}
            showInMenu
          />,
        ],
      },
    ],
    [openEdit],
  );

  return (
    <Box className="flex flex-col gap-3">
      {/* A failed load is an error, never an empty-looking table. */}
      {loadError && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {loadError}
        </Alert>
      )}

      {!loadError && (
        <DataTable<PlanRow>
          rows={gridRows}
          columns={columns}
          loading={!loaded}
          actions={
            <Button
              variant="outlined"
              size="small"
              color="grey"
              startIcon={<NiPlus size="small" />}
              onClick={() => openEdit()}
            >
              New plan
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              icon={<NiMoney size="medium" />}
              title="No plans yet"
              description="The plan catalog is what a workspace can buy — price, period, trial and the limits each tier unlocks."
              action={{ label: "New plan", onClick: () => openEdit() }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No plans match your search.
            </Typography>
          }
        />
      )}

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{form?.id ? "Edit plan" : "New plan"}</DialogTitle>
        {form && (
          <DialogContent className="flex flex-col">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Slug" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} />
            <Field
              label="Description"
              value={form.description}
              onChange={(v) => setForm({ ...form, description: v })}
            />
            <SelectField
              label="Kind"
              value={form.kind}
              options={[
                { value: "recurring", label: "Recurring" },
                { value: "credits", label: "Credits" },
              ]}
              onChange={(v) => setForm({ ...form, kind: v })}
            />
            <SelectField
              label="Period"
              value={form.period}
              options={[
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
                { value: "none", label: "None (one-time credits)" },
              ]}
              onChange={(v) => setForm({ ...form, period: v })}
            />
            <CurrencyField
              label={`Price (${form.currency})`}
              size="small"
              name="price"
              currencySymbol={CURRENCY_SYMBOLS[form.currency] ?? `${form.currency} `}
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
            />
            <Field
              label="Credit amount (credits plans)"
              type="number"
              value={form.credit_amount}
              onChange={(v) => setForm({ ...form, credit_amount: v === "" ? "" : Number(v) })}
            />
            <Field
              label="Trial days (0 = no trial)"
              type="number"
              value={form.trial_days}
              onChange={(v) => setForm({ ...form, trial_days: Number(v) })}
            />
            <Field label="Limits (JSON)" value={form.limits} onChange={(v) => setForm({ ...form, limits: v })} />
            <Field
              label="Sort"
              type="number"
              value={form.sort}
              onChange={(v) => setForm({ ...form, sort: Number(v) })}
            />
            <Box className="flex flex-row flex-wrap gap-4">
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.credits_expire}
                    onChange={(e) => setForm({ ...form, credits_expire: e.target.checked })}
                  />
                }
                label="Credits expire each period"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.is_free}
                    onChange={(e) => setForm({ ...form, is_free: e.target.checked })}
                  />
                }
                label="Free default plan"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                }
                label="Active (sellable at all)"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.is_public}
                    onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
                  />
                }
                label="Listed in the pricing grids"
              />
            </Box>
            {/* The distinction the console has to make explicit: unchecking
                "Active" is how an offer becomes UNBUYABLE, which is the wrong
                tool for taking it off the catalog. */}
            {!form.is_public && form.is_active && (
              <Alert severity="info" className="neutral bg-background-paper/60! mt-2">
                Unlisted: hidden from /planos and from the customer plan grid, still purchasable at
                {` /settings/billing?plan=${form.slug || "<slug>"}`} and assignable from Subscriptions.
              </Alert>
            )}
            {error && (
              <Alert severity="error" className="neutral bg-background-paper/60! mt-2">
                {error}
              </Alert>
            )}
          </DialogContent>
        )}
        <DialogActions>
          <Button color="grey" variant="text" onClick={() => setForm(null)}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
