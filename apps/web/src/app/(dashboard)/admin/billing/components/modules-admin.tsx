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
import IllustrationIntegrate from "@/icons/illustrations/illustration-integrate";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type ModuleForm = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  /** Amount in currency units as a numeric string ("49.9"); converted to cents on save. */
  price: string;
  limits: string;
  is_active: boolean;
  sort: number;
};

/** One module row, flattened for the grid; `raw` is what the edit dialog reads. */
type ModuleRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  price: string;
  isActive: boolean;
  raw: Record<string, unknown>;
};

const EMPTY: ModuleForm = {
  slug: "",
  name: "",
  description: "",
  kind: "recurring",
  price: "",
  limits: "{}",
  is_active: true,
  sort: 0,
};

export default function ModulesAdmin() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState<ModuleForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("modules").select("*").order("sort");
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
    setForm(
      row
        ? {
            id: row.id as string,
            slug: row.slug as string,
            name: row.name as string,
            description: (row.description as string) ?? "",
            kind: row.kind as string,
            price: row.price_cents ? String((row.price_cents as number) / 100) : "",
            limits: JSON.stringify(row.limits ?? {}, null, 2),
            is_active: row.is_active as boolean,
            sort: row.sort as number,
          }
        : EMPTY,
    );
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
    const { error: saveError } = await supabase.from("modules").upsert({
      ...(form.id ? { id: form.id } : {}),
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description || null,
      kind: form.kind,
      price_cents: Math.round(Number(form.price) * 100) || 0,
      limits,
      is_active: form.is_active,
      sort: Number(form.sort) || 0,
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, form.id ? "admin.billing.module.updated" : "admin.billing.module.created", {
      entityType: "module",
      entityId: form.id || undefined,
      metadata: { slug: form.slug.trim() },
    });
    setForm(null);
    refresh();
  };

  const gridRows = useMemo<ModuleRow[]>(
    () =>
      rows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        slug: row.slug as string,
        kind: row.kind as string,
        price: `${((row.price_cents as number) / 100).toFixed(2)} ${row.currency as string}`,
        isActive: Boolean(row.is_active),
        raw: row,
      })),
    [rows],
  );

  const columns = useMemo<GridColDef<ModuleRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Módulo",
        flex: 2,
        minWidth: 240,
        // The slug is searched and exported as part of the cell's value, even
        // though the cell renders it on its own line.
        valueGetter: (_, row) => `${row.name} (${row.slug})`,
        renderCell: (params: GridRenderCellParams<ModuleRow, string>) => (
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
      { field: "kind", headerName: "Tipo", minWidth: 140 },
      { field: "price", headerName: "Preço", minWidth: 140 },
      {
        field: "isActive",
        headerName: "Situação",
        minWidth: 140,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<ModuleRow, boolean>) => (
          <Box className="flex h-full items-center">
            {params.row.isActive ? (
              <Typography variant="body2" className="text-text-secondary">
                —
              </Typography>
            ) : (
              <Chip label="inativo" size="small" variant="outlined" />
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
        <DataTable<ModuleRow>
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
              Novo módulo
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              layout="row"
              illustration={<IllustrationIntegrate />}
              title="Nenhum módulo ainda"
              description="Um módulo é um adicional vendido em cima de um plano — um recurso extra que o consultório liga sem trocar de nível."
              action={{ label: "Novo módulo", onClick: () => openEdit() }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum módulo corresponde à sua busca.
            </Typography>
          }
        />
      )}

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{form?.id ? "Editar módulo" : "Novo módulo"}</DialogTitle>
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
                { value: "one_time", label: "Avulso" },
              ]}
              onChange={(v) => setForm({ ...form, kind: v })}
            />
            <CurrencyField
              label="Preço"
              size="small"
              name="price"
              currencySymbol={CURRENCY_SYMBOLS.BRL}
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
            />
            <Field label="Limites (JSON)" value={form.limits} onChange={(v) => setForm({ ...form, limits: v })} />
            <Field
              label="Ordem"
              type="number"
              value={form.sort}
              onChange={(v) => setForm({ ...form, sort: Number(v) })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
              }
              label="Ativo"
            />
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
