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

/**
 * One confirmation for an operator action that changes someone else's account.
 *
 * Extracted from the mold of `superadmin-dialog.tsx`, which was already the
 * shape this needs: a single component covering BOTH directions of the same
 * action, whose entire text is a function of the direction.
 *
 * The contract it enforces, in this order:
 *  1. Say what the action DOES — `consequences`, spelled out, never implied by
 *     the button label.
 *  2. Say what it does NOT do — `stays`. Half of a dangerous action's risk is
 *     the operator assuming it reaches further than it does; "suspender" that
 *     does not suspend login has to say so, out loud, before the click.
 *  3. Make the operator state a reason, because the audit trail has columns for
 *     who and when but the WHY survives nowhere else (migration 0005).
 *
 * `onConfirm` resolves to an error message or null, so the busy/error cycle
 * stays here and a failure never closes the dialog.
 */
export default function ConfirmActionDialog({
  title,
  intro,
  consequences,
  staysTitle = "O que NÃO muda",
  stays,
  reasonLabel = "Por que você está fazendo isto?",
  reasonPlaceholder,
  reasonHelp = "Fica na trilha de auditoria com o seu nome e a data. A trilha registra quem e quando de qualquer jeito — o motivo é o único lugar onde o porquê sobrevive.",
  reasonMinLength = 8,
  confirmLabel,
  tone = "warning",
  onConfirm,
  onClose,
}: {
  title: string;
  /** One sentence of context, above the consequences. */
  intro?: string;
  /** What this action does. Rendered as a warning list — never leave it empty. */
  consequences: string[];
  staysTitle?: string;
  /** What this action deliberately does NOT do. */
  stays?: string[];
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonHelp?: string;
  /** Same floor as support access and account deletion. */
  reasonMinLength?: number;
  confirmLabel: string;
  /** `danger` paints the confirm button red — for actions that take something away. */
  tone?: "warning" | "danger";
  onConfirm: (reason: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = reason.trim().length >= reasonMinLength;

  const close = () => {
    if (busy) return;
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const failure = await onConfirm(reason.trim());
    setBusy(false);
    // A failure keeps the dialog open with the reason still typed: closing it
    // would make the operator write the justification a second time.
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          {intro && (
            <Typography variant="body2" className="text-text-secondary">
              {intro}
            </Typography>
          )}

          <Alert severity="warning" className="neutral bg-background-paper/60!">
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </Box>
          </Alert>

          {stays && stays.length > 0 && (
            <Box>
              <Typography variant="body2" className="text-text-primary mb-1 font-medium">
                {staysTitle}
              </Typography>
              <Box component="ul" className="text-text-secondary m-0 flex list-disc flex-col gap-1 pl-4">
                {stays.map((line) => (
                  <Typography component="li" variant="body2" key={line}>
                    {line}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}

          <FormControl className="outlined" variant="standard">
            <FormLabel htmlFor="confirm-action-reason">{reasonLabel}</FormLabel>
            <Input
              id="confirm-action-reason"
              placeholder={reasonPlaceholder}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              autoFocus
              aria-describedby="confirm-action-reason-help"
            />
            {/* body2, not caption: the sentence that says where this text ends
                up is consequence copy, and caption renders below 12px. */}
            <Typography id="confirm-action-reason-help" variant="body2" className="text-text-secondary mt-1">
              {reasonHelp}
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
          Cancelar
        </Button>
        {/* Disabled until the reason is there — and the helper above says why,
            so the button never sits dead without an explanation. */}
        <Button
          variant="contained"
          color={tone === "danger" ? "error" : "primary"}
          onClick={confirm}
          disabled={busy || !reasonOk}
        >
          {busy ? "Aplicando…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
