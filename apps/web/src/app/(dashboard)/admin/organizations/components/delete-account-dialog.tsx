"use client";

import { type AccountDeletionResult, deleteAccount, retryAccountStoragePurge } from "../actions";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Typography,
} from "@mui/material";

import { createClient } from "@flyee/auth/client";

type DeletionPreview = {
  email: string | null;
  workspaces: { id: string; name: string }[];
  sharedWorkspaces: string[];
  counts: {
    patients: number;
    consultations: number;
    upcomingAppointments: number;
    documents: number;
    recordings: number;
    attachments: number;
    historyVersions: number;
    storageObjects: number;
  };
  providerSubscriptions: { id: string; provider: string; status: string }[];
  lastExport: { status: string; completedAt: string | null; expiresAt: string | null } | null;
  blockers: string[];
};

const BLOCKERS: Record<string, string> = {
  self: "This is your own account. Another superadmin has to delete it.",
  superadmin:
    "This account holds the platform superadmin role. Remove the role first (same menu), then delete the account.",
  shared_workspace:
    "She owns a workspace other people still belong to. Its records are not hers alone: transfer ownership or remove the other members first.",
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "an unknown date");

function actionError(error: string): string {
  if (error === "forbidden") return "Only a platform superadmin can delete accounts.";
  if (error === "not-configured") {
    return "Set SUPABASE_SERVICE_ROLE_KEY: stored files can only be removed with the service role, so deletion is disabled without it.";
  }
  return error;
}

/**
 * Permanent deletion of a professional's account and every piece of data it
 * holds (migration 0099).
 *
 * The dialog's job is to make the operator SEE the size of what goes before
 * the click — patients, consultations, documents, files — and to carry the
 * friction the database also enforces: a stated reason and the account's
 * e-mail typed back. It is mounted only while open (keyed by user), so each
 * account starts from a fresh preview.
 */
