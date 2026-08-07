"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import NiCross from "@/icons/nexture/ni-cross";
import NiFlask from "@/icons/nexture/ni-flask";
import NiPlus from "@/icons/nexture/ni-plus";
import NiReceipt from "@/icons/nexture/ni-receipt";
import {
  emptyItem,
  itemsForSave,
  normalizeItems,
  type Prescription,
  type PrescriptionItem,
  type PrescriptionKind,
} from "@/lib/prescription";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

type Draft = {
  id: string | null;
  kind: PrescriptionKind;
  title: string;
  items: PrescriptionItem[];
  posology: string;
  preparation: string;
  notes: string;
};

type IssuedDoc = {
  id: string;
  sourceId: string;
  version: number;
  verifyCode: string;
  status: string;
  storagePath: string | null;
};

/**
 * The professional's receituário (migration 0074). Two kinds — a Chinese herbal
 * FORMULA and a free 'generic' script. It is authored by HER: nothing here is AI
 * generated, because the assistant never prescribes (PRD §10/§16). A prescription
 * is a DRAFT until she validates (signs) it; editing a validated one returns it
 * to a draft. Frozen once the consultation is finalized.
 *
 * Phase 2 turns a validated prescription into a signed, QR-verifiable PDF.
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
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [validating, setValidating] = useState<Prescription | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Prescription | null>(null);

  // Issued PDFs, grouped by the prescription they were issued from (newest
  // first). A validated prescription can become a signed, QR-verifiable document.
  const [documents, setDocuments] = useState<Record<string, IssuedDoc[]>>({});
  const [confirmReissue, setConfirmReissue] = useState<Prescription | null>(null);
  const issueKeys = useRef<Record<string, string>>({});
  const [sharingDoc, setSharingDoc] = useState<IssuedDoc | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareResult, setShareResult] = useState<{
    url: string;
    whatsappUrl?: string | null;
    delivered: boolean;
    reason?: string;
  } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

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
    const rows = (data ?? []).map((row) => ({
      id: row.id,
      kind: (row.kind as PrescriptionKind) ?? "generic",
      title: row.title ?? "",
      items: normalizeItems(row.items),
      posology: row.posology ?? "",
      preparation: row.preparation ?? "",
      notes: row.notes ?? "",
      status: row.status === "validated" ? ("validated" as const) : ("draft" as const),
      validatedAt: row.validated_at,
      updatedAt: row.updated_at,
    }));
    setPrescriptions(rows);

    // Issued PDFs for these prescriptions, newest first, grouped by source.
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      const { data: docs } = await supabase
        .from("documents")
        .select("id, source_id, version, verify_code, status, storage_path")
        .eq("kind", "prescription")
        .eq("source_type", "consultation_prescription")
        .in("source_id", ids)
        .order("version", { ascending: false });
      const grouped: Record<string, IssuedDoc[]> = {};
      for (const doc of docs ?? []) {
        const entry: IssuedDoc = {
          id: doc.id,
          sourceId: doc.source_id,
          version: doc.version,
          verifyCode: doc.verify_code,
          status: doc.status,
          storagePath: doc.storage_path,
        };
        (grouped[doc.source_id] ??= []).push(entry);
      }
      setDocuments(grouped);
    } else {
      setDocuments({});
    }
    setLoaded(true);
  }, [consultationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = (kind: PrescriptionKind) => {
    setAddAnchor(null);
    setActionError(null);
    setDraft({ id: null, kind, title: "", items: [emptyItem()], posology: "", preparation: "", notes: "" });
  };

  const openEdit = (prescription: Prescription) => {
    setActionError(null);
    setDraft({
      id: prescription.id,
      kind: prescription.kind,
      title: prescription.title,
      items: prescription.items.length > 0 ? prescription.items : [emptyItem()],
      posology: prescription.posology,
      preparation: prescription.preparation,
      notes: prescription.notes,
    });
  };

  const save = async () => {
    if (!draft) return;
    const items = itemsForSave(draft.items);
    if (items.length === 0) {
      setActionError(t("prescription-empty-items"));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const supabase = createClient();
      // Any edit is a draft again — a signature was of a specific content.
      const values = {
        title: draft.title.trim() || null,
        items,
        posology: draft.posology.trim() || null,
        preparation: draft.kind === "herbal" ? draft.preparation.trim() || null : null,
        notes: draft.notes.trim() || null,
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
          kind: draft.kind,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
      }
      setDraft(null);
      await load();
    } catch {
      setActionError(t("prescription-error"));
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    if (!validating) return;
    setBusy(true);
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
      setAcknowledged(false);
      await load();
    } catch {
      setActionError(t("prescription-error"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy(true);
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
      setBusy(false);
    }
  };

  const issue = async (prescription: Prescription) => {
    const docs = documents[prescription.id] ?? [];
    const nextVersion = (docs[0]?.version ?? 0) + 1;
    // Reissuing REVOKES the version already in the patient's hands — confirm it.
    if (docs.length > 0 && confirmReissue?.id !== prescription.id) {
      setConfirmReissue(prescription);
      return;
    }
    setConfirmReissue(null);
    setBusy(true);
    setActionError(null);
    try {
      issueKeys.current[prescription.id] ??= crypto.randomUUID();
      const response = await fetch(`/api/consultations/${consultationId}/prescriptions/${prescription.id}/issue`, {
        method: "POST",
        headers: {
          "idempotency-key": issueKeys.current[prescription.id],
          ...(docs.length > 0 ? { "confirm-version": String(nextVersion) } : {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = body?.error?.code ?? body?.error;
        setActionError(
          code === "prescription_not_validated"
            ? t("prescription-issue-need-validate")
            : code === "document_profile_incomplete"
              ? t("prescription-issue-profile-incomplete")
              : code === "document_reissue_confirmation_required"
                ? t("prescription-issue-version-conflict")
                : t("prescription-issue-error"),
        );
        return;
      }
      delete issueKeys.current[prescription.id];
      await load();
    } catch {
      setActionError(t("prescription-issue-error"));
    } finally {
      setBusy(false);
    }
  };

  const download = async (doc: IssuedDoc) => {
    if (!doc.storagePath) return;
    setActionError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storagePath, 120);
      if (error || !data?.signedUrl) {
        setActionError(t("prescription-download-error"));
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener");
    } catch {
      setActionError(t("prescription-download-error"));
    }
  };

  const share = async (channel: "whatsapp" | "email" | "link") => {
    if (!sharingDoc) return;
    setShareBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/documents/${sharingDoc.id}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        whatsappUrl?: string | null;
        delivered?: boolean;
        deliveryReason?: string;
      };
      if (!response.ok || !body.ok || !body.url) {
        setActionError(t("prescription-share-error"));
        return;
      }
      setShareResult({
        url: body.url,
        whatsappUrl: body.whatsappUrl ?? null,
        delivered: body.delivered === true,
        reason: body.deliveryReason,
      });
    } catch {
      setActionError(t("prescription-share-error"));
    } finally {
      setShareBusy(false);
    }
  };

  const closeShare = () => {
    setSharingDoc(null);
    setShareResult(null);
    setShareCopied(false);
  };

  const kindLabel = (kind: PrescriptionKind) =>
    kind === "herbal" ? t("prescription-kind-herbal") : t("prescription-kind-generic");

  // Nothing to show and nothing to add on a finalized record without content.
  if (loaded && prescriptions.length === 0 && isFinalized) return null;

  const updateItem = (index: number, patch: Partial<PrescriptionItem>) =>
    setDraft((current) =>
      current
        ? { ...current, items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }
        : current,
    );

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
            {prescriptions.length === 0 ? (
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("prescription-empty")}
              </Typography>
            ) : (
              <Box className="flex flex-col gap-2">
                {prescriptions.map((prescription) => (
                  <Box
                    key={prescription.id}
                    className="border-grey-100 flex flex-col gap-2 rounded-2xl border px-3.5 py-3"
                  >
                    <Box className="flex flex-row flex-wrap items-center gap-2">
                      {prescription.kind === "herbal" ? (
                        <NiFlask size="tiny" className="text-secondary" aria-hidden />
                      ) : (
                        <NiReceipt size="tiny" className="text-secondary" aria-hidden />
                      )}
                      <Typography variant="body2" className="text-text-primary font-semibold">
                        {prescription.title || kindLabel(prescription.kind)}
                      </Typography>
                      <Chip size="small" variant="outlined" label={kindLabel(prescription.kind)} className="text-xs" />
                      {prescription.status === "validated" && (
                        <Chip
                          size="small"
                          label={t("prescription-status-validated")}
                          className="bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light text-xs font-semibold"
                        />
                      )}
                    </Box>
                    <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                      {t("prescription-items-count", { count: prescription.items.length })}
                    </Typography>
                    {!isFinalized && (
                      <Box className="flex flex-row flex-wrap gap-2">
                        <Button size="small" variant="outlined" color="grey" onClick={() => openEdit(prescription)}>
                          {t("prescription-edit")}
                        </Button>
                        {prescription.status === "draft" && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            onClick={() => {
                              setValidating(prescription);
                              setAcknowledged(false);
                            }}
                          >
                            {t("prescription-validate")}
                          </Button>
                        )}
                        {/* A validated prescription can become a signed PDF (PRD §9.8). */}
                        {prescription.status === "validated" && (
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            onClick={() => void issue(prescription)}
                            disabled={busy}
                          >
                            {(documents[prescription.id]?.length ?? 0) > 0
                              ? t("prescription-reissue")
                              : t("prescription-issue")}
                          </Button>
                        )}
                        <Button size="small" variant="text" color="grey" onClick={() => setConfirmDelete(prescription)}>
                          {t("prescription-delete")}
                        </Button>
                      </Box>
                    )}

                    {/* Issued PDFs — viewable and verifiable even after the record
                        is finalized (the prescription freezes, the document remains). */}
                    {(documents[prescription.id]?.length ?? 0) > 0 && (
                      <Box className="flex flex-col gap-1.5">
                        {documents[prescription.id].map((doc) => (
                          <Box
                            key={doc.id}
                            className="border-grey-100 flex flex-row flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
                          >
                            <Box className="min-w-0 flex-1">
                              <Typography variant="body2" className="text-text-primary text-xs font-medium">
                                {t("plan-doc-version")} {doc.version}
                                {doc.status === "revoked" ? ` · ${t("plan-doc-superseded")}` : ""}
                              </Typography>
                              <Typography variant="body2" className="text-text-secondary font-mono text-xs">
                                {doc.verifyCode}
                              </Typography>
                            </Box>
                            <Button size="small" variant="text" color="grey" onClick={() => void download(doc)}>
                              {t("plan-doc-download")}
                            </Button>
                            {doc.status === "issued" && (
                              <Button size="small" variant="text" color="primary" onClick={() => setSharingDoc(doc)}>
                                {t("plan-doc-send")}
                              </Button>
                            )}
                            <Button
                              size="small"
                              variant="text"
                              color="grey"
                              href={`/verify/${doc.verifyCode}`}
                              target="_blank"
                            >
                              {t("plan-doc-verify-link")}
                            </Button>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            )}

            {!isFinalized && (
              <>
                <Button
                  variant="outlined"
                  color="primary"
                  fullWidth
                  startIcon={<NiPlus size="tiny" />}
                  onClick={(event) => setAddAnchor(event.currentTarget)}
                >
                  {t("prescription-add")}
                </Button>
                <Menu anchorEl={addAnchor} open={Boolean(addAnchor)} onClose={() => setAddAnchor(null)}>
                  <MenuItem onClick={() => openNew("herbal")}>{t("prescription-kind-herbal")}</MenuItem>
                  <MenuItem onClick={() => openNew("generic")}>{t("prescription-kind-generic")}</MenuItem>
                </Menu>
              </>
            )}
          </>
        )}

        {/* The draft-not-autonomous framing travels with the receituário. */}
        <Typography variant="body2" className="text-text-secondary text-xs leading-5">
          {t("prescription-disclaimer")}
        </Typography>
      </CardContent>

      {/* Author / edit dialog. */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} maxWidth="sm" fullWidth scroll="paper">
        <DialogHeader
          title={draft ? kindLabel(draft.kind) : ""}
          closeLabel={t("close")}
          onClose={() => setDraft(null)}
        />
        {draft && (
          <DialogContent dividers className="flex flex-col gap-3 py-5!">
            <TextField
              label={t("prescription-title-field")}
              size="small"
              fullWidth
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />

            <Box className="flex flex-col gap-2">
              <Typography variant="body2" className="text-text-primary text-xs font-semibold">
                {t("prescription-items")}
              </Typography>
              {draft.items.map((item, index) => (
                <Box key={index} className="flex flex-row items-start gap-2">
                  <TextField
                    label={t("prescription-item-name")}
                    size="small"
                    className="flex-[2]"
                    value={item.name}
                    onChange={(event) => updateItem(index, { name: event.target.value })}
                  />
                  <TextField
                    label={t("prescription-item-amount")}
                    size="small"
                    className="flex-1"
                    value={item.amount}
                    onChange={(event) => updateItem(index, { amount: event.target.value })}
                  />
                  <Tooltip title={t("prescription-remove-item")}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t("prescription-remove-item")}
                        className="mt-1 flex-none"
                        disabled={draft.items.length <= 1}
                        onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}
                      >
                        <NiCross size="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              ))}
              <Button
                size="small"
                variant="text"
                color="grey"
                className="self-start"
                startIcon={<NiPlus size="tiny" />}
                onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem()] })}
              >
                {t("prescription-add-item")}
              </Button>
            </Box>

            {draft.kind === "herbal" && (
              <TextField
                label={t("prescription-preparation")}
                size="small"
                fullWidth
                multiline
                minRows={2}
                value={draft.preparation}
                onChange={(event) => setDraft({ ...draft, preparation: event.target.value })}
              />
            )}
            <TextField
              label={t("prescription-posology")}
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={draft.posology}
              onChange={(event) => setDraft({ ...draft, posology: event.target.value })}
            />
            <TextField
              label={t("prescription-notes")}
              size="small"
              fullWidth
              multiline
              minRows={2}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </DialogContent>
        )}
        <DialogActions>
          <Button color="grey" onClick={() => setDraft(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="primary" onClick={save} disabled={busy}>
            {busy ? <CircularProgress size={16} /> : t("prescription-save")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Validate (sign) confirmation — herbal requires acknowledging interactions. */}
      <Dialog open={Boolean(validating)} onClose={() => setValidating(null)} maxWidth="xs" fullWidth>
        <DialogHeader title={t("prescription-validate")} closeLabel={t("close")} onClose={() => setValidating(null)} />
        <DialogContent className="flex flex-col gap-3 py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("prescription-validate-body")}
          </Typography>
          {validating?.kind === "herbal" && (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("prescription-safety-herbal")}
            </Alert>
          )}
          {validating?.kind === "herbal" && (
            <FormControlLabel
              control={<Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />}
              label={
                <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                  {t("prescription-safety-ack")}
                </Typography>
              }
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setValidating(null)}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={validate}
            disabled={busy || (validating?.kind === "herbal" && !acknowledged)}
          >
            {busy ? <CircularProgress size={16} /> : t("prescription-validate-confirm")}
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
          <Button variant="contained" color="error" onClick={remove} disabled={busy}>
            {busy ? <CircularProgress size={16} /> : t("prescription-delete")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reissuing revokes the version already in the patient's hands — its own
          dialog naming the consequence. */}
      <Dialog open={Boolean(confirmReissue)} onClose={() => setConfirmReissue(null)} maxWidth="xs" fullWidth>
        <DialogHeader
          title={t("prescription-reissue")}
          closeLabel={t("close")}
          onClose={() => setConfirmReissue(null)}
        />
        <DialogContent className="py-5!">
          <Typography variant="body2" className="text-text-secondary leading-6">
            {t("prescription-reissue-confirm")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirmReissue(null)}>
            {t("cancel")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => confirmReissue && void issue(confirmReissue)}
            disabled={busy}
          >
            {busy ? <CircularProgress size={16} /> : t("prescription-reissue")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Hand the document to the patient (PRD §9.8) — an expiring link, no
          clinical content. Reuses the shared document-delivery copy. */}
      <Dialog open={Boolean(sharingDoc)} onClose={closeShare} maxWidth="xs" fullWidth>
        <DialogHeader title={t("plan-share-title")} closeLabel={t("close")} onClose={closeShare} />
        <DialogContent className="flex flex-col gap-3 py-5!">
          {!shareResult ? (
            <>
              <Typography variant="body2" className="text-text-secondary leading-6">
                {t("plan-share-body")}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                disabled={shareBusy}
                onClick={() => void share("whatsapp")}
              >
                {t("plan-share-whatsapp")}
              </Button>
              <Button
                variant="outlined"
                color="grey"
                fullWidth
                disabled={shareBusy}
                onClick={() => void share("email")}
              >
                {t("plan-share-email")}
              </Button>
              <Button variant="text" color="grey" fullWidth disabled={shareBusy} onClick={() => void share("link")}>
                {t("plan-share-link")}
              </Button>
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("plan-share-privacy")}
              </Typography>
            </>
          ) : (
            <>
              <Alert severity={shareResult.delivered ? "success" : "info"}>
                {shareResult.delivered
                  ? t("plan-share-sent")
                  : shareResult.whatsappUrl
                    ? t("plan-share-whatsapp-ready")
                    : shareResult.reason === "contact_missing"
                      ? t("plan-share-contact-missing")
                      : shareResult.reason === "channel_unavailable"
                        ? t("plan-share-channel-unavailable")
                        : t("plan-share-link-ready")}
              </Alert>
              {shareResult.whatsappUrl && (
                <Button
                  variant="contained"
                  color="primary"
                  fullWidth
                  href={shareResult.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("plan-share-whatsapp-open")}
                </Button>
              )}
              <TextField
                size="small"
                fullWidth
                value={shareResult.url}
                slotProps={{ htmlInput: { readOnly: true, "aria-label": t("plan-share-copy") } }}
              />
              <Button
                variant="outlined"
                color="grey"
                fullWidth
                onClick={() => {
                  void navigator.clipboard
                    .writeText(shareResult.url)
                    .then(() => {
                      setShareCopied(true);
                      window.setTimeout(() => setShareCopied(false), 4000);
                    })
                    .catch(() => undefined);
                }}
              >
                {shareCopied ? t("plan-share-copied") : t("plan-share-copy")}
              </Button>
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("plan-share-expires")}
              </Typography>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
