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

import { createClient } from "@flyee/auth/client";

/**
 * Confirmation for granting or removing the platform superadmin role.
 *
 * The write is the `set_user_superadmin` RPC (migration 0096), called with
 * the normal client: the gate lives in the database, so this needs no
 * service role. The dialog's job is to spell out, before the click, what
 * the role actually opens — every workspace's clinical record — because
 * "superadmin" reads like a settings toggle and is nothing of the sort.
 */
export default function SuperadminDialog({
  open,
  userId,
  userName,
  grant,
  onClose,
  onDone,
}: {
  open: boolean;
  userId: string;
  userName: string;
  /** true = grant the role, false = remove it. */
  grant: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_user_superadmin", {
      target_user: userId,
      value: grant,
      target_note: note.trim() || null,
    });
    if (rpcError) {
      setError(messageFor(rpcError.message));
      setBusy(false);
      return;
    }
    setBusy(false);
    setNote("");
    onDone();
  };

  const close = () => {
    if (busy) return;
    setNote("");
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>
        {grant ? `Make ${userName} a platform superadmin?` : `Remove ${userName}'s platform superadmin role?`}
      </DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          {grant ? (
            <>
              <Typography variant="body2" className="text-text-secondary">
                This is the highest privilege in the platform, and it is not scoped to a workspace.
              </Typography>

              <Alert severity="warning" className="neutral bg-background-paper/60!">
                <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
                  <li>
                    Reads the clinical record of <strong>every</strong> workspace — patients, consultations,
                    transcripts, documents.
                  </li>
                  <li>Opens support sessions inside any professional&apos;s account.</li>
                  <li>Suspends and bans accounts, resets 2FA, and assigns paid plans with no payment.</li>
                  <li>Grants this same role to other people.</li>
                </Box>
              </Alert>

              <Typography variant="body2" className="text-text-secondary">
                Grant it to operators of the platform, never as a convenience for a customer.
              </Typography>
            </>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {userName} loses the /admin area and every cross-workspace privilege on the next request. Their own
              account, workspace and data are untouched.
            </Typography>
          )}

          <FormControl className="outlined" variant="standard">
            <FormLabel htmlFor="superadmin-note">Note for the audit trail (optional)</FormLabel>
            <Input
              id="superadmin-note"
              placeholder={grant ? "Second operator for the launch window" : "Left the team"}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
              autoFocus
            />
            <Typography variant="caption" className="text-text-secondary mt-1">
              Who granted the role to whom is recorded either way. The note is the only place the reason survives.
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
        <Button variant="text" color="grey" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={confirm} disabled={busy}>
          {busy ? "Saving…" : grant ? "Grant superadmin" : "Remove superadmin"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The database speaks in error codes; the console has to speak in reasons. */
function messageFor(raw: string): string {
  if (raw.includes("self_change_forbidden")) {
    return "You cannot change your own platform role — ask another superadmin. (Removing your own could leave the platform with no operator.)";
  }
  if (raw.includes("not_authorized")) {
    return "Only a platform superadmin can change this role, and never from a support session.";
  }
  if (raw.includes("user_not_found")) {
    return "This user no longer exists. Reload the list.";
  }
  if (raw.includes("superadmin_not_self_assignable")) {
    return "The database refused the change: this role cannot be self-assigned.";
  }
  return raw;
}
