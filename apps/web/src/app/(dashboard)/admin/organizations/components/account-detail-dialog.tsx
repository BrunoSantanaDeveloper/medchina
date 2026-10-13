"use client";

import { type Dossier, readVerdict } from "./account-dossier";
import {
  type AccountOverview,
  FLAG_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  formatSpend,
  MINUTE_REASON,
  sinceDays,
  SPEND_FEATURE,
  SUBSCRIPTION_STATUS_LABEL,
} from "./account-overview";
import { useSnackbar } from "notistack";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

import MetricBars from "@/components/product/metric-bars";
import TrendSparkline from "@/components/product/trend-sparkline";
import UsageMeter from "@/components/product/usage-meter";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiEmail from "@/icons/nexture/ni-email";
import NiPhone from "@/icons/nexture/ni-phone";
import { createClient } from "@flyee/auth/client";

/**
 * Everything the platform knows about one account, in the order an operator
 * decides in: what is standing in the way, who she is, what she pays, whether
 * the product is happening to her, and what is broken. The rest — the AI's
 * report card, consent, access, the timeline — is real but rarely the reason
 * she opened this, so it waits behind one disclosure.
 *
 * The numbers come from `admin_account_dossier` (0106) in one query; nothing
 * here recomputes them, which is what keeps this screen from disagreeing with
 * the product it describes.
 */
