"use client";

import { getSignupWhatsAppAdminState, setSignupWhatsAppConfirmation, type SignupWhatsAppAdminState } from "../actions";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Skeleton,
  Switch,
  Typography,
} from "@mui/material";

import { StatTile } from "@/components/product/home-tiles";
import NiClock from "@/icons/nexture/ni-clock";
import { brLocalDigits } from "@/lib/signup-whatsapp-shared";
import { formatPhoneBr } from "@flyee/fields";

type Loaded = Extract<SignupWhatsAppAdminState, { ok: true }>;

/** "+55 (11) 99999-0000" for a Brazilian number; the bare digits otherwise. */
function showNumber(number: string): string {
  const local = brLocalDigits(number);
  return local ? `+55 ${formatPhoneBr(local)}` : `+${number}`;
}

/**
 * The switch that decides whether a sign-up has to be confirmed by WhatsApp
 * (migration 0122). The operator comes here with one question — "can I turn
 * this on, and what happens if I do?" — so the screen answers it before the
 * control: what the server still lacks, what the switch changes for each kind
 * of sign-up, and how many accounts are waiting right now.
 *
 * Off is the safe state and the one a new deployment is born in: the sign-up
 * is confirmed by e-mail and nobody is held. The WhatsApp NUMBER is asked for
 * either way — that part is not a setting.
 */
export default function SignupWhatsAppAdmin() {
  const [state, setState] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const result = await getSignupWhatsAppAdminState().catch(() => null);
    if (result?.ok) setState(result);
    else setLoadFailed(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    setSaved(null);
    const result = await setSignupWhatsAppConfirmation(enabled).catch(() => null);
    setSaving(false);
    setConfirmOff(false);

    if (!result || !result.ok) {
      setError(
        result?.reason === "not_ready"
          ? `Ainda não dá para ligar: falta configurar ${(result.missing ?? []).join(", ")} no servidor.`
          : result?.reason === "not_authorized"
            ? "Só superadmins da plataforma podem mudar esta configuração."
            : "Não foi possível salvar agora. Nada mudou — tente de novo.",
      );
      return;
    }
    setSaved(
      result.enabled
        ? "Confirmação pelo WhatsApp ligada. Vale para os cadastros feitos a partir de agora."
        : result.released > 0
          ? `Confirmação desligada. ${result.released} ${result.released === 1 ? "conta que aguardava foi liberada" : "contas que aguardavam foram liberadas"}.`
          : "Confirmação desligada. O cadastro volta a ser confirmado só por e-mail.",
    );
    await load();
  };

  if (loadFailed) {
    return (
      <Box className="flex max-w-xl flex-col gap-3">
        <Alert severity="error" className="neutral bg-background-paper/60!">
          Não foi possível ler a configuração do cadastro.
        </Alert>
        <Box>
          <Button variant="outlined" onClick={() => void load()}>
            Tentar de novo
          </Button>
        </Box>
      </Box>
    );
  }

  if (!state) {
    return (
      <Box className="flex max-w-xl flex-col gap-3" aria-busy>
        <Skeleton variant="text" className="w-2/3" />
        <Skeleton variant="rounded" height={72} />
        <Skeleton variant="rounded" height={40} className="w-1/2" />
      </Box>
    );
  }

  const blocked = state.missing.length > 0;

  return (
    <Box className="flex max-w-xl flex-col gap-4">
      <Box className="flex flex-col gap-1">
        <Typography variant="h6" component="h2">
          Confirmação de cadastro pelo WhatsApp
        </Typography>
        <Typography variant="body1" className="text-text-secondary">
          O número de WhatsApp é sempre pedido no cadastro. Esta chave decide se ele precisa ser confirmado: a
          profissional envia um código do próprio WhatsApp e a conta só segue depois disso.
        </Typography>
      </Box>

      {blocked ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          <AlertTitle variant="subtitle2">Ainda não dá para ligar</AlertTitle>
          Falta configurar no servidor: {state.missing.join(", ")}. Enquanto isso, o cadastro continua confirmado só por
          e-mail e ninguém fica retido.
        </Alert>
      ) : (
        <Typography variant="body1">
          Número que recebe os códigos: <strong>{state.number ? showNumber(state.number) : "não configurado"}</strong>
        </Typography>
      )}

      <FormControlLabel
        control={
          <Switch
            checked={state.enabled}
            disabled={saving || (blocked && !state.enabled)}
            onChange={(_, checked) => {
              // Turning it off lets through whoever was waiting: say so first.
              if (!checked && state.waiting > 0) setConfirmOff(true);
              else void apply(checked);
            }}
          />
        }
        label="Exigir confirmação pelo WhatsApp"
      />

      <Typography variant="body2" className="text-text-secondary">
        {state.enabled
          ? "Ligada: o cadastro comum confirma antes de a conta ser criada. O cadastro que vem de campanha vai direto ao pagamento e confirma depois de pagar."
          : "Desligada: o cadastro é confirmado por e-mail, como sempre foi, e nenhuma conta fica aguardando."}
      </Typography>

      {state.enabled && (
        <Box className="max-w-64">
          <StatTile
            icon={<NiClock size="medium" />}
            tone="secondary"
            label="Aguardando confirmação"
            value={state.waiting}
            hint="Contas criadas por campanha que ainda não confirmaram o WhatsApp"
          />
        </Box>
      )}

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          {saved}
        </Alert>
      )}

      <Dialog open={confirmOff} onClose={() => (saving ? undefined : setConfirmOff(false))}>
        <DialogTitle>Desligar a confirmação pelo WhatsApp?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {state.waiting === 1
              ? "1 conta está aguardando confirmação. Ao desligar, ela é liberada e entra no produto sem confirmar o WhatsApp."
              : `${state.waiting} contas estão aguardando confirmação. Ao desligar, elas são liberadas e entram no produto sem confirmar o WhatsApp.`}{" "}
            Isso não se desfaz ligando a chave de novo.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setConfirmOff(false)} disabled={saving}>
            Manter ligada
          </Button>
          <Button variant="contained" onClick={() => void apply(false)} disabled={saving}>
            {saving ? "Desligando…" : "Desligar e liberar"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
