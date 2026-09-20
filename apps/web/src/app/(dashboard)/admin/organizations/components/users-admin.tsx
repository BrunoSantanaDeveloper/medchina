"use client";

import { listUserAdminInfo, resetUserMfa, setUserBanned, UserAdminInfo } from "../actions";
import DeleteAccountDialog from "./delete-account-dialog";
import ImpersonateDialog from "./impersonate-dialog";
import SuperadminDialog from "./superadmin-dialog";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Chip, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiCrown from "@/icons/nexture/ni-crown";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiShield from "@/icons/nexture/ni-shield";
import NiShieldCross from "@/icons/nexture/ni-shield-cross";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUserCross from "@/icons/nexture/ni-user-cross";
import NiUsers from "@/icons/nexture/ni-users";
import { createClient } from "@flyee/auth/client";

type UserRow = {
  id: string;
  displayName: string;
  isSuperadmin: boolean;
  createdAt: string;
  orgCount: number;
};

/** The profile row plus the auth-side fields, so every scanned/searched value
 *  is reachable as a cell value (the quick filter reads values, not nodes). */
type UserTableRow = UserRow & {
  email: string | null;
  lastSignInAt: string | null;
  hasMfa: boolean;
  banned: boolean;
};

const isBanned = (info?: UserAdminInfo) =>
  Boolean(info?.bannedUntil && new Date(info.bannedUntil).getTime() > Date.now());

/** The database and the auth API speak in codes; the console has to speak in
 *  reasons. Same idea as `messageFor` in the superadmin dialog. */
