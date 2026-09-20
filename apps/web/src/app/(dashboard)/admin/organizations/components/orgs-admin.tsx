"use client";

import AccountDetailDialog from "./account-detail-dialog";
import {
  ACCOUNT_FILTERS,
  type AccountOverview,
  type AccountsOverview,
  type AccountTotals,
  FLAG_LABEL,
  formatDate,
  formatMoney,
  renewalLabel,
  sinceDays,
  SUBSCRIPTION_STATUS_LABEL,
  trialLabel,
} from "./account-overview";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import NiBuilding from "@/icons/nexture/ni-building";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiUsers from "@/icons/nexture/ni-users";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type AccountRow = AccountOverview & { id: string };
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
  const [totals, setTotals] = useState<AccountTotals | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detail, setDetail] = useState<AccountRow | null>(null);
  const [suspending, setSuspending] = useState<{ account: AccountRow; suspend: boolean } | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);
  const { enqueueSnackbar } = useSnackbar();
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

  const columns = useMemo<GridColDef<AccountRow>[]>(
    () => [
      {
        field: "account",
        headerName: "Conta",
        flex: 2,
        minWidth: 240,
        valueGetter: (_, row) => searchTextOf(row),
        renderCell: (params: GridRenderCellParams<AccountRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.owner?.name ?? "Sem responsável"}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.owner?.email ?? "sem e-mail"} · {params.row.name}
            </Typography>
          </Box>
        ),
      },
      {
        // Plan and status read as one fact ("Pro · active"). Measured on the
        // real screen: as two columns they pushed the kill-switch and the
        // kebab off a 1680px viewport. Suspended/canceling live in Signals.
        field: "plan",
        headerName: "Plano",
        minWidth: 190,
        valueGetter: (_, row) => `${row.billing.planName ?? "sem assinatura"} ${statusTextOf(row)}`,
        renderCell: (params: GridRenderCellParams<AccountRow, string>) => (
          <Box className="flex h-full flex-row flex-wrap items-center gap-1">
            <Chip label={params.row.billing.planName ?? "sem assinatura"} size="small" variant="outlined" />
            {params.row.billing.status && (
              <Chip
                label={SUBSCRIPTION_STATUS_LABEL[params.row.billing.status] ?? params.row.billing.status}
                size="small"
                color={STATUS_COLOR[params.row.billing.status] ?? "default"}
                variant="outlined"
                className="first-letter:uppercase"
              />
            )}
            {/* A plan an operator gave away has no provider behind it (0067). */}
            {params.row.billing.isFree === false && !params.row.billing.providerManaged && (
              <Chip label="cortesia" size="small" color="warning" variant="outlined" />
            )}
          </Box>
        ),
      },
      {
        // Numeric so the operator can sort by "who renews next"; the cell
        // still reads in words.
        field: "renewal",
        headerName: "Renovação",
        type: "number",
        minWidth: 110,
        valueGetter: (_, row) => row.billing.renewalDays,
        renderCell: (params: GridRenderCellParams<AccountRow, number>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body2" className="text-text-primary">
              {renewalLabel(params.row.billing)}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.billing.currentPeriodEnd ? formatDate(params.row.billing.currentPeriodEnd) : ""}
            </Typography>
          </Box>
        ),
      },
      {
        field: "trial",
        headerName: "Trial Pro",
        type: "number",
        minWidth: 120,
        valueGetter: (_, row) => (row.trial?.active ? row.trial.daysLeft : null),
        renderCell: (params: GridRenderCellParams<AccountRow, number>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-primary">
              {trialLabel(params.row.trial, params.row.minutes.remaining)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "use",
        headerName: "Uso (30 d)",
        minWidth: 150,
        // The searchable value must read like the cell: "records" was English
        // in an otherwise pt-BR console, so the word on screen found nothing.
        valueGetter: (_, row) =>
          `${row.usage.finalized30d} atendimentos ${row.usage.minutes30d} min ${row.usage.patients} pacientes`,
        renderCell: (params: GridRenderCellParams<AccountRow, string>) => (
          <Box className="flex h-full flex-col justify-center">
            <Typography variant="body2" className="text-text-primary">
              {params.row.usage.finalized30d} atendimentos · {params.row.usage.minutes30d} min
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.usage.patients} pacientes · ativa {sinceDays(params.row.usage.lastActivityAt)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "signals",
        headerName: "Sinais",
        minWidth: 190,
        sortable: false,
        valueGetter: (_, row) => row.flags.map((flag) => FLAG_LABEL[flag] ?? flag).join(" "),
        // Three at most, so a busy row stays one line and nothing renders
        // half-cut; the detail dialog carries the full set.
        renderCell: (params: GridRenderCellParams<AccountRow, string>) => (
          <Box className="flex h-full flex-row flex-wrap items-center gap-1">
            {params.row.flags
              .filter((flag) => flag !== "paid")
              .slice(0, 3)
              .map((flag) => (
                <Chip
                  key={flag}
                  label={FLAG_LABEL[flag] ?? flag}
                  size="small"
                  variant="outlined"
                  color={flag === "past_due" || flag === "banned" ? "error" : "default"}
                />
              ))}
          </Box>
        ),
      },
      {
        // The audited kill-switch on paid capability. It stays visible on the
        // row, never buried in the kebab — but the header says what it really
        // governs: it was called "Acesso" and does not touch access.
        field: "access",
        headerName: "Recursos pagos",
        minWidth: 140,
        type: "boolean",
        valueGetter: (_, row) => Boolean(row.billing.subscriptionId && !row.billing.suspended),
        renderCell: (params: GridRenderCellParams<AccountRow, boolean>) => {
          const { billing } = params.row;
          if (!billing.subscriptionId) return null;
          const suspended = Boolean(billing.suspended);
          const label = suspended
            ? `Reativar os recursos pagos de ${params.row.name}`
            : `Suspender os recursos pagos de ${params.row.name} — ela continua entrando e lendo o prontuário`;
          return (
            <Box className="flex h-full items-center">
              <Tooltip title={label}>
                <Switch
                  checked={!suspended}
                  disabled={suspendingId === params.row.orgId}
                  onChange={() => setSuspending({ account: params.row, suspend: !suspended })}
                  size="small"
                  slotProps={{ input: { "aria-label": label } }}
                />
              </Tooltip>
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
        getActions: (params) => [
          <GridActionsCellItem
            key="detail"
            icon={<NiEyeOpen size="medium" />}
            label="Detalhe da conta"
            onClick={() => setDetail(params.row)}
            showInMenu
          />,
          <GridActionsCellItem
            key="members"
            icon={<NiUsers size="medium" />}
            label="Ver membros"
            onClick={() => openMembers(params.row)}
            showInMenu
          />,
        ],
      },
    ],
    [openMembers, suspendingId],
  );

  const visibleRows = useMemo(
    () => (filter === "all" ? rows : rows.filter((row) => row.flags.includes(filter))),
    [rows, filter],
  );
  const roster = membersOrg ? members[membersOrg.orgId] : undefined;
  const activeFilter = ACCOUNT_FILTERS.find((entry) => entry.key === filter);

  return (
    <Box className="flex flex-col gap-4">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {/* What the account book adds up to. Not a filter — the state of the
          business, counted by the same query as the rows below. */}
      {totals && (
        <Box className="border-divider bg-background-paper flex flex-row flex-wrap items-center gap-8 rounded-lg border px-4 py-3">
          <Stat
            label="MRR"
            value={formatMoney(totals.mrrCents, totals.currency)}
            hint="O que os provedores cobram por mês; plano anual normalizado para um mês"
          />
          <Stat
            label="Em risco"
            value={formatMoney(totals.atRiskMrrCents, totals.currency)}
            hint="Em atraso no provedor ou marcado para cancelar no fim do período"
          />
          <Stat
            label="Cortesia"
            value={formatMoney(totals.compedMrrCents, totals.currency)}
            hint="Planos pagos concedidos pelo console: capacidade dada, nunca contada como receita"
          />
        </Box>
      )}

      {/* Where to look today, before the list of everything. Each tile is the
          count the same query produced, and clicking it filters the table. */}
      <Box className="flex flex-row flex-wrap gap-2">
        {ACCOUNT_FILTERS.map((entry) => {
          const active = filter === entry.key;
          return (
            <Box
              key={entry.key}
              component="button"
              type="button"
              aria-pressed={active}
              title={entry.hint}
              onClick={() => setFilter(entry.key)}
              className={`flex min-w-32 cursor-pointer flex-col items-start rounded-lg border px-3 py-2 text-left ${
                active ? "border-primary bg-primary/5" : "border-divider bg-background-paper"
              }`}
            >
              <Typography variant="h5" component="span" className={active ? "text-primary" : "text-text-primary"}>
                {totals ? totals[entry.total] : "—"}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {entry.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<AccountRow>
          rows={visibleRows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            filter === "all" ? (
              <EmptyState
                icon={<NiBuilding size="medium" />}
                title="Nenhuma conta ainda"
                description="Todo cadastro cria um consultório e aparece aqui, com plano, trial e uso."
                className="border-none"
              />
            ) : (
              <Box className="flex h-full flex-col items-center justify-center gap-2">
                <Typography variant="body2" className="text-text-secondary">
                  Nenhuma conta em &quot;{activeFilter?.label ?? "este filtro"}&quot; agora.
                </Typography>
                <Button variant="text" onClick={() => setFilter("all")}>
                  Ver todas as contas
                </Button>
              </Box>
            )
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma conta corresponde à busca.
            </Typography>
          }
        />
      )}

      {generatedAt && (
        <Typography variant="caption" className="text-text-secondary">
          Planos, trials e uso conforme {new Date(generatedAt).toLocaleString()}.
        </Typography>
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

      {detail && <AccountDetailDialog account={detail} onClose={() => setDetail(null)} />}
    </Box>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <Box className="flex flex-col">
        <Typography variant="h5" component="span" className="text-text-primary">
          {value}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
}