export default function DeleteAccountDialog({
  userId,
  userName,
  onClose,
  onDeleted,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountDeletionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error: rpcError } = await createClient().rpc("admin_account_deletion_preview", {
        target_user: userId,
      });
      if (cancelled) return;
      if (rpcError) setLoadError(rpcError.message);
      else setPreview(data as DeletionPreview);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const expected = (preview?.email ?? userId).toLowerCase();
  const confirmed = typed.trim().toLowerCase() === expected;
  const reasonOk = reason.trim().length >= 8;
  const blockers = preview?.blockers ?? [];
  const canConfirm = Boolean(preview) && blockers.length === 0 && !result;

  const close = () => {
    if (busy) return;
    if (result) onDeleted();
    else onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const outcome = await deleteAccount(userId, typed, reason);
    setBusy(false);
    if (!outcome.ok) {
      setError(actionError(outcome.error));
      return;
    }
    setResult(outcome.data);
  };

  const retry = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    const outcome = await retryAccountStoragePurge(userId, result.deletedWorkspaces);
    setBusy(false);
    if (!outcome.ok) {
      setError(actionError(outcome.error));
      return;
    }
    setResult({ ...result, storage: outcome.data });
  };

  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{result ? "Account deleted" : `Delete ${userName}'s account and all of its data?`}</DialogTitle>
      <DialogContent>
        {result ? (
          <DeletionOutcome userName={userName} result={result} error={error} />
        ) : loadError ? (
          // A failed count is an error, never an empty-looking account.
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Could not load what this deletion would remove: {loadError}
          </Alert>
        ) : !preview ? (
          <Box className="flex min-h-40 items-center gap-3">
            <CircularProgress size={20} aria-label="Loading" />
            <Typography variant="body2" className="text-text-secondary">
              Counting everything this account holds…
            </Typography>
          </Box>
        ) : blockers.length > 0 ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
              {blockers.map((blocker) => (
                <li key={blocker}>
                  {BLOCKERS[blocker] ?? blocker}
                  {blocker === "shared_workspace" && preview.sharedWorkspaces.length > 0
                    ? ` (${preview.sharedWorkspaces.join(", ")})`
                    : null}
                </li>
              ))}
            </Box>
          </Alert>
        ) : (
          <Box className="flex flex-col gap-4 pt-1">
            <Typography variant="body2" className="text-text-secondary">
              Everything below is removed for good. There is no trash, no restore and no undo anywhere in the product.
            </Typography>

            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
              <li>
                <Typography variant="body2">
                  {preview.workspaces.length === 0
                    ? "No workspace — she does not run one on her own"
                    : `${preview.workspaces.length === 1 ? "The workspace" : "The workspaces"} ${preview.workspaces
                        .map((workspace) => workspace.name)
                        .join(", ")}`}
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  {plural(preview.counts.patients, "patient")}, with their consent records
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  {plural(preview.counts.consultations, "consultation")} and agenda entries (
                  {preview.counts.upcomingAppointments} upcoming)
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  {plural(preview.counts.documents, "issued document")} — their verification links stop working
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  {plural(preview.counts.recordings, "recording")}, {plural(preview.counts.attachments, "attachment")}{" "}
                  and {plural(preview.counts.storageObjects, "stored file")}
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  {plural(preview.counts.historyVersions, "change-history entry", "change-history entries")}
                </Typography>
              </li>
              <li>
                <Typography variant="body2">Her login, profile, notifications and sign-in history</Typography>
              </li>
            </Box>

            {preview.providerSubscriptions.length > 0 && (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {plural(preview.providerSubscriptions.length, "subscription")} still charging at{" "}
                {[...new Set(preview.providerSubscriptions.map((subscription) => subscription.provider))].join(" and ")}{" "}
                will be canceled at the provider first. If that fails, nothing is deleted.
              </Alert>
            )}

            <Alert severity="warning" className="neutral bg-background-paper/60!">
              <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
                <li>
                  {preview.lastExport
                    ? preview.lastExport.status === "ready"
                      ? `Her last full export was ready on ${formatDate(preview.lastExport.completedAt)}. It is deleted with the account — make sure she downloaded it.`
                      : `Her last full export request is "${preview.lastExport.status}" — she does not have a copy yet.`
                    : "She never exported her practice. If she needs her records, ask her to export before you continue."}
                </li>
                <li>
                  She may owe a legal retention of these records (in Brazil, 20 years from the last entry — Law
                  13.787/2018). Delete on her request with her copy in hand, or when that duty does not apply.
                </li>
                <li>Automatic backups keep a copy until they are pruned (30 days by default).</li>
              </Box>
            </Alert>

            <FormControl className="outlined" variant="standard">
              <FormLabel htmlFor="delete-account-reason">Why is this account being deleted?</FormLabel>
              <Input
                id="delete-account-reason"
                placeholder="Holder's request by e-mail — ticket 1234"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy}
                autoFocus
              />
              <Typography variant="caption" className="text-text-secondary mt-1">
                Stored in the audit trail with your name, together with how much was deleted.
              </Typography>
            </FormControl>

            <FormControl className="outlined" variant="standard">
              <FormLabel htmlFor="delete-account-confirm">
                Type <strong>{expected}</strong> to confirm
              </FormLabel>
              <Input
                id="delete-account-confirm"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={busy}
              />
            </FormControl>

            {error && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {error}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {result ? (
          <>
            {result.storage.remaining !== 0 && (
              <Button variant="text" onClick={retry} disabled={busy}>
                {busy ? "Retrying…" : "Retry file cleanup"}
              </Button>
            )}
            <Button variant="contained" onClick={onDeleted} disabled={busy}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="text" color="grey" onClick={close} disabled={busy}>
              {canConfirm ? "Cancel" : "Close"}
            </Button>
            {canConfirm && (
              <Button variant="contained" color="error" onClick={confirm} disabled={busy || !reasonOk || !confirmed}>
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function DeletionOutcome({
  userName,
  result,
  error,
}: {
  userName: string;
  result: AccountDeletionResult;
  error: string | null;
}) {
  const { storage, counts } = result;
  return (
    <Box className="flex flex-col gap-3 pt-1">
      <Alert severity="success" className="neutral bg-background-paper/60!">
        {userName}&apos;s account was deleted: {plural(result.deletedWorkspaces.length, "workspace")},{" "}
        {plural(counts.patients ?? 0, "patient")} and {plural(counts.consultations ?? 0, "consultation")}.
        {result.canceledSubscriptions > 0
          ? ` ${plural(result.canceledSubscriptions, "provider subscription")} canceled.`
          : ""}
      </Alert>
      {storage.remaining === 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          All {plural(storage.removed, "stored file")} removed.
        </Typography>
      ) : storage.remaining > 0 ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {plural(storage.remaining, "stored file")} could not be removed yet. They belong to no account anymore — retry
          now. The workspace ids are also recorded in the audit trail.
        </Alert>
      ) : (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          File cleanup could not be verified{storage.error ? `: ${storage.error}` : ""}. Retry now.
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
    </Box>
  );
}
