"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiPlus from "@/icons/nexture/ni-plus";
import NiPrinter from "@/icons/nexture/ni-printer";
import NiReceipt from "@/icons/nexture/ni-receipt";
import { type Prescription, prescriptionText } from "@/lib/prescription";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/** A prescription as this panel sees it: one free text plus its review state. */
type Row = Prescription & { text: string };

/**
 * The professional's receituário — deliberately SIMPLE: one free-text body she
 * writes herself (nothing here is AI generated; the assistant never prescribes,
 * PRD §10/§16). She writes, validates (signs), and prints or downloads the
 * signed PDF straight from the card — the letterhead (clinic + professional),
 * signature and QR verification are the document's frame, her text is its only
 * body. Versioning and verification codes stay INTERNAL: the QR on the paper
 * remains the proof, without asking her to manage versions.
 */
export default function PrescriptionPanel({
  consultationId,
  orgId,
  isFinalized,
}: {
  consultationId: string;
  orgId: string;
  isFinalized: boolean;
}) {
  const t = useTranslations("product");
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [draft, setDraft] = useState<{ id: string | null; text: string } | null>(null);
  const [validating, setValidating] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("consultation_prescriptions")
      .select("id, kind, title, items, posology, preparation, notes, status, validated_at, updated_at")
      .eq("consultation_id", consultationId)
      .order("created_at", { ascending: true });
    if (error) {
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setLoadFailed(false);
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        kind: row.kind === "herbal" ? "herbal" : "generic",
        title: row.title ?? "",
        items: [],
        posology: row.posology ?? "",
        preparation: row.preparation ?? "",
        notes: row.notes ?? "",
        status: row.status === "validated" ? "validated" : "draft",
        validatedAt: row.validated_at,
        updatedAt: row.updated_at,
        text: prescriptionText(row),
      })),
    );
    setLoaded(true);
  }, [consultationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    const text = draft.text.trim();
    if (!text) {
      setActionError(t("prescription-empty-text"));
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const supabase = createClient();
      // The whole prescription is ONE text; the structured legacy columns are
      // cleared so what she sees is exactly what the PDF will carry. Any edit
      // returns it to a draft — a signature was of a specific content.
      const values = {
        kind: "generic" as const,
        title: null,
        items: [],
        posology: null,
        preparation: null,
        notes: text,
        status: "draft" as const,
        validated_by: null,
        validated_at: null,
      };
      if (draft.id) {
        const { error } = await supabase.from("consultation_prescriptions").update(values).eq("id", draft.id);
        if (error) throw error;
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error } = await supabase.from("consultation_prescriptions").insert({
          ...values,
          org_id: orgId,
          consultation_id: consultationId,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
      setDraft(null);
      await load();
    } catch {
      setActionError(t("prescription-error"));
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (!validating) return;
    setSaving(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("consultation_prescriptions")
        .update({ status: "validated", validated_by: user?.id ?? null, validated_at: new Date().toISOString() })
        .eq("id", validating.id);
      if (error) throw error;
      setValidating(null);
      await load();
    } catch {
      setActionError(t("prescription-error"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("consultation_prescriptions").delete().eq("id", confirmDelete.id);
      if (error) throw error;
      setConfirmDelete(null);
      await load();
    } catch {
      setActionError(t("prescription-error"));
    } finally {
      setSaving(false);
    }
  };

  /**
   * The signed PDF for a validated prescription, issuing (or re-issuing after
   * an edit + re-validation) only when the current version is not already on
   * file. Versions and verify codes are managed here so the professional never
   * has to — the QR printed on the paper remains the public proof.
   */
  const ensurePdfPath = async (row: Row): Promise<string | null> => {
    const supabase = createClient();
    const { data: latest } = await supabase
      .from("documents")
      .select("id, version, status, storage_path, issued_at")
      .eq("kind", "prescription")
      .eq("source_type", "consultation_prescription")
      .eq("source_id", row.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const current =
      latest?.status === "issued" &&
      latest.storage_path &&
      row.validatedAt &&
      latest.issued_at &&
      new Date(latest.issued_at) >= new Date(row.validatedAt);
    if (current) return latest.storage_path as string;

    const issueOnce = async (confirmVersion?: number) =>
      fetch(`/api/consultations/${consultationId}/prescriptions/${row.id}/issue`, {
        method: "POST",
        headers: {
          "idempotency-key": crypto.randomUUID(),
          ...(confirmVersion ? { "confirm-version": String(confirmVersion) } : {}),
        },
      });

    let response = await issueOnce(latest ? latest.version + 1 : undefined);
    let body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      documentId?: string;
      error?: { code?: string; details?: { expectedVersion?: number } };
    };
    if (!response.ok && body.error?.code === "document_reissue_confirmation_required") {
      response = await issueOnce(body.error.details?.expectedVersion);
      body = await response.json().catch(() => ({}));
    }
    if (!response.ok || !body.ok || !body.documentId) {
      setActionError(
        body.error?.code === "document_profile_incomplete"
          ? t("prescription-issue-profile-incomplete")
          : t("prescription-issue-error"),
      );
      return null;
    }
    const { data: issued } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", body.documentId)
      .maybeSingle();
    return (issued?.storage_path as string | null) ?? null;
  };

  const fetchPdfBlobUrl = async (row: Row): Promise<string | null> => {
    const path = await ensurePdfPath(row);
    if (!path) return null;
    const supabase = createClient();
    const { data: signed } = await supabase.storage.from("documents").createSignedUrl(path, 120);
    if (!signed?.signedUrl) {
      setActionError(t("prescription-download-error"));
      return null;
    }
    const pdf = await fetch(signed.signedUrl);
    if (!pdf.ok) {
      setActionError(t("prescription-download-error"));
      return null;
    }
    return URL.createObjectURL(await pdf.blob());
  };

  const download = async (row: Row) => {
    setBusyId(row.id);
    setActionError(null);
    try {
      const url = await fetchPdfBlobUrl(row);
      if (!url) return;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "receituario.pdf";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setActionError(t("prescription-download-error"));
    } finally {
      setBusyId(null);
    }
  };

  const print = async (row: Row) => {
    setBusyId(row.id);
    setActionError(null);
    try {
      const url = await fetchPdfBlobUrl(row);
      if (!url) return;
      const viewer = window.open(url, "_blank", "noopener");
      // Best effort: the browser's PDF viewer has its own print control when
      // the programmatic call is refused for a blob document.
      window.setTimeout(() => {
        try {
          viewer?.print();
        } catch {
          /* viewer stays open for a manual print */
        }
      }, 800);
    } catch {
      setActionError(t("prescription-download-error"));
    } finally {
      setBusyId(null);
    }
  };

  // Nothing to show and nothing to add on a finalized record without content.
  if (loaded && rows.length === 0 && isFinalized) return null;

  const titleOf = (row: Row) => {
    const firstLine = row.text.split("\n").find((line) => line.trim().length > 0) ?? "";
    return firstLine.length > 70 ? `${firstLine.slice(0, 70)}…` : firstLine || t("prescription-title");
  };

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-row items-center gap-2">
          <span
            aria-hidden
            className="bg-secondary/10 text-secondary flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          >
            <NiReceipt size="small" />
          </span>
          <Box className="min-w-0">
            <Typography variant="h6" component="h2" className="mb-0">
              {t("prescription-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("prescription-subtitle")}
            </Typography>
          </Box>
        </Box>

        {loadFailed && (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={<Button onClick={() => void load()}>{t("retry")}</Button>}
          >
            {t("prescription-load-error")}
          </Alert>
        )}

        {actionError && (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {actionError}
          </Alert>
        )}

        {!loaded ? (
          <CircularProgress size={20} aria-label={t("loading")} />
        ) : (
          <>
            {rows.length === 0 ? (
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("prescription-empty")}
              </Typography>
            ) : (
              <Box className="flex flex-col gap-2">
                {rows.map((row) => {
                  const busy = busyId === row.id;
                  const printable = row.status === "validated";
                  return (
                    <Box key={row.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border px-3.5 py-3">
                      <Box className="flex flex-row items-center gap-2">
                        <Typography variant="body2" className="text-text-primary min-w-0 flex-1 font-semibold">
                          {titleOf(row)}
                        </Typography>
                        {row.status === "validated" && (
                          <Chip
                            size="small"
                            label={t("prescription-status-validated")}
                            className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light text-xs font-semibold"
                          />
                        )}
                        {busy ? (
                          <CircularProgress size={18} aria-label={t("loading")} />
                        ) : (
                          <Box className="-mr-1 flex flex-none flex-row items-center">
                            <Tooltip title={printable ? t("plan-doc-download") : t("prescription-validate-first")}>
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label={t("plan-doc-download")}
                                  disabled={!printable}
                                  onClick={() => void download(row)}
                                >
                                  <NiDownloadCloud size="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={printable ? t("prescription-print") : t("prescription-validate-first")}>
                              <span>
                                <IconButton
                                  size="small"
                                  aria-label={t("prescription-print")}
                                  disabled={!printable}
                                  onClick={() => void print(row)}
                                >
                                  <NiPrinter size="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                        )}
                      </Box>
                      <Typography variant="body2" className="text-text-secondary line-clamp-2 text-xs leading-5">
                        {row.text}
                      </Typography>
                      {!isFinalized && (
                        <Box className="flex flex-row flex-wrap gap-2">
                          <Button
                            size="small"
                            variant="outlined"
                            color="grey"
                            onClick={() => {
                              setActionError(null);
                              setDraft({ id: row.id, text: row.text });
                            }}
                          >
                            {t("prescription-edit")}
                          </Button>
                          {row.status === "draft" && (
                            <Button size="small" variant="outlined" color="primary" onClick={() => setValidating(row)}>
                              {t("prescription-validate")}
                            </Button>
                          )}
                          <Button size="small" variant="text" color="grey" onClick={() => setConfirmDelete(row)}>
                            {t("prescription-delete")}
                          </Button>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}

            {!isFinalized && (
              <Button
                variant="outlined"
                color="primary"
                fullWidth
                startIcon={<NiPlus size="tiny" />}
                onClick={() => {
                  setActionError(null);
                  setDraft({ id: null, text: "" });
                }}
              >
                {t("prescription-add")}
              </Button>
            )}
          </>
        )}

        {/* The draft-not-autonomous framing travels with the receituário. */}
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("prescription-disclaimer")}
        </Typography>
      </CardContent>

      {/* Author / edit: ONE descriptive field, written by her. */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} maxWidth="sm" fullWidth scroll="paper">
        <DialogHeader title={t("prescription-title")} closeLabel={t("close")} onClose={() => setDraft(null)} />
        {draft && (
          <DialogContent dividers className="flex flex-col gap-3 py-5!">
            <TextField
              label={t("prescription-description")}
              autoFocus
              fullWidth
              multiline
              minRows={8}
              value={draft.text}
              onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            />
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("prescription-description-hint")}
            </Typography>
          </DialogContent>
        )}
        <DialogActions>
          <Button color="grey" onClick={() => setDraft(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={save} disabled={saving}>
            {saving ? <CircularProgress size={16} /> : t("prescription-save")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Validate (sign) confirmation. */}
      <Dialog open={Boolean(validating)} onClose={() => setValidating(null)} maxWidth="xs" fullWidth>
        <DialogHeader title={t("prescription-validate")} closeLabel={t("close")} onClose={() => setValidating(null)} />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("prescription-validate-body")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setValidating(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={validate} disabled={saving}>
            {saving ? <CircularProgress size={16} /> : t("prescription-validate-confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation. */}
      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogHeader title={t("prescription-delete")} closeLabel={t("close")} onClose={() => setConfirmDelete(null)} />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("prescription-delete-confirm")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmDelete(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={remove} disabled={saving}>
            {saving ? <CircularProgress size={16} /> : t("prescription-delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
