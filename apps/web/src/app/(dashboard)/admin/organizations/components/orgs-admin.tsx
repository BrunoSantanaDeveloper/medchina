"use client";

import { listUserAdminInfo, type UserAdminInfo } from "../actions";
import AccountDetailDialog from "./account-detail-dialog";
import {
  ACCOUNT_FILTERS,
  type AccountCountKey,
  type AccountOverview,
  type AccountsOverview,
  type AccountTotals,
  clockLabel,
  costMeasured,
  FLAG_LABEL,
  formatDate,
  formatMoney,
  formatSpend,
  renewalLabel,
  sinceDays,
  SPEND_FEATURE,
  SUBSCRIPTION_STATUS_LABEL,
  trialLabel,
} from "./account-overview";
import { usePersonActions } from "./person-actions";
import PersonWithoutWorkspaceDialog, {
  CAUSE_LABEL,
  type PeopleWithoutWorkspace,
  type PersonWithoutWorkspace,
} from "./person-without-workspace";
import Link from "next/link";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import MetricBars from "@/components/product/metric-bars";
import { type TileTone } from "@/components/product/tile-tone";
import NiArrowOutRight from "@/icons/nexture/ni-arrow-out-right";
import NiBuilding from "@/icons/nexture/ni-building";
import NiClock from "@/icons/nexture/ni-clock";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiPause from "@/icons/nexture/ni-pause";
import NiPower from "@/icons/nexture/ni-power";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiRocket from "@/icons/nexture/ni-rocket";
import NiUsers from "@/icons/nexture/ni-users";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type AccountRow = AccountOverview & { id: string };

/**
 * The platform's AI bill for the window (migration 0115).
 *
 * A second query beside the account list on purpose: this one includes spend
 * that belongs to NO account — the operator's own /admin/insights questions,
 * shared-library ingestion — which by definition cannot appear in a list of
 * accounts. The per-account totals and the cost filters still come from the
 * account query, so a tile can never disagree with the rows under it.
 */
type SpendOverview = {
  windowDays: number;
  since: string;
  measuringSince: string | null;
  usdToBrl: number | null;
  pricedModels: number;
  totals: {
    costUsdMicros: number;
    calls: number;
    unpricedCalls: number;
    estimatedCalls: number;
    audioSeconds: number;
    accountCostUsdMicros: number;
    platformCostUsdMicros: number;
    accountsWithSpend: number;
  };
  byFeature: { feature: string; costUsdMicros: number; calls: number; unpricedCalls: number }[];
  byModel: { provider: string; model: string; costUsdMicros: number; calls: number; priced: boolean }[];
  topAccounts: { orgId: string; name: string; costUsdMicros: number; calls: number }[];
};

/**
 * One row for either kind of subject the operator searches for.
 *
 * A console that lists ORGANIZATIONS cannot show a professional who has none
 * — and she is precisely the "me cadastrei e não consigo usar" call. Rather
 * than a hollow account with invented zeros, the row carries whichever
 * subject it is and the few display fields both share, so the cells stay
 * simple and nothing is faked.
 */
type GridRow = {
  id: string;
  kind: "workspace" | "person";
  title: string;
  subtitle: string;
  searchText: string;
  flags: string[];
  account: AccountRow | null;
  person: PersonWithoutWorkspace | null;
};
type MemberRow = { userId: string; role: string; displayName: string; joinedAt: string };

/** A roster that failed to load must never render as a roster that is empty:
 *  "este consultório não tem membros" was being stated on a discarded error. */
type MemberState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; rows: MemberRow[] };

/** The membership role enum as the operator reads it. */
const ROLE_LABEL: Record<string, string> = {
  owner: "responsável",
  admin: "administradora",
  member: "membro",
};

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  active: "success",
  trialing: "warning",
  past_due: "error",
};

/** Which signal earns the scarce space on the row, most urgent first. */
/**
 * The four tiles that open the screen, in lifecycle order: the charge broke,
 * she asked to leave, the window is closing, she never got value. The first
 * three are exactly what the daily digest mails about (lib/admin-jobs.ts), so
 * the console and the e-mail cannot disagree about what needs attention.
 *
 * Terracotta (accent-3) is the repo's colour for a commercial problem; red
 * stays reserved for clinical risk. Every key here must exist in
 * ACCOUNT_FILTERS, which is what validates the `?filter=` in the URL.
 */
const HEADLINE_TILES: {
  key: string;
  total: AccountCountKey;
  label: string;
  hint: string;
  tone: TileTone;
  icon: typeof NiCreditCard;
}[] = [
  {
    key: "past_due",
    total: "pastDue",
    label: "Inadimplentes",
    hint: "O provedor não conseguiu cobrar",
    tone: "accent-3",
    icon: NiCreditCard,
  },
  {
    key: "canceling",
    total: "canceling",
    label: "Cancelando",
    hint: "Pediu para encerrar no fim do período",
    tone: "accent-4",
    icon: NiArrowOutRight,
  },
  {
    key: "trial_ending",
    total: "trialEnding",
    label: "Trial acabando",
    hint: "Trial Pro com três dias ou menos",
    tone: "secondary",
    icon: NiClock,
  },
  {
    key: "never_activated",
    total: "neverActivated",
    label: "Nunca ativou",
    hint: "Nenhum atendimento finalizado",
    tone: "primary",
    icon: NiRocket,
  },
];

/** Everything else stays reachable, as one exclusive control below the tiles. */
const HEADLINE_KEYS = new Set(HEADLINE_TILES.map((tile) => tile.key));
const SECONDARY_FILTERS = ACCOUNT_FILTERS.filter((entry) => !HEADLINE_KEYS.has(entry.key));

