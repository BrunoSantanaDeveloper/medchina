"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, FormLabel, Input, Switch, Tooltip, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import { Field, SelectField } from "@/app/(dashboard)/admin/billing/components/catalog-shared";
import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiPen from "@/icons/nexture/ni-pen";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type AnnouncementRow = {
  id: string;
  title: string;
  body: string | null;
  level: "info" | "warning" | "critical";
  href: string | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
};

type FormState = {
  id: string | null;
  title: string;
  body: string;
  level: string;
  href: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  title: "",
  body: "",
  level: "info",
  href: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
};

const LEVEL_COLOR: Record<string, "default" | "warning" | "error"> = {
  info: "default",
  warning: "warning",
  critical: "error",
};

/** The level enum as the operator reads it; an unknown value falls back to the raw one. */
const LEVEL_LABEL: Record<string, string> = {
  info: "informativo",
  warning: "aviso",
  critical: "crítico",
};

// datetime-local <-> ISO helpers (the input needs local "YYYY-MM-DDTHH:mm").
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

const statusOf = (row: AnnouncementRow) => {
  if (!row.isActive) return "off";
  const now = Date.now();
  if (new Date(row.startsAt).getTime() > now) return "scheduled";
  if (row.endsAt && new Date(row.endsAt).getTime() <= now) return "expired";
  return "live";
};

const STATUS_COLOR: Record<string, "success" | "warning" | "default"> = {
  live: "success",
  scheduled: "warning",
  expired: "default",
  off: "default",
};

/** The computed window status, in words. */
const STATUS_LABEL: Record<string, string> = {
  live: "publicado",
  scheduled: "agendado",
  expired: "expirado",
  off: "desligado",
};

const formatWindow = (row: AnnouncementRow) =>
  `${new Date(row.startsAt).toLocaleString()}${row.endsAt ? ` → ${new Date(row.endsAt).toLocaleString()}` : ""}`;

/**
 * Publish and manage system-wide messages: write one, choose severity and
 * window, and it reaches every signed-in user until they dismiss it.
 */
