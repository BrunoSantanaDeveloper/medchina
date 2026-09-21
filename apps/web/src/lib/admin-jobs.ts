import "server-only";

import { notifyUsers } from "@/lib/notifications";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { sendAdminAccountsDigestEmail } from "@flyee/email";
import { inngest } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The platform operator's daily watch over the account book.
 *
 * The accounts console (0104) answers "which account needs me today?" — but
 * only for someone who opens it. A Pro trial ends on its own schedule and an
 * overdue payment does not wait for anybody's routine, so the answer travels
 * to the operator instead: one bell notification plus one e-mail, only when
 * there is something to decide, only once a day.
 *
 * It reads the SAME query the console renders (as the service role, which
 * 0104 lets in explicitly — a cron has no session), so the digest can never
 * describe a state the screen would contradict.
 */

/** 08:30 in São Paulo (UTC-3): the start of a working day, not the night. */
const CRON = "30 11 * * *";

/** A trial that ended is news for two days; after that it is a statistic. */
const TRIAL_ENDED_NEWS_HOURS = 48;

/**
 * A scheduled cancellation is the one state on this list where a phone call
 * still changes the outcome — but `cancel_at_period_end` stays true from the
 * request until the period actually ends, which on a yearly plan is up to a
 * year. Reporting the flag itself would mail the same account every morning
 * for months, and a digest that repeats stops being read. So report it only
 * while the deadline is close enough to act on, exactly as `trial_ending`
 * limits itself to its last three days.
 */
const CANCELING_WINDOW_DAYS = 7;

/** Enough of the overview to decide; the console has the rest. */
type WatchedAccount = {
  orgId: string;
  name: string;
  owner: { name: string | null; email: string | null } | null;
  billing: { planName: string | null; pastDueSince: string | null; renewalDays: number | null };
  trial: { endsAt: string; daysLeft: number } | null;
  minutes: { remaining: number };
  flags: string[];
};

export type WatchOutcome = {
  /** Operators who received a NEW notification (the digest's idempotency). */
  notified: number;
  accounts: number;
  emailed: number;
  reason?: string;
  error?: string;
};

const hoursSince = (iso: string | null | undefined) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;

/** The account as a human would name it: the professional, then her practice. */
const describe = (account: WatchedAccount) => `${account.owner?.name ?? "sem responsável"} · ${account.name}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function summarizeWatch(trialEnding: number, pastDue: number, trialEnded: number, canceling = 0): string {
  const parts = [
    trialEnding > 0 ? plural(trialEnding, "trial terminando", "trials terminando") : null,
    pastDue > 0 ? plural(pastDue, "conta inadimplente", "contas inadimplentes") : null,
    trialEnded > 0 ? plural(trialEnded, "trial encerrado", "trials encerrados") : null,
    canceling > 0 ? plural(canceling, "cancelamento marcado", "cancelamentos marcados") : null,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return "Nenhuma conta pede atenção hoje";
  if (parts.length === 1) return `${parts[0]} hoje`;
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]} hoje`;
}

export async function watchAccounts(supabase: SupabaseClient): Promise<WatchOutcome> {
  const { data, error } = await supabase.rpc("admin_accounts_overview");
  if (error) return { notified: 0, accounts: 0, emailed: 0, error: error.message };

  const accounts = ((data as { accounts?: WatchedAccount[] } | null)?.accounts ?? []).filter(Boolean);
  const trialEnding = accounts.filter((account) => account.flags.includes("trial_ending"));
  const pastDue = accounts.filter((account) => account.flags.includes("past_due"));
  // "Trial over" stays true until she converts, so only a FRESH one is news —
  // otherwise the same account would be reported every morning forever.
  const trialEnded = accounts.filter(
    (account) => account.flags.includes("trial_over") && hoursSince(account.trial?.endsAt) <= TRIAL_ENDED_NEWS_HOURS,
  );
  // Past due is reported on its own line already, and it is the more urgent
  // reason; an account that is both would otherwise appear twice in one mail.
  const canceling = accounts.filter(
    (account) =>
      account.flags.includes("canceling") &&
      !account.flags.includes("past_due") &&
      account.billing.renewalDays !== null &&
      account.billing.renewalDays >= 0 &&
      account.billing.renewalDays <= CANCELING_WINDOW_DAYS,
  );

  const items = [
    ...trialEnding.map((account) => ({
      account: describe(account),
      detail: `Trial Pro termina em ${plural(account.trial?.daysLeft ?? 0, "dia", "dias")} — ${account.minutes.remaining} min restantes`,
    })),
    ...pastDue.map((account) => ({
      account: describe(account),
      detail: `Pagamento em atraso${
        account.billing.pastDueSince
          ? ` desde ${new Date(account.billing.pastDueSince).toLocaleDateString("pt-BR")}`
          : ""
      } (${account.billing.planName ?? "sem plano"})`,
    })),
    ...trialEnded.map((account) => ({
      account: describe(account),
      detail: "Trial Pro terminou e a conta não converteu",
    })),
    ...canceling.map((account) => ({
      account: describe(account),
      detail: `Pediu cancelamento e o acesso termina em ${plural(account.billing.renewalDays ?? 0, "dia", "dias")} (${account.billing.planName ?? "sem plano"})`,
    })),
  ];

  // No "all clear" digest: an alert that arrives every day stops being read.
  if (items.length === 0) return { notified: 0, accounts: 0, emailed: 0, reason: "nothing-to-report" };

  const { data: operators, error: operatorError } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_superadmin", true);
  if (operatorError) return { notified: 0, accounts: items.length, emailed: 0, error: operatorError.message };

  const operatorIds = (operators ?? []).map((row) => row.id as string);
  if (operatorIds.length === 0) return { notified: 0, accounts: items.length, emailed: 0, reason: "no-operator" };

  const headline = summarizeWatch(trialEnding.length, pastDue.length, trialEnded.length, canceling.length);
  // Most urgent first; the tile keys are validated against ACCOUNT_FILTERS
  // by the console, so a new key here has to exist there too.
  const filter =
    trialEnding.length > 0
      ? "trial_ending"
      : pastDue.length > 0
        ? "past_due"
        : canceling.length > 0
          ? "canceling"
          : "trial_over";
  const href = `/admin/organizations?filter=${filter}`;

  const bell = await notifyUsers(operatorIds, {
    type: "billing",
    title: headline,
    body: items
      .slice(0, 3)
      .map((item) => `${item.account}: ${item.detail}`)
      .join(" · "),
    href,
    // One digest per operator per day, whatever happens to the cron.
    sourceKey: `admin-watch:${new Date().toISOString().slice(0, 10)}`,
  });

  // The bell's key is the fence for the whole digest: an operator who already
  // has today's row must not receive today's e-mail a second time.
  let emailed = 0;
  for (const operatorId of bell.createdFor ?? []) {
    const { data: operator } = await supabase.auth.admin.getUserById(operatorId);
    const to = operator?.user?.email;
    if (!to) continue;
    const sent = await sendAdminAccountsDigestEmail(to, {
      headline,
      // The mail points; the console decides.
      items: items.slice(0, 8),
      appUrl: `${BRAND.siteUrl}${href}`,
    });
    if (sent.sent) emailed += 1;
  }

  return { notified: bell.created ?? 0, accounts: items.length, emailed };
}

export const adminAccountWatchFunction = inngest.createFunction(
  { id: "admin-account-watch", retries: 1, concurrency: { limit: 1 } },
  { cron: CRON },
  async ({ step }) =>
    step.run("watch-accounts", async () => {
      return watchAccounts(createServiceClient());
    }),
);

export const adminFunctions = [adminAccountWatchFunction];
