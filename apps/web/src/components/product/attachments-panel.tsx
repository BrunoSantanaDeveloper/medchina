"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Typography,
} from "@mui/material";

import ConsultationStepHeader from "@/components/product/consultation-step-header";
import DialogHeader from "@/components/product/dialog-header";
import InfoHint from "@/components/product/info-hint";
import NiAi from "@/icons/nexture/ni-ai";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { ATTACHMENT_ACCEPT, attachmentKindForMime, MAX_ATTACHMENT_BYTES } from "@/lib/attachment-mime";
import { cn } from "@/lib/utils";
import { createClient } from "@flyee/auth/client";

const BUCKET = "clinical-attachments";

type AttachmentAnalysis = {
  summary: string;
  observations: string[];
  extractedValues: { label: string; value: string }[];
  limitations: string[];
};

type Attachment = {
  id: string;
  kind: "image" | "document";
  mime: string;
  sizeBytes: number | null;
  caption: string | null;
  createdAt: string;
  url: string | null;
  analysis: AttachmentAnalysis | null;
};

/**
 * Documents and photos attached to the consultation (migration 0068). The job:
 * bring an exam PDF or a clinical photo INTO the record so it sits beside the
 * anamnesis — uploaded here on the computer, or captured on the phone via the
 * same QR. Images are consent-gated (clinical-images); a refused consent is
 * stated with the way to grant it, never a dead end.
 */