export default function AnnouncementsAdmin() {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("announcements")
      .select("id, title, body, level, href, starts_at, ends_at, is_active")
      .order("created_at", { ascending: false })
      .limit(100);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        level: row.level,
        href: row.href,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        isActive: row.is_active,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    if (!form || !form.title.trim()) return;
    setError(null);
    const supabase = createClient();
    const payload = {
      title: form.title.trim(),
      body: form.body.trim() || null,
      level: form.level,
      href: form.href.trim() || null,
      starts_at: toIso(form.startsAt) ?? new Date().toISOString(),
      ends_at: toIso(form.endsAt),
      is_active: form.isActive,
    };
    const query = form.id
      ? supabase.from("announcements").update(payload).eq("id", form.id)
      : supabase.from("announcements").insert(payload);
    const { error: writeError } = await query;
    if (writeError) {
      setError(writeError.message);
      return;
    }
    recordAudit(supabase, form.id ? "admin.announcement.updated" : "admin.announcement.created", {
      entityType: "announcement",
      entityId: form.id ?? undefined,
      metadata: { title: payload.title, level: payload.level },
    });
    setForm(null);
    refresh();
  };

  const toggleActive = useCallback(
    async (row: AnnouncementRow) => {
      setError(null);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("announcements")
        .update({ is_active: !row.isActive })
        .eq("id", row.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      recordAudit(supabase, row.isActive ? "admin.announcement.deactivated" : "admin.announcement.activated", {
        entityType: "announcement",
        entityId: row.id,
        metadata: { title: row.title },
      });
      refresh();
    },
    [refresh],
  );

  const openEdit = useCallback((row: AnnouncementRow) => {
    setForm({
      id: row.id,
      title: row.title,
      body: row.body ?? "",
      level: row.level,
      href: row.href ?? "",
      startsAt: toLocalInput(row.startsAt),
      endsAt: toLocalInput(row.endsAt),
      isActive: row.isActive,
    });
  }, []);

  const columns = useMemo<GridColDef<AnnouncementRow>[]>(
    () => [
      {
        field: "title",
        headerName: "Título",
        flex: 2,
        minWidth: 220,
        renderCell: (params: GridRenderCellParams<AnnouncementRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "startsAt",
        headerName: "Janela",
        flex: 1.5,
        minWidth: 200,
        valueFormatter: (_value: string, row: AnnouncementRow) => formatWindow(row),
      },
      {
        field: "level",
        headerName: "Nível",
        minWidth: 110,
        // The quick search has to match the chip, not the stored enum.
        valueGetter: (_, row) => LEVEL_LABEL[row.level] ?? row.level,
        renderCell: (params: GridRenderCellParams<AnnouncementRow, AnnouncementRow["level"]>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={LEVEL_LABEL[params.row.level] ?? params.row.level}
              size="small"
              color={LEVEL_COLOR[params.row.level]}
              variant="outlined"
              className="capitalize"
            />
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Situação",
        minWidth: 120,
        valueGetter: (_, row) => STATUS_LABEL[statusOf(row)] ?? statusOf(row),
        renderCell: (params: GridRenderCellParams<AnnouncementRow, string>) => {
          const status = statusOf(params.row);
          return (
            <Box className="flex h-full items-center">
              <Chip
                label={STATUS_LABEL[status] ?? status}
                size="small"
                color={STATUS_COLOR[status]}
                variant="outlined"
                className="capitalize"
              />
            </Box>
          );
        },
      },
      {
        // Publish/unpublish is a kill switch: it stays visible on the row,
        // never buried in the kebab.
        field: "isActive",
        headerName: "Ativo",
        minWidth: 100,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<AnnouncementRow, boolean>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.isActive ? "Desativar" : "Ativar"}>
              <Switch
                checked={params.row.isActive}
                onChange={() => toggleActive(params.row)}
                size="small"
                slotProps={{
                  input: {
                    "aria-label": params.row.isActive ? "Desativar anúncio" : "Ativar anúncio",
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
    ],
    [openEdit, toggleActive],
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
          <Field label="Título" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
          <FormControl className="outlined" variant="standard" size="small" fullWidth>
            <FormLabel component="label">Texto (opcional)</FormLabel>
            <Input multiline rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </FormControl>
          <Box className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SelectField
              label="Nível"
              value={form.level}
              options={[
                { value: "info", label: "Informativo" },
                { value: "warning", label: "Aviso" },
                { value: "critical", label: "Crítico" },
              ]}
              onChange={(value) => setForm({ ...form, level: value })}
            />
            <Field
              label="Começa em (vazio = agora)"
              type="datetime-local"
              value={form.startsAt}
              onChange={(value) => setForm({ ...form, startsAt: value })}
            />
            <Field
              label="Termina em (vazio = até desativar)"
              type="datetime-local"
              value={form.endsAt}
              onChange={(value) => setForm({ ...form, endsAt: value })}
            />
          </Box>
          <Field
            label="Link para saber mais (opcional)"
            value={form.href}
            onChange={(value) => setForm({ ...form, href: value })}
          />
          <Box className="flex flex-row items-center gap-2">
            <Switch
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              size="small"
            />
            <Typography variant="body2">Ativo</Typography>
          </Box>
          <Box className="flex flex-row gap-2">
            <Button variant="contained" size="small" onClick={save} disabled={!form.title.trim()}>
              {form.id ? "Salvar alterações" : "Publicar"}
            </Button>
            <Button variant="text" color="grey" size="small" onClick={() => setForm(null)}>
              Cancelar
            </Button>
          </Box>
        </Box>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<AnnouncementRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          actions={
            form ? undefined : (
              <Button variant="outlined" size="small" onClick={() => setForm(EMPTY_FORM)}>
                Novo anúncio
              </Button>
            )
          }
          noRowsOverlay={
            form ? (
              <Typography variant="body2" className="text-text-secondary">
                Nenhum anúncio ainda.
              </Typography>
            ) : (
              <EmptyState
                icon={<NiAnnouncement size="medium" />}
                title="Nenhum anúncio ainda"
                description="Publique uma mensagem e toda profissional logada vê o aviso no topo da tela até dispensar — janelas de manutenção, novidades, mudanças de política."
                action={{ label: "Novo anúncio", onClick: () => setForm(EMPTY_FORM) }}
                className="border-none"
              />
            )
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum anúncio corresponde à busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
