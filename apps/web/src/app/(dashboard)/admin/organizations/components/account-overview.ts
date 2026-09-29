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

/**
 * What this account cost us in provider money (migrations 0115/0116).
 *
 * Everything is in USD micros — millionths of a dollar — because that is what
 * the price lists are written in and what survives a thousand-token call.
 * `cents30d` and `marginCents` are NULL until the operator sets an exchange
 * rate in the price book: until then the console shows dollars rather than
 * inventing a conversion.
 */
export type AccountAiCost = {
  usdMicros30d: number;
  cents30d: number | null;
  calls30d: number;
  /** Calls whose model has no configured price: cost we KNOW we are missing. */
  unpriced30d: number;
  lifetimeUsdMicros: number;
  lastAt: string | null;
  /** feature -> USD micros, for the 30-day window. */
  byFeature30d: Record<string, number>;
  /** Monthly revenue minus the AI bill; NULL when either half is unknown. */
  marginCents: number | null;
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
  /**
   * Absent when the database predates migration 0116 — a deploy that
   * landed before its migration. Never assume it is there.
   */
  aiCost?: AccountAiCost;
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
  // All of the cost totals are absent on a database that predates 0116 —
  // the console hides the cost column, tiles and filters in that case rather
  // than reporting zeros it cannot stand behind.
  /** What every account's AI cost us in the last 30 days, in USD micros. */
  aiCost30dUsdMicros?: number;
  /** The same sum converted, or NULL with no exchange rate configured. */
  aiCost30dCents?: number | null;
  /** Spend that belongs to no account: admin insights, shared library. */
  aiPlatformCost30dUsdMicros?: number;
  /** Calls we could not price at all — the caveat on every number above. */
  aiUnpricedCalls30d?: number;
  aiCostAccounts?: number;
  aiCostUnpaid?: number;
  aiCostOverRevenue?: number;
  usdToBrl?: number | null;
  /** When real measurement started; NULL means nothing is measured yet. */
  aiMeasuringSince?: string | null;
};

/**
 * Whether this payload can talk about cost at all.
 *
 * One check, used by every surface, so the column, the tiles, the filters and
 * the dossier can never disagree about whether the number exists.
 */
export const costMeasured = (totals: AccountTotals | null | undefined): boolean =>
  totals?.aiCost30dUsdMicros !== undefined;

export type AccountsOverview = {
  generatedAt: string;
  totals: AccountTotals;
  accounts: AccountOverview[];
};

/**
 * The totals a tile or a filter may display: the plain counters.
 *
 * Money and the exchange rate live in the same object but are not countable —
 * a tile that rendered `usdToBrl` would read as "5 contas". Narrowing the key
 * here is what stops that at compile time.
 */
export type AccountCountKey = {
  // NonNullable, not a bare lookup: the cost totals are optional (a database
  // older than 0116 omits them), and `number | undefined` would fail the test
  // and silently drop the cost filters from the union.
  [K in keyof AccountTotals]-?: NonNullable<AccountTotals[K]> extends number ? K : never;
}[keyof AccountTotals];

/** Tiles double as filters: the number and the list always come from one query. */
export const ACCOUNT_FILTERS: { key: string; label: string; total: AccountCountKey; hint: string }[] = [
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
  // Cost filters. Each one is a fact the database computed, never a
  // threshold this file invented — "caro" is the operator's judgement, made
  // by sorting the custo column.
  { key: "ai_cost", label: "Com custo de IA", total: "aiCostAccounts", hint: "Gastou com IA nos últimos 30 dias" },
  {
    key: "ai_cost_unpaid",
    label: "Gasta sem pagar",
    total: "aiCostUnpaid",
    hint: "Consome IA sem nenhuma assinatura paga por trás",
  },
  {
    key: "ai_cost_over_revenue",
    label: "Custo > receita",
    total: "aiCostOverRevenue",
    hint: "A IA dela custou mais no mês do que ela paga",
  },
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

/**
 * Provider money, in the currency the operator can actually reason about.
 *
 * With an exchange rate configured the console speaks BRL like the rest of
 * the money on screen; without one it speaks USD and says so, because a
 * converted number nobody set a rate for is a made-up number.
 *
 * AI costs are small and fractional by nature: four decimal places below one
 * unit, so a R$ 0,0032 call does not render as "R$ 0" and read as free.
 */
export function formatSpend(usdMicros: number | null | undefined, usdToBrl: number | null | undefined): string {
  const micros = usdMicros ?? 0;
  const currency = usdToBrl ? "BRL" : "USD";
  const value = usdToBrl ? (micros * usdToBrl) / 1_000_000 : micros / 1_000_000;
  if (value === 0) return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
  }).format(value);
}

/** What each ledger feature is, in the operator's words. */
export const SPEND_FEATURE: Record<string, string> = {
  transcription: "Transcrição do áudio",
  anamnesis: "Anamnese pelo áudio",
  hypotheses: "Hipóteses (Pro)",
  plan: "Plano terapêutico",
  attachment: "Leitura de anexos",
  library: "Chat da biblioteca",
  case_review: "Revisão de caso",
  embedding: "Indexação (embeddings)",
  insights: "Insights do admin",
  other: "Outros",
};

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
