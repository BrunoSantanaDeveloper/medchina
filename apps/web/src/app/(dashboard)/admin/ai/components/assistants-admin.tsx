"use client";

import { Field, SelectField } from "../../billing/components/catalog-shared";
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
  FormControl,
  FormControlLabel,
  FormLabel,
  TextareaAutosize,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiAi from "@/icons/nexture/ni-ai";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

/** Rows stay the raw assistant records — the edit dialog reads every column. */
type AssistantRow = Record<string, unknown>;

type AssistantForm = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  credits_per_message: number;
  is_active: boolean;
  sort: number;
};

const EMPTY: AssistantForm = {
  slug: "",
  name: "",
  description: "",
  provider: "anthropic",
  model: "claude-sonnet-5",
  system_prompt: "",
  temperature: 0.7,
  max_tokens: 2048,
  credits_per_message: 0,
  is_active: true,
  sort: 0,
};

const MODEL_HINT: Record<string, string> = {
  anthropic: "e.g. claude-sonnet-5, claude-haiku-4-5",
  gemini: "e.g. gemini-2.5-flash, gemini-2.5-pro",
  // Native ids here (no vendor prefix) — that prefix is what tells the two
  // OpenAI-dialect providers apart when reading an assistant row.
  openai: "native id, e.g. gpt-4o, gpt-4o-mini, o4-mini",
  openrouter: "REQUIRED full id, e.g. openai/gpt-4o, anthropic/claude-sonnet-5",
};

