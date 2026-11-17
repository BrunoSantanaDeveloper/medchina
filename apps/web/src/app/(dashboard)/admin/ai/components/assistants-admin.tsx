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
import IllustrationLaunch from "@/icons/illustrations/illustration-launch";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import { recordAudit } from "@/lib/audit";
import { LIBRARY_ASSISTANT_SLUG } from "@/lib/clinical-library";
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
  /** Thinking depth for Claude ("" = the model's default), kept in `config.effort`. */
  effort: string;
  /** The row's `config` as loaded — knowledge and quota keys live here and must survive a save. */
  config: Record<string, unknown>;
};

const EMPTY: AssistantForm = {
  slug: "",
  name: "",
  description: "",
  // The processor the clinical data already goes to. Any other provider is a
  // second processor — a decision taken in the form, never a default.
  provider: "gemini",
  model: "gemini-3.6-flash",
  system_prompt: "",
  temperature: 0.7,
  max_tokens: 2048,
  credits_per_message: 0,
  is_active: true,
  sort: 0,
  effort: "",
  config: {},
};

const MODEL_HINT: Record<string, string> = {
  anthropic: "ex.: claude-sonnet-5-5, claude-opus-5-5, claude-haiku-5-5",
  gemini: "ex.: gemini-3.6-flash, gemini-3.8-flash",
  // Native ids here (no vendor prefix) — that prefix is what tells the two
  // OpenAI-dialect providers apart when reading an assistant row.
  openai: "id nativo, ex.: gpt-4o, gpt-4o-mini, o4-mini",
  openrouter: "id completo OBRIGATÓRIO, ex.: openai/gpt-4o, anthropic/claude-sonnet-5",
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
            effort: String((row.config as { effort?: unknown } | null)?.effort ?? ""),
            config: (row.config as Record<string, unknown> | null) ?? {},
          }
        : EMPTY,
    );
  }, []);

  const save = async () => {
    if (!form) return;
    setError(null);
    if (!form.model.trim()) {
      setError("Informe o modelo.");
      return;
    }
    if (!form.system_prompt.trim()) {
      setError("As instruções de sistema são obrigatórias — é o que define o assistente.");
      return;
    }
    const supabase = createClient();
    // Merged into what the row already holds: its knowledge collections and
    // quota key live in the same `config` and are not edited here.
    const config: Record<string, unknown> = { ...form.config };
    if (form.effort) config.effort = form.effort;
    else delete config.effort;
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
      config,
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
        headerName: "Assistente",
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
        headerName: "Provedor",
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<AssistantRow, string>) => (
          <Box className="flex h-full items-center">
            <Chip label={String(params.row.provider ?? "")} size="small" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "model",
        headerName: "Modelo",
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
        headerName: "Créditos/msg",
        type: "number",
        minWidth: 130,
      },
      {
        // Read-only report of the flag: activation is edited in the dialog,
        // never inline — there is no in-table write path here.
        field: "is_active",
        headerName: "Situação",
        minWidth: 120,
        valueGetter: (_, row) => (row.is_active ? "ativo" : "inativo"),
        renderCell: (params: GridRenderCellParams<AssistantRow, string>) => {
          const active = Boolean(params.row.is_active);
          return (
            <Box className="flex h-full items-center">
              <Chip
                label={active ? "ativo" : "inativo"}
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
              Novo assistente
            </Button>
          }
          noRowsOverlay={
            <EmptyState
              layout="row"
              illustration={<IllustrationLaunch />}
              title="Nenhum assistente ainda"
              description="Um assistente é um modelo mais suas instruções de sistema — o contrato de comportamento que toda conversa com ele obedece. Crie um para disponibilizá-lo no aplicativo."
              action={{ label: "Novo assistente", onClick: () => openEdit() }}
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum assistente corresponde à busca.
            </Typography>
          }
        />
      )}

      <Dialog open={form !== null} onClose={() => setForm(null)} maxWidth="md" fullWidth>
        <DialogTitle>{form?.id ? "Editar assistente" : "Novo assistente"}</DialogTitle>
        {form && (
          <DialogContent className="flex flex-col">
            <Field label="Nome" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Slug" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} />
            <Field label="Descrição" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
            <SelectField
              label="Provedor"
              value={form.provider}
              options={[
                { value: "anthropic", label: "Anthropic" },
                { value: "gemini", label: "Gemini (áudio + imagem)" },
                { value: "openai", label: "OpenAI (conta direta)" },
                { value: "openrouter", label: "OpenRouter (multimodelo)" },
              ]}
              onChange={(v) => setForm({ ...form, provider: v })}
            />
            {/* Saying so HERE is the whole point: without it the missing key
                surfaces later, to a professional mid-appointment, as a provider
                error she cannot act on. */}
            {configured && configured[form.provider] === false && (
              <Alert severity="warning" className="neutral bg-background-paper/60! mb-2">
                {PROVIDER_KEY_ENV[form.provider] ?? "A chave de API"} não está definida neste ambiente — assistentes
                deste provedor vão falhar quando usados.
              </Alert>
            )}
            {form.provider !== "gemini" && (
              <Alert severity="warning" className="neutral bg-background-paper/60! mb-2">
                {form.slug.trim() === LIBRARY_ASSISTANT_SLUG
                  ? "Este é o assistente da biblioteca clínica: com este provedor, as conversas — e o prontuário que a revisão de caso envia — passam a ir para um segundo processador de dados, além do Gemini. Confirme antes o acordo de tratamento de dados (LGPD) com ele."
                  : "As conversas deste assistente vão para um segundo processador de dados, além do Gemini. Confirme antes o acordo de tratamento de dados (LGPD) com ele. O prontuário do paciente nunca é anexado aqui: a revisão de caso só roda no assistente da biblioteca clínica."}
              </Alert>
            )}
            <Field
              label={`Modelo — ${MODEL_HINT[form.provider] ?? ""}`}
              value={form.model}
              onChange={(v) => setForm({ ...form, model: v })}
            />
            <FormControl className="outlined" variant="standard" size="small" fullWidth>
              <FormLabel component="label">Instruções de sistema (o contrato de comportamento do assistente)</FormLabel>
              <TextareaAutosize
                minRows={8}
                className="MuiInputBase-root MuiInput-root w-full"
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              />
            </FormControl>
            {form.provider === "anthropic" && (
              <SelectField
                label="Esforço de raciocínio (Claude)"
                value={form.effort}
                options={[
                  { value: "", label: "Padrão do modelo" },
                  { value: "low", label: "Baixo — respostas rápidas" },
                  { value: "medium", label: "Médio" },
                  { value: "high", label: "Alto" },
                  { value: "xhigh", label: "Muito alto" },
                  { value: "max", label: "Máximo — mais lento e caro" },
                ]}
                onChange={(v) => setForm({ ...form, effort: v })}
              />
            )}
            <Box className="flex flex-col gap-0 md:flex-row md:gap-4">
              <Field
                // Claude 4.7+ and 5.x reject sampling parameters; the provider
                // drops it for them, so the field must not look like it works.
                label={form.provider === "anthropic" ? "Temperatura (ignorada no Claude 5.x)" : "Temperatura (0-1)"}
                type="number"
                value={form.temperature}
                onChange={(v) => setForm({ ...form, temperature: Number(v) })}
              />
              <Field
                label="Máximo de tokens"
                type="number"
                value={form.max_tokens}
                onChange={(v) => setForm({ ...form, max_tokens: Number(v) })}
              />
              <Field
                label="Créditos por mensagem"
                type="number"
                value={form.credits_per_message}
                onChange={(v) => setForm({ ...form, credits_per_message: Number(v) })}
              />
              <Field
                label="Ordem"
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
              label="Ativo"
            />
            <Typography variant="body2" className="text-text-secondary">
              Entrada de áudio exige Gemini (ou um modelo do OpenRouter com suporte a áudio). Imagens funcionam em todos
              os provedores.
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
