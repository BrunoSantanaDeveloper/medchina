"use client";

import { resetUserMfa, setUserBanned } from "../actions";
import DeleteAccountDialog from "./delete-account-dialog";
import ImpersonateDialog from "./impersonate-dialog";
import SuperadminDialog from "./superadmin-dialog";
import { useSnackbar } from "notistack";
import { useCallback, useState } from "react";

import { GridActionsCellItem } from "@mui/x-data-grid";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiCrown from "@/icons/nexture/ni-crown";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiShield from "@/icons/nexture/ni-shield";
import NiShieldCross from "@/icons/nexture/ni-shield-cross";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUserCross from "@/icons/nexture/ni-user-cross";

/** The person an escalated action acts on, however the row was built. */
export type PersonTarget = {
  userId: string;
  name: string;
  email: string | null;
  isSuperadmin: boolean;
  /** Only a verified factor can be reset; the accounts payload does not carry
   *  it, so a caller without the service-role read passes false. */
  hasMfa: boolean;
  banned: boolean;
};

/** The database and the auth API speak in codes; the console speaks in reasons. */
export const personActionError = (raw: string): string => {
  if (raw === "forbidden") return "Só uma superadmin da plataforma pode fazer isto.";
  if (raw === "not-configured") {
    return "Defina SUPABASE_SERVICE_ROLE_KEY: esta ação usa a API de administração da autenticação e fica desligada sem ela.";
  }
  if (raw === "reason-required") return "Escreva um motivo com pelo menos 8 caracteres.";
  if (raw === "self-mfa") {
    return "Você não pode redefinir o seu próprio 2FA aqui — perderia o acesso de suporte, que exige segundo fator. Refaça o cadastro em Ajustes → Segurança.";
  }
  return raw;
};

/**
 * What each escalated action REALLY does, verified against the code that runs
 * it. These sentences are what the operator will believe and repeat to a
 * customer: the ban writes `banned_until` and nothing else (no session is
 * revoked anywhere in this repo), and the 2FA reset loops over every factor
 * the listing returns, without filtering by status.
 */
type ConfirmKind = "ban" | "unban" | "mfa";

const CONFIRM_COPY: Record<
  ConfirmKind,
  {
    title: (name: string) => string;
    intro?: string;
    consequences: string[];
    stays: string[];
    confirm: string;
    tone: "warning" | "danger";
    placeholder: string;
  }
> = {
  ban: {
    title: (name) => `Bloquear o acesso de ${name} à plataforma?`,
    intro: "O bloqueio é na conta de autenticação, então vale para o site e para o aplicativo.",
    consequences: [
      "Novas tentativas de entrar passam a ser recusadas, sem prazo para acabar.",
      "A tela de entrada não explica o bloqueio: ela vê uma mensagem genérica de erro e não é avisada por nós.",
      "Esta ação NÃO encerra uma sessão que já esteja aberta — não revogamos o token. Se ela estiver com a tela aberta, não dá para garantir que o acesso pare na hora.",
      "Enquanto estiver bloqueada, “Entrar como” fica indisponível: para ver a conta por dentro é preciso desbloquear antes.",
    ],
    stays: [
      "Nada é apagado: pacientes, consultas, documentos e a conta seguem intactos.",
      "A assinatura continua como está — suspender os recursos pagos é outra ação.",
      "É reversível: “Desbloquear na plataforma” devolve o acesso, com senha e 2FA intactos.",
    ],
    confirm: "Bloquear na plataforma",
    tone: "danger",
    placeholder: "Ticket 1234 — uso indevido confirmado",
  },
  unban: {
    title: (name) => `Devolver o acesso de ${name} à plataforma?`,
    consequences: ["Ela volta a conseguir entrar, com a senha e o 2FA que já tinha."],
    stays: ["Nada além do bloqueio é alterado."],
    confirm: "Desbloquear na plataforma",
    tone: "warning",
    placeholder: "Ticket 1234 — bloqueio aplicado por engano",
  },
  mfa: {
    title: (name) => `Redefinir o 2FA de ${name}?`,
    intro: "É o caminho de recuperação de quem perdeu o aparelho e ficou presa na verificação em duas etapas.",
    consequences: [
      "Remove TODOS os fatores de verificação da conta — o código apaga cada fator que a listagem devolver, sem filtrar.",
      "Ela passa a entrar só com e-mail e senha, e nada a obriga a cadastrar outro aplicativo depois.",
      "Ela não é avisada: nenhum e-mail, nenhuma notificação no aplicativo.",
      "O único sinal visível depois é o selo “2FA” sumir da lista.",
    ],
    stays: [
      "A senha, a sessão e os dados da conta não são tocados.",
      "Ela pode cadastrar um novo autenticador quando quiser, em Ajustes → Segurança.",
    ],
    confirm: "Redefinir 2FA",
    tone: "danger",
    placeholder: "Ticket 1234 — perdeu o celular, confirmou identidade por vídeo",
  },
};

