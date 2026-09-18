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
  { key: "all", label: "All accounts", total: "accounts", hint: "Every workspace on the platform" },
  { key: "paid", label: "Paying", total: "paid", hint: "On a paid plan and not suspended" },
  { key: "trial_ending", label: "Trial ending", total: "trialEnding", hint: "Pro trial with three days or less" },
  { key: "trial_over", label: "Trial over", total: "trialOver", hint: "Trial ended and never converted" },
  { key: "past_due", label: "Past due", total: "pastDue", hint: "The provider could not charge" },
  { key: "idle", label: "Idle 14d+", total: "idle", hint: "Worked before, nothing for two weeks" },
  { key: "never_activated", label: "Never activated", total: "neverActivated", hint: "No finalized record yet" },
  { key: "unconfirmed", label: "Unconfirmed", total: "unconfirmed", hint: "Signed up, never confirmed the e-mail" },
  { key: "new", label: "New 7d", total: "new", hint: "Created in the last seven days" },
  { key: "suspended", label: "Suspended", total: "suspended", hint: "Access switched off by an operator" },
];

/** What the database means by each reason on the minute allowance. */
export const MINUTE_REASON: Record<string, string> = {
  ok: "Can record",
  pack_only: "Recording on purchased minutes",
  past_due_grace: "Recording inside the past-due grace window",
  past_due_blocked: "Blocked: payment overdue",
  suspended: "Blocked: access suspended",
  trial_not_started: "Trial not started yet",
  trial_over: "Trial over",
  cycle_exhausted: "Cycle minutes exhausted",
  no_plan: "No plan with minutes",
};

export const FLAG_LABEL: Record<string, string> = {
  no_owner: "no owner",
  suspended: "suspended",
  past_due: "past due",
  canceling: "canceling",
  trial_active: "trial",
  trial_ending: "trial ending",
  trial_over: "trial over",
  paid: "paying",
  never_activated: "never activated",
  idle: "idle",
  unconfirmed: "unconfirmed",
  banned: "banned",
  new: "new",
};

/** Money is Brazilian even though this console speaks English to operators. */
export const formatMoney = (cents: number | null | undefined, currency: string | null | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currency || "BRL",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);

export const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString() : "—");

export const formatDateTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "—");

/** "today" / "3 d ago" / "never" — the operator reads distance, not dates. */
export function sinceDays(value: string | null | undefined): string {
  if (!value) return "never";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} d ago`;
}

/** What the renewal column says, in one place so the dialog agrees with it. */
export function renewalLabel(billing: AccountBilling): string {
  if (billing.status === "past_due") return "past due";
  if (billing.renewalDays === null) return billing.isFree === false ? "comped" : "—";
  if (billing.renewalDays < 0) return `${Math.abs(billing.renewalDays)} d overdue`;
  return `${billing.renewalDays} d`;
}

export function trialLabel(trial: AccountTrial | null, minutesRemaining: number): string {
  if (!trial) return "not started";
  if (!trial.active) return "ended";
  return `${trial.daysLeft} d · ${minutesRemaining} min`;
}
