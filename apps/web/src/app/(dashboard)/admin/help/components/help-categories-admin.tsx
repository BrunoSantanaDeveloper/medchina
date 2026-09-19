"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, Switch, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import { Field, SelectField } from "@/app/(dashboard)/admin/billing/components/catalog-shared";
import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import { LOCALES } from "@/constants";
import NiPen from "@/icons/nexture/ni-pen";
import NiQuestionHexagon from "@/icons/nexture/ni-question-hexagon";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

export type HelpCategoryRow = {
  id: string;
  locale: string;
  slug: string;
  name: string;
  description: string | null;
  sort: number;
  isPublished: boolean;
};

type FormState = {
  id: string | null;
  locale: string;
  slug: string;
  name: string;
  description: string;
  sort: number;
  isPublished: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  locale: "en",
  slug: "",
  name: "",
  description: "",
  sort: 0,
  isPublished: true,
};

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Help-center categories: one row per locale, ordered by `sort`. */
export default function HelpCategoriesAdmin() {
  const [rows, setRows] = useState<HelpCategoryRow[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("help_categories")
      .select("id, locale, slug, name, description, sort, is_published")
      .order("locale")
      .order("sort");
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        locale: row.locale,
        slug: row.slug,
        name: row.name,
        description: row.description,
        sort: row.sort,
        isPublished: row.is_published,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    if (!form || !form.name.trim()) return;
    setError(null);
    const supabase = createClient();
    const payload = {
      locale: form.locale,
      slug: form.slug.trim() || slugify(form.name),
      name: form.name.trim(),
      description: form.description.trim() || null,
      sort: Number(form.sort) || 0,
      is_published: form.isPublished,
    };
    const query = form.id
      ? supabase.from("help_categories").update(payload).eq("id", form.id)
      : supabase.from("help_categories").insert(payload);
    const { error: writeError } = await query;
    if (writeError) {
      setError(writeError.message);
      return;
    }
    recordAudit(supabase, form.id ? "admin.help.category.updated" : "admin.help.category.created", {
      entityType: "help_category",
      entityId: form.id ?? undefined,
      metadata: { name: payload.name, locale: payload.locale },
    });
    setForm(null);
    refresh();
  };

  const remove = async (id: string) => {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("help_categories").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    recordAudit(supabase, "admin.help.category.deleted", { entityType: "help_category", entityId: id });
    setForm(null);
    refresh();
  };

  const openEdit = useCallback((row: HelpCategoryRow) => {
    setForm({
      id: row.id,
      locale: row.locale,
      slug: row.slug,
      name: row.name,
      description: row.description ?? "",
      sort: row.sort,
      isPublished: row.isPublished,
    });
  }, []);

  const columns = useMemo<GridColDef<HelpCategoryRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Nome",
        flex: 2,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<HelpCategoryRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "slug",
        headerName: "Slug",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<HelpCategoryRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "description",
        headerName: "Descrição",
        flex: 2,
        minWidth: 220,
        // The searched text must be reachable as the cell value, not only in
        // the rendered node — description was part of the old row's line.
        valueGetter: (_, row) => row.description ?? "",
        renderCell: (params: GridRenderCellParams<HelpCategoryRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "locale",
        headerName: "Idioma",
        minWidth: 100,
        renderCell: (params: GridRenderCellParams<HelpCategoryRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip label={params.row.locale} size="small" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "sort",
        headerName: "Ordem",
        type: "number",
        minWidth: 90,
      },
      {
        field: "isPublished",
        headerName: "Situação",
        minWidth: 120,
        valueGetter: (_, row) => (row.isPublished ? "publicada" : "oculta"),
        renderCell: (params: GridRenderCellParams<HelpCategoryRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={params.value}
              size="small"
              color={params.row.isPublished ? "success" : "warning"}
              variant="outlined"
            />
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
            onClick={() => openEdit(params.row)}
            showInMenu
          />,
        ],
      },
    ],
    [openEdit],
  );

  return (
    <Box className="flex flex-col gap-3">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {form && (
        <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Box className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SelectField
              label="Idioma"
              value={form.locale}
              options={LOCALES.map((locale) => ({ value: locale, label: locale }))}
              onChange={(value) => setForm({ ...form, locale: value })}
            />
            <Field label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <Field
              label="Slug (vazio = a partir do nome)"
              value={form.slug}
              onChange={(value) => setForm({ ...form, slug: value })}
            />
          </Box>
          <Field
            label="Descrição (opcional)"
            value={form.description}
            onChange={(value) => setForm({ ...form, description: value })}
          />
          <Box className="flex flex-row items-center gap-4">
            <Field
              label="Ordem"
              type="number"
              className="w-24"
              value={form.sort}
              onChange={(value) => setForm({ ...form, sort: Number(value) })}
            />
            <Box className="flex flex-row items-center gap-2">
              <Switch
                checked={form.isPublished}
                onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
                size="small"
              />
              <Typography variant="body2">Publicada</Typography>
            </Box>
          </Box>
          <Box className="flex flex-row gap-2">
            <Button variant="contained" size="small" onClick={save} disabled={!form.name.trim()}>
              {form.id ? "Salvar alterações" : "Criar categoria"}
            </Button>
            <Button variant="text" color="grey" size="small" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            {form.id && (
              <Button variant="text" color="error" size="small" onClick={() => remove(form.id!)}>
                Excluir categoria (e todos os seus artigos)
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<HelpCategoryRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          actions={
            form ? undefined : (
              <Button variant="outlined" size="small" onClick={() => setForm(EMPTY_FORM)}>
                Nova categoria
              </Button>
            )
          }
          noRowsOverlay={
            form ? (
              <Typography variant="body2" className="text-text-secondary">
                Nenhuma categoria de ajuda ainda.
              </Typography>
            ) : (
              <EmptyState
                icon={<NiQuestionHexagon size="medium" />}
                title="Nenhuma categoria de ajuda ainda"
                description="As categorias agrupam os artigos da página pública /help. Comece pelos dois ou três assuntos que as profissionais mais perguntam."
                action={{ label: "Nova categoria", onClick: () => setForm(EMPTY_FORM) }}
                className="border-none"
              />
            )
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma categoria corresponde à busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
