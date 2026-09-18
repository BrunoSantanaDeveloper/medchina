"use client";

import {
  type AccountOverview,
  FLAG_LABEL,
  formatDate,
  formatDateTime,
  formatMoney,
  MINUTE_REASON,
  sinceDays,
} from "./account-overview";

import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";

/**
 * Everything about one account that does not fit a table row: who signs the
 * documents, how to reach her, what the plan and the minutes are doing, how
 * much of the product she actually uses, and where the account came from.
 */
export default function AccountDetailDialog({ account, onClose }: { account: AccountOverview; onClose: () => void }) {
  const { owner, billing, trial, minutes, usage, attribution } = account;
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box className="flex flex-col">
          <Typography variant="h5" component="span">
            {account.name}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {owner?.name ?? "No owner"}
            {owner?.email ? ` · ${owner.email}` : ""}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-5 pt-1">
          {account.flags.length > 0 && (
            <Box className="flex flex-row flex-wrap gap-1">
              {account.flags.map((flag) => (
                <Chip key={flag} label={FLAG_LABEL[flag] ?? flag} size="small" variant="outlined" />
              ))}
            </Box>
          )}

          <Section title="Professional">
            <Row label="Name" value={owner?.name ?? "—"} />
            <Row label="Title" value={owner?.title ?? "—"} />
            <Row label="Registration" value={owner?.registration ?? "—"} />
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
              label="Phone"
              value={
                owner?.phone ? (
                  <a href={`tel:${owner.phone}`} className="text-primary">
                    {owner.phone}
                  </a>
                ) : (
                  "not provided"
                )
              }
            />
            <Row label="E-mail confirmed" value={owner?.confirmed ? "yes" : "no — sign-up never completed"} />
            <Row
              label="Last sign-in"
              value={`${sinceDays(owner?.lastSignInAt)} (${formatDateTime(owner?.lastSignInAt)})`}
            />
            {owner?.bannedUntil && <Row label="Banned until" value={formatDateTime(owner.bannedUntil)} />}
          </Section>

          <Section title="Workspace">
            <Row label="Name" value={account.name} />
            <Row label="Slug" value={account.slug} />
            <Row label="Created" value={formatDate(account.createdAt)} />
            <Row label="Members" value={String(account.memberCount)} />
            <Row label="Time zone" value={account.timezone ?? "—"} />
            <Row label="Workspace id" value={account.orgId} />
          </Section>

          <Section title="Plan and billing">
            <Row label="Plan" value={billing.planName ?? "no live subscription"} />
            <Row
              label="Price"
              value={
                billing.monthlyCents > 0
                  ? `${formatMoney(billing.monthlyCents, billing.currency)} / month${
                      billing.providerManaged ? "" : " — comped, nobody is charged"
                    }`
                  : "free"
              }
            />
            <Row label="Status" value={billing.status ?? "—"} />
            <Row
              label="Billed through"
              value={
                billing.providerManaged
                  ? (billing.provider ?? "provider")
                  : billing.isFree === false
                    ? "comped by an operator (no provider)"
                    : "—"
              }
            />
            <Row
              label="Renews"
              value={
                billing.currentPeriodEnd
                  ? `${formatDate(billing.currentPeriodEnd)}${billing.renewalDays !== null ? ` (in ${billing.renewalDays} d)` : ""}`
                  : billing.isFree === false
                    ? "no renewal date — comped plans keep metering by calendar month"
                    : "—"
              }
            />
            {billing.cancelAtPeriodEnd && <Row label="Cancellation" value="scheduled for the end of the period" />}
            {billing.pastDueSince && <Row label="Past due since" value={formatDate(billing.pastDueSince)} />}
            {billing.graceEndsAt && <Row label="Grace ends" value={formatDateTime(billing.graceEndsAt)} />}
            <Row label="Access" value={billing.suspended ? "suspended by an operator" : "active"} />
            <Row label="Billing data" value={billing.hasBillingId ? "CPF/CNPJ on file" : "not filled in"} />
          </Section>

          <Section title="Pro trial">
            {trial ? (
              <>
                <Row label="Started" value={`${formatDate(trial.startedAt)} (via ${trial.startedVia ?? "unknown"})`} />
                <Row label="Ends" value={formatDate(trial.endsAt)} />
                <Row label="Days left" value={trial.active ? String(trial.daysLeft) : "ended"} />
                <Row label="Minute ceiling" value={`${trial.minutesLimit} min`} />
              </>
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                No Pro trial started. It begins at the first operational action — a recording, an appointment, an import
                or the library.
              </Typography>
            )}
          </Section>

          <Section title="Minutes">
            <Row label="Pool" value={minutes.source === "none" ? "no pool" : minutes.source} />
            <Row label="Used" value={`${minutes.used} of ${minutes.limit} min (${minutes.percent}%)`} />
            <Row label="Remaining" value={`${minutes.remaining} min`} />
            <Row label="Can record now" value={minutes.canStart ? "yes" : "no"} />
            <Row label="Clinical reasoning" value={minutes.clinicalReasoning ? "included" : "not included"} />
            <Row label="Why" value={MINUTE_REASON[minutes.reason] ?? minutes.reason} />
          </Section>

          <Section title="Use">
            <Row label="Patients" value={String(usage.patients)} />
            <Row label="Records" value={`${usage.finalized} finalized of ${usage.consultations} consultations`} />
            <Row label="Upcoming appointments" value={String(usage.upcoming)} />
            <Row
              label="Last 30 days"
              value={`${usage.finalized30d} records · ${usage.recordings30d} recordings · ${usage.minutes30d} min · ${usage.libraryMessages30d} library messages`}
            />
            <Row label="Issued documents" value={String(usage.documents)} />
            <Row
              label="Last activity"
              value={`${sinceDays(usage.lastActivityAt)}${usage.lastActivityAt ? ` (${formatDate(usage.lastActivityAt)})` : ""}`}
            />
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
                No attribution recorded — the account predates sign-up tracking, or arrived with no campaign data.
              </Typography>
            )}
          </Section>
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
      <Typography variant="body2" className="text-text-secondary w-44 shrink-0">
        {label}
      </Typography>
      <Typography variant="body2" component="span" className="text-text-primary min-w-0 flex-1 break-words">
        {value}
      </Typography>
    </Box>
  );
}
