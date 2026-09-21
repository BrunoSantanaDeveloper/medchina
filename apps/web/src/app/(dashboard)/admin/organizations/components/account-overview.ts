/**
 * Shape of `admin_accounts_overview()` (migration 0104) plus the formatting
 * the console shares between the table and the detail dialog.
 *
 * Everything here is computed in the database on purpose: the summary tiles
 * and the rows are counted from the same query, so they cannot disagree.
 */

export type AccountOwner = {
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  registration: string | null;
  lastSignInAt: string | null;
  confirmed: boolean;
  bannedUntil: string | null;
};

export type AccountBilling = {
  /** The live subscription row the suspend kill-switch acts on. */
  subscriptionId: string | null;
  planSlug: string | null;
  planName: string | null;
  isFree: boolean | null;
  priceCents: number | null;
  /** Price normalized to a month, so a yearly plan is comparable. */
  monthlyCents: number;
  currency: string | null;
  status: string | null;
  suspended: boolean | null;
  provider: string | null;
  providerManaged: boolean;
  currentPeriodEnd: string | null;
  renewalDays: number | null;
  cancelAtPeriodEnd: boolean | null;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  hasBillingId: boolean;
};

export type AccountTrial = {
  startedAt: string;
  endsAt: string;
  daysLeft: number;
  minutesLimit: number;
  startedVia: string | null;
  active: boolean;
};

export type AccountMinutes = {
  source: string;
  limit: number;
  used: number;
  remaining: number;
  percent: number;
  canStart: boolean;
  clinicalReasoning: boolean;
  reason: string;
};

export type AccountUsage = {
  patients: number;
  consultations: number;
  finalized: number;
  finalized30d: number;
  upcoming: number;
  recordings30d: number;
  libraryMessages30d: number;
  minutes30d: number;
  documents: number;
  lastActivityAt: string | null;
  idleDays: number | null;
};

export type AccountAttribution = {
  origem: string | null;
  onda: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  landingPath: string | null;
};

export type AccountOverview = {
  orgId: string;
  name: string;
  slug: string;
  createdAt: string;
  timezone: string | null;
  memberCount: number;
  owner: AccountOwner | null;
  billing: AccountBilling;
  trial: AccountTrial | null;
  minutes: AccountMinutes;
  usage: AccountUsage;
  attribution: AccountAttribution | null;
  flags: string[];
};

export type AccountTotals = {
  accounts: number;
  paid: number;
  trialActive: number;
  trialEnding: number;
  trialOver: number;
  pastDue: number;
  suspended: number;
  canceling: number;
  idle: number;
  neverActivated: number;
  unconfirmed: number;
  new: number;
  /** What the providers charge every month, normalized. */
  mrrCents: number;
  /** Unpaid or scheduled to cancel — the part that is leaving. */
  atRiskMrrCents: number;
  /** Paid plans granted by an operator: capability given away, not revenue. */
  compedMrrCents: number;
  currency: string;
};

export type AccountsOverview = {
  generatedAt: string;
  totals: AccountTotals;
  accounts: AccountOverview[];
};

/** Tiles double as filters: the number and the list always come from one query. */
export const ACCOUNT_FILTERS: { key: string; label: string; total: keyof AccountTotals; hint: string }[] = [
  { key: "all", label: "Todas as contas", total: "accounts", hint: "Todos os consultórios da plataforma" },
  { key: "paid", label: "Pagantes", total: "paid", hint: "Em plano pago e sem suspensão" },
  { key: "trial_ending", label: "Trial acabando", total: "trialEnding", hint: "Trial Pro com três dias ou menos" },
  { key: "trial_over", label: "Trial encerrado", total: "trialOver", hint: "Trial terminou e não converteu" },
  { key: "past_due", label: "Inadimplentes", total: "pastDue", hint: "O provedor não conseguiu cobrar" },
  // The flag, the label and the count all existed (migration 0104 emits
  // 'canceling' and counts it); only the tile was missing, so the one group
  // where a phone call still changes the outcome was the one group the
  // console could not isolate. The hint deliberately does NOT claim this
  // matches the "Em risco" money: that sum also requires a provider
  // subscription, and this flag does not.
  { key: "canceling", label: "Cancelando", total: "canceling", hint: "Pediu para encerrar no fim do período" },
  { key: "idle", label: "Paradas 14d+", total: "idle", hint: "Já trabalhou, nada há duas semanas" },
  { key: "never_activated", label: "Nunca ativou", total: "neverActivated", hint: "Nenhum atendimento finalizado" },
  {
    key: "unconfirmed",
    label: "Não confirmadas",
    total: "unconfirmed",
    hint: "Cadastrou-se e nunca confirmou o e-mail",
  },
  { key: "new", label: "Novas 7d", total: "new", hint: "Criadas nos últimos sete dias" },
  { key: "suspended", label: "Suspensas", total: "suspended", hint: "Acesso desligado por uma operadora" },
];