const FLAG_SEVERITY: Record<string, number> = {
  banned: 0,
  past_due: 1,
  no_workspace: 2,
  suspended: 3,
  canceling: 4,
  no_owner: 5,
  trial_ending: 6,
  unconfirmed: 7,
  never_activated: 8,
  idle: 9,
  trial_over: 10,
  trial_active: 11,
  new: 12,
};

const bySeverity = (a: string, b: string) => (FLAG_SEVERITY[a] ?? 50) - (FLAG_SEVERITY[b] ?? 50);

/** The account flags plus the ones only a person without a workspace has. */
const ROW_FLAG_LABEL: Record<string, string> = { ...FLAG_LABEL, no_workspace: "sem consultório", ...CAUSE_LABEL };

/** Everything scanned or searched must be reachable as a cell VALUE. */
const searchTextOf = (row: AccountRow) =>
  [row.name, row.slug, row.owner?.name, row.owner?.email, row.owner?.registration].filter(Boolean).join(" ");

const statusTextOf = (row: AccountRow) =>
  [
    SUBSCRIPTION_STATUS_LABEL[row.billing.status ?? ""] ?? row.billing.status ?? "sem assinatura",
    row.billing.suspended ? "suspensa" : null,
    row.billing.cancelAtPeriodEnd ? "cancelando" : null,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * The platform operator's account book. The job here genuinely is scan and
 * compare many accounts — but the question is never "list the rows", it is
 * "which account needs me today?". So the tiles come first (they are filters,
 * counted by the same query as the rows), every row says WHO the account is
 * rather than only what the workspace was named, and the numbers a decision
 * hangs on — days to renewal, days of trial left, days since anyone worked —
 * are on the row instead of two clicks away.
 */
export default function OrgsAdmin() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [people, setPeople] = useState<PeopleWithoutWorkspace | null>(null);
  const [personDetail, setPersonDetail] = useState<PersonWithoutWorkspace | null>(null);
  const [totals, setTotals] = useState<AccountTotals | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detail, setDetail] = useState<AccountRow | null>(null);
  const [suspending, setSuspending] = useState<{ account: AccountRow; suspend: boolean } | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);
  /** Mirrors the quick filter so the page can phrase its own empty state and
   *  let a search reach past the active tile. */
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // Auth-side facts about the OWNER, so this grid can offer the same escalated
  // actions the professionals tab has. Without them the menu would offer
  // "redefinir 2FA" to someone with no factor and "excluir" to a superadmin —
  // the action-without-fact class the confirmations were built to remove.
  const [selfId, setSelfId] = useState<string | null>(null);
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);
  const [authInfo, setAuthInfo] = useState<Record<string, UserAdminInfo>>({});
  const [superadminIds, setSuperadminIds] = useState<Set<string>>(() => new Set());
  const { enqueueSnackbar } = useSnackbar();
  const [spend, setSpend] = useState<SpendOverview | null>(null);
  const [membersOrg, setMembersOrg] = useState<AccountRow | null>(null);
  const [members, setMembers] = useState<Record<string, MemberState>>({});
  // Mirrors which rosters loaded SUCCESSFULLY, so the column defs stay stable
  // and a failed read can still be retried (it used to be marked as fetched
  // before the request, which made the failure permanent until remount).
  const fetchedMembers = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const supabase = createClient();
    // One query for identity, plan, trial, minutes, usage and origin: the
    // browser cannot drift from the database by recomputing any of it.
    const { data, error: rpcError } = await supabase.rpc("admin_accounts_overview");
    if (rpcError) {
      setError(rpcError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    const overview = data as AccountsOverview;
    setRows((overview.accounts ?? []).map((account) => ({ ...account, id: account.orgId })));
    setTotals(overview.totals);
    setGeneratedAt(overview.generatedAt);
    setLoadFailed(false);
    setLoaded(true);

    const [{ data: auth }, roles, info, orphans] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("id").eq("is_superadmin", true),
      listUserAdminInfo(),
      // Migration 0108. Deliberately its own query and its own payload key:
      // folded into `accounts` it would change what `totals.accounts` means
      // and make the nightly digest report the same person every morning
      // forever (being workspace-less is a permanent condition).
      supabase.rpc("admin_people_without_workspace"),
    ]);
    if (!orphans.error) setPeople(orphans.data as PeopleWithoutWorkspace);
    // The bill for the same 30 days the rows describe. A failure here leaves
    // the panel out rather than the list: knowing who needs a phone call does
    // not depend on knowing what the month cost.
    const bill = await supabase.rpc("admin_ai_spend_overview", { window_days: 30 });
    if (!bill.error) setSpend(bill.data as SpendOverview);
    setSelfId(auth.user?.id ?? null);
    setSuperadminIds(new Set((roles.data ?? []).map((row) => row.id as string)));
    if (info.ok) {
      setServiceAvailable(true);
      setAuthInfo(Object.fromEntries(info.data.map((entry) => [entry.id, entry])));
    } else {
      setServiceAvailable(info.error === "not-configured" ? false : null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The daily operator digest links straight to the group it is about
  // (/admin/organizations?filter=trial_ending), so the alert lands on the
  // three accounts it named instead of on the whole book. Read after mount:
  // the first render must match the server's, which knows no query string.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("filter");
    if (requested && ACCOUNT_FILTERS.some((entry) => entry.key === requested)) setFilter(requested);
  }, []);

  /** Picking a tile writes it back to the URL, so the view survives a reload
   *  and can be pasted to the other operator — the digest already links this
   *  way, and the console could only receive such a link, never make one. */
  const selectFilter = useCallback((key: string) => {
    setFilter(key);
    const params = new URLSearchParams(window.location.search);
    if (key === "all") params.delete("filter");
    else params.set("filter", key);
    const search = params.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }, []);

  const { buildItems, dialogs, canImpersonate, openImpersonation } = usePersonActions({
    selfId,
    serviceAvailable,
    onChanged: refresh,
  });

  const loadMembers = useCallback(async (orgId: string) => {
    setMembers((current) => ({ ...current, [orgId]: { status: "loading" } }));
    const supabase = createClient();
    // Named apart from the component's `error` state so it cannot shadow it —
    // the previous version discarded this value entirely.
    const { data, error: membersError } = await supabase
      .from("memberships")
      .select("user_id, role, created_at, profiles(display_name)")
      .eq("org_id", orgId)
      .order("created_at");
    if (membersError) {
      setMembers((current) => ({ ...current, [orgId]: { status: "error", message: membersError.message } }));
      return;
    }
    fetchedMembers.current.add(orgId);
    setMembers((current) => ({
      ...current,
      [orgId]: {
        status: "ok",
        rows: (data ?? []).map((row) => ({
          userId: row.user_id,
          role: row.role,
          displayName:
            (row.profiles as unknown as { display_name: string | null } | null)?.display_name ??
            "Profissional sem nome",
          joinedAt: row.created_at,
        })),
      },
    }));
  }, []);

  const openMembers = useCallback(
    async (account: AccountRow) => {
      setMembersOrg(account);
      if (fetchedMembers.current.has(account.orgId)) return;
      await loadMembers(account.orgId);
    },
    [loadMembers],
  );

  /**
   * The superadmin kill-switch on the live subscription — and it is NOT a
   * kill-switch on access. Writing `admin_suspended` only closes the gates
   * that read it: AI recording, hypotheses/plan/summary, the library chat,
   * data import, the MCP connectors and any purchase. Login, the app, the
   * patients and the clinical record are governed by membership RLS
   * (0020_clinical.sql) and keep working. Cutting off entry is the ban, on
   * the other tab.
   *
   * It now goes through a confirmation that spells both halves out, and the
   * reason lands in the audit metadata — the trail recorded who and when, and
   * nothing at all about why.
   */
  const applySuspension = useCallback(
    async (account: AccountRow, suspend: boolean, reason: string): Promise<string | null> => {
      const subscriptionId = account.billing.subscriptionId;
      if (!subscriptionId) return "Esta conta não tem assinatura viva para suspender.";
      setError(null);
      setSuspendingId(account.orgId);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ admin_suspended: suspend })
        .eq("id", subscriptionId);
      if (updateError) {
        setSuspendingId(null);
        return updateError.message;
      }
      recordAudit(supabase, suspend ? "admin.org.suspended" : "admin.org.reactivated", {
        orgId: account.orgId,
        entityType: "subscription",
        entityId: subscriptionId,
        metadata: { org: account.name, reason },
      });
      enqueueSnackbar(
        suspend
          ? `Recursos pagos de ${account.name} suspensos. Ela continua entrando e lendo o prontuário.`
          : `Recursos pagos de ${account.name} reativados.`,
        { variant: "success" },
      );
      await refresh();
      setSuspendingId(null);
      return null;
    },
    [enqueueSnackbar, refresh],
  );

  const columns = useMemo<GridColDef<GridRow>[]>(
    () => [
      {
        field: "account",
        headerName: "Conta",
        flex: 2,
        minWidth: 260,
        valueGetter: (_, row) => row.searchText,
        renderCell: (params: GridRenderCellParams<GridRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.title}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.subtitle}
            </Typography>
          </Box>
        ),
      },
      {
        // Plan, status and the nearest deadline as ONE column. As three
        // (Plano 190 + Renovação 110 + Trial 120 = 420px) they were the single
        // biggest reason the grid needed ~1.690px of viewport to fit, while
        // the widest it ever gets to use is ~932px at 1440.
        field: "plan",
        headerName: "Plano e prazo",
        minWidth: 200,
        valueGetter: (_, row) =>
          row.account
            ? `${row.account.billing.planName ?? "sem assinatura"} ${statusTextOf(row.account)} ${clockLabel(row.account.billing, row.account.trial)}`
            : "sem consultório",
        renderCell: (params: GridRenderCellParams<GridRow, string>) => {
          const account = params.row.account;
          // Nothing invented for a person with no workspace: there is no plan
          // and no cycle, so the cell says so instead of showing a zero.
          if (!account) {
            return (
              <Box className="flex h-full items-center">
                <Typography variant="body2" className="text-text-secondary">
                  —
                </Typography>
              </Box>
            );
          }
          return (
            <Box className="flex h-full flex-col justify-center gap-0.5">
              <Box className="flex flex-row flex-wrap items-center gap-1">
                <Chip label={account.billing.planName ?? "sem assinatura"} size="small" variant="outlined" />
                {account.billing.status && (
                  <Chip
                    label={SUBSCRIPTION_STATUS_LABEL[account.billing.status] ?? account.billing.status}
                    size="small"
                    color={STATUS_COLOR[account.billing.status] ?? "default"}
                    variant="outlined"
                    className="first-letter:uppercase"
                  />
                )}
                {/* A plan an operator gave away has no provider behind it (0067). */}
                {account.billing.isFree === false && !account.billing.providerManaged && (
                  <Chip label="cortesia" size="small" color="warning" variant="outlined" />
                )}
              </Box>
              <Typography variant="body2" className="text-text-secondary truncate">
                {clockLabel(account.billing, account.trial)}
              </Typography>
            </Box>
          );
        },
      },
      {
        // Kept for sorting by "who renews next" and for the CSV, hidden by
        // default: the row already carries the nearest deadline in words.
        field: "renewal",
        headerName: "Renovação",
        type: "number",
        minWidth: 110,
        valueGetter: (_, row) => row.account?.billing.renewalDays ?? null,
        renderCell: (params: GridRenderCellParams<GridRow, number>) =>
          params.row.account ? (
            <Box className="flex h-full flex-col justify-center">
              <Typography variant="body2" className="text-text-primary">
                {renewalLabel(params.row.account.billing)}
              </Typography>
              <Typography variant="body2" className="text-text-secondary truncate">
                {params.row.account.billing.currentPeriodEnd
                  ? formatDate(params.row.account.billing.currentPeriodEnd)
                  : ""}
              </Typography>
            </Box>
          ) : null,
      },
      {
        field: "trial",
        headerName: "Trial Pro",
        type: "number",
        minWidth: 120,
        valueGetter: (_, row) => (row.account?.trial?.active ? row.account.trial.daysLeft : null),
        renderCell: (params: GridRenderCellParams<GridRow, number>) =>
          params.row.account ? (
            <Box className="flex h-full items-center">
              <Typography variant="body2" className="text-text-primary">
                {trialLabel(params.row.account.trial, params.row.account.minutes.remaining)}
              </Typography>
            </Box>
          ) : null,
      },
      {
        // "Nunca acessou" spelled out. As a bare date column the null rendered
        // as an empty cell, which reads as "unknown" for the single strongest
        // support signal there is: signed up and never came back.
        field: "lastSignIn",
        headerName: "Último acesso",
        type: "date",
        minWidth: 130,
        valueGetter: (_, row) => {
          const at = row.account?.owner?.lastSignInAt ?? row.person?.lastSignInAt ?? null;
          return at ? new Date(at) : null;
        },
        renderCell: (params: GridRenderCellParams<GridRow, Date | null>) => {
          const at = params.row.account?.owner?.lastSignInAt ?? params.row.person?.lastSignInAt ?? null;
          return (
            <Box className="flex h-full items-center">
              <Typography variant="body2" className={at ? "" : "text-accent-3"}>
                {at ? sinceDays(at) : "nunca acessou"}
              </Typography>
            </Box>
          );
        },
      },
      {
        field: "use",
        headerName: "Uso (30 d)",
        minWidth: 150,
        // The searchable value must read like the cell: "records" was English
        // in an otherwise pt-BR console, so the word on screen found nothing.
        valueGetter: (_, row) =>
          row.account
            ? `${row.account.usage.finalized30d} atendimentos ${row.account.usage.minutes30d} min ${row.account.usage.patients} pacientes`
            : "",
        renderCell: (params: GridRenderCellParams<GridRow, string>) => {
          const account = params.row.account;
          if (!account) {
            return (
              <Box className="flex h-full items-center">
                <Typography variant="body2" className="text-text-secondary">
                  nunca teve consultório
                </Typography>
              </Box>
            );
          }
          return (
            <Box className="flex h-full flex-col justify-center">
              <Typography variant="body2" className="text-text-primary">
                {account.usage.finalized30d} atendimentos · {account.usage.minutes30d} min
              </Typography>
              <Typography variant="body2" className="text-text-secondary truncate">
                {account.usage.patients} pacientes · ativa {sinceDays(account.usage.lastActivityAt)}
              </Typography>
            </Box>
          );
        },
      },
      {
        // The other half of every row: revenue has been here since 0104, and
        // what the account COSTS us was the number nobody could see.
        field: "aiCost",
        headerName: "Custo IA (30 d)",
        type: "number",
        minWidth: 150,
        align: "left",
        headerAlign: "left",
        // Sorted on the raw micros, not the formatted string: "R$ 0,9800"
        // sorts above "R$ 12,00" as text, and this column exists to be sorted.
        // Both hops are optional: `aiCost` is absent when the deployed
        // database predates 0116, which is what used to crash this grid.
        valueGetter: (_, row) => row.account?.aiCost?.usdMicros30d ?? 0,
        renderCell: (params: GridRenderCellParams<GridRow, number>) => {
          const cost = params.row.account?.aiCost;
          if (!cost) {
            return (
              <Box className="flex h-full items-center">
                <Typography variant="body2" className="text-text-secondary">
                  —
                </Typography>
              </Box>
            );
          }
          const rate = totals?.usdToBrl ?? null;
          const margin = cost.marginCents;
          return (
            <Box className="flex h-full flex-col justify-center">
              <Typography
                variant="body2"
                className={margin !== null && margin < 0 ? "text-accent-3 tabular-nums" : "tabular-nums"}
              >
                {formatSpend(cost.usdMicros30d, rate)}
              </Typography>
              <Typography variant="body2" className="text-text-secondary truncate">
                {cost.calls30d === 0
                  ? "nenhuma chamada"
                  : cost.unpriced30d > 0
                    ? `${cost.calls30d} chamadas · ${cost.unpriced30d} sem preço`
                    : margin !== null
                      ? `margem ${formatMoney(margin, totals?.currency)}`
                      : `${cost.calls30d} chamadas`}
              </Typography>
            </Box>
          );
        },
      },
      {
        field: "signals",
        headerName: "Sinais",
        minWidth: 160,
        sortable: false,
        // The searchable value keeps EVERY flag, including the ones the cell
        // had to drop - searching "suspensa" must find the row even when the
        // chip did not fit.
        valueGetter: (_, row) => row.flags.map((flag) => ROW_FLAG_LABEL[flag] ?? flag).join(" "),
        renderCell: (params: GridRenderCellParams<GridRow, string>) => {
          // Two at most in 160px, and the most urgent first: a row whose
          // access the operator herself cut must not hide "suspensa" behind
          // "nova" just because of the order the database returned them.
          const shown = params.row.flags.filter((flag) => flag !== "paid").sort(bySeverity);
          const extra = shown.length - 2;
          return (
            <Box className="flex h-full flex-row flex-wrap items-center gap-1">
              {shown.slice(0, 2).map((flag) => (
                <Chip
                  key={flag}
                  label={ROW_FLAG_LABEL[flag] ?? flag}
                  size="small"
                  variant="outlined"
                  color={flag === "past_due" || flag === "banned" ? "error" : "default"}
                />
              ))}
              {extra > 0 && (
                <Tooltip
                  title={shown
                    .slice(2)
                    .map((flag) => ROW_FLAG_LABEL[flag] ?? flag)
                    .join(" | ")}
                >
                  <Typography variant="body2" className="text-text-secondary">
                    +{extra}
                  </Typography>
                </Tooltip>
              )}
            </Box>
          );
        },
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => {
          const account = params.row.account;
          const person = params.row.person;
          // A person with no workspace has no dossier (`admin_account_dossier`
          // takes an org) and nothing to suspend; what she has is a cause and
          // the escalated actions, which need only a user id.
          if (person) {
            return [
              <GridActionsCellItem
                key="person"
                icon={<NiEyeOpen size="medium" />}
                label="Por que ela está sem consultório"
                onClick={() => setPersonDetail(person)}
                showInMenu
              />,
              ...buildItems({
                userId: person.userId,
                name: person.name ?? "Profissional sem nome",
                email: person.email,
                isSuperadmin: person.isSuperadmin,
                hasMfa: Boolean(authInfo[person.userId]?.hasMfa),
                banned: Boolean(person.bannedUntil && new Date(person.bannedUntil).getTime() > Date.now()),
              }),
            ];
          }
          if (!account) return [];
          const suspended = Boolean(account.billing.suspended);
          return [
            <GridActionsCellItem
              key="detail"
              icon={<NiEyeOpen size="medium" />}
              label="Detalhe da conta"
              onClick={() => setDetail(account)}
              showInMenu
            />,
            <GridActionsCellItem
              key="members"
              icon={<NiUsers size="medium" />}
              label="Ver membros"
              onClick={() => openMembers(account)}
              showInMenu
            />,
            // The kill-switch moved off the row: at 140px it was the last
            // column before the kebab, and both were the first to leave the
            // screen. It always opened a confirmation anyway, so the cost is
            // one click; the STATE stays readable as the "suspensa" signal.
            ...(account.billing.subscriptionId
              ? [
                  <GridActionsCellItem
                    key="suspend"
                    icon={suspended ? <NiPower size="medium" /> : <NiPause size="medium" />}
                    label={suspended ? "Reativar recursos pagos" : "Suspender recursos pagos"}
                    disabled={suspendingId === account.orgId}
                    onClick={() => setSuspending({ account, suspend: !suspended })}
                    showInMenu
                  />,
                ]
              : []),
            // The support actions, on the row that already NAMES the
            // professional. A call that arrives with an e-mail used to cost
            // two searches on two tabs.
            ...(account.owner
              ? buildItems({
                  userId: account.owner.userId,
                  name: account.owner.name ?? account.name,
                  email: account.owner.email,
                  isSuperadmin: superadminIds.has(account.owner.userId),
                  hasMfa: Boolean(authInfo[account.owner.userId]?.hasMfa),
                  banned: Boolean(
                    account.owner.bannedUntil && new Date(account.owner.bannedUntil).getTime() > Date.now(),
                  ),
                })
              : []),
          ];
        },
      },
    ],
    [authInfo, buildItems, openMembers, superadminIds, suspendingId, totals],
  );

  const searching = query.trim().length > 0;

  /** The two subjects, in one list. Counts stay with the query that produced
   *  them, so a tile can never disagree with the rows it filters. */
  const gridRows = useMemo<GridRow[]>(() => {
    const accounts: GridRow[] = rows.map((account) => ({
      id: account.orgId,
      kind: "workspace",
      title: account.owner?.name ?? "Sem responsável",
      subtitle: `${account.owner?.email ?? "sem e-mail"} · ${account.name}`,
      searchText: searchTextOf(account),
      flags: account.flags,
      account,
      person: null,
    }));
    const orphans: GridRow[] = (people?.people ?? []).map((person) => ({
      id: `user:${person.userId}`,
      kind: "person",
      title: person.name ?? "Profissional sem nome",
      subtitle: `${person.email ?? "sem e-mail"} · sem consultório`,
      searchText: [person.name, person.email, person.invite?.orgName].filter(Boolean).join(" "),
      // `no_workspace` first so it wins the two chips the column fits.
      flags: ["no_workspace", person.cause],
      account: null,
      person,
    }));
    return [...accounts, ...orphans];
  }, [rows, people]);

  /**
   * The database can be older than this page — the app ships through CI and
   * the migrations are applied by hand, so there is always a window where
   * 0116 has not run yet. In that window the cost payload is simply absent,
   * and every cost surface hides instead of reporting zeros.
   */
  const measured = costMeasured(totals);

  const visibleColumns = useMemo(
    () => (measured ? columns : columns.filter((column) => column.field !== "aiCost")),
    [columns, measured],
  );

  const secondaryFilters = useMemo(
    () => (measured ? SECONDARY_FILTERS : SECONDARY_FILTERS.filter((entry) => !entry.key.startsWith("ai_cost"))),
    [measured],
  );

  const visibleRows = useMemo(
    () => (searching || filter === "all" ? gridRows : gridRows.filter((row) => row.flags.includes(filter))),
    [gridRows, filter, searching],
  );
  const roster = membersOrg ? members[membersOrg.orgId] : undefined;
  const activeFilter = ACCOUNT_FILTERS.find((entry) => entry.key === filter);

  /**
   * The three money pools as ONE population: what the book is worth per month,
   * and how much of that is secured, leaving, or given away. The bars carry
   * the share, so the question "how exposed am I" is answered before a figure
   * is read.
   */
  const monthly = useMemo(() => {
    const secured = Math.max(0, totals?.mrrCents ?? 0);
    const atRisk = Math.max(0, totals?.atRiskMrrCents ?? 0);
    const comped = Math.max(0, totals?.compedMrrCents ?? 0);
    const money = (cents: number) => formatMoney(cents, totals?.currency);
    return {
      total: secured + atRisk + comped,
      items: [
        {
          key: "secured",
          label: `Garantido · ${money(secured)}`,
          value: secured,
          tone: "primary" as const,
          hint: "Cobrado todo mês pelo provedor; plano anual normalizado para um mês",
        },
        {
          key: "at-risk",
          label: `Em risco · ${money(atRisk)}`,
          value: atRisk,
          tone: "attention" as const,
          hint: "Em atraso no provedor ou marcado para cancelar no fim do período",
        },
        {
          key: "comped",
          label: `Cortesia · ${money(comped)}`,
          value: comped,
          tone: "secondary" as const,
          hint: "Plano pago concedido pelo console: capacidade dada, nunca contada como receita",
        },
      ],
    };
  }, [totals]);

  /**
   * The AI bill for the same 30 days, split by what the money bought.
   *
   * Deliberately the same shape as the revenue band above it: the two
   * questions an operator asks about a month are what came in and what went
   * out, and they should read the same way. The bars are per FEATURE rather
   * than per account — "transcrição" is a product decision, and one
   * expensive account is a phone call.
   */
  const bill = useMemo(() => {
    if (!spend) return null;
    const rate = spend.usdToBrl;
    const items = spend.byFeature
      .filter((line) => line.costUsdMicros > 0)
      .map((line) => ({
        key: line.feature,
        label: `${SPEND_FEATURE[line.feature] ?? line.feature} · ${formatSpend(line.costUsdMicros, rate)}`,
        value: line.costUsdMicros,
        tone: line.feature === "transcription" ? ("primary" as const) : ("secondary" as const),
        hint: `${line.calls} chamada(s)${line.unpricedCalls > 0 ? ` · ${line.unpricedCalls} sem preço` : ""}`,
      }));
    return {
      total: spend.totals.costUsdMicros,
      items,
      rate,
      // Everything below is a caveat the number cannot carry on its own.
      unpriced: spend.totals.unpricedCalls,
      estimated: spend.totals.estimatedCalls,
      platform: spend.totals.platformCostUsdMicros,
      accounts: spend.totals.accountsWithSpend,
      pricedModels: spend.pricedModels,
      measuringSince: spend.measuringSince,
      topModel: spend.byModel[0] ?? null,
    };
  }, [spend]);

  return (
    <Box className="flex flex-col gap-4">
      {/* Says WHY half the menu is missing, instead of letting the operator
          conclude the actions do not exist. Both states are named: not
          configured is a setup task, and a FAILED check is a failure — which
          used to render as plain absence, the one thing an error must never
          look like. */}
      {serviceAvailable === false && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          Defina SUPABASE_SERVICE_ROLE_KEY para habilitar entrar como, redefinir 2FA, bloquear/desbloquear e excluir
          conta a partir desta lista.
        </Alert>
      )}
      {serviceAvailable === null && loaded && (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={<Button onClick={refresh}>Tentar de novo</Button>}
        >
          Não foi possível consultar a autenticação agora, então entrar como, redefinir 2FA, bloquear e excluir estão
          fora do menu. Não é que a conta não permita — é que a verificação falhou.
        </Alert>
      )}

      {loaded && !loadFailed && !measured && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          O custo de IA não aparece porque este banco ainda não tem as migrações 0115 a 0117. Aplique-as (
          <code>npm run db:migrate:remote</code>) e informe os preços por modelo em{" "}
          <Link href="/admin/ai">Assistentes de IA</Link>.
        </Alert>
      )}

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* What the account book adds up to. Three money pools that describe ONE
          population — the monthly value of the book — so they belong in the
          template's Application Status block, not in a row of bare figures.
          The bars answer "how much of this is at risk" before a number is
          read; three numbers side by side made the reader divide in their
          head. */}
      {totals && (
        <Card component="section">
          <CardContent className="flex flex-col gap-4">
            <Box className="flex flex-row items-baseline justify-between gap-4">
              <Typography variant="h5" component="h2" className="card-title mb-0">
                Valor mensal da carteira
              </Typography>
              <Typography variant="body2" className="text-text-secondary tabular-nums">
                {formatMoney(monthly.total, totals.currency)}
              </Typography>
            </Box>
            {monthly.total > 0 ? (
              <MetricBars items={monthly.items} total={monthly.total} />
            ) : (
              // A meter of three empty bars says nothing and looks broken. Say
              // the fact instead: nobody is paying yet.
              <Typography variant="body2" className="text-text-secondary">
                Nenhuma conta gera receita ainda. Assim que a primeira assinatura for cobrada, a divisão entre
                garantido, em risco e cortesia aparece aqui.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {/* What the month COST, beside what it earned. The caveats are part of
          the number, not a footnote: an unpriced call is money we spent and
          cannot name, and an estimated one is history rebuilt from recorded
          seconds (migration 0115) rather than a measured bill. */}
      {bill && (
        <Card component="section">
          <CardContent className="flex flex-col gap-4">
            <Box className="flex flex-row items-baseline justify-between gap-4">
              <Typography variant="h5" component="h2" className="card-title mb-0">
                Custo de IA (30 dias)
              </Typography>
              <Typography variant="body2" className="text-text-secondary tabular-nums">
                {formatSpend(bill.total, bill.rate)}
              </Typography>
            </Box>

            {bill.pricedModels === 0 ? (
              // Zero with no price book is not a cheap month — it is a console
              // that cannot answer the question yet. Say which, and where to fix it.
              <Alert severity="info" className="neutral bg-background-paper/60!">
                Nenhum preço configurado ainda, então todo custo aparece como zero. Informe o preço por milhão de tokens
                de cada modelo em <Link href="/admin/ai">Assistentes de IA</Link> para estes números passarem a valer.
              </Alert>
            ) : bill.total > 0 ? (
              <MetricBars items={bill.items} total={bill.total} />
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                Nenhuma chamada de IA nos últimos 30 dias.
              </Typography>
            )}

            <Box className="flex flex-row flex-wrap gap-x-6 gap-y-1">
              <Typography variant="body2" className="text-text-secondary">
                {bill.accounts} conta(s) com gasto
              </Typography>
              {bill.platform > 0 && (
                <Typography variant="body2" className="text-text-secondary">
                  Plataforma (insights, biblioteca): {formatSpend(bill.platform, bill.rate)}
                </Typography>
              )}
              {bill.topModel && (
                <Typography variant="body2" className="text-text-secondary">
                  Modelo mais caro: {bill.topModel.model} ({formatSpend(bill.topModel.costUsdMicros, bill.rate)})
                </Typography>
              )}
              {bill.rate === null && bill.total > 0 && (
                <Typography variant="body2" className="text-text-secondary">
                  Valores em dólar — defina a cotação para comparar com a receita
                </Typography>
              )}
            </Box>

            {(bill.unpriced > 0 || bill.estimated > 0) && (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {bill.unpriced > 0 && (
                  <>{bill.unpriced} chamada(s) sem preço configurado — esse gasto existiu e não está somado acima. </>
                )}
                {bill.estimated > 0 && (
                  <>
                    {bill.estimated} lançamento(s) são estimativa a partir dos segundos gravados, não medição do
                    provedor.
                  </>
                )}
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Where to look today, before the list of everything. Four tiles, four
          across, in the template's stats shape (dashboards/analytics/sections/
          dashboard-analytics-stats.tsx). Eleven equal boxes, eight of them
          zero, ranked nothing: these four are the lifecycle in order — the
          charge broke, she asked to leave, the window is closing, she never
          got value. The first three are exactly what the daily digest mails
          about (lib/admin-jobs.ts), so the screen and the e-mail cannot
          disagree about what "needs attention" means. */}
      <Grid container spacing={4}>
        {HEADLINE_TILES.map((tile) => (
          <Grid key={tile.key} size={{ xs: 6, sm: 3 }}>
            <StatTile
              icon={<tile.icon size="large" />}
              tone={tile.tone}
              label={tile.label}
              hint={tile.hint}
              value={totals?.[tile.total] ?? "—"}
              pressed={filter === tile.key}
              // The filter goes to the URL so it survives a reload and can be
              // shared — the daily digest already links in this way, and until
              // now the console could only receive that link, never produce one.
              onClick={() => selectFilter(tile.key)}
            />
          </Grid>
        ))}
      </Grid>

      {/* The rest of the book, as one exclusive control instead of seven more
          boxes competing with the four above. ToggleButtonGroup is what the
          template styles for "pick one of N", and it carries the roving focus
          and the pressed state that a row of divs never had. */}
      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_, next) => next && selectFilter(next)}
        aria-label="Filtrar as contas"
        className="flex flex-row flex-wrap gap-1"
      >
        {secondaryFilters.map((entry) => (
          <ToggleButton key={entry.key} value={entry.key} title={entry.hint} className="rounded-lg! border!">
            {entry.label}
            <Typography component="span" variant="body2" className="text-text-secondary ml-2 tabular-nums">
              {totals?.[entry.total] ?? "—"}
            </Typography>
          </ToggleButton>
        ))}
        {/* Counted by its own query (migration 0108) and filtering the rows
            that same query produced, so the number and the list cannot
            disagree. Hidden when there is nobody: being workspace-less is an
            anomaly, not a category, and an always-zero entry is noise. */}
        {people && people.totals.people > 0 && (
          <ToggleButton
            value="no_workspace"
            title="Cadastraram-se e nunca tiveram um consultório — não conseguem usar o produto"
            className="rounded-lg! border!"
          >
            Sem consultório
            <Typography component="span" variant="body2" className="text-text-secondary ml-2 tabular-nums">
              {people.totals.people}
            </Typography>
          </ToggleButton>
        )}
      </ToggleButtonGroup>

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<GridRow>
          rows={visibleRows}
          columns={visibleColumns}
          loading={!loaded}
          // A workspace row opens its dossier; a person without one has no dossier
          // to open, so the row explains WHY she has no workspace instead of
          // going nowhere.
          onRowClick={(row) => (row.account ? setDetail(row.account) : row.person && setPersonDetail(row.person))}
          onQuickFilterChange={setQuery}
          // Renewal, trial and last sign-in stay defined — sortable from the
          // Columns panel — but off the default view: the row already carries
          // the nearest deadline in words, and the width budget is the binding
          // constraint at 1440.
          initialColumnVisibility={{ renewal: false, trial: false, lastSignIn: false }}
          header={
            generatedAt && (
              <Typography variant="body2" className="text-text-secondary">
                Planos, trials e uso conforme {new Date(generatedAt).toLocaleString()}.
              </Typography>
            )
          }
          actions={
            <Button
              variant="surface"
              color="grey"
              size="medium"
              startIcon={<NiRefresh size="medium" />}
              disabled={refreshing || !loaded}
              onClick={async () => {
                setRefreshing(true);
                await refresh();
                setRefreshing(false);
              }}
            >
              {refreshing ? "Atualizando…" : "Atualizar"}
            </Button>
          }
          noRowsOverlay={
            filter === "all" || searching ? (
              <EmptyState
                icon={<NiBuilding size="medium" />}
                title="Nenhuma conta ainda"
                description="Todo cadastro com nome de consultório cria um e aparece aqui, com plano, trial e uso."
                className="border-none"
              />
            ) : (
              <Box className="flex h-full flex-col items-center justify-center gap-2">
                <Typography variant="body2" className="text-text-secondary">
                  Nenhuma conta em &quot;{activeFilter?.label ?? "este filtro"}&quot; agora.
                </Typography>
                <Button variant="text" onClick={() => selectFilter("all")}>
                  Ver todas as contas
                </Button>
              </Box>
            )
          }
          noResultsOverlay={
            <Box className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <Typography variant="body2" className="text-text-secondary">
                Nenhuma conta corresponde a &quot;{query}&quot;.
              </Typography>
              {/* Say it, because the alternative is the operator assuming the
                  active tile hid the person she is looking for. */}
              <Typography variant="body2" className="text-text-secondary">
                A busca já procurou em todas as contas, não só no filtro ativo.
              </Typography>
            </Box>
          }
        />
      )}

      <Dialog open={Boolean(membersOrg)} onClose={() => setMembersOrg(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Membros de {membersOrg?.name}</DialogTitle>
        <DialogContent>
          <Box className="flex flex-col gap-3 pt-1">
            {(!roster || roster.status === "loading") &&
              // Skeletons that reserve the row height, instead of a line of
              // text that collapses the dialog and then jumps.
              [0, 1, 2].map((index) => <Skeleton key={index} variant="rounded" height={44} className="rounded-lg" />)}
            {roster?.status === "error" && (
              <Alert
                severity="error"
                className="neutral bg-background-paper/60!"
                action={<Button onClick={() => membersOrg && loadMembers(membersOrg.orgId)}>{"Tentar de novo"}</Button>}
              >
                Não foi possível ler os membros deste consultório: {roster.message}
              </Alert>
            )}
            {roster?.status === "ok" && roster.rows.length === 0 && (
              <Typography variant="body2" className="text-text-secondary">
                Este consultório não tem nenhum membro — nem responsável. É uma anomalia: toda conta nasce com uma.
              </Typography>
            )}
            {(roster?.status === "ok" ? roster.rows : []).map((member) => (
              <Box key={member.userId} className="flex flex-row items-center gap-3">
                <Box className="flex min-w-0 flex-1 flex-col">
                  <Typography variant="body1" className="text-text-primary truncate font-medium">
                    {member.displayName}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary truncate">
                    entrou em {new Date(member.joinedAt).toLocaleDateString()}
                  </Typography>
                </Box>
                <Chip
                  label={ROLE_LABEL[member.role] ?? member.role}
                  size="small"
                  variant="outlined"
                  className="first-letter:uppercase"
                />
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setMembersOrg(null)}>
            Fechar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Both halves stated: what stops, and — the half that was missing — what
          keeps working. An operator who believes "suspender" cuts access will
          tell the customer so, and be wrong. */}
      {suspending && (
        <ConfirmActionDialog
          key={`${suspending.account.orgId}-${suspending.suspend}`}
          title={
            suspending.suspend
              ? `Suspender os recursos pagos de ${suspending.account.name}?`
              : `Reativar os recursos pagos de ${suspending.account.name}?`
          }
          intro={
            suspending.suspend
              ? "Isto NÃO bloqueia o acesso dela. Para impedir que ela entre, use “Bloquear na plataforma”, na aba Profissionais."
              : undefined
          }
          consequences={
            suspending.suspend
              ? [
                  "Param na hora: gravações com IA, hipóteses, plano terapêutico e resumo, o chat da biblioteca, a importação de dados, os conectores externos (MCP) e qualquer nova compra.",
                  "Os minutos avulsos já pagos também param — a suspensão é a única coisa que eles não sobrevivem.",
                  "Se houver trial Pro disponível, ele deixa de poder ser iniciado.",
                ]
              : [
                  "Gravação com IA, biblioteca, importação, conectores e compras voltam a funcionar conforme o plano dela.",
                ]
          }
          stays={
            suspending.suspend
              ? [
                  "Ela continua entrando na conta, criando e editando pacientes, e lendo e escrevendo o prontuário.",
                  "Agenda, emissão de documentos e o acervo da biblioteca seguem funcionando — o que para é o chat sobre o acervo.",
                  "Gravar áudio sem IA continua permitido, e uma gravação já enviada termina de ser processada.",
                  "É reversível: basta religar este mesmo interruptor.",
                ]
              : undefined
          }
          confirmLabel={suspending.suspend ? "Suspender recursos pagos" : "Reativar recursos pagos"}
          tone={suspending.suspend ? "danger" : "warning"}
          reasonPlaceholder={
            suspending.suspend
              ? "Ticket 1234 — inadimplência confirmada, sem resposta há 30 dias"
              : "Ticket 1234 — pagamento confirmado"
          }
          onConfirm={(reason) => applySuspension(suspending.account, suspending.suspend, reason)}
          onClose={() => setSuspending(null)}
        />
      )}

      {detail && (
        <AccountDetailDialog
          account={detail}
          onClose={() => setDetail(null)}
          // Support access as a footer button, with the same guard the row
          // uses. The rest of the escalated set stays in the kebab: a footer
          // of red buttons invites the click it should discourage.
          actions={(() => {
            const owner = detail.owner;
            if (!owner) return null;
            const target = {
              userId: owner.userId,
              name: owner.name ?? detail.name,
              email: owner.email,
              isSuperadmin: superadminIds.has(owner.userId),
              hasMfa: Boolean(authInfo[owner.userId]?.hasMfa),
              banned: Boolean(owner.bannedUntil && new Date(owner.bannedUntil).getTime() > Date.now()),
            };
            if (!canImpersonate(target)) return null;
            return (
              <Button variant="outlined" color="primary" onClick={() => openImpersonation(target)}>
                Entrar como
              </Button>
            );
          })()}
        />
      )}

      {personDetail && (
        <PersonWithoutWorkspaceDialog
          key={personDetail.userId}
          person={personDetail}
          onClose={() => setPersonDetail(null)}
        />
      )}

      {dialogs}
    </Box>
  );
}