export default function AccountDetailDialog({
  account,
  onClose,
  actions,
}: {
  account: AccountOverview;
  onClose: () => void;
  /** Person-level actions (support access) supplied by the list, so the
   *  dossier and the row offer the same thing with the same guards. */
  actions?: React.ReactNode;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showEverything, setShowEverything] = useState(false);

  /**
   * The verdict above says "mande o link de pagamento para ela" — so the
   * footer hands it over. Copy, not open: the operator is going to paste it
   * into a message to the customer, and opening the provider's page in her
   * own browser is not that.
   */
  const copyLink = async (url: string, what: string) => {
    try {
      await navigator.clipboard.writeText(url);
      enqueueSnackbar(`${what} copiado. Cole na mensagem para ela.`, { variant: "success" });
    } catch {
      // Clipboard can be refused (permission, insecure context); opening the
      // link still lets her get at it instead of leaving her with nothing.
      window.open(url, "_blank", "noreferrer");
    }
  };

  const paymentUrl = dossier?.money.failedCharges.invoiceUrl ?? dossier?.money.openCheckout?.url ?? null;
  const paymentLabel = dossier?.money.failedCharges.invoiceUrl ? "Link da fatura" : "Link do checkout";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await createClient().rpc("admin_account_dossier", { target_org: account.orgId });
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else setDossier(data as Dossier);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [account.orgId]);

  const { owner, billing, trial, minutes, attribution } = account;
  const verdict = dossier ? readVerdict(dossier, account.flags, trial?.daysLeft ?? null) : null;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box className="flex flex-col">
          <Typography variant="h5" component="span">
            {owner?.name ?? "Sem responsável"}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {owner?.email ?? "sem e-mail"} · {account.name}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-5 pt-1">
          <Box className="flex flex-row flex-wrap gap-1">
            {account.flags.map((flag) => (
              <Chip key={flag} label={FLAG_LABEL[flag] ?? flag} size="small" variant="outlined" />
            ))}
            {dossier?.identity.staffAccount && (
              <Chip label="conta interna" size="small" color="warning" variant="outlined" />
            )}
          </Box>

          {/* What to do about this account, before the data that justifies it. */}
          {verdict && (
            <Alert severity={verdict.blocker ? "warning" : "success"} className="neutral bg-background-paper/60!">
              <Typography variant="body2" className="text-text-primary">
                {verdict.blocker ?? "Nada está travando esta conta."}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {verdict.action}
              </Typography>
            </Alert>
          )}

          {loadError ? (
            // A dossier that failed to load is an error, never a thin account.
            <Alert severity="error" className="neutral bg-background-paper/60!">
              Não foi possível carregar o detalhe desta conta: {loadError}
            </Alert>
          ) : !dossier ? (
            <Box className="flex min-h-40 items-center gap-3">
              <CircularProgress size={20} aria-label="Carregando" />
              <Typography variant="body2" className="text-text-secondary">
                Lendo tudo o que esta conta guarda…
              </Typography>
            </Box>
          ) : (
            <>
              <Section title="Quem ela é">
                <Row label="Nome" value={owner?.name ?? "—"} />
                <Row
                  label="Título e registro"
                  value={
                    owner?.registration || owner?.title
                      ? [owner?.title, owner?.registration].filter(Boolean).join(" · ")
                      : "não preenchido — todo documento que ela emite sai sem credencial"
                  }
                />
                <Row
                  label="E-mail"
                  value={
                    owner?.email ? (
                      <a href={`mailto:${owner.email}`} className="text-primary">
                        {owner.email}
                      </a>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row
                  label="E-mail confirmado"
                  value={owner?.confirmed ? "sim" : "não — o cadastro nunca foi concluído"}
                />
                <Row
                  label="Telefone (consultório)"
                  value={
                    dossier.identity.billingPhone ? (
                      <a href={`tel:${dossier.identity.billingPhone}`} className="text-primary">
                        {dossier.identity.billingPhone}
                      </a>
                    ) : (
                      "não informado"
                    )
                  }
                />
                <Row
                  label="CPF/CNPJ"
                  value={
                    dossier.identity.fiscalId ?? "não consta — o provedor de pagamento não cria uma cliente sem ele"
                  }
                />
                <Row
                  label="Pronta para o checkout"
                  value={
                    dossier.identity.checkoutReady
                      ? "sim — CPF/CNPJ, CEP e número do endereço estão todos no cadastro"
                      : `não — falta ${[
                          !dossier.identity.fiscalId ? "CPF/CNPJ" : null,
                          !dossier.identity.postalCodeOnFile ? "CEP" : null,
                          !dossier.identity.addressNumberOnFile ? "número do endereço" : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}`
                  }
                />
                <Row label="Modalidades" value={listOf(dossier.identity.modalities)} />
                {/* Free text she typed (0119). Shown apart because it is not the
                    same kind of answer: the five above shape the plan and the
                    library, these only say who she is. */}
                <Row label="Outras modalidades" value={listOf(dossier.identity.modalitiesOther ?? null)} />
                <Row label="Áreas" value={listOf(dossier.identity.areas)} />
                <Row
                  label="Começou por"
                  value={
                    dossier.identity.onboarding?.track
                      ? `a trilha "${dossier.identity.onboarding.track}"${dossier.identity.onboarding.completedAt ? ", concluída" : ", nunca concluída"}`
                      : "nenhuma escolha de início registrada"
                  }
                />
                <Row
                  label="E-mail de ciclo de vida"
                  value={
                    dossier.identity.lifecycleEmailOptOut
                      ? "descadastrada — a automação de trial e uso fica muda para ela"
                      : "recebendo"
                  }
                />
                <Row
                  label="Consultório"
                  value={`${account.name} · ${account.slug} · criado em ${formatDate(account.createdAt)} · ${account.timezone ?? "sem fuso"}${dossier.identity.timezoneConfirmed ? "" : " (nunca confirmado)"}`}
                />
                <Row label="Id do consultório" value={account.orgId} />
              </Section>

              <Section title="Dinheiro">
                <Row
                  label="Plano"
                  value={`${billing.planName ?? "nenhuma assinatura em andamento"}${billing.status ? ` · ${SUBSCRIPTION_STATUS_LABEL[billing.status] ?? billing.status}` : ""}${
                    billing.isFree === false && !billing.providerManaged ? " · cortesia, ninguém é cobrado" : ""
                  }`}
                />
                <Row
                  label="Total já pago"
                  value={
                    dossier.money.payments > 0
                      ? `${formatMoney(dossier.money.lifetimePaidCents, dossier.money.currency)} em ${dossier.money.payments} pagamento${dossier.money.payments === 1 ? "" : "s"}${
                          dossier.money.refundedCents > 0
                            ? ` · ${formatMoney(dossier.money.refundedCents, dossier.money.currency)} estornado`
                            : ""
                        }`
                      : billing.isFree === false
                        ? "cortesia — nunca cobrada"
                        : "nunca cobrada"
                  }
                />
                <Row
                  label="Pagando desde"
                  value={
                    dossier.money.payingSince
                      ? `${formatDate(dossier.money.payingSince)}${dossier.money.daysToFirstPayment !== null ? ` · ${dossier.money.daysToFirstPayment} d após o cadastro` : ""}`
                      : "—"
                  }
                />
                <Row
                  label="Renova"
                  value={
                    billing.currentPeriodEnd
                      ? `${formatDate(billing.currentPeriodEnd)}${billing.renewalDays !== null ? ` (em ${billing.renewalDays} d)` : ""}`
                      : billing.isFree === false
                        ? "sem data de renovação — um plano cortesia conta por mês do calendário"
                        : "—"
                  }
                />
                {billing.cancelAtPeriodEnd && <Row label="Cancelamento" value="marcado para o fim do período" />}
                {dossier.money.failedCharges.count > 0 && (
                  <Row
                    label="Cobrança falhando"
                    value={
                      <>
                        {dossier.money.failedCharges.count} em aberto desde{" "}
                        {formatDate(dossier.money.failedCharges.since)}
                        {dossier.money.failedCharges.invoiceUrl ? (
                          <>
                            {" · "}
                            <a
                              href={dossier.money.failedCharges.invoiceUrl}
                              className="text-primary"
                              target="_blank"
                              rel="noreferrer"
                            >
                              link de pagamento
                            </a>
                          </>
                        ) : null}
                      </>
                    }
                  />
                )}
                {dossier.money.openCheckout && (
                  <Row
                    label="Checkout em aberto"
                    value={
                      <>
                        {dossier.money.openCheckout.planName}, abandonado há {dossier.money.openCheckout.ageDays} d
                        {dossier.money.openCheckout.url ? (
                          <>
                            {" · "}
                            <a
                              href={dossier.money.openCheckout.url}
                              className="text-primary"
                              target="_blank"
                              rel="noreferrer"
                            >
                              link aberto
                            </a>
                          </>
                        ) : null}
                      </>
                    }
                  />
                )}
                {dossier.money.coupon && (
                  <Row
                    label="Cupom"
                    value={`${dossier.money.coupon.code} (${dossier.money.coupon.value} ${dossier.money.coupon.type})`}
                  />
                )}
                <Row
                  label="No provedor"
                  value={
                    dossier.money.providerCustomerId
                      ? `${billing.provider ?? "provedor"} · cliente ${dossier.money.providerCustomerId}`
                      : "sem registro no provedor"
                  }
                />
                {dossier.money.offers.length > 0 && (
                  <Row
                    label="Ofertas de conversão"
                    value={dossier.money.offers.map((offer) => `${offer.trigger}: ${offer.state}`).join(" · ")}
                  />
                )}
                {dossier.money.invoices.length > 0 && (
                  // The concatenation threw away every invoiceUrl — while the
                  // verdict above tells the operator to send the payment link.
                  <Row
                    label="Últimas faturas"
                    value={
                      <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                        {dossier.money.invoices.slice(0, 4).map((invoice, index) => (
                          <Box component="li" key={`${invoice.at}-${index}`} className="flex flex-row gap-2">
                            <span className="tabular-nums">{formatDate(invoice.at)}</span>
                            <span className="tabular-nums">
                              {formatMoney(invoice.amountCents, dossier.money.currency)}
                            </span>
                            <span className="text-text-secondary">{invoice.status}</span>
                            {invoice.invoiceUrl && (
                              <a href={invoice.invoiceUrl} className="text-primary" target="_blank" rel="noreferrer">
                                abrir
                              </a>
                            )}
                          </Box>
                        ))}
                      </Box>
                    }
                  />
                )}
                <Row
                  label="Custo de IA (30 d)"
                  value={(() => {
                    const spend = dossier.ai.spend;
                    // The database can be older than this page: the app ships
                    // through CI and the migrations are applied by hand, so
                    // there is always a window where 0117 has not run yet.
                    if (!spend) return "medição de custo ainda não instalada neste banco";
                    const cost = account.aiCost?.cents30d ?? null;
                    const revenue = account.billing.monthlyCents ?? 0;
                    if (spend.window.lifetimeCalls === 0) return "nenhuma chamada registrada";
                    const headline = `${formatSpend(spend.window.costUsdMicros, spend.usdToBrl)} em ${spend.window.calls} chamada(s)`;
                    // The margin only when both halves are in the same
                    // currency — see formatSpend and migration 0116.
                    if (cost === null || revenue === 0) return headline;
                    return (
                      <Typography
                        variant="body2"
                        component="span"
                        className={revenue - cost < 0 ? "text-accent-3" : "text-text-primary"}
                      >
                        {headline} · margem {formatMoney(revenue - cost, account.billing.currency)}
                      </Typography>
                    );
                  })()}
                />
              </Section>

              <Section title="Ela está usando">
                <Row
                  label="Ativação"
                  value={`primeiro paciente ${
                    dossier.usage.daysToFirstPatient !== null
                      ? `${dossier.usage.daysToFirstPatient} d após o cadastro`
                      : "nunca"
                  } · primeiro atendimento finalizado ${
                    dossier.usage.daysToFirstRecord !== null
                      ? `${dossier.usage.daysToFirstRecord} d após o cadastro`
                      : "nunca"
                  }`}
                />
                <Row
                  label="Pacientes"
                  value={`${dossier.usage.activePatients} ativas · ${dossier.usage.archivedPatients} arquivadas`}
                />
                {/* Six counters in one sentence made the reader divide in
                    their head, and `inProgress` never even reached the screen.
                    Migration 0106 warns that merging "rascunho" with
                    "aguardando revisão" hides WHICH SIDE is stuck, so the two
                    queues carry different tones: terracotta is our pile, and
                    the hint says whose move it is. */}
                <Box className="py-1">
                  <Typography variant="body2" className="text-text-secondary mb-2">
                    Atendimentos
                  </Typography>
                  <MetricBars
                    spacing="dense"
                    items={[
                      { key: "finalized", label: "Finalizados", value: dossier.usage.funnel.finalized },
                      {
                        key: "awaiting",
                        label: "Esperando revisão dela",
                        hint: "a pilha que a IA preparou",
                        value: dossier.usage.funnel.awaitingReview,
                        tone: "attention",
                      },
                      {
                        key: "draft",
                        label: "Rascunhos dela",
                        hint: "parados com a profissional",
                        value: dossier.usage.funnel.draft,
                        tone: "secondary",
                      },
                      { key: "in-progress", label: "Em atendimento agora", value: dossier.usage.funnel.inProgress },
                      { key: "scheduled", label: "Agendados", value: dossier.usage.funnel.scheduled },
                      { key: "cancelled", label: "Cancelados", value: dossier.usage.funnel.cancelled, tone: "empty" },
                    ]}
                  />
                </Box>
                {dossier.usage.oldestOpenRecordDays !== null && (
                  <Row label="Atendimento aberto mais antigo" value={`${dossier.usage.oldestOpenRecordDays} d`} />
                )}
                <Row
                  label="Como os atendimentos nascem"
                  value={`${dossier.usage.recordsFromAudio} do áudio · ${dossier.usage.recordsTyped} digitados à mão`}
                />
                <Row
                  label="Gravações"
                  value={`${dossier.usage.recordings.total} no total · ${dossier.usage.recordings.ready} prontas · ${dossier.usage.recordings.modeAi} com IA, ${dossier.usage.recordings.modeAudioOnly} só áudio · última ${sinceDays(dossier.usage.recordings.lastAt)}`}
                />
                <Row
                  label="Capturado em"
                  value={
                    Object.keys(dossier.usage.captureSurface).length > 0
                      ? Object.entries(dossier.usage.captureSurface)
                          .map(([surface, count]) => `${surface} ${count}`)
                          .join(" · ")
                      : "nada capturado ainda"
                  }
                />
                <Row
                  label="Aplicativo companheiro"
                  value={
                    dossier.usage.mobileDevices.count > 0
                      ? `${dossier.usage.mobileDevices.count} dispositivo (${dossier.usage.mobileDevices.platforms.join(", ")}) · visto ${sinceDays(dossier.usage.mobileDevices.lastSeenAt)}`
                      : "nunca instalado"
                  }
                />
                {/* The same meter the professional sees on her own screen
                    (audio-usage-card), on the same numbers: "vai bater o teto
                    antes do fim do ciclo?" is a proportion, and it was being
                    asked of a three-clause sentence. A meter of 0 of 0 is
                    noise, though: an account with no allowance has no
                    proportion to show, only a reason. */}
                {minutes.limit <= 0 ? (
                  <Row label="Minutos" value={MINUTE_REASON[minutes.reason] ?? minutes.reason} />
                ) : (
                  <Box className="py-1">
                    <Typography variant="body2" className="text-text-secondary mb-2">
                      Minutos do ciclo
                    </Typography>
                    <UsageMeter
                      ariaLabel="Minutos do ciclo"
                      headline={`${minutes.used} de ${minutes.limit} min usados neste ciclo (${minutes.percent}%)`}
                      caption={`${MINUTE_REASON[minutes.reason] ?? minutes.reason} · ${
                        dossier.usage.minutes.lifetimeCycle + dossier.usage.minutes.lifetimePack
                      } min desde sempre${
                        dossier.usage.minutes.perFinalizedRecord !== null
                          ? ` · ${dossier.usage.minutes.perFinalizedRecord} min por atendimento`
                          : ""
                      }`}
                      segments={[
                        {
                          key: "used",
                          label: "Usados",
                          value: minutes.used,
                          display: `${minutes.used} min`,
                          // Amber past 80%, never red: a commercial ceiling is
                          // not clinical risk (same rule as the audio meter).
                          tone: minutes.percent >= 80 ? "attention" : "primary",
                        },
                        {
                          key: "remaining",
                          label: "Restantes",
                          value: Math.max(0, minutes.remaining),
                          display: `${minutes.remaining} min`,
                          tone: "empty",
                        },
                      ]}
                    />
                  </Box>
                )}
                {/* Eight weeks of recordings were printed as "3 · 5 · 4 · 6".
                    The `idle` flag only fires at 14 days; the slope shows the
                    slide three weeks earlier, which is when a call still
                    changes the outcome.

                    The RPC's last bucket is the CURRENT week, still running
                    (0106: generate_series(7, 0, -1), oldest first). Charting
                    it would compare a partial week against whole ones and
                    invent a drop every single time, so the trend is drawn on
                    complete weeks only and the week in progress is stated in
                    words instead. */}
                {(() => {
                  const weeks = dossier.usage.weeklyRecordings ?? [];
                  const complete = weeks.slice(0, -1);
                  const current = weeks.at(-1) ?? 0;
                  if (complete.length < 2) return null;
                  return (
                    <Box className="py-1">
                      <TrendSparkline
                        label="Gravações por semana"
                        data={complete}
                        plotType="bar"
                        caption={`Sete semanas completas, da mais antiga à mais recente — passe o mouse para ler cada uma. A semana em curso, com ${current}, ainda não entra na comparação.`}
                      />
                    </Box>
                  );
                })()}
                <Row
                  label="Documentos"
                  value={`${dossier.usage.documents.issued} emitidos · ${dossier.usage.documents.revoked} revogados · ${dossier.usage.shareLinks.created} links de compartilhamento, abertos ${dossier.usage.shareLinks.totalOpens}×`}
                />
                <Row label="Adendos escritos" value={String(dossier.usage.addenda)} />
              </Section>

              <Section title="Algo quebrado">
                {isBroken(dossier) ? (
                  <>
                    <Row
                      label="Gravações com falha"
                      value={`${dossier.broken.failedRecordings30d} em 30 dias · ${dossier.broken.failedRecordingsTotal} desde sempre${
                        Object.keys(dossier.broken.failureStages).length > 0
                          ? ` · ${Object.entries(dossier.broken.failureStages)
                              .map(([stage, count]) => `${stage} ${count}`)
                              .join(", ")}`
                          : ""
                      }`}
                    />
                    {dossier.broken.lastFailure && (
                      <Row
                        label="Última falha"
                        value={
                          <Box component="span" className="font-mono">
                            {formatDateTime(dossier.broken.lastFailure.at)} ·{" "}
                            {dossier.broken.lastFailure.errorCode ?? "sem código"}
                            {dossier.broken.lastFailure.message ? ` · ${dossier.broken.lastFailure.message}` : ""}
                          </Box>
                        }
                      />
                    )}
                    {dossier.broken.stuckProcessing.count > 0 && (
                      <Row
                        label="Travadas no processamento"
                        value={`${dossier.broken.stuckProcessing.count} com o lease vencido · até ${dossier.broken.stuckProcessing.maxAttempts} tentativas`}
                      />
                    )}
                    {dossier.broken.strandedUploads > 0 && (
                      <Row
                        label="Uploads órfãos"
                        value={`${dossier.broken.strandedUploads} entregues, e nada os pegou`}
                      />
                    )}
                    {dossier.broken.audioDeletionPending.count > 0 && (
                      <Row
                        label="Exclusão de áudio pendente"
                        value={`${dossier.broken.audioDeletionPending.count} desde ${formatDate(dossier.broken.audioDeletionPending.oldest)}`}
                      />
                    )}
                    {dossier.money.checkout.failed90d > 0 && (
                      <Row
                        label="Falhas de checkout (90 d)"
                        value={`${dossier.money.checkout.failed90d}${dossier.money.checkout.lastError ? ` · última: ${dossier.money.checkout.lastError}` : ""}`}
                      />
                    )}
                    {dossier.broken.imports.length > 0 && (
                      <Row
                        label="Importações"
                        value={dossier.broken.imports
                          .map((batch) => `${batch.kind} ${batch.status}${batch.revertedAt ? " (revertida)" : ""}`)
                          .join(" · ")}
                      />
                    )}
                  </>
                ) : (
                  <Typography variant="body2" className="text-text-secondary">
                    Nada quebrado: nenhuma gravação com falha ou travada, nenhum áudio órfão, nenhum checkout com falha,
                    nenhuma exclusão pendente.
                  </Typography>
                )}
              </Section>

              {!showEverything ? (
                <Button variant="text" onClick={() => setShowEverything(true)}>
                  Ver o veredito da IA e no que o custo dela foi gasto, consentimento, acesso e linha do tempo
                </Button>
              ) : (
                <>
                  <Section title="A IA funciona para ela">
                    <Row
                      label="Biblioteca"
                      value={
                        dossier.ai.library?.unlimited
                          ? "ilimitada neste plano"
                          : `${String(dossier.ai.library?.used ?? 0)} de ${String(dossier.ai.library?.limit ?? "—")} mensagens neste mês`
                      }
                    />
                    <Row
                      label="Hábito na biblioteca"
                      value={
                        dossier.ai.libraryLedger.lastAt
                          ? `${dossier.ai.libraryLedger.viaApp} no app · ${dossier.ai.libraryLedger.viaMcp} pelo conector · ativa em ${dossier.ai.libraryLedger.activeMonths} mês(es) · última ${sinceDays(dossier.ai.libraryLedger.lastAt)}`
                          : "nunca perguntou nada à biblioteca"
                      }
                    />
                    {/* How the professional JUDGED the AI — the only honest
                        measure of clinical quality the platform has. As a
                        sentence nobody computed the ratio; as shares of what
                        she reviewed, "ela corrige tudo" is visible at once. */}
                    <Box className="py-1">
                      <Typography variant="body2" className="text-text-secondary mb-2">
                        Anamnese a partir do áudio — {dossier.ai.anamnesis.fromAudio} campos preenchidos
                      </Typography>
                      <MetricBars
                        spacing="dense"
                        total={dossier.ai.anamnesis.fromAudio || undefined}
                        items={[
                          {
                            key: "kept",
                            label: "Aceitos como vieram",
                            value: Math.max(
                              0,
                              dossier.ai.anamnesis.fromAudio -
                                dossier.ai.anamnesis.edited -
                                dossier.ai.anamnesis.rejected,
                            ),
                          },
                          {
                            key: "edited",
                            label: "Que ela corrigiu",
                            value: dossier.ai.anamnesis.edited,
                            tone: "secondary",
                          },
                          {
                            key: "rejected",
                            label: "Que ela descartou",
                            value: dossier.ai.anamnesis.rejected,
                            tone: "attention",
                          },
                        ]}
                      />
                    </Box>
                    <Box className="py-1">
                      <Typography variant="body2" className="text-text-secondary mb-2">
                        Hipóteses — {dossier.ai.hypotheses.total} preparadas, {dossier.ai.hypotheses.awaitingReview}{" "}
                        ainda sem revisão
                        {dossier.ai.hypotheses.withoutLibrary > 0
                          ? `, ${dossier.ai.hypotheses.withoutLibrary} sem a biblioteca`
                          : ""}
                      </Typography>
                      <MetricBars
                        spacing="dense"
                        items={[
                          { key: "accepted", label: "Aceitas", value: dossier.ai.hypotheses.accepted },
                          { key: "edited", label: "Editadas", value: dossier.ai.hypotheses.edited, tone: "secondary" },
                          {
                            key: "rejected",
                            label: "Rejeitadas",
                            value: dossier.ai.hypotheses.rejected,
                            tone: "attention",
                          },
                        ]}
                      />
                    </Box>
                    <Row
                      label="Planos terapêuticos"
                      value={`${dossier.ai.plans.ai} rascunhados pela IA (${dossier.ai.plans.aiValidated} validados) · ${dossier.ai.plans.manual} escritos à mão`}
                    />
                    <Row
                      label="Revisões de caso"
                      value={`${dossier.ai.caseReviews.total} conversas, ${dossier.ai.caseReviews.aboutAPatient} sobre uma paciente`}
                    />
                    <Row
                      label="Protocolos dela"
                      value={`${dossier.ai.ownProtocols.total} carregados (${dossier.ai.ownProtocols.ready} prontos, ${dossier.ai.ownProtocols.failed} com falha)`}
                    />
                    <Row
                      label="Paywall do raciocínio"
                      value={`vista ${dossier.ai.reasoningPaywall.viewed}× · clicada ${dossier.ai.reasoningPaywall.clicked}×`}
                    />
                    {Object.keys(dossier.ai.usageAlerts).length > 0 && (
                      <Row
                        label="Alertas de cota"
                        value={Object.entries(dossier.ai.usageAlerts)
                          .map(([meter, alert]) => `${meter} ${alert.maxThreshold}% (${sinceDays(alert.lastAt)})`)
                          .join(" · ")}
                      />
                    )}
                  </Section>

                  {/* The other half of "is the AI earning its cost here": the
                      cost. Split by what the money bought, with the units
                      beside it, because the only way to argue with a provider
                      invoice is to have the tokens and the seconds. */}
                  <Section title="O que a IA custou aqui">
                    {(() => {
                      const spend = dossier.ai.spend;
                      if (!spend) {
                        return (
                          <Typography variant="body2" className="text-text-secondary">
                            Este banco ainda não tem a medição de custo (migrações 0115 a 0117). Aplique-as para que o
                            gasto desta conta apareça aqui.
                          </Typography>
                        );
                      }
                      const rate = spend.usdToBrl;
                      const revenue = account.billing.monthlyCents ?? 0;
                      const cost = account.aiCost?.cents30d ?? null;

                      if (spend.window.lifetimeCalls === 0) {
                        return (
                          <Typography variant="body2" className="text-text-secondary">
                            Nenhuma chamada de IA registrada para esta conta. Ou ela não usa, ou o gasto é anterior ao
                            início da medição.
                          </Typography>
                        );
                      }

                      const bars = spend.byFeature
                        .filter((line) => line.costUsdMicros > 0)
                        .map((line) => ({
                          key: line.feature,
                          label: `${SPEND_FEATURE[line.feature] ?? line.feature} · ${formatSpend(line.costUsdMicros, rate)}`,
                          value: line.costUsdMicros,
                          tone: line.feature === "transcription" ? ("primary" as const) : ("secondary" as const),
                        }));

                      return (
                        <>
                          <Row
                            label="Custo (30 d)"
                            value={`${formatSpend(spend.window.costUsdMicros, rate)} em ${spend.window.calls} chamada(s)`}
                          />
                          <Row
                            label="Desde o início"
                            value={`${formatSpend(spend.window.lifetimeCostUsdMicros, rate)} em ${spend.window.lifetimeCalls} chamada(s) · primeira ${formatDate(spend.window.firstAt)} · última ${sinceDays(spend.window.lastAt)}`}
                          />
                          {/* Only when BOTH halves are known. A margin against
                              an unconverted dollar figure would be arithmetic
                              on two different currencies. */}
                          {cost !== null && revenue > 0 && (
                            <Row
                              label="Margem no mês"
                              value={
                                <Typography
                                  variant="body2"
                                  component="span"
                                  className={revenue - cost < 0 ? "text-accent-3" : "text-text-primary"}
                                >
                                  {formatMoney(revenue - cost, account.billing.currency)} — ela paga{" "}
                                  {formatMoney(revenue, account.billing.currency)} e a IA dela custou{" "}
                                  {formatMoney(cost, account.billing.currency)}
                                </Typography>
                              }
                            />
                          )}
                          {cost === null && revenue > 0 && (
                            <Row
                              label="Margem no mês"
                              value="não dá para calcular sem a cotação do dólar no catálogo de preços"
                            />
                          )}

                          {bars.length > 0 && (
                            <Box className="py-1">
                              <Typography variant="body2" className="text-text-secondary mb-2">
                                Em que foi gasto, nos últimos 30 dias
                              </Typography>
                              <MetricBars spacing="dense" items={bars} total={spend.window.costUsdMicros} />
                            </Box>
                          )}

                          {/* The units behind each line. A cost is arguable;
                              300 minutes of audio and 40.000 tokens are facts. */}
                          {spend.byFeature.map((line) => (
                            <Row
                              key={line.feature}
                              label={SPEND_FEATURE[line.feature] ?? line.feature}
                              value={[
                                formatSpend(line.costUsdMicros, rate),
                                `${line.calls} chamada(s)`,
                                line.audioSeconds > 0 ? `${Math.round(line.audioSeconds / 60)} min de áudio` : null,
                                line.tokensIn > 0 || line.tokensOut > 0
                                  ? `${line.tokensIn.toLocaleString("pt-BR")} tokens entrada · ${line.tokensOut.toLocaleString("pt-BR")} saída`
                                  : null,
                                line.unpricedCalls > 0 ? `${line.unpricedCalls} sem preço` : null,
                                line.estimatedCalls > 0 ? `${line.estimatedCalls} estimada(s)` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            />
                          ))}

                          {spend.byModel.length > 0 && (
                            <Row
                              label="Modelos"
                              value={spend.byModel
                                .map(
                                  (line) =>
                                    `${line.model} ${formatSpend(line.costUsdMicros, rate)}${line.priced ? "" : " (sem preço)"}`,
                                )
                                .join(" · ")}
                            />
                          )}

                          {/* Six months, so a cost that doubled has a shape.
                              The current month is partial by definition and is
                              charted anyway here — unlike the weekly recording
                              trend, this is money already spent, not a rate
                              being compared against whole periods. */}
                          {/* Two months with spend is the floor for a trend:
                              a single bar among five zeros is a chart of
                              nothing, and the account'''s total already says
                              what that one month cost. */}
                          {spend.monthly.filter((month) => month.costUsdMicros > 0).length >= 2 && (
                            <Box className="py-1">
                              <TrendSparkline
                                label="Custo por mês"
                                data={spend.monthly.map((month) => month.costUsdMicros)}
                                plotType="bar"
                                formatValue={(value) => formatSpend(value, rate)}
                                caption={`Seis meses, do mais antigo ao atual (${spend.monthly.map((month) => month.month).join(", ")}). O mês corrente ainda está correndo.`}
                              />
                            </Box>
                          )}

                          {(spend.window.unpricedCalls > 0 || spend.window.estimatedCalls > 0) && (
                            <Typography variant="body2" className="text-accent-3">
                              {spend.window.unpricedCalls > 0
                                ? `${spend.window.unpricedCalls} chamada(s) sem preço configurado — o gasto existiu e não está somado acima. `
                                : ""}
                              {spend.window.estimatedCalls > 0
                                ? `${spend.window.estimatedCalls} lançamento(s) são estimativa a partir dos segundos gravados, não medição do provedor.`
                                : ""}
                            </Typography>
                          )}
                        </>
                      );
                    })()}
                  </Section>

                  <Section title="Consentimento e risco">
                    <Row
                      label="Pacientes autorizadas"
                      value={`${dossier.consent.clearedForAudio} para gravação · ${dossier.consent.clearedForAi} para processamento por IA · de ${dossier.consent.activePatients} ativas`}
                    />
                    <Row
                      label="Quem manifestou"
                      value={`${dossier.consent.signedByPatient} assinados pela paciente · ${dossier.consent.declaredByProfessional} declarados pela profissional`}
                    />
                    <Row label="Finalidades recusadas" value={String(dossier.consent.refusals)} />
                    <Row
                      label="Sessões de consentimento por QR"
                      value={`${dossier.consent.qrSessions.completed} concluídas de ${dossier.consent.qrSessions.total}${
                        dossier.consent.qrSessions.pending > 0
                          ? ` · ${dossier.consent.qrSessions.pending} em aberto`
                          : ""
                      }`}
                    />
                    <Row
                      label="Áudio sob consentimento revogado"
                      value={
                        dossier.consent.audioUnderRevokedConsent > 0
                          ? `${dossier.consent.audioUnderRevokedConsent} — apague hoje`
                          : "nenhum"
                      }
                    />
                    <Row
                      label="Pedidos de exclusão de pacientes"
                      value={
                        dossier.consent.erasureRequests.count > 0
                          ? `${dossier.consent.erasureRequests.count} pendentes, o mais antigo ${formatDate(dossier.consent.erasureRequests.oldest)}`
                          : "nenhum"
                      }
                    />
                    <Row label="Retenção de áudio" value={dossier.identity.audioRetention ?? "—"} />
                    <Row
                      label="Exportações completas"
                      value={
                        dossier.consent.exports.last
                          ? `${dossier.consent.exports.count} pedidas · última ${dossier.consent.exports.last.status} em ${formatDate(dossier.consent.exports.last.requestedAt)}${
                              dossier.consent.exports.last.lastDownloadedAt ? ", baixada" : ", nunca baixada"
                            }`
                          : "nunca exportou o consultório"
                      }
                    />
                  </Section>

                  <Section title="Acesso e suporte">
                    <Row
                      label="Acessos"
                      value={
                        dossier.access.trailAvailable
                          ? `${dossier.access.signIns.total} no total · ${dossier.access.signIns.last30d} em 30 dias · último ${sinceDays(dossier.access.signIns.lastAt)}`
                          : "nenhuma trilha registrada"
                      }
                    />
                    <Row
                      label="Senha"
                      value={`${dossier.identity.hasPassword ? "definida" : "sem senha (login social)"}${
                        dossier.identity.recoverySentAt
                          ? ` · e-mail de redefinição enviado ${sinceDays(dossier.identity.recoverySentAt)}`
                          : ""
                      }`}
                    />
                    {dossier.identity.emailChangePending && (
                      <Row label="Troca de e-mail" value="aguardando confirmação" />
                    )}
                    <Row
                      label="2FA"
                      value={
                        dossier.access.mfa.verified > 0
                          ? `${dossier.access.mfa.verified} fator(es) verificado(s)`
                          : dossier.access.mfa.unverified > 0
                            ? "cadastro começado e abandonado"
                            : "não cadastrado"
                      }
                    />
                    <Row
                      label="Visitas de suporte"
                      value={
                        dossier.access.supportVisits.count > 0
                          ? `${dossier.access.supportVisits.count} · última por ${dossier.access.supportVisits.lastActor ?? "desconhecida"} ${sinceDays(dossier.access.supportVisits.lastAt)}`
                          : "nunca visitada"
                      }
                    />
                    <Row label="Conta criada em" value={formatDateTime(dossier.identity.userCreatedAt)} />
                  </Section>

                  <Section title="Origem">
                    {attribution ? (
                      <>
                        <Row label="Origem" value={attribution.origem ?? "—"} />
                        <Row label="Onda" value={attribution.onda ?? "—"} />
                        <Row label="Origem UTM" value={attribution.utmSource ?? "—"} />
                        <Row label="Campanha UTM" value={attribution.utmCampaign ?? "—"} />
                        <Row label="Página de entrada" value={attribution.landingPath ?? "—"} />
                      </>
                    ) : (
                      <Typography variant="body2" className="text-text-secondary">
                        Nenhuma atribuição registrada — a conta é anterior ao rastreio de cadastro, ou chegou sem dados
                        de campanha.
                      </Typography>
                    )}
                  </Section>

                  <Section title="Últimas 20 ações">
                    {dossier.timeline.length === 0 ? (
                      <Typography variant="body2" className="text-text-secondary">
                        Nada auditado neste consultório ainda.
                      </Typography>
                    ) : (
                      dossier.timeline.map((entry, index) => (
                        <Row
                          key={`${entry.at}-${index}`}
                          label={formatDateTime(entry.at)}
                          value={
                            <Box component="span" className="font-mono">
                              {entry.action}
                            </Box>
                          }
                        />
                      ))
                    )}
                  </Section>
                </>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      {/* The dossier used to end here with "Fechar" as its only primary
          action — after telling the operator, in the imperative, to send a
          payment link or to call. Every prescription the verdict can make now
          has a button, and closing is demoted to what it is. */}
      <DialogActions className="flex-wrap justify-end gap-1">
        {paymentUrl && (
          <Button
            variant="contained"
            color="primary"
            startIcon={<NiClipboard size="medium" />}
            onClick={() => copyLink(paymentUrl, paymentLabel)}
          >
            Copiar link de pagamento
          </Button>
        )}
        {dossier?.identity.billingPhone && (
          <Button
            variant="outlined"
            color="primary"
            startIcon={<NiPhone size="medium" />}
            href={`tel:${dossier.identity.billingPhone}`}
          >
            Ligar
          </Button>
        )}
        {owner?.email && (
          <Button
            variant="outlined"
            color="primary"
            startIcon={<NiEmail size="medium" />}
            href={`mailto:${owner.email}`}
          >
            E-mail
          </Button>
        )}
        {actions}
        <Button variant="text" color="grey" onClick={onClose}>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const listOf = (values: string[] | null | undefined) =>
  values && values.length > 0 ? values.join(", ") : "não declarado";

const isBroken = (dossier: Dossier) =>
  dossier.broken.failedRecordings30d > 0 ||
  dossier.broken.stuckProcessing.count > 0 ||
  dossier.broken.strandedUploads > 0 ||
  dossier.broken.audioDeletionPending.count > 0 ||
  dossier.broken.audioDeletionErrors > 0 ||
  dossier.money.checkout.failed90d > 0 ||
  dossier.broken.imports.some((batch) => batch.status === "failed");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box className="flex flex-col gap-2">
      <Typography variant="subtitle2" className="text-text-primary">
        {title}
      </Typography>
      <Box className="flex flex-col gap-1">{children}</Box>
    </Box>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box className="flex flex-row flex-wrap items-baseline gap-2">
      <Typography variant="body2" className="text-text-secondary w-48 shrink-0">
        {label}
      </Typography>
      <Typography variant="body2" component="span" className="text-text-primary min-w-0 flex-1 break-words">
        {value}
      </Typography>
    </Box>
  );
}