/** Env var backing each provider, named so a missing key is diagnosable. */
const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export default function AssistantsAdmin() {
  const [rows, setRows] = useState<AssistantRow[]>([]);
  const [form, setForm] = useState<AssistantForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Which providers hold a key here; null until the check answers. */
  const [configured, setConfigured] = useState<Record<string, boolean> | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase.from("assistants").select("*").order("sort");
    if (readError) {
      setLoadError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(data ?? []);
    setLoadError(null);
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    // Best-effort: an unanswered check simply shows no warning, never a false
    // "missing key" that would send the operator chasing a non-problem.
    void fetch("/api/admin/ai/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { providers?: Record<string, boolean> } | null) => setConfigured(body?.providers ?? null))
      .catch(() => setConfigured(null));
  }, []);

  const openEdit = useCallback((row?: AssistantRow) => {
    setError(null);
    setForm(
      row
        ? {
            id: row.id as string,
            slug: row.slug as string,
            name: row.name as string,
            description: (row.description as string) ?? "",
            provider: row.provider as string,
            model: row.model as string,
            system_prompt: row.system_prompt as string,
            temperature: Number(row.temperature),
            max_tokens: row.max_tokens as number,
            credits_per_message: row.credits_per_message as number,
            is_active: row.is_active as boolean,
            sort: row.sort as number,
          }
        : EMPTY,
    );
  }, []);

  const save = async () => {
    if (!form) return;
    setError(null);
    if (!form.model.trim()) {
      setError("Model is required.");
      return;
    }
    if (!form.system_prompt.trim()) {
      setError("System instructions are required — that is the whole point of an assistant.");
      return;
    }
    const supabase = createClient();
    const { error: saveError } = await supabase.from("assistants").upsert({
      ...(form.id ? { id: form.id } : {}),
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description || null,
      provider: form.provider,
      model: form.model.trim(),
      system_prompt: form.system_prompt,
      temperature: form.temperature,
      max_tokens: Number(form.max_tokens) || 2048,
      credits_per_message: Number(form.credits_per_message) || 0,
      is_active: form.is_active,
      sort: Number(form.sort) || 0,
    });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    recordAudit(supabase, form.id ? "admin.ai.assistant.updated" : "admin.ai.assistant.created", {
      entityType: "assistant",
      entityId: form.id || undefined,
      metadata: { slug: form.slug.trim(), provider: form.provider },
    });
    setForm(null);
    refresh();
  };

  const columns = useMemo<GridColDef<AssistantRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Assistant",
        flex: 2,
        minWidth: 220,
        // The slug is a second line in the cell, so keep both halves reachable
        // as the cell VALUE — that is what the quick filter searches.
        valueGetter: (_, row) => `${row.name ?? ""} (${row.slug ?? ""})`,
        renderCell: (params: GridRenderCellParams<AssistantRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {String(params.row.name ?? "")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {String(params.row.slug ?? "")}
            </Typography>
          </Box>
        ),
      },
      {
        field: "provider",
        headerName: "Provider",
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<AssistantRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip label={String(params.row.provider ?? "")} size="small" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "model",
        headerName: "Model",
        flex: 1.5,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<AssistantRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {String(params.row.model ?? "")}
            </Typography>
          </Box>
        ),
      },
      {
        field: "credits_per_message",
        headerName: "Credits/msg",
        type: "number",
        minWidth: 130,
      },
      {
        // Read-only report of the flag: activation is edited in the dialog,
        // never inline — there is no in-table write path here.
        field: "is_active",
        headerName: "Status",
        minWidth: 120,
        valueGetter: (_, row) => (row.is_active ? "active" : "inactive"),
        renderCell: (params: GridRenderCellParams<AssistantRow, string>) => {
          const active = Boolean(params.row.is_active);
          return (
            <Box className="flex h-full items-center">
              <Chip
                label={active ? "active" : "inactive"}
                size="small"
                color={active ? "success" : "default"}
                variant="outlined"
              />
            </Box>
          );
        },
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
      {loadError && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {loadError}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<AssistantRow>
          rows={rows}
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
              New assistant
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              icon={<NiAi size="medium" />}
              title="No assistants yet"
              description="An assistant is a model plus its system instructions — the behavior contract every chat with it obeys. Create one to make it available in the app."
              action={{ label: "New assistant", onClick: () => openEdit() }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              No assistants match your search.
            </Typography>
          }
        />
      )}

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="md" fullWidth>
        <DialogTitle>{form?.id ? "Edit assistant" : "New assistant"}</DialogTitle>
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
              label="Provider"
              value={form.provider}
              options={[
                { value: "anthropic", label: "Anthropic" },
                { value: "gemini", label: "Gemini (audio + image)" },
                { value: "openai", label: "OpenAI (direct account)" },
                { value: "openrouter", label: "OpenRouter (multi-model)" },
              ]}
              onChange={(v) => setForm({ ...form, provider: v })}
            />
            {/* Saying so HERE is the whole point: without it the missing key
                surfaces later, to a professional mid-appointment, as a provider
                error she cannot act on. */}
            {configured && configured[form.provider] === false && (
              <Alert severity="warning" className="neutral bg-background-paper/60! mb-2">
                {PROVIDER_KEY_ENV[form.provider] ?? "The API key"} is not set in this deployment — assistants on this
                provider will fail when used.
              </Alert>
            )}
            <Field
              label={`Model — ${MODEL_HINT[form.provider] ?? ""}`}
              value={form.model}
              onChange={(v) => setForm({ ...form, model: v })}
            />
            <FormControl className="outlined" variant="standard" size="small" fullWidth>
              <FormLabel component="label">System instructions (the assistant behavior contract)</FormLabel>
              <TextareaAutosize
                minRows={8}
                className="MuiInputBase-root MuiInput-root w-full"
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              />
            </FormControl>
            <Box className="flex flex-col gap-0 md:flex-row md:gap-4">
              <Field
                label="Temperature (0-1)"
                type="number"
                value={form.temperature}
                onChange={(v) => setForm({ ...form, temperature: Number(v) })}
              />
              <Field
                label="Max tokens"
                type="number"
                value={form.max_tokens}
                onChange={(v) => setForm({ ...form, max_tokens: Number(v) })}
              />
              <Field
                label="Credits per message"
                type="number"
                value={form.credits_per_message}
                onChange={(v) => setForm({ ...form, credits_per_message: Number(v) })}
              />
              <Field
                label="Sort"
                type="number"
                value={form.sort}
                onChange={(v) => setForm({ ...form, sort: Number(v) })}
              />
            </Box>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
              }
              label="Active"
            />
            <Typography variant="body2" className="text-text-secondary">
              Audio input requires Gemini (or an audio-capable OpenRouter model). Images work on all providers.
            </Typography>
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
