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
        {grant
          ? `Tornar ${userName} superadmin da plataforma?`
          : `Remover o papel de superadmin da plataforma de ${userName}?`}
      </DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          {grant ? (
            <>
              <Typography variant="body2" className="text-text-secondary">
                Este é o maior privilégio da plataforma, e ele não fica restrito a um consultório.
              </Typography>

              <Alert severity="warning" className="neutral bg-background-paper/60!">
                <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
                  <li>
                    Lê o prontuário de <strong>todos</strong> os consultórios — pacientes, consultas, transcrições,
                    documentos.
                  </li>
                  <li>Abre sessões de suporte dentro da conta de qualquer profissional.</li>
                  <li>Suspende e bane contas, reseta o 2FA e atribui planos pagos sem cobrança.</li>
                  <li>Concede este mesmo papel a outras pessoas.</li>
                  <li>
                    Libera o <strong>consultório dela</strong>: importação sem limite de linhas, minutos e raciocínio do
                    melhor plano, biblioteca sem cota — sem cobrança. Um consultório que já paga um plano continua no
                    plano que paga.
                  </li>
                </Box>
              </Alert>

              <Typography variant="body2" className="text-text-secondary">
                Conceda a operadoras da plataforma, nunca como facilidade para uma cliente.
              </Typography>
            </>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {userName} perde a área /admin e todo privilégio entre consultórios na próxima requisição. A conta, o
              consultório e os dados dela ficam intactos — mas o consultório volta ao plano que ele realmente tem, com
              os limites desse plano.
            </Typography>
          )}

          <FormControl className="outlined" variant="standard">
            <FormLabel htmlFor="superadmin-note">Nota para a trilha de auditoria (opcional)</FormLabel>
            <Input
              id="superadmin-note"
              placeholder={grant ? "Segunda operadora para a janela de lançamento" : "Saiu do time"}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
              autoFocus
            />
            <Typography variant="body2" className="text-text-secondary mt-1">
              Quem concedeu o papel a quem fica registrado de qualquer jeito. A nota é o único lugar onde o motivo
              sobrevive.
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
        <Button variant="contained" onClick={confirm} disabled={busy}>
          {busy ? "Salvando…" : grant ? "Conceder superadmin" : "Remover superadmin"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The database speaks in error codes; the console has to speak in reasons. */
function messageFor(raw: string): string {
  if (raw.includes("self_change_forbidden")) {
    return "Você não pode mudar o seu próprio papel na plataforma — peça a outra superadmin. (Remover o seu deixaria a plataforma sem operadora.)";
  }
  if (raw.includes("not_authorized")) {
    return "Só uma superadmin da plataforma pode mudar este papel, e nunca de dentro de uma sessão de suporte.";
  }
  if (raw.includes("user_not_found")) {
    return "Esta profissional não existe mais. Recarregue a lista.";
  }
  if (raw.includes("superadmin_not_self_assignable")) {
    return "O banco recusou a mudança: este papel não pode ser atribuído a si mesma.";
  }
  return raw;
}
