"use client";

import { deleteProtocol, saveProtocol } from "./actions";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useProfile } from "@/hooks/use-profile";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlus from "@/icons/nexture/ni-plus";
import { OWN_PROTOCOLS_SLUG } from "@/lib/clinical-library";
import { trackProductEvent } from "@/lib/product-events";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

type Protocol = { id: string; title: string; content: string; status: string; error: string | null };

type Draft = { id?: string; title: string; content: string };

/**
 * Her own protocols (fase 5). The job: write down how SHE treats something,
 * once, and have it come back — cited — whenever she asks the library or
 * reviews a case. Success is a protocol that is indexed and then quoted back
 * to her, so this screen is a short list plus one writing surface, never a
 * document manager.
 */
export default function Protocolos() {
  const t = useTranslations("product");
  const { orgId } = useCurrentOrg();
  const { displayName } = useProfile();
  const { enqueueSnackbar } = useSnackbar();
  const [state, setState] = useState<RemoteState<Protocol[], string>>(() => remoteLoading());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Protocol | null>(null);

  const load = useCallback(async () => {
    setState(remoteLoading());
    if (!isSupabaseConfigured || !orgId) {
      setState(remoteEmpty());
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("id, title, content, status, error, knowledge_collections!inner(slug, org_id)")
      .eq("knowledge_collections.slug", OWN_PROTOCOLS_SLUG)
      .eq("knowledge_collections.org_id", orgId)
      .order("title");
    if (error) {
      setState(remoteError(error.message));
      return;
    }
    const rows = (data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      content: row.content as string,
      status: row.status as string,
      error: (row.error as string | null) ?? null,
    }));
    setState(rows.length === 0 ? remoteEmpty() : remoteSuccess(rows));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft || !orgId || saving) return;
    setSaving(true);
    const result = await saveProtocol({
      orgId,
      id: draft.id,
      title: draft.title,
      content: draft.content,
      authorLabel: displayName ? t("protocols-author", { name: displayName }) : t("protocols-author-generic"),
      collectionName: t("protocols-collection-name"),
    });
    setSaving(false);
    if (!result.ok) {
      enqueueSnackbar(result.error === "empty" ? t("protocols-required") : t("protocols-save-error"), {
        variant: "error",
      });
      return;
    }
    trackProductEvent("protocol.saved");
    enqueueSnackbar(t("protocols-saved"), { variant: "success" });
    setDraft(null);
    await load();
  };

  const remove = async () => {
    if (!confirmDelete || !orgId) return;
    const result = await deleteProtocol(orgId, confirmDelete.id);
    setConfirmDelete(null);
    if (!result.ok) {
      enqueueSnackbar(t("protocols-delete-error"), { variant: "error" });
      return;
    }
    enqueueSnackbar(t("protocols-deleted"), { variant: "success" });
    await load();
  };

  const statusChip = (protocol: Protocol) => {
    if (protocol.status === "ready")
      return <Chip size="small" variant="outlined" label={t("protocols-status-ready")} />;
    if (protocol.status === "error") {
      return <Chip size="small" color="warning" variant="outlined" label={t("protocols-status-error")} />;
    }
    return <Chip size="small" variant="outlined" label={t("protocols-status-pending")} />;
  };

  return (
    <Box className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <Box className="flex flex-row flex-wrap items-start justify-between gap-3">
        <Box>
          <Typography variant="h1" component="h1" className="mb-0">
            {t("protocols-title")}
          </Typography>
          <Breadcrumbs>
            <Link color="inherit" href="/inicio">
              {t("home-breadcrumb")}
            </Link>
            <Link color="inherit" href="/biblioteca">
              {t("library-title")}
            </Link>
            <Typography variant="body2">{t("protocols-title")}</Typography>
          </Breadcrumbs>
        </Box>
        {state.status === "success" && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<NiPlus size="small" />}
            onClick={() => setDraft({ title: "", content: "" })}
          >
            {t("protocols-new")}
          </Button>
        )}
      </Box>

      <Typography variant="body1" className="text-text-secondary max-w-3xl">
        {t("protocols-subtitle")}
      </Typography>

      <Card component="section">
        <CardContent className="flex flex-col gap-3">
          {state.status === "error" ? (
            <Alert severity="error" action={<Button onClick={load}>{t("retry")}</Button>}>
              {state.error}
            </Alert>
          ) : state.status === "idle" || state.status === "loading" ? (
            <Skeleton variant="rounded" height={200} className="rounded-3xl" />
          ) : state.status === "empty" ? (
            <EmptyState
              icon={<NiPen />}
              title={t("protocols-empty-title")}
              description={t("protocols-empty-body")}
              action={{ label: t("protocols-new"), onClick: () => setDraft({ title: "", content: "" }) }}
              className="border-0"
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
              {state.data.map((protocol) => (
                <Box
                  component="li"
                  key={protocol.id}
                  className="border-grey-100 flex flex-row flex-wrap items-center justify-between gap-2 rounded-2xl border p-3"
                >
                  <Box className="flex min-w-0 flex-col gap-1">
                    <Typography variant="body1" className="text-text-primary font-medium">
                      {protocol.title}
                    </Typography>
                    <Box className="flex flex-row flex-wrap items-center gap-2">
                      {statusChip(protocol)}
                      {protocol.status === "error" && protocol.error && (
                        <Typography variant="body2" className="text-text-secondary text-xs">
                          {protocol.error}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <Box className="flex flex-row flex-wrap gap-1">
                    <Button
                      size="small"
                      variant="text"
                      color="grey"
                      onClick={() => setDraft({ id: protocol.id, title: protocol.title, content: protocol.content })}
                      aria-label={t("protocols-edit-for", { title: protocol.title })}
                    >
                      {t("protocols-edit")}
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      color="grey"
                      onClick={() => setConfirmDelete(protocol)}
                      aria-label={t("protocols-delete-for", { title: protocol.title })}
                    >
                      {t("protocols-delete")}
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(draft)} onClose={() => !saving && setDraft(null)} fullWidth maxWidth="md">
        <DialogTitle>{draft?.id ? t("protocols-edit-title") : t("protocols-new-title")}</DialogTitle>
        <DialogContent className="flex flex-col gap-4 pt-2!">
          <TextField
            label={t("protocols-field-title")}
            value={draft?.title ?? ""}
            onChange={(event) => setDraft((current) => (current ? { ...current, title: event.target.value } : current))}
            fullWidth
          />
          <TextField
            label={t("protocols-field-content")}
            helperText={t("protocols-field-content-hint")}
            value={draft?.content ?? ""}
            onChange={(event) =>
              setDraft((current) => (current ? { ...current, content: event.target.value } : current))
            }
            multiline
            minRows={10}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setDraft(null)} disabled={saving}>
            {t("protocols-cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={save}
            disabled={saving || !draft?.title.trim() || !draft?.content.trim()}
          >
            {t("protocols-save")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("protocols-delete-title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" className="text-text-secondary">
            {t("protocols-delete-body", { title: confirmDelete?.title ?? "" })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmDelete(null)}>
            {t("protocols-cancel")}
          </Button>
          <Button color="error" variant="contained" onClick={remove}>
            {t("protocols-delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