/** What the database means by each reason on the minute allowance. */
export const MINUTE_REASON: Record<string, string> = {
  ok: "Pode gravar",
  pack_only: "Gravando com minutos avulsos comprados",
  past_due_grace: "Gravando dentro da carência da inadimplência",
  past_due_blocked: "Bloqueada: pagamento em atraso",
  suspended: "Bloqueada: acesso suspenso",
  trial_not_started: "Trial ainda não começou",
  trial_over: "Trial encerrado",
  cycle_exhausted: "Minutos do ciclo esgotados",
  no_plan: "Sem plano com minutos",
};

/** The subscription status enum as the operator reads it; unknown values fall back to the raw one. */
export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: "ativa",
  trialing: "em trial",
  past_due: "inadimplente",
  incomplete: "incompleta",
  canceled: "cancelada",
};

export const FLAG_LABEL: Record<string, string> = {
  no_owner: "sem responsável",
  suspended: "suspensa",
  past_due: "inadimplente",
  canceling: "cancelando",
  trial_active: "em trial",
  trial_ending: "trial acabando",
  trial_over: "trial encerrado",
  paid: "pagante",
  never_activated: "nunca ativou",
  idle: "parada",
  unconfirmed: "não confirmada",
  banned: "bloqueada",
  new: "nova",
};

/** The console speaks pt-BR to its single operator; so does the money. */
export const formatMoney = (cents: number | null | undefined, currency: string | null | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);

export const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString() : "—");

export const formatDateTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "—");

/** "hoje" / "há 3 d" / "nunca" — the operator reads distance, not dates. */
export function sinceDays(value: string | null | undefined): string {
  if (!value) return "nunca";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} d`;
}

/** What the renewal column says, in one place so the dialog agrees with it. */
export function renewalLabel(billing: AccountBilling): string {
  if (billing.status === "past_due") return "inadimplente";
  if (billing.renewalDays === null) return billing.isFree === false ? "cortesia" : "—";
  if (billing.renewalDays < 0) return `${Math.abs(billing.renewalDays)} d vencida`;
  return `${billing.renewalDays} d`;
}

/**
 * The ONE time fact that matters for this account right now, by precedence.
 *
 * Renewal and trial used to be two sortable columns, and together with the
 * plan they cost 420px in a grid that has ~932px to work with at 1440. They
 * are rarely both interesting: what the operator needs on the row is the
 * nearest deadline, whatever kind it is. The raw values stay available as
 * hidden columns and in the dossier.
 */
export function clockLabel(billing: AccountBilling, trial: AccountTrial | null): string {
  if (billing.status === "past_due") {
    const since = billing.pastDueSince
      ? Math.max(0, Math.floor((Date.now() - new Date(billing.pastDueSince).getTime()) / 86_400_000))
      : null;
    return since === null ? "inadimplente" : `inadimplente há ${since} d`;
  }
  if (billing.cancelAtPeriodEnd) {
    return billing.renewalDays !== null ? `cancela em ${billing.renewalDays} d` : "cancelamento marcado";
  }
  if (trial?.active) return `trial acaba em ${trial.daysLeft} d`;
  if (billing.renewalDays !== null) {
    return billing.renewalDays < 0
      ? `${Math.abs(billing.renewalDays)} d vencida`
      : `renova em ${billing.renewalDays} d`;
  }
  return billing.isFree === false ? "cortesia, sem cobrança" : "sem cobrança";
}

export function trialLabel(trial: AccountTrial | null, minutesRemaining: number): string {
  if (!trial) return "não começou";
  if (!trial.active) return "encerrado";
  return `${trial.daysLeft} d · ${minutesRemaining} min`;
}
