"use client";

import { type Dossier, readVerdict } from "./account-dossier";
import {
  type AccountOverview,
  FLAG_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  MINUTE_REASON,
  sinceDays,
} from "./account-overview";
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
export default function AccountDetailDialog({ account, onClose }: { account: AccountOverview; onClose: () => void }) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showEverything, setShowEverything] = useState(false);

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
            {owner?.name ?? "No owner"}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {owner?.email ?? "no e-mail"} · {account.name}
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
              <Chip label="internal account" size="small" color="warning" variant="outlined" />
            )}
          </Box>

          {/* What to do about this account, before the data that justifies it. */}
          {verdict && (
            <Alert severity={verdict.blocker ? "warning" : "success"} className="neutral bg-background-paper/60!">
              <Typography variant="body2" className="text-text-primary">
                {verdict.blocker ?? "Nothing is standing in this account's way."}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {verdict.action}
              </Typography>
            </Alert>
          )}

          {loadError ? (
            // A dossier that failed to load is an error, never a thin account.
            <Alert severity="error" className="neutral bg-background-paper/60!">
              Could not load this account&apos;s detail: {loadError}
            </Alert>
          ) : !dossier ? (
            <Box className="flex min-h-40 items-center gap-3">
              <CircularProgress size={20} aria-label="Loading" />
              <Typography variant="body2" className="text-text-secondary">
                Reading everything this account holds…
              </Typography>
            </Box>
          ) : (
            <>
              <Section title="Who she is">
                <Row label="Name" value={owner?.name ?? "—"} />
                <Row
                  label="Title and registration"
                  value={
                    owner?.registration || owner?.title
                      ? [owner?.title, owner?.registration].filter(Boolean).join(" · ")
                      : "not filled in — every document she issues goes out with no credential on it"
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
                <Row label="E-mail confirmed" value={owner?.confirmed ? "yes" : "no — sign-up never completed"} />
                <Row
                  label="Phone (practice)"
                  value={
                    dossier.identity.billingPhone ? (
                      <a href={`tel:${dossier.identity.billingPhone}`} className="text-primary">
                        {dossier.identity.billingPhone}
                      </a>
                    ) : (
                      "not provided"
                    )
                  }
                />
                <Row
                  label="Fiscal identity"
                  value={
                    dossier.identity.fiscalId ??
                    "none on file — the payment provider cannot create a customer without it"
                  }
                />
                <Row
                  label="Checkout ready"
                  value={
                    dossier.identity.checkoutReady
                      ? "yes — fiscal id, postal code and address number are all on file"
                      : `no — missing ${[
                          !dossier.identity.fiscalId ? "fiscal id" : null,
                          !dossier.identity.postalCodeOnFile ? "postal code" : null,
                          !dossier.identity.addressNumberOnFile ? "address number" : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}`
                  }
                />
                <Row label="Modalities" value={listOf(dossier.identity.modalities)} />
                <Row label="Areas" value={listOf(dossier.identity.areas)} />
                <Row
                  label="Started with"
                  value={
                    dossier.identity.onboarding?.track
                      ? `the "${dossier.identity.onboarding.track}" track${dossier.identity.onboarding.completedAt ? ", completed" : ", never completed"}`
                      : "no start choice recorded"
                  }
                />
                <Row
                  label="Lifecycle e-mail"
                  value={
                    dossier.identity.lifecycleEmailOptOut
                      ? "opted out — the trial and usage automation is silent for her"
                      : "receiving"
                  }
                />
                <Row
                  label="Workspace"
                  value={`${account.name} · ${account.slug} · created ${formatDate(account.createdAt)} · ${account.timezone ?? "no timezone"}${dossier.identity.timezoneConfirmed ? "" : " (never confirmed)"}`}
                />
                <Row label="Workspace id" value={account.orgId} />
              </Section>

              <Section title="Money">
                <Row
                  label="Plan"
                  value={`${billing.planName ?? "no live subscription"}${billing.status ? ` · ${billing.status}` : ""}${
                    billing.isFree === false && !billing.providerManaged ? " · comped, nobody is charged" : ""
                  }`}
                />
                <Row
                  label="Lifetime paid"
                  value={
                    dossier.money.payments > 0
                      ? `${formatMoney(dossier.money.lifetimePaidCents, dossier.money.currency)} over ${dossier.money.payments} payment${dossier.money.payments === 1 ? "" : "s"}${
                          dossier.money.refundedCents > 0
                            ? ` · ${formatMoney(dossier.money.refundedCents, dossier.money.currency)} refunded`
                            : ""
                        }`
                      : billing.isFree === false
                        ? "comped — never charged"
                        : "never charged"
                  }
                />
                <Row
                  label="Paying since"
                  value={
                    dossier.money.payingSince
                      ? `${formatDate(dossier.money.payingSince)}${dossier.money.daysToFirstPayment !== null ? ` · ${dossier.money.daysToFirstPayment} d after sign-up` : ""}`
                      : "—"
                  }
                />
                <Row
                  label="Renews"
                  value={
                    billing.currentPeriodEnd
                      ? `${formatDate(billing.currentPeriodEnd)}${billing.renewalDays !== null ? ` (in ${billing.renewalDays} d)` : ""}`
                      : billing.isFree === false
                        ? "no renewal date — a comped plan meters by calendar month"
                        : "—"
                  }
                />
                {billing.cancelAtPeriodEnd && <Row label="Cancellation" value="scheduled for the end of the period" />}
                {dossier.money.failedCharges.count > 0 && (
                  <Row
                    label="Failing charge"
                    value={
                      <>
                        {dossier.money.failedCharges.count} open since {formatDate(dossier.money.failedCharges.since)}
                        {dossier.money.failedCharges.invoiceUrl ? (
                          <>
                            {" · "}
                            <a
                              href={dossier.money.failedCharges.invoiceUrl}
                              className="text-primary"
                              target="_blank"
                              rel="noreferrer"
                            >
                              payment link
                            </a>
                          </>
                        ) : null}
                      </>
                    }
                  />
                )}
                {dossier.money.openCheckout && (
                  <Row
                    label="Open checkout"
                    value={
                      <>
                        {dossier.money.openCheckout.planName}, abandoned {dossier.money.openCheckout.ageDays} d ago
                        {dossier.money.openCheckout.url ? (
                          <>
                            {" · "}
                            <a
                              href={dossier.money.openCheckout.url}
                              className="text-primary"
                              target="_blank"
                              rel="noreferrer"
                            >
                              open link
                            </a>
                          </>
                        ) : null}
                      </>
                    }
                  />
                )}
                {dossier.money.coupon && (
                  <Row
                    label="Coupon"
                    value={`${dossier.money.coupon.code} (${dossier.money.coupon.value} ${dossier.money.coupon.type})`}
                  />
                )}
                <Row
                  label="At the provider"
                  value={
                    dossier.money.providerCustomerId
                      ? `${billing.provider ?? "provider"} · customer ${dossier.money.providerCustomerId}`
                      : "no provider record"
                  }
                />
                {dossier.money.offers.length > 0 && (
                  <Row
                    label="Conversion offers"
                    value={dossier.money.offers.map((offer) => `${offer.trigger}: ${offer.state}`).join(" · ")}
                  />
                )}
                {dossier.money.invoices.length > 0 && (
                  <Row
                    label="Last invoices"
                    value={dossier.money.invoices
                      .slice(0, 4)
                      .map(
                        (invoice) =>
                          `${formatDate(invoice.at)} ${formatMoney(invoice.amountCents, dossier.money.currency)} ${invoice.status}`,
                      )
                      .join(" · ")}
                  />
                )}
              </Section>

              <Section title="Is she using it">
                <Row
                  label="Activation"
                  value={`first patient ${dossier.usage.daysToFirstPatient ?? "—"} d after sign-up · first finalized record ${
                    dossier.usage.daysToFirstRecord ?? "never"
                  }${dossier.usage.daysToFirstRecord !== null ? " d" : ""}`}
                />
                <Row
                  label="Patients"
                  value={`${dossier.usage.activePatients} active · ${dossier.usage.archivedPatients} archived`}
                />
                <Row
                  label="Records"
                  value={`${dossier.usage.funnel.finalized} finalized · ${dossier.usage.funnel.draft} her drafts · ${dossier.usage.funnel.awaitingReview} awaiting her review (the AI's pile) · ${dossier.usage.funnel.scheduled} scheduled · ${dossier.usage.funnel.cancelled} cancelled`}
                />
                {dossier.usage.oldestOpenRecordDays !== null && (
                  <Row label="Oldest untouched open record" value={`${dossier.usage.oldestOpenRecordDays} d`} />
                )}
                <Row
                  label="How records are made"
                  value={`${dossier.usage.recordsFromAudio} from audio · ${dossier.usage.recordsTyped} typed by hand`}
                />
                <Row
                  label="Recordings"
                  value={`${dossier.usage.recordings.total} total · ${dossier.usage.recordings.ready} ready · ${dossier.usage.recordings.modeAi} with AI, ${dossier.usage.recordings.modeAudioOnly} audio-only · last ${sinceDays(dossier.usage.recordings.lastAt)}`}
                />
                <Row
                  label="Captured on"
                  value={
                    Object.keys(dossier.usage.captureSurface).length > 0
                      ? Object.entries(dossier.usage.captureSurface)
                          .map(([surface, count]) => `${surface} ${count}`)
                          .join(" · ")
                      : "nothing captured yet"
                  }
                />
                <Row
                  label="Companion app"
                  value={
                    dossier.usage.mobileDevices.count > 0
                      ? `${dossier.usage.mobileDevices.count} device (${dossier.usage.mobileDevices.platforms.join(", ")}) · last seen ${sinceDays(dossier.usage.mobileDevices.lastSeenAt)}`
                      : "never installed"
                  }
                />
                <Row
                  label="Minutes"
                  value={`${minutes.used} of ${minutes.limit} this cycle (${minutes.percent}%) · ${minutes.remaining} left · ${dossier.usage.minutes.lifetimeCycle + dossier.usage.minutes.lifetimePack} min lifetime${
                    dossier.usage.minutes.perFinalizedRecord !== null
                      ? ` · ${dossier.usage.minutes.perFinalizedRecord} min per record`
                      : ""
                  }`}
                />
                <Row label="Minute verdict" value={MINUTE_REASON[minutes.reason] ?? minutes.reason} />
                {dossier.usage.weeklyRecordings && (
                  <Row
                    label="Recordings per week"
                    value={`${dossier.usage.weeklyRecordings.join(" · ")} (oldest → this week)`}
                  />
                )}
                <Row
                  label="Documents"
                  value={`${dossier.usage.documents.issued} issued · ${dossier.usage.documents.revoked} revoked · ${dossier.usage.shareLinks.created} share links, opened ${dossier.usage.shareLinks.totalOpens}×`}
                />
                <Row label="Addenda written" value={String(dossier.usage.addenda)} />
              </Section>

              <Section title="Anything broken">
                {isBroken(dossier) ? (
                  <>
                    <Row
                      label="Failed recordings"
                      value={`${dossier.broken.failedRecordings30d} in 30 days · ${dossier.broken.failedRecordingsTotal} ever${
                        Object.keys(dossier.broken.failureStages).length > 0
                          ? ` · ${Object.entries(dossier.broken.failureStages)
                              .map(([stage, count]) => `${stage} ${count}`)
                              .join(", ")}`
                          : ""
                      }`}
                    />
                    {dossier.broken.lastFailure && (
                      <Row
                        label="Last failure"
                        value={
                          <Box component="span" className="font-mono">
                            {formatDateTime(dossier.broken.lastFailure.at)} ·{" "}
                            {dossier.broken.lastFailure.errorCode ?? "no code"}
                            {dossier.broken.lastFailure.message ? ` · ${dossier.broken.lastFailure.message}` : ""}
                          </Box>
                        }
                      />
                    )}
                    {dossier.broken.stuckProcessing.count > 0 && (
                      <Row
                        label="Stuck in processing"
                        value={`${dossier.broken.stuckProcessing.count} with an expired lease · up to ${dossier.broken.stuckProcessing.maxAttempts} attempts`}
                      />
                    )}
                    {dossier.broken.strandedUploads > 0 && (
                      <Row
                        label="Stranded uploads"
                        value={`${dossier.broken.strandedUploads} delivered, nothing picked them up`}
                      />
                    )}
                    {dossier.broken.audioDeletionPending.count > 0 && (
                      <Row
                        label="Audio deletion pending"
                        value={`${dossier.broken.audioDeletionPending.count} since ${formatDate(dossier.broken.audioDeletionPending.oldest)}`}
                      />
                    )}
                    {dossier.money.checkout.failed90d > 0 && (
                      <Row
                        label="Checkout failures (90 d)"
                        value={`${dossier.money.checkout.failed90d}${dossier.money.checkout.lastError ? ` · last: ${dossier.money.checkout.lastError}` : ""}`}
                      />
                    )}
                    {dossier.broken.imports.length > 0 && (
                      <Row
                        label="Imports"
                        value={dossier.broken.imports
                          .map((batch) => `${batch.kind} ${batch.status}${batch.revertedAt ? " (reverted)" : ""}`)
                          .join(" · ")}
                      />
                    )}
                  </>
                ) : (
                  <Typography variant="body2" className="text-text-secondary">
                    Nothing broken: no failed or stuck recordings, no stranded audio, no failed checkout, no pending
                    deletion.
                  </Typography>
                )}
              </Section>

              {!showEverything ? (
                <Button variant="text" onClick={() => setShowEverything(true)}>
                  Show the AI verdict, consent, access and timeline
                </Button>
              ) : (
                <>
                  <Section title="Does the AI work for her">
                    <Row
                      label="Library"
                      value={
                        dossier.ai.library?.unlimited
                          ? "unlimited on this plan"
                          : `${String(dossier.ai.library?.used ?? 0)} of ${String(dossier.ai.library?.limit ?? "—")} messages this month`
                      }
                    />
                    <Row
                      label="Library habit"
                      value={
                        dossier.ai.libraryLedger.lastAt
                          ? `${dossier.ai.libraryLedger.viaApp} in-app · ${dossier.ai.libraryLedger.viaMcp} via connector · active in ${dossier.ai.libraryLedger.activeMonths} month(s) · last ${sinceDays(dossier.ai.libraryLedger.lastAt)}`
                          : "never asked the library anything"
                      }
                    />
                    <Row
                      label="Anamnesis from audio"
                      value={`${dossier.ai.anamnesis.fromAudio} fields filled · ${dossier.ai.anamnesis.edited} she corrected · ${dossier.ai.anamnesis.rejected} she threw away`}
                    />
                    <Row
                      label="Hypotheses"
                      value={`${dossier.ai.hypotheses.total} prepared · ${dossier.ai.hypotheses.awaitingReview} still unreviewed · ${dossier.ai.hypotheses.accepted} accepted · ${dossier.ai.hypotheses.edited} edited · ${dossier.ai.hypotheses.rejected} rejected${
                        dossier.ai.hypotheses.withoutLibrary > 0
                          ? ` · ${dossier.ai.hypotheses.withoutLibrary} prepared without the library`
                          : ""
                      }`}
                    />
                    <Row
                      label="Therapeutic plans"
                      value={`${dossier.ai.plans.ai} AI-drafted (${dossier.ai.plans.aiValidated} validated) · ${dossier.ai.plans.manual} written by hand`}
                    />
                    <Row
                      label="Case reviews"
                      value={`${dossier.ai.caseReviews.total} conversations, ${dossier.ai.caseReviews.aboutAPatient} about a patient`}
                    />
                    <Row
                      label="Her own protocols"
                      value={`${dossier.ai.ownProtocols.total} loaded (${dossier.ai.ownProtocols.ready} ready, ${dossier.ai.ownProtocols.failed} failed)`}
                    />
                    <Row
                      label="Reasoning paywall"
                      value={`seen ${dossier.ai.reasoningPaywall.viewed}× · clicked ${dossier.ai.reasoningPaywall.clicked}×`}
                    />
                    {Object.keys(dossier.ai.usageAlerts).length > 0 && (
                      <Row
                        label="Quota alerts"
                        value={Object.entries(dossier.ai.usageAlerts)
                          .map(([meter, alert]) => `${meter} ${alert.maxThreshold}% (${sinceDays(alert.lastAt)})`)
                          .join(" · ")}
                      />
                    )}
                  </Section>

                  <Section title="Consent and risk">
                    <Row
                      label="Patients cleared"
                      value={`${dossier.consent.clearedForAudio} for recording · ${dossier.consent.clearedForAi} for AI processing · of ${dossier.consent.activePatients} active`}
                    />
                    <Row
                      label="Who manifested it"
                      value={`${dossier.consent.signedByPatient} signed by the patient · ${dossier.consent.declaredByProfessional} declared by the professional`}
                    />
                    <Row label="Purposes refused" value={String(dossier.consent.refusals)} />
                    <Row
                      label="QR consent sessions"
                      value={`${dossier.consent.qrSessions.completed} completed of ${dossier.consent.qrSessions.total}${
                        dossier.consent.qrSessions.pending > 0 ? ` · ${dossier.consent.qrSessions.pending} open` : ""
                      }`}
                    />
                    <Row
                      label="Audio under revoked consent"
                      value={
                        dossier.consent.audioUnderRevokedConsent > 0
                          ? `${dossier.consent.audioUnderRevokedConsent} — delete today`
                          : "none"
                      }
                    />
                    <Row
                      label="Patient erasure requests"
                      value={
                        dossier.consent.erasureRequests.count > 0
                          ? `${dossier.consent.erasureRequests.count} pending, oldest ${formatDate(dossier.consent.erasureRequests.oldest)}`
                          : "none"
                      }
                    />
                    <Row label="Audio retention" value={dossier.identity.audioRetention ?? "—"} />
                    <Row
                      label="Full exports"
                      value={
                        dossier.consent.exports.last
                          ? `${dossier.consent.exports.count} requested · last ${dossier.consent.exports.last.status} on ${formatDate(dossier.consent.exports.last.requestedAt)}${
                              dossier.consent.exports.last.lastDownloadedAt ? ", downloaded" : ", never downloaded"
                            }`
                          : "never exported her practice"
                      }
                    />
                  </Section>

                  <Section title="Access and support">
                    <Row
                      label="Sign-ins"
                      value={
                        dossier.access.trailAvailable
                          ? `${dossier.access.signIns.total} total · ${dossier.access.signIns.last30d} in 30 days · last ${sinceDays(dossier.access.signIns.lastAt)}`
                          : "no trail recorded"
                      }
                    />
                    <Row
                      label="Password"
                      value={`${dossier.identity.hasPassword ? "set" : "no password (social sign-in)"}${
                        dossier.identity.recoverySentAt
                          ? ` · reset e-mail sent ${sinceDays(dossier.identity.recoverySentAt)}`
                          : ""
                      }`}
                    />
                    {dossier.identity.emailChangePending && <Row label="E-mail change" value="pending confirmation" />}
                    <Row
                      label="2FA"
                      value={
                        dossier.access.mfa.verified > 0
                          ? `${dossier.access.mfa.verified} verified factor(s)`
                          : dossier.access.mfa.unverified > 0
                            ? "enrolment started and abandoned"
                            : "not enrolled"
                      }
                    />
                    <Row
                      label="Support visits"
                      value={
                        dossier.access.supportVisits.count > 0
                          ? `${dossier.access.supportVisits.count} · last by ${dossier.access.supportVisits.lastActor ?? "unknown"} ${sinceDays(dossier.access.supportVisits.lastAt)}`
                          : "never visited"
                      }
                    />
                    <Row label="Account created" value={formatDateTime(dossier.identity.userCreatedAt)} />
                  </Section>

                  <Section title="Origin">
                    {attribution ? (
                      <>
                        <Row label="Origin" value={attribution.origem ?? "—"} />
                        <Row label="Wave" value={attribution.onda ?? "—"} />
                        <Row label="UTM source" value={attribution.utmSource ?? "—"} />
                        <Row label="UTM campaign" value={attribution.utmCampaign ?? "—"} />
                        <Row label="Landing page" value={attribution.landingPath ?? "—"} />
                      </>
                    ) : (
                      <Typography variant="body2" className="text-text-secondary">
                        No attribution recorded — the account predates sign-up tracking, or arrived with no campaign
                        data.
                      </Typography>
                    )}
                  </Section>

                  <Section title="Last 20 actions">
                    {dossier.timeline.length === 0 ? (
                      <Typography variant="body2" className="text-text-secondary">
                        Nothing audited in this workspace yet.
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
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const listOf = (values: string[] | null | undefined) =>
  values && values.length > 0 ? values.join(", ") : "not declared";

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
