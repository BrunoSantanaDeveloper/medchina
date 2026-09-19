"use client";

import { Field, SelectField } from "./catalog-shared";
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
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import NiTicket from "@/icons/nexture/ni-ticket";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type CouponForm = {
  id?: string;
  code: string;
  description: string;
  discount_type: string;
  discount_value: number;
  max_redemptions: number | "";
  valid_until: string;
  is_active: boolean;
};

/** One coupon row, flattened for the grid; `raw` is what the edit dialog reads. */
type CouponRow = {
  id: string;
  code: string;
  description: string;
  discount: string;
  redeemed: string;
  validUntil: string;
  isActive: boolean;
  raw: Record<string, unknown>;
};

const EMPTY: CouponForm = {
  code: "",
  description: "",
  discount_type: "percent",
  discount_value: 10,
  max_redemptions: "",
  valid_until: "",
  is_active: true,
};

export default function CouponsAdmin() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [form, setForm] = useState<CouponForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("coupons")
      .select("*")
      .order("created_at", { ascending: false });
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
            code: row.code as string,
            description: (row.description as string) ?? "",
            discount_type: row.discount_type as string,
            discount_value: row.discount_value as number,
            max_redemptions: (row.max_redemptions as number) ?? "",
            valid_until: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
            is_active: row.is_active as boolean,
          }
        : EMPTY,
    );
  }, []);

  const save = async () => {
    if (!form) return;
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase.from("coupons").upsert({
      ...(form.id ? { id: form.id } : {}),
      code: form.code.trim().toUpperCase(),
      description: form.description || null,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value) || 0,
      max_redemptions: form.max_redemptions === "" ? null : Number(form.max_redemptions),
      valid_until: form.valid_until ? new Date(`${form.valid_until}T23:59:59`).toISOString() : null,
      is_active: form.is_active,
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, form.id ? "admin.billing.coupon.updated" : "admin.billing.coupon.created", {
      entityType: "coupon",
      entityId: form.id || undefined,
      metadata: { code: form.code.trim().toUpperCase() },
    });
    setForm(null);
    refresh();
  };

  const gridRows = useMemo<CouponRow[]>(
    () =>
      rows.map((row) => ({
        id: row.id as string,
        code: row.code as string,
        description: (row.description as string) ?? "",
        discount:
          row.discount_type === "percent"
            ? `${row.discount_value}%`
            : `${((row.discount_value as number) / 100).toFixed(2)} fixo`,
        redeemed: `${row.redeemed_count}${row.max_redemptions ? `/${row.max_redemptions}` : ""}`,
        validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "sem validade",
        isActive: Boolean(row.is_active),
        raw: row,
      })),
    [rows],
  );

  const columns = useMemo<GridColDef<CouponRow>[]>(
    () => [
      {
        field: "code",
        headerName: "Código",
        flex: 2,
        minWidth: 220,
        // The description is searched and exported with the code, even though
        // the cell renders it on its own line.
        valueGetter: (_, row) => (row.description ? `${row.code} — ${row.description}` : row.code),
        renderCell: (params: GridRenderCellParams<CouponRow, string>) => (
          <Box className="flex h-full min-w-0 flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.code}
            </Typography>
            {params.row.description && (
              <Typography variant="body2" className="text-text-secondary truncate">
                {params.row.description}
              </Typography>
            )}
          </Box>
        ),
      },
      { field: "discount", headerName: "Desconto", minWidth: 140 },
      { field: "redeemed", headerName: "Resgates", minWidth: 130 },
      { field: "validUntil", headerName: "Válido até", minWidth: 150 },
      {
        field: "isActive",
        headerName: "Situação",
        minWidth: 130,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<CouponRow, boolean>) => (
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
        <DataTable<CouponRow>
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
              Novo cupom
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              icon={<NiTicket size="medium" />}
              title="Nenhum cupom ainda"
              description="Um cupom dá desconto num plano no checkout — percentual ou valor fixo, com limite de resgates e data de validade opcionais."
              action={{ label: "Novo cupom", onClick: () => openEdit() }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum cupom corresponde à sua busca.
            </Typography>
          }
        />
      )}

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{form?.id ? "Editar cupom" : "Novo cupom"}</DialogTitle>
        {form && (
          <DialogContent className="flex flex-col">
            <Field label="Código" value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} />
            <Field label="Descrição" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
            <SelectField
              label="Tipo de desconto"
              value={form.discount_type}
              options={[
                { value: "percent", label: "Percentual (%)" },
                { value: "fixed", label: "Fixo (centavos)" },
              ]}
              onChange={(v) => setForm({ ...form, discount_type: v })}
            />
            <Field
              label={form.discount_type === "percent" ? "Desconto (%)" : "Desconto (centavos)"}
              type="number"
              value={form.discount_value}
              onChange={(v) => setForm({ ...form, discount_value: Number(v) })}
            />
            <Field
              label="Máximo de resgates (vazio = ilimitado)"
              type="number"
              value={form.max_redemptions}
              onChange={(v) => setForm({ ...form, max_redemptions: v === "" ? "" : Number(v) })}
            />
            <Field
              label="Válido até (AAAA-MM-DD, vazio = sem validade)"
              value={form.valid_until}
              onChange={(v) => setForm({ ...form, valid_until: v })}
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
