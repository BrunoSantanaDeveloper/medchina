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
  /** The anchor card of the public pricing grids (0124) — at most one plan. */
  is_highlighted: boolean;
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
  isHighlighted: boolean;
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
  is_highlighted: false,
  limits: "{}",
  sort: 0,
};

/** The catalog flags a row carries, as searchable text (the chips render them). */
const flagsOf = (row: PlanRow) =>
  [
    row.isFree ? "grátis padrão" : null,
    row.isActive ? null : "inativo",
    row.isPublic ? null : "não listado",
    row.isHighlighted ? "destaque" : null,
  ]
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
      is_highlighted: row.is_highlighted === true,
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
      setError("Os limites precisam ser um JSON válido.");
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
      is_highlighted: form.is_highlighted,
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
        isHighlighted: row.is_highlighted === true,
        raw: row,
      })),
    [rows],
  );

  const columns = useMemo<GridColDef<PlanRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Plano",
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
      { field: "kind", headerName: "Tipo", minWidth: 120 },
      { field: "period", headerName: "Período", minWidth: 120 },
      { field: "price", headerName: "Preço", minWidth: 140 },
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
        headerName: "Catálogo",
        minWidth: 220,
        sortable: false,
        valueGetter: (_, row) => flagsOf(row),
        renderCell: (params: GridRenderCellParams<PlanRow, string>) => (
          <Box className="flex h-full flex-row items-center gap-1">
            {params.row.isFree && <Chip label="grátis padrão" size="small" color="success" variant="outlined" />}
            {!params.row.isActive && <Chip label="inativo" size="small" variant="outlined" />}
            {!params.row.isPublic && <Chip label="não listado" size="small" color="primary" variant="outlined" />}
            {params.row.isHighlighted && <Chip label="destaque" size="small" color="secondary" variant="outlined" />}
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
            label="Editar"
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
              Novo plano
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              icon={<NiMoney size="medium" />}
              title="Nenhum plano ainda"
              description="O catálogo de planos é o que um consultório pode comprar — preço, período, trial e os limites que cada nível libera."
              action={{ label: "Novo plano", onClick: () => openEdit() }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum plano corresponde à sua busca.
            </Typography>
          }
        />
      )}

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{form?.id ? "Editar plano" : "Novo plano"}</DialogTitle>
        {form && (
          <DialogContent className="flex flex-col">
            <Field label="Nome" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Slug" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} />
            <Field label="Descrição" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
            <SelectField
              label="Tipo"
              value={form.kind}
              options={[
                { value: "recurring", label: "Recorrente" },
                { value: "credits", label: "Créditos" },
              ]}
              onChange={(v) => setForm({ ...form, kind: v })}
            />
            <SelectField
              label="Período"
              value={form.period}
              options={[
                { value: "weekly", label: "Semanal" },
                { value: "monthly", label: "Mensal" },
                { value: "yearly", label: "Anual" },
                { value: "none", label: "Nenhum (créditos avulsos)" },
              ]}
              onChange={(v) => setForm({ ...form, period: v })}
            />
            <CurrencyField
              label={`Preço (${form.currency})`}
              size="small"
              name="price"
              currencySymbol={CURRENCY_SYMBOLS[form.currency] ?? `${form.currency} `}
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
            />
            <Field
              label="Quantidade de créditos (planos de crédito)"
              type="number"
              value={form.credit_amount}
              onChange={(v) => setForm({ ...form, credit_amount: v === "" ? "" : Number(v) })}
            />
            <Field
              label="Dias de trial (0 = sem trial)"
              type="number"
              value={form.trial_days}
              onChange={(v) => setForm({ ...form, trial_days: Number(v) })}
            />
            <Field label="Limites (JSON)" value={form.limits} onChange={(v) => setForm({ ...form, limits: v })} />
            <Field
              label="Ordem"
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
                label="Créditos expiram a cada período"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.is_free}
                    onChange={(e) => setForm({ ...form, is_free: e.target.checked })}
                  />
                }
                label="Plano grátis padrão"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                }
                label="Ativo (vendável de fato)"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.is_public}
                    onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
                  />
                }
                label="Listado nas tabelas de preço"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.is_highlighted}
                    onChange={(e) => setForm({ ...form, is_highlighted: e.target.checked })}
                  />
                }
                label="Destaque na home e em /planos"
              />
            </Box>
            {/* The distinction the console has to make explicit: unchecking
                "Active" is how an offer becomes UNBUYABLE, which is the wrong
                tool for taking it off the catalog. */}
            {/* A checkbox cannot show that this one is exclusive, nor that an
                unlisted plan has no grid to be the anchor of. */}
            {form.is_highlighted && (
              <Alert severity="info" className="neutral bg-background-paper/60! mt-2">
                {form.is_public
                  ? "Só um plano fica em destaque: marcar este tira o destaque do que estiver marcado hoje."
                  : "Este plano não está listado, então não aparece nas tabelas de preço — o destaque só passa a valer se você marcar também “Listado nas tabelas de preço”."}
              </Alert>
            )}
            {!form.is_public && form.is_active && (
              <Alert severity="info" className="neutral bg-background-paper/60! mt-2">
                Não listado: fica fora de /planos e da tabela de planos da cliente, mas ainda pode ser comprado em
                {` /settings/billing?plan=${form.slug || "<slug>"}`} e atribuído na aba Assinaturas.
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
            Cancelar
          </Button>
          <Button variant="contained" onClick={save}>
            Salvar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