export default function AttachmentsPanel({
  consultationId,
  patientId,
  canAnalyze = false,
}: {
  consultationId: string;
  patientId: string;
  /** Pro entitlement: the AI may read an attachment for review (Fase B). */
  canAnalyze?: boolean;
}) {
  const t = useTranslations("product");
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [needsImagesConsent, setNeedsImagesConsent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [viewAnalysis, setViewAnalysis] = useState<Attachment | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/consultations/${consultationId}/attachments`);
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; attachments?: Attachment[] };
      if (!response.ok || !body.ok) {
        setLoadFailed(true);
        return;
      }
      setLoadFailed(false);
      setItems(body.attachments ?? []);
    } catch {
      setLoadFailed(true);
    }
  }, [consultationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadOne = async (file: File): Promise<boolean> => {
    const kind = attachmentKindForMime(file.type);
    if (!kind) {
      setErrorKey("attachments-type-error");
      return false;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setErrorKey("attachments-size-error");
      return false;
    }
    const reserve = await fetch(`/api/consultations/${consultationId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mime: file.type }),
    });
    const reserveBody = (await reserve.json().catch(() => ({}))) as {
      ok?: boolean;
      code?: string;
      error?: { code?: string };
      attachmentId?: string;
      path?: string;
      token?: string;
    };
    if (!reserve.ok || !reserveBody.ok || !reserveBody.path || !reserveBody.token || !reserveBody.attachmentId) {
      const code = reserveBody.error?.code ?? reserveBody.code;
      if (code === "images_consent_required") setNeedsImagesConsent(true);
      else setErrorKey("attachments-upload-error");
      return false;
    }
    const { error: uploadError } = await createClient()
      .storage.from(BUCKET)
      .uploadToSignedUrl(reserveBody.path, reserveBody.token, file, { contentType: file.type });
    if (uploadError) {
      setErrorKey("attachments-upload-error");
      return false;
    }
    const confirm = await fetch(`/api/consultations/${consultationId}/attachments/${reserveBody.attachmentId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: reserveBody.path, size: file.size }),
    });
    if (!confirm.ok) {
      setErrorKey("attachments-upload-error");
      return false;
    }
    return true;
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setErrorKey(null);
    setNeedsImagesConsent(false);
    let anyOk = false;
    for (const file of Array.from(files)) {
      // Sequential: a signed URL is minted per file and the reserve gate must
      // see one pending row at a time cleanly.
      const ok = await uploadOne(file);
      anyOk = anyOk || ok;
    }
    if (fileInput.current) fileInput.current.value = "";
    if (anyOk) await load();
    setUploading(false);
  };

  const remove = async (attachment: Attachment) => {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/attachments/${attachment.id}`, {
        method: "DELETE",
      });
      if (!response.ok) setErrorKey("attachments-delete-error");
      else {
        setItems((current) => (current ?? []).filter((item) => item.id !== attachment.id));
      }
    } catch {
      setErrorKey("attachments-delete-error");
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  };

  const analyze = async (attachment: Attachment) => {
    setAnalyzingId(attachment.id);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/consultations/${consultationId}/attachments/${attachment.id}/analyze`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { code?: string };
        analysis?: AttachmentAnalysis;
      };
      if (!response.ok || !body.ok || !body.analysis) {
        const code = body.error?.code;
        setErrorKey(
          code === "reasoning_not_available"
            ? "attachments-analyze-pro"
            : code === "ai_consent_required"
              ? "attachments-analyze-consent"
              : "attachments-analyze-error",
        );
        return;
      }
      const analysis = body.analysis;
      setItems((current) => (current ?? []).map((item) => (item.id === attachment.id ? { ...item, analysis } : item)));
      setViewAnalysis({ ...attachment, analysis });
    } catch {
      setErrorKey("attachments-analyze-error");
    } finally {
      setAnalyzingId(null);
    }
  };

  return (
    <Card component="section">
      <CardContent className="flex flex-col gap-3">
        <ConsultationStepHeader
          step={2}
          icon={<NiPaperclip size="medium" />}
          title={t("attachments-title")}
          hint={t("attachments-hint")}
          trailing={<InfoHint label={t("attachments-note")} className="ml-auto" />}
        />

        <input
          ref={fileInput}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => void onFiles(event.target.files)}
        />

        {needsImagesConsent && (
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            action={
              <Button size="small" color="inherit" href={`/pacientes/${patientId}/consentimentos`}>
                {t("context-manage-consents")}
              </Button>
            }
          >
            {t("attachments-images-consent")}
          </Alert>
        )}
        {errorKey && <Alert severity="error">{t(errorKey)}</Alert>}
        {loadFailed && (
          <Alert severity="error" action={<Button onClick={() => void load()}>{t("retry")}</Button>}>
            {t("attachments-load-error")}
          </Alert>
        )}

        {items === null ? (
          <CircularProgress size={22} aria-label={t("loading")} />
        ) : items.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary text-xs leading-5">
            {t("attachments-empty")}
          </Typography>
        ) : (
          <Box className="grid grid-cols-2 gap-2">
            {items.map((item) => (
              <Box key={item.id} className="border-grey-100 flex flex-col gap-1 rounded-2xl border p-2">
                {item.kind === "image" && item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* Short-lived signed thumbnail; opens full size in a new tab. */}
                    <img
                      src={item.url}
                      alt={item.caption ?? t("attachments-image-alt")}
                      className="border-grey-100 h-24 w-full rounded-xl border object-cover"
                    />
                  </a>
                ) : (
                  <a
                    href={item.url ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "bg-grey-25 text-text-secondary flex h-24 w-full flex-col items-center justify-center gap-1 rounded-xl",
                      !item.url && "pointer-events-none opacity-60",
                    )}
                  >
                    <NiDocumentFull size="medium" />
                    <span className="text-xs font-medium">{t("attachments-open-document")}</span>
                  </a>
                )}
                <Box className="flex flex-row items-center justify-between gap-1">
                  <Typography variant="body2" className="text-text-secondary truncate text-xs">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </Typography>
                  <Button
                    size="tiny"
                    variant="text"
                    color="grey"
                    className="px-1!"
                    onClick={() => setConfirmDelete(item)}
                  >
                    {t("attachments-remove")}
                  </Button>
                </Box>
                {/* AI reading — a DRAFT for review, Pro-gated. Never applied. */}
                {item.analysis ? (
                  <Button
                    size="tiny"
                    variant="text"
                    color="primary"
                    className="justify-start px-1!"
                    startIcon={<NiAi size="tiny" />}
                    onClick={() => setViewAnalysis(item)}
                  >
                    {t("attachments-view-analysis")}
                  </Button>
                ) : canAnalyze ? (
                  <Button
                    size="tiny"
                    variant="text"
                    color="primary"
                    className="justify-start px-1!"
                    startIcon={analyzingId === item.id ? undefined : <NiAi size="tiny" />}
                    disabled={analyzingId !== null}
                    onClick={() => void analyze(item)}
                  >
                    {analyzingId === item.id ? <CircularProgress size={14} /> : t("attachments-analyze")}
                  </Button>
                ) : null}
              </Box>
            ))}
          </Box>
        )}

        <Button
          variant="outlined"
          color="primary"
          fullWidth
          startIcon={uploading ? undefined : <NiUploadCloud size="tiny" />}
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <CircularProgress size={18} /> : t("attachments-add")}
        </Button>
      </CardContent>

      {/* AI reading of the attachment — a DRAFT for review, never a diagnosis
          and never applied to the record. */}
      <Dialog open={viewAnalysis !== null} onClose={() => setViewAnalysis(null)} maxWidth="sm" fullWidth>
        <DialogHeader
          title={t("attachments-analysis-title")}
          closeLabel={t("close")}
          onClose={() => setViewAnalysis(null)}
        />
        <DialogContent dividers className="flex flex-col gap-3 py-5!">
          {viewAnalysis?.analysis && (
            <>
              <Typography variant="body2" className="text-text-primary leading-6">
                {viewAnalysis.analysis.summary}
              </Typography>
              {viewAnalysis.analysis.extractedValues.length > 0 && (
                <Box className="flex flex-col gap-1">
                  <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                    {t("attachments-analysis-values")}
                  </Typography>
                  {viewAnalysis.analysis.extractedValues.map((entry, index) => (
                    <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
                      · {entry.label}: {entry.value}
                    </Typography>
                  ))}
                </Box>
              )}
              {viewAnalysis.analysis.observations.length > 0 && (
                <Box className="flex flex-col gap-1">
                  <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                    {t("attachments-analysis-observations")}
                  </Typography>
                  {viewAnalysis.analysis.observations.map((entry, index) => (
                    <Typography key={index} variant="body2" className="text-text-secondary text-xs leading-5">
                      · {entry}
                    </Typography>
                  ))}
                </Box>
              )}
              {viewAnalysis.analysis.limitations.length > 0 && (
                <Alert severity="info" className="neutral bg-background-paper/60!">
                  <Typography variant="body2" className="mb-1 text-xs font-semibold">
                    {t("attachments-analysis-limitations")}
                  </Typography>
                  {viewAnalysis.analysis.limitations.map((entry, index) => (
                    <Typography key={index} variant="body2" className="text-xs leading-5">
                      · {entry}
                    </Typography>
                  ))}
                </Alert>
              )}
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("attachments-analysis-disclaimer")}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setViewAnalysis(null)}>
            {t("close")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Removing an attachment deletes its file — name the consequence. */}
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogHeader title={t("attachments-remove")} closeLabel={t("close")} onClose={() => setConfirmDelete(null)} />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("attachments-remove-confirm")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmDelete(null)}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy}
            onClick={() => confirmDelete && void remove(confirmDelete)}
          >
            {t("attachments-remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
