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

/** The prescription as this panel sees it: one free text plus its review state. */
type Row = Prescription & { text: string };

/**
 * The professional's receituário — ONE per consultation, deliberately simple.
 *
 * She writes a single free text (nothing here is AI generated; the assistant
 * never prescribes, PRD §10/§16), validates it (signs), and downloads or prints
 * the signed PDF from the icons in this card's own header. The letterhead
 * (clinic + professional), signature and QR verification are the document's
 * frame; her text is its only body. Versions and verify codes stay INTERNAL —
 * the QR on the paper is the public proof, and she never manages versions.
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
  const [row, setRow] = useState<Row | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [draft, setDraft] = useState<{ id: string | null; text: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    const supabase = createClient();
    // One per consultation — the oldest wins if history ever left more than one,
    // so the card never silently picks a different prescription between loads.
    const { data, error } = await supabase
      .from("consultation_prescriptions")
      .select("id, kind, title, items, posology, preparation, notes, status, validated_at, updated_at")
      .eq("consultation_id", consultationId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setLoadFailed(false);
    setRow(
      data
        ? {
            id: data.id,
            kind: data.kind === "herbal" ? "herbal" : "generic",
            title: data.title ?? "",
            items: [],
            posology: data.posology ?? "",
            preparation: data.preparation ?? "",
            notes: data.notes ?? "",
            status: data.status === "validated" ? "validated" : "draft",
            validatedAt: data.validated_at,
            updatedAt: data.updated_at,
            text: prescriptionText(data),
          }
        : null,
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
    if (!row) return;
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
        .eq("id", row.id);
      if (error) throw error;
      setValidating(false);
      await load();
    } catch {
      setActionError(t("prescription-error"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!row) return;
    setSaving(true);
    setActionError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("consultation_prescriptions").delete().eq("id", row.id);
      if (error) throw error;
      setConfirmDelete(false);
      await load();
    } catch {
      setActionError(t("prescription-error"));
    } finally {
      setSaving(false);
    }
  };

  /**
   * The signed PDF for a validated prescription, issuing (or re-issuing after an
   * edit + re-validation) only when the current version is not already on file.
   */
  const ensurePdfPath = async (target: Row): Promise<string | null> => {
    const supabase = createClient();
    const { data: latest } = await supabase
      .from("documents")
      .select("id, version, status, storage_path, issued_at")
      .eq("kind", "prescription")
      .eq("source_type", "consultation_prescription")
      .eq("source_id", target.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const current =
      latest?.status === "issued" &&
      latest.storage_path &&
      target.validatedAt &&
      latest.issued_at &&
      new Date(latest.issued_at) >= new Date(target.validatedAt);
    if (current) return latest.storage_path as string;

    const issueOnce = async (confirmVersion?: number) =>
      fetch(`/api/consultations/${consultationId}/prescriptions/${target.id}/issue`, {
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

  const fetchPdfBlobUrl = async (target: Row): Promise<string | null> => {
    const path = await ensurePdfPath(target);
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

  const download = async () => {
    if (!row) return;
    setBusy(true);
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
      setBusy(false);
    }
  };

  const print = async () => {
    if (!row) return;
    setBusy(true);
    setActionError(null);
    try {
      const url = await fetchPdfBlobUrl(row);
      if (!url) return;
      const viewer = window.open(url, "_blank", "noopener");
      // Best effort: the browser's PDF viewer keeps its own print control when
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
      setBusy(false);
    }
  };

  // Nothing to show and nothing to add on a finalized record without content.
  if (loaded && !row && isFinalized) return null;

  const printable = row?.status === "validated";

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        {/* Header owns the document actions: there is ONE prescription, so its
            download/print belong to the card itself rather than to a nested
            card repeating the same title. */}
        <Box className="flex flex-row items-center gap-2">
          <span
            aria-hidden
            className="bg-secondary/10 text-secondary flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          >
            <NiReceipt size="small" />
          </span>
          <Box className="min-w-0 flex-1">
            <Typography variant="h6" component="h2" className="mb-0">
              {t("prescription-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("prescription-subtitle")}
            </Typography>
          </Box>
          {row?.status === "validated" && (
            <Chip
              size="small"
              label={t("prescription-status-validated")}
              className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light flex-none text-xs font-semibold"
            />
          )}
          {row &&
            (busy ? (
              <CircularProgress size={18} aria-label={t("loading")} className="flex-none" />
            ) : (
              <Box className="-mr-1 flex flex-none flex-row items-center">
                <Tooltip title={printable ? t("plan-doc-download") : t("prescription-validate-first")}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t("plan-doc-download")}
                      disabled={!printable}
                      onClick={() => void download()}
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
                      onClick={() => void print()}
                    >
                      <NiPrinter size="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
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
        ) : !row ? (
          <>
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("prescription-empty")}
            </Typography>
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
        ) : (
          <>
            {/* Her text, straight in the card — the same body the PDF carries. */}
            <Typography variant="body2" className="text-text-primary leading-6 whitespace-pre-line">
              {row.text}
            </Typography>
            {/* Signing survives the freeze; rewriting and deleting do not.
                A prescription is usually written at the very end of the
                appointment, so closing the record first used to leave the
                document the patient came for permanently unsignable. */}
            {(!isFinalized || row.status === "draft") && (
              <Box className="flex flex-row flex-wrap gap-2">
                {!isFinalized && (
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
                )}
                {row.status === "draft" && (
                  <Button size="small" variant="outlined" color="primary" onClick={() => setValidating(true)}>
                    {t("prescription-validate")}
                  </Button>
                )}
                {!isFinalized && (
                  <Button size="small" variant="text" color="grey" onClick={() => setConfirmDelete(true)}>
                    {t("prescription-delete")}
                  </Button>
                )}
              </Box>
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
      <Dialog open={validating} onClose={() => setValidating(false)} maxWidth="xs" fullWidth>
        <DialogHeader title={t("prescription-validate")} closeLabel={t("close")} onClose={() => setValidating(false)} />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("prescription-validate-body")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setValidating(false)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={validate} disabled={saving}>
            {saving ? <CircularProgress size={16} /> : t("prescription-validate-confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation. */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogHeader
          title={t("prescription-delete")}
          closeLabel={t("close")}
          onClose={() => setConfirmDelete(false)}
        />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("prescription-delete-confirm")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmDelete(false)}>
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