const actionError = (raw: string): string => {
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
 * customer, so each one is traceable: the ban writes `banned_until` and
 * nothing else (no session is revoked anywhere in this repo), and the 2FA
 * reset loops over every factor the listing returns, without filtering.
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
      "A assinatura continua como está — suspender os recursos pagos é outra ação, na aba Contas.",
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
      "O único sinal visível depois é o selo “2FA” sumir desta lista.",
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

/** One source for the badge wording, so the cell, the quick filter and the CSV
 *  all say the same thing. They used to disagree: the cell read "bloqueada"
 *  while the searchable value was "banned", so searching what you SAW on the
 *  screen returned nothing. */
const BADGE_LABEL = { self: "você", superadmin: "superadmin", mfa: "2FA", banned: "bloqueada" } as const;

const badgesOf = (row: UserTableRow, selfId: string | null) =>
  [
    row.id === selfId ? BADGE_LABEL.self : null,
    row.isSuperadmin ? BADGE_LABEL.superadmin : null,
    row.hasMfa ? BADGE_LABEL.mfa : null,
    row.banned ? BADGE_LABEL.banned : null,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * Platform-wide user roster: find a user, see how they use the platform
 * (orgs, last sign-in) and act (impersonate / reset 2FA / ban / delete). Auth-side
 * fields need the service role and degrade gracefully without it.
 */
export default function UsersAdmin() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [authInfo, setAuthInfo] = useState<Record<string, UserAdminInfo>>({});
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<UserTableRow | null>(null);
  const [roleChange, setRoleChange] = useState<{ row: UserTableRow; grant: boolean } | null>(null);
  const [deleting, setDeleting] = useState<UserTableRow | null>(null);
  const [confirming, setConfirming] = useState<{ kind: ConfirmKind; row: UserTableRow } | null>(null);
  const { enqueueSnackbar } = useSnackbar();

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setSelfId(user?.id ?? null);

    const { data, error: readError } = await supabase
      .from("profiles")
      .select("id, display_name, is_superadmin, created_at, memberships(count)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        displayName: row.display_name ?? "Profissional sem nome",
        isSuperadmin: row.is_superadmin,
        createdAt: row.created_at,
        orgCount: (row.memberships as unknown as { count: number }[])?.[0]?.count ?? 0,
      })),
    );

    const info = await listUserAdminInfo();
    if (info.ok) {
      setServiceAvailable(true);
      setAuthInfo(Object.fromEntries(info.data.map((entry) => [entry.id, entry])));
    } else {
      setServiceAvailable(info.error === "not-configured" ? false : null);
    }
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Both escalated actions run behind the same confirmation now. They return
   * an error string (which keeps the dialog open with the reason still typed)
   * or null, and a success says so out loud — these used to change someone
   * else's account on a single click, in silence.
   */
  const runConfirmed = useCallback(
    async (kind: ConfirmKind, row: UserTableRow, reason: string): Promise<string | null> => {
      setError(null);
      const result =
        kind === "mfa" ? await resetUserMfa(row.id, reason) : await setUserBanned(row.id, kind === "ban", reason);
      if (!result.ok) return actionError(result.error);
      enqueueSnackbar(
        kind === "mfa"
          ? `2FA de ${row.displayName} redefinido. Ela entra só com a senha até cadastrar outro aplicativo.`
          : kind === "ban"
            ? `${row.displayName} foi bloqueada na plataforma.`
            : `${row.displayName} voltou a ter acesso.`,
        { variant: "success" },
      );
      refresh();
      return null;
    },
    [enqueueSnackbar, refresh],
  );

  const tableRows = useMemo<UserTableRow[]>(
    () =>
      rows.map((row) => {
        const info = authInfo[row.id];
        return {
          ...row,
          email: info?.email ?? null,
          lastSignInAt: info?.lastSignInAt ?? null,
          hasMfa: Boolean(info?.hasMfa),
          banned: isBanned(info),
        };
      }),
    [rows, authInfo],
  );

  const columns = useMemo<GridColDef<UserTableRow>[]>(
    () => [
      {
        field: "displayName",
        headerName: "Profissional",
        flex: 2,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.displayName}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              desde {new Date(params.row.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "email",
        headerName: "E-mail",
        flex: 2,
        minWidth: 200,
        valueGetter: (_, row) => row.email ?? "",
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.email ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "orgCount",
        headerName: "Consultórios",
        type: "number",
        minWidth: 90,
      },
      {
        // A real date value, so sorting orders by time instead of by the
        // formatted string.
        field: "lastSignInAt",
        headerName: "Último acesso",
        type: "date",
        minWidth: 150,
        valueGetter: (_, row) => (row.lastSignInAt ? new Date(row.lastSignInAt) : null),
      },
      {
        field: "badges",
        headerName: "Situação",
        flex: 1,
        minWidth: 200,
        sortable: false,
        valueGetter: (_, row) => badgesOf(row, selfId),
        renderCell: (params: GridRenderCellParams<UserTableRow, string>) => (
          <Box className="flex h-full flex-row flex-wrap items-center gap-1">
            {params.row.id === selfId && (
              <Chip label={BADGE_LABEL.self} size="small" color="primary" variant="outlined" />
            )}
            {params.row.isSuperadmin && (
              <Chip label={BADGE_LABEL.superadmin} size="small" color="warning" variant="outlined" />
            )}
            {params.row.hasMfa && <Chip label={BADGE_LABEL.mfa} size="small" color="success" variant="outlined" />}
            {params.row.banned && <Chip label={BADGE_LABEL.banned} size="small" color="error" variant="outlined" />}
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        // The auth-side actions need the service role: without it the kebab
        // offers only what RLS alone can authorize (the platform role, whose
        // gate lives in the database — migration 0096).
        getActions: (params) => {
          const row = params.row;
          const canImpersonate = Boolean(serviceAvailable) && row.id !== selfId && !row.isSuperadmin && !row.banned;
          // Never on yourself: wiping your own second factor costs you support
          // access (impersonation requires AAL2) and nothing here would say so.
          // The server refuses it too, so offering it would only produce an error.
          const canResetMfa = Boolean(serviceAvailable) && row.hasMfa && row.id !== selfId;
          const canBan = Boolean(serviceAvailable) && row.id !== selfId;
          // Never on yourself, in either direction — the database refuses it
          // too, so offering it would only produce an error.
          const canChangeRole = row.id !== selfId;
          // Irreversible, and service-role backed (files go through the Storage
          // API). A superadmin has to lose the role first — the database
          // refuses otherwise, so the menu does not offer it.
          const canDelete = Boolean(serviceAvailable) && row.id !== selfId && !row.isSuperadmin;
          return [
            ...(canImpersonate
              ? [
                  <GridActionsCellItem
                    key="impersonate"
                    icon={<NiEyeOpen size="medium" />}
                    label="Entrar como"
                    onClick={() => setImpersonating(row)}
                    showInMenu
                  />,
                ]
              : []),
            ...(canResetMfa
              ? [
                  <GridActionsCellItem
                    key="reset-mfa"
                    icon={<NiShieldCross size="medium" />}
                    label="Redefinir 2FA (perdeu o aparelho)"
                    onClick={() => setConfirming({ kind: "mfa", row })}
                    showInMenu
                  />,
                ]
              : []),
            ...(canChangeRole
              ? [
                  <GridActionsCellItem
                    key="superadmin"
                    icon={row.isSuperadmin ? <NiShield size="medium" /> : <NiCrown size="medium" />}
                    label={row.isSuperadmin ? "Remover superadmin" : "Tornar superadmin"}
                    onClick={() => setRoleChange({ row, grant: !row.isSuperadmin })}
                    showInMenu
                  />,
                ]
              : []),
            ...(canBan
              ? [
                  <GridActionsCellItem
                    key="ban"
                    icon={row.banned ? <NiUserCheck size="medium" /> : <NiUserCross size="medium" />}
                    label={row.banned ? "Desbloquear na plataforma" : "Bloquear na plataforma"}
                    onClick={() => setConfirming({ kind: row.banned ? "unban" : "ban", row })}
                    showInMenu
                  />,
                ]
              : []),
            ...(canDelete
              ? [
                  <GridActionsCellItem
                    key="delete"
                    icon={<NiBinEmpty size="medium" />}
                    label="Excluir conta e todos os dados"
                    onClick={() => setDeleting(row)}
                    showInMenu
                  />,
                ]
              : []),
          ];
        },
      },
    ],
    [selfId, serviceAvailable],
  );

  return (
    <Box className="flex flex-col gap-3">
      {serviceAvailable === false && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Defina SUPABASE_SERVICE_ROLE_KEY para ver e-mails e último acesso e habilitar entrar como, redefinir 2FA,
          bloquear/desbloquear e excluir conta.
        </Alert>
      )}

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<UserTableRow>
          rows={tableRows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiUsers size="medium" />}
              title="Nenhuma profissional ainda"
              description="Toda conta criada pelo cadastro aparece aqui, com seus consultórios e o estado de autenticação."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma profissional corresponde à busca.
            </Typography>
          }
        />
      )}

      {confirming && (
        <ConfirmActionDialog
          key={`${confirming.kind}-${confirming.row.id}`}
          title={CONFIRM_COPY[confirming.kind].title(confirming.row.displayName)}
          intro={CONFIRM_COPY[confirming.kind].intro}
          consequences={CONFIRM_COPY[confirming.kind].consequences}
          stays={CONFIRM_COPY[confirming.kind].stays}
          confirmLabel={CONFIRM_COPY[confirming.kind].confirm}
          tone={CONFIRM_COPY[confirming.kind].tone}
          reasonPlaceholder={CONFIRM_COPY[confirming.kind].placeholder}
          onConfirm={(reason) => runConfirmed(confirming.kind, confirming.row, reason)}
          onClose={() => setConfirming(null)}
        />
      )}

      {/* Mounted only while open and keyed by user, like the deletion dialog.
          Kept permanently mounted they changed identity on the way out — the
          title read "…de ?" during the fade — and, worse, ImpersonateDialog
          never reset its reason: the justification typed for one account, which
          is AUDITED and shown to that professional, came back on the next. */}
      {impersonating && (
        <ImpersonateDialog
          key={impersonating.id}
          open
          userId={impersonating.id}
          userName={impersonating.displayName}
          onClose={() => setImpersonating(null)}
        />
      )}

      {roleChange && (
        <SuperadminDialog
          key={`${roleChange.row.id}-${roleChange.grant}`}
          open
          userId={roleChange.row.id}
          userName={roleChange.row.displayName}
          grant={roleChange.grant}
          onClose={() => setRoleChange(null)}
          onDone={() => {
            setRoleChange(null);
            refresh();
          }}
        />
      )}

      {/* Mounted only while open and keyed by user: every account starts from
          a fresh count of what it holds, never from the previous one's. */}
      {deleting && (
        <DeleteAccountDialog
          key={deleting.id}
          userId={deleting.id}
          userName={deleting.displayName}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            refresh();
          }}
        />
      )}
    </Box>
  );
}
