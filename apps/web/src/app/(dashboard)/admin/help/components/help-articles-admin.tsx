"use client";

import { slugify } from "./help-categories-admin";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, FormLabel, Input, Switch, Tooltip, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import { Field, SelectField } from "@/app/(dashboard)/admin/billing/components/catalog-shared";
import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import { LOCALES } from "@/constants";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiPen from "@/icons/nexture/ni-pen";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type CategoryOption = { id: string; locale: string; name: string };

type ArticleRow = {
  id: string;
  categoryId: string;
  locale: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMd: string;
  sort: number;
  isPublished: boolean;
  updatedAt: string;
};

type FormState = {
  id: string | null;
  categoryId: string;
  locale: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  sort: number;
  isPublished: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  categoryId: "",
  locale: "en",
  slug: "",
  title: "",
  excerpt: "",
  bodyMd: "",
  sort: 0,
  isPublished: false,
};

/**
 * Help articles: written in Markdown per locale, published with a switch —
 * the public /help page updates without a deploy.
 */
export default function HelpArticlesAdmin() {
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data: articles, error: readError }, { data: cats }] = await Promise.all([
      supabase
        .from("help_articles")
        .select("id, category_id, locale, slug, title, excerpt, body_md, sort, is_published, updated_at")
        .order("locale")
        .order("sort"),
      supabase.from("help_categories").select("id, locale, name").order("locale").order("sort"),
    ]);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (articles ?? []).map((row) => ({
        id: row.id,
        categoryId: row.category_id,
        locale: row.locale,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        bodyMd: row.body_md,
        sort: row.sort,
        isPublished: row.is_published,
        updatedAt: row.updated_at,
      })),
    );
    setCategories((cats ?? []).map((cat) => ({ id: cat.id, locale: cat.locale, name: cat.name })));
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    if (!form || !form.title.trim() || !form.categoryId) return;
    setError(null);
    const supabase = createClient();
    const payload = {
      category_id: form.categoryId,
      locale: form.locale,
      slug: form.slug.trim() || slugify(form.title),
      title: form.title.trim(),
      excerpt: form.excerpt.trim() || null,
      body_md: form.bodyMd,
      sort: Number(form.sort) || 0,
      is_published: form.isPublished,
    };
    const query = form.id
      ? supabase.from("help_articles").update(payload).eq("id", form.id)
      : supabase.from("help_articles").insert(payload);
    const { error: writeError } = await query;
    if (writeError) {
      setError(writeError.message);
      return;
    }
    recordAudit(supabase, form.id ? "admin.help.article.updated" : "admin.help.article.created", {
      entityType: "help_article",
      entityId: form.id ?? undefined,
      metadata: { title: payload.title, locale: payload.locale },
    });
    setForm(null);
    refresh();
  };

  const remove = async (id: string) => {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("help_articles").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    recordAudit(supabase, "admin.help.article.deleted", { entityType: "help_article", entityId: id });
    setForm(null);
    refresh();
  };

  const togglePublished = useCallback(
    async (row: ArticleRow) => {
      setError(null);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("help_articles")
        .update({ is_published: !row.isPublished })
        .eq("id", row.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      recordAudit(supabase, row.isPublished ? "admin.help.article.unpublished" : "admin.help.article.published", {
        entityType: "help_article",
        entityId: row.id,
        metadata: { title: row.title },
      });
      refresh();
    },
    [refresh],
  );

  const openEdit = useCallback((row: ArticleRow) => {
    setForm({
      id: row.id,
      categoryId: row.categoryId,
      locale: row.locale,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt ?? "",
      bodyMd: row.bodyMd,
      sort: row.sort,
      isPublished: row.isPublished,
    });
  }, []);

  const formCategories = form ? categories.filter((cat) => cat.locale === form.locale) : [];

  const columns = useMemo<GridColDef<ArticleRow>[]>(() => {
    const categoryName = (id: string) => categories.find((cat) => cat.id === id)?.name ?? "?";
    return [
      {
        field: "title",
        headerName: "Título",
        flex: 2,
        minWidth: 220,
        renderCell: (params: GridRenderCellParams<ArticleRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "categoryId",
        headerName: "Categoria",
        flex: 1,
        minWidth: 150,
        // The searched text must be reachable as the cell value: the category
        // name lives in another table, not on the row.
        valueGetter: (_, row) => categoryName(row.categoryId),
        renderCell: (params: GridRenderCellParams<ArticleRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "slug",
        headerName: "Caminho",
        flex: 1,
        minWidth: 170,
        valueGetter: (_, row) => `/help/${row.slug}`,
        renderCell: (params: GridRenderCellParams<ArticleRow, string>) => (
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
        renderCell: (params: GridRenderCellParams<ArticleRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip label={params.row.locale} size="small" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "updatedAt",
        headerName: "Atualizado",
        minWidth: 130,
        valueFormatter: (value: string) => new Date(value).toLocaleDateString(),
      },
      {
        // Publish/unpublish is a kill switch for public content: it stays
        // visible on the row, never buried in the kebab.
        field: "isPublished",
        headerName: "Publicado",
        minWidth: 110,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<ArticleRow, boolean>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.isPublished ? "Despublicar" : "Publicar"}>
              <Switch
                checked={params.row.isPublished}
                onChange={() => togglePublished(params.row)}
                size="small"
                slotProps={{
                  input: {
                    "aria-label": params.row.isPublished ? "Despublicar artigo" : "Publicar artigo",
                  },
                }}
              />
            </Tooltip>
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
    ];
  }, [categories, openEdit, togglePublished]);

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
              onChange={(value) => setForm({ ...form, locale: value, categoryId: "" })}
            />
            <SelectField
              label="Categoria (mesmo idioma)"
              value={form.categoryId}
              options={formCategories.map((cat) => ({ value: cat.id, label: cat.name }))}
              onChange={(value) => setForm({ ...form, categoryId: value })}
            />
            <Field
              label="Slug (vazio = a partir do título)"
              value={form.slug}
              onChange={(value) => setForm({ ...form, slug: value })}
            />
          </Box>
          {formCategories.length === 0 && (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              Nenhuma categoria existe neste idioma ainda — crie uma antes na aba Categorias.
            </Alert>
          )}
          <Field label="Título" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
          <Field
            label="Resumo (aparece na lista de artigos)"
            value={form.excerpt}
            onChange={(value) => setForm({ ...form, excerpt: value })}
          />
          <FormControl className="outlined" variant="standard" size="small" fullWidth>
            <FormLabel component="label">Conteúdo (Markdown)</FormLabel>
            <Input
              multiline
              minRows={10}
              value={form.bodyMd}
              onChange={(e) => setForm({ ...form, bodyMd: e.target.value })}
              className="font-mono"
            />
          </FormControl>
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
              <Typography variant="body2">Publicado</Typography>
            </Box>
          </Box>
          <Box className="flex flex-row gap-2">
            <Button variant="contained" size="small" onClick={save} disabled={!form.title.trim() || !form.categoryId}>
              {form.id ? "Salvar alterações" : "Criar artigo"}
            </Button>
            <Button variant="text" color="grey" size="small" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            {form.id && (
              <Button variant="text" color="error" size="small" onClick={() => remove(form.id!)}>
                Excluir artigo
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<ArticleRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          actions={
            form ? undefined : (
              <Button variant="outlined" size="small" onClick={() => setForm(EMPTY_FORM)}>
                Novo artigo
              </Button>
            )
          }
          noRowsOverlay={
            form ? (
              <Typography variant="body2" className="text-text-secondary">
                Nenhum artigo de ajuda ainda.
              </Typography>
            ) : (
              <EmptyState
                icon={<NiDocumentFull size="medium" />}
                title="Nenhum artigo de ajuda ainda"
                description="Escreva o primeiro artigo que as profissionais vão encontrar em /help — comece pela pergunta que o suporte mais responde."
                action={{ label: "Novo artigo", onClick: () => setForm(EMPTY_FORM) }}
                className="border-none"
              />
            )
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum artigo corresponde à busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
