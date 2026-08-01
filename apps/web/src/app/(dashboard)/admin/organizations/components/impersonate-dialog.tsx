"use client";

import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Typography,
} from "@mui/material";

import { DEFAULTS } from "@/config";
import { startImpersonation } from "@/lib/impersonation-actions";

/**
 * Confirmation for opening a support session inside a user's account.
 *
 * The dialog exists to make the operator state a reason and to show, before
 * anything happens, exactly what this access is and is not: the professional
 * is notified, the visit is logged and time-boxed, and the clinical record
 * stays read-only (the database refuses those writes — migration 0057).
 */
export default function ImpersonateDialog({
  open,
  userId,
  userName,
  onClose,
}: {
  open: boolean;
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = reason.trim().length < 8;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await startImpersonation(userId, reason);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    // Full page load so every client picks the parallel session cookie up.
    window.location.href = DEFAULTS.appRoot;
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Open a support session in {userName}&apos;s account</DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          <Typography variant="body2" className="text-text-secondary">
            You will browse the product exactly as {userName} sees it, without her password and without signing yourself
            out — your own session stays active and you return with one click.
          </Typography>

          <Alert severity="info" className="neutral bg-background-paper/60!">
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
              <li>
                The clinical record is read-only: consultations, anamnesis, hypotheses, plans, recordings, consent and
                patient data cannot be written.
              </li>
              <li>Settings, billing and the agenda remain editable.</li>
              <li>She is notified in her account, and the access appears in her own security log with your name.</li>
              <li>The session expires on its own and is recorded in the audit trail.</li>
            </Box>
          </Alert>

          <FormControl className="outlined" variant="standard">
            <FormLabel htmlFor="impersonation-reason">Why do you need this access?</FormLabel>
            <Input
              id="impersonation-reason"
              placeholder="Ticket 1234 — recording stuck in 'uploading' since yesterday"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              autoFocus
            />
            <Typography variant="caption" className="text-text-secondary mt-1">
              Stored with the access and visible to her. Name the ticket or the reported symptom.
            </Typography>
          </FormControl>

          {error && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={confirm} disabled={busy || tooShort}>
          {busy ? "Opening…" : "Enter account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
