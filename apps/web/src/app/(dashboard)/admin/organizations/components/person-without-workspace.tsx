"use client";

import { formatDate, formatDateTime, sinceDays } from "./account-overview";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

/** Shape of `admin_people_without_workspace()` (migration 0108). */
export type PersonWithoutWorkspace = {
  userId: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmed: boolean;
  bannedUntil: string | null;
  isSuperadmin: boolean;
  authProvider: string | null;
  cause: "invite_pending" | "invite_expired" | "setup_abandoned" | "unknown";
  invite: {
    orgId: string;
    orgName: string;
    role: string;
    sentAt: string;
    expiresAt: string;
    valid: boolean;
  } | null;
};

export type PeopleWithoutWorkspace = {
  generatedAt: string;
  totals: {
    people: number;
    invitePending: number;
    inviteExpired: number;
    setupAbandoned: number;
    unknown: number;
    neverSignedIn: number;
  };
  people: PersonWithoutWorkspace[];
};

/** Short label for the row. The cause is never guessed — see migration 0108. */
export const CAUSE_LABEL: Record<PersonWithoutWorkspace["cause"], string> = {
  invite_pending: "convite pendente",
  invite_expired: "convite vencido",
  setup_abandoned: "cadastro não concluído",
  unknown: "causa desconhecida",
};

/**
 * What the operator is allowed to conclude, and — for the one case where the
 * obvious repair is the WRONG repair — what not to do.
 *
 * A pending invite means her single MVP workspace arrives on acceptance;
 * `auth/callback/route.ts` refuses to create a personal one for exactly that
 * reason ("creating a second personal workspace would be wrong"), so the
 * console must not suggest it either.
 */
const CAUSE_EXPLANATION: Record<PersonWithoutWorkspace["cause"], { what: string; todo: string }> = {
  invite_pending: {
    what: "Ela foi convidada para um consultório e ainda não aceitou. O consultório dela chega no aceite — por isso ela ainda não tem nenhum.",
    todo: "Peça que abra o convite no e-mail. NÃO crie um consultório para ela: o produto recusa um segundo consultório pessoal de propósito.",
  },
  invite_expired: {
    what: "Ela foi convidada, o convite venceu sem aceite, e por isso ela nunca recebeu um consultório.",
    todo: "Peça a quem convidou que reenvie o convite, em Configurações → Consultório.",
  },
  setup_abandoned: {
    what: "Ela entrou pelo login social, que não pergunta o nome do consultório, e não concluiu a tela seguinte (Completar cadastro) — que é onde o consultório é criado.",
    todo: "Peça que entre de novo: ela cai direto em Completar cadastro e termina em um passo.",
  },
  unknown: {
    what: "O cadastro por e-mail exige o nome do consultório, então esta conta deveria ter um. Não dá para dizer pelo banco o que aconteceu — o consultório foi excluído, ou o vínculo dela foi removido.",
    todo: "Confirme com ela o que houve antes de agir. Não há causa registrada para afirmar nada.",
  },
};

/**
 * The "signed up and cannot use the product" case, which a console that lists
 * ORGANIZATIONS could not show at all: she has no workspace, so she had no
 * row. This is deliberately not the account dossier — `admin_account_dossier`
 * takes an org and there is none — it is the small amount that is true about
 * her, plus the cause, plus what to do about it.
 */
export default function PersonWithoutWorkspaceDialog({
  person,
  onClose,
  actions,
}: {
  person: PersonWithoutWorkspace;
  onClose: () => void;
  /** The same escalated actions the row's kebab offers. */
  actions?: React.ReactNode;
}) {
  const explanation = CAUSE_EXPLANATION[person.cause];
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box className="flex flex-col">
          <Typography variant="h5" component="span">
            {person.name ?? "Profissional sem nome"}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {person.email ?? "sem e-mail"} · sem consultório
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            <Typography variant="body2" className="text-text-primary">
              {explanation.what}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {explanation.todo}
            </Typography>
          </Alert>

          {person.invite && (
            <Row
              label="Convite"
              value={`${person.invite.orgName} · como ${person.invite.role} · enviado em ${formatDate(person.invite.sentAt)} · ${
                person.invite.valid ? `vence em ${formatDate(person.invite.expiresAt)}` : "vencido"
              }`}
            />
          )}
          <Row label="Entrou por" value={person.authProvider ?? "e-mail e senha"} />
          <Row label="E-mail confirmado" value={person.confirmed ? "sim" : "não — o cadastro nunca foi concluído"} />
          <Row label="Conta criada em" value={formatDateTime(person.createdAt)} />
          {/* Never a blank cell: "nunca acessou" is the strongest signal here. */}
          <Row
            label="Último acesso"
            value={person.lastSignInAt ? sinceDays(person.lastSignInAt) : "nunca acessou desde o cadastro"}
          />
          {person.isSuperadmin && <Row label="Papel" value="superadmin da plataforma" />}
          <Row label="Id da pessoa" value={person.userId} />
        </Box>
      </DialogContent>
      <DialogActions>
        {actions}
        <Button variant="text" color="grey" onClick={onClose}>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box className="flex flex-row flex-wrap items-baseline gap-2">
      <Typography variant="body2" className="text-text-secondary w-40 shrink-0">
        {label}
      </Typography>
      <Typography variant="body2" component="span" className="text-text-primary min-w-0 flex-1 break-words">
        {value}
      </Typography>
    </Box>
  );
}
