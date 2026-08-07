"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

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
    setPrescriptions(
      (data ?? []).map((row) => ({
        id: row.id,
        kind: (row.kind as PrescriptionKind) ?? "generic",
        title: row.title ?? "",
        items: normalizeItems(row.items),
        posology: row.posology ?? "",
        preparation: row.preparation ?? "",
        notes: row.notes ?? "",
        status: row.status === "validated" ? "validated" : "draft",
        validatedAt: row.validated_at,
        updatedAt: row.updated_at,
      })),
    );
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
                        <Button size="small" variant="text" color="grey" onClick={() => setConfirmDelete(prescription)}>
                          {t("prescription-delete")}
                        </Button>
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
    </Card>
  );
}