/**
 * The escalated actions on a PERSON, in one place, so every surface that can
 * reach her offers the same set with the same guards and the same
 * confirmations.
 *
 * Before this, "entrar como / redefinir 2FA / bloquear / excluir" lived only
 * in the professionals tab, while the accounts tab identified its rows BY the
 * professional (name and e-mail) and offered none of them. A support call
 * that arrives with an e-mail therefore cost two searches on two tabs. The
 * hook is what keeps the two surfaces from drifting apart again.
 */
export function usePersonActions({
  selfId,
  serviceAvailable,
  onChanged,
}: {
  selfId: string | null;
  /** False when SUPABASE_SERVICE_ROLE_KEY is missing: the auth-admin actions
   *  cannot run, so they are not offered. */
  serviceAvailable: boolean | null;
  onChanged: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [confirming, setConfirming] = useState<{ kind: ConfirmKind; target: PersonTarget } | null>(null);
  const [impersonating, setImpersonating] = useState<PersonTarget | null>(null);
  const [roleChange, setRoleChange] = useState<{ target: PersonTarget; grant: boolean } | null>(null);
  const [deleting, setDeleting] = useState<PersonTarget | null>(null);

  const run = useCallback(
    async (kind: ConfirmKind, target: PersonTarget, reason: string): Promise<string | null> => {
      const result =
        kind === "mfa"
          ? await resetUserMfa(target.userId, reason)
          : await setUserBanned(target.userId, kind === "ban", reason);
      if (!result.ok) return personActionError(result.error);
      enqueueSnackbar(
        kind === "mfa"
          ? `2FA de ${target.name} redefinido. Ela entra só com a senha até cadastrar outro aplicativo.`
          : kind === "ban"
            ? `${target.name} foi bloqueada na plataforma.`
            : `${target.name} voltou a ter acesso.`,
        { variant: "success" },
      );
      onChanged();
      return null;
    },
    [enqueueSnackbar, onChanged],
  );

  /**
   * The guards are the same ones the server enforces, so the menu never
   * offers what the database will refuse.
   */
  const buildItems = useCallback(
    (target: PersonTarget) => {
      const service = Boolean(serviceAvailable);
      const isSelf = target.userId === selfId;
      const items = [];
      if (service && !isSelf && !target.isSuperadmin && !target.banned) {
        items.push(
          <GridActionsCellItem
            key="impersonate"
            icon={<NiEyeOpen size="medium" />}
            label="Entrar como"
            onClick={() => setImpersonating(target)}
            showInMenu
          />,
        );
      }
      // Never on yourself: wiping your own second factor costs you support
      // access (impersonation requires AAL2) and nothing here would say so.
      if (service && target.hasMfa && !isSelf) {
        items.push(
          <GridActionsCellItem
            key="reset-mfa"
            icon={<NiShieldCross size="medium" />}
            label="Redefinir 2FA (perdeu o aparelho)"
            onClick={() => setConfirming({ kind: "mfa", target })}
            showInMenu
          />,
        );
      }
      // The database refuses a self role change too, in either direction.
      if (!isSelf) {
        items.push(
          <GridActionsCellItem
            key="superadmin"
            icon={target.isSuperadmin ? <NiShield size="medium" /> : <NiCrown size="medium" />}
            label={target.isSuperadmin ? "Remover superadmin" : "Tornar superadmin"}
            onClick={() => setRoleChange({ target, grant: !target.isSuperadmin })}
            showInMenu
          />,
        );
      }
      if (service && !isSelf) {
        items.push(
          <GridActionsCellItem
            key="ban"
            icon={target.banned ? <NiUserCheck size="medium" /> : <NiUserCross size="medium" />}
            label={target.banned ? "Desbloquear na plataforma" : "Bloquear na plataforma"}
            onClick={() => setConfirming({ kind: target.banned ? "unban" : "ban", target })}
            showInMenu
          />,
        );
      }
      // Irreversible, and service-role backed. A superadmin has to lose the
      // role first — the database refuses otherwise.
      if (service && !isSelf && !target.isSuperadmin) {
        items.push(
          <GridActionsCellItem
            key="delete"
            icon={<NiBinEmpty size="medium" />}
            label="Excluir conta e todos os dados"
            onClick={() => setDeleting(target)}
            showInMenu
          />,
        );
      }
      return items;
    },
    [selfId, serviceAvailable],
  );

  // Every dialog is mounted only while open and keyed by the person: kept
  // permanently mounted they changed identity during the exit fade, and the
  // impersonation reason — which is audited AND shown to the professional —
  // survived from one account to the next.
  const dialogs = (
    <>
      {confirming && (
        <ConfirmActionDialog
          key={`${confirming.kind}-${confirming.target.userId}`}
          title={CONFIRM_COPY[confirming.kind].title(confirming.target.name)}
          intro={CONFIRM_COPY[confirming.kind].intro}
          consequences={CONFIRM_COPY[confirming.kind].consequences}
          stays={CONFIRM_COPY[confirming.kind].stays}
          confirmLabel={CONFIRM_COPY[confirming.kind].confirm}
          tone={CONFIRM_COPY[confirming.kind].tone}
          reasonPlaceholder={CONFIRM_COPY[confirming.kind].placeholder}
          onConfirm={(reason) => run(confirming.kind, confirming.target, reason)}
          onClose={() => setConfirming(null)}
        />
      )}

      {impersonating && (
        <ImpersonateDialog
          key={impersonating.userId}
          open
          userId={impersonating.userId}
          userName={impersonating.name}
          onClose={() => setImpersonating(null)}
        />
      )}

      {roleChange && (
        <SuperadminDialog
          key={`${roleChange.target.userId}-${roleChange.grant}`}
          open
          userId={roleChange.target.userId}
          userName={roleChange.target.name}
          grant={roleChange.grant}
          onClose={() => setRoleChange(null)}
          onDone={() => {
            setRoleChange(null);
            onChanged();
          }}
        />
      )}

      {deleting && (
        <DeleteAccountDialog
          key={deleting.userId}
          userId={deleting.userId}
          userName={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onChanged();
          }}
        />
      )}
    </>
  );

  /**
   * Support access, exposed on its own so a dialog footer can offer it as a
   * button while the row keeps it in the kebab. Only this one is promoted:
   * ban, delete and 2FA are rare and destructive, and a footer lined with red
   * buttons invites the click it should be discouraging.
   */
  const canImpersonate = useCallback(
    (target: PersonTarget) =>
      Boolean(serviceAvailable) && target.userId !== selfId && !target.isSuperadmin && !target.banned,
    [selfId, serviceAvailable],
  );

  return { buildItems, dialogs, canImpersonate, openImpersonation: setImpersonating };
}
