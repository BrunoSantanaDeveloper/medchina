"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Card, CardContent, Chip, Tooltip, Typography } from "@mui/material";

import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiFlag from "@/icons/nexture/ni-flag";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUser from "@/icons/nexture/ni-user";
import type { ConsultationSaveState } from "@/lib/consultation-save-coordinator";
import { cn } from "@/lib/utils";
import type { ConsultationExperienceState, RecordingStatus } from "@flyee/clinical";

export type ClinicalContextBarProps = {
  patientId: string;
  patientName: string;
  patientBirthDate?: string | null;
  alerts: { label: string }[];
  scheduledFor: string | null;
  experience: ConsultationExperienceState;
  /** `images` is optional: screens that only care about capture may omit it. */
  /**
   * `aiRefused` and `aiNotice` are not authorizations to chase: the first is
   * the patient having said no, the second the ciência she was given (0102).
   * Neither raises the callout — only what gates capture does.
   */
  consents: { audio: boolean; ai: boolean; images?: boolean; aiRefused?: boolean; aiNotice?: boolean };
  /**
   * The clinical context could not be loaded — a network failure, not an empty
   * patient. Without this the bar states the FALLBACKS as facts: "sem alertas
   * clínicos cadastrados" over a patient who may be pregnant or on
   * anticoagulants, and "não autorizado" over consents that are actually
   * granted. Absence of data is never a negative answer (PRD §10.5), and an
   * error is never rendered as an empty state.
   */
  contextUnavailable?: boolean;
  /** The practice timezone, so a date near midnight is not the browser's day. */
  timezone?: string | null;
  saveState: ConsultationSaveState;
  recordingStatus?: RecordingStatus | null;
  /**
   * The ONE thing to do next, derived from the record's data
   * (`deriveConsultationJourney`), with the control that does it.
   */
  nextAction: { label: string; action?: { label: string; onClick: () => void } };
  onRetrySave?: () => void;
  /**
   * THE place consents are registered, for the whole consultation. Every card
   * used to carry its own "Registrar consentimento" button; the same action in
   * five places read as noise and left her unsure which one to press.
   */
  onManageConsents?: () => void;
  /** The record can still change, so a missing consent is worth asking for now. */
  consentActionable?: boolean;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant: "outlined" | "contained";
    /** Loose ends the database will name when closing; shown as a small count. */
    count?: number;
    /** Full accessible name when the count is shown ("Revisar e finalizar · 2 pendências"). */
    ariaLabel?: string;
    /**
     * Why it is disabled, in words, under the button. A disabled control with
     * no reason is a dead end, and a tooltip does not exist on touch.
     */
    reason?: string;
  };
};

const EXPERIENCE_KEYS: Record<ConsultationExperienceState, string> = {
  scheduled: "context-status-scheduled",
  manual_draft: "context-status-draft",
  in_session: "context-status-in-progress",
  awaiting_upload: "context-status-awaiting-upload",
  uploading: "context-status-uploading",
  ready_to_process: "context-status-ready-to-process",
  processing: "context-status-processing",
  awaiting_review: "context-status-awaiting-review",
  failed: "context-status-failed",
  finalized: "context-status-finalized",
  cancelled: "context-status-cancelled",
};

/** One tone per lifecycle stage, so scheduled/working/review/done read apart at a glance. */
const EXPERIENCE_TONE: Record<ConsultationExperienceState, string> = {
  scheduled: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
  manual_draft: "bg-grey-100 text-text-secondary",
  in_session: "bg-primary/15 text-primary-dark dark:text-primary-light",
  awaiting_upload: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
  uploading: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
  ready_to_process: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
  processing: "bg-accent-2/15 text-accent-2-dark dark:text-accent-2-light",
  awaiting_review: "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light",
  failed: "bg-warning-light/20 text-warning-dark",
  finalized: "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light",
  cancelled: "bg-grey-100 text-text-secondary",
};

const SAVE_KEYS: Record<ConsultationSaveState, string> = {
  idle: "context-save-idle",
  pending: "context-save-pending",
  saving: "context-save-saving",
  saved: "context-save-saved",
  error: "context-save-error",
};

const dismissKey = (patientId: string) => `medchina:consent-strip-dismissed:${patientId}`;

/** Small round tinted icon, the same "chip" language used for section headers elsewhere. */
function ColumnIcon({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-xl [&_svg]:h-4 [&_svg]:w-4", tone)}
    >
      {children}
    </span>
  );
}

/**
 * Persistent clinical identity and state, kept above the editable record.
 *
 * Two bands, read top to bottom: WHO and WHEN (patient, appointment, state,
 * consents), then WHAT NOW (the next action, the save state and closing the
 * record). A pending consent sits between them as the one highlighted callout
 * of the screen, because it gates recording and every AI step.
 */
export default function ClinicalContextBar({
  patientId,
  patientName,
  patientBirthDate,
  alerts,
  scheduledFor,
  experience,
  consents,
  contextUnavailable = false,
  timezone,
  saveState,
  recordingStatus,
  nextAction,
  onRetrySave,
  onManageConsents,
  consentActionable = true,
  primaryAction,
}: ClinicalContextBarProps) {
  const t = useTranslations("product");
  // The practice's own locale and timezone are the authority: a bare
  // `toLocaleDateString()` shows the browser's day near midnight.
  const locale = useLocale();
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone ?? undefined,
  });
  const birthFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone ?? undefined });

  // "Agora não" is a real answer — the consultation can proceed by hand without
  // any consent — so the callout steps back for this patient until the tab is
  // closed, and the "Consentimentos" chip stays to bring it back.
  const [stripDismissed, setStripDismissed] = useState(false);
  useEffect(() => {
    try {
      setStripDismissed(window.sessionStorage.getItem(dismissKey(patientId)) === "1");
    } catch {
      // Storage blocked: the callout simply stays visible.
    }
  }, [patientId]);
  const dismissStrip = () => {
    setStripDismissed(true);
    try {
      window.sessionStorage.setItem(dismissKey(patientId), "1");
    } catch {
      // Storage blocked: dismissed for this render only.
    }
  };

  const birth = patientBirthDate ? new Date(`${patientBirthDate}T12:00:00`) : null;
  const age = birth ? Math.floor((Date.now() - birth.getTime()) / 31_557_600_000) : null;

  const consentStates = [
    {
      key: "audio",
      granted: consents.audio,
      label: t(consents.audio ? "context-audio-granted" : "context-audio-missing"),
    },
    { key: "ai", granted: consents.ai, label: t(consents.ai ? "context-ai-granted" : "context-ai-missing") },
    ...(consents.images === undefined
      ? []
      : [
          {
            key: "images",
            granted: consents.images,
            label: t(consents.images ? "context-images-granted" : "context-images-missing"),
          },
        ]),
  ];
  const missingConsents = consentStates.filter((item) => !item.granted).length;
  // Listed with the rest so she can see it was given, never counted as pending:
  // a missing ciência blocks nothing, and a chip that nags for it would lie.
  const noticeLabel = t(consents.aiNotice ? "context-notice-granted" : "context-notice-missing");
  const consentSummary = [...consentStates.map((item) => item.label), noticeLabel];
  // Audio and AI are the ones that gate the flow (recording, hypotheses, plan,
  // summary). Images only gate photos, so they count on the chip but never
  // raise the callout on their own.
  const captureConsentMissing = !consents.audio || !consents.ai;
  const showStrip =
    Boolean(onManageConsents) && consentActionable && !contextUnavailable && captureConsentMissing && !stripDismissed;
  const stripBody =
    !consents.audio && !consents.ai
      ? t("context-consent-strip-both")
      : !consents.ai
        ? t("context-consent-strip-ai")
        : t("context-consent-strip-audio");

  return (
    <Card component="section" aria-label={t("context-title")} className="bg-background-paper/95 backdrop-blur">
      <CardContent className="flex flex-col gap-3 py-3!">
        {/* ---- WHO and WHEN ------------------------------------------------ */}
        <Box className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          <Box className="flex min-w-0 flex-1 flex-row items-center gap-3">
            <ColumnIcon tone="bg-primary/10 text-primary">
              <NiUser />
            </ColumnIcon>
            <Box className="min-w-0">
              <Typography variant="caption" className="text-text-secondary block leading-4 font-semibold">
                {t("context-identity")}
              </Typography>
              <Typography
                component={Link}
                href={`/pacientes/${patientId}`}
                variant="subtitle1"
                className="block truncate leading-6 font-semibold"
              >
                {patientName}
              </Typography>
              <Typography variant="caption" className="text-text-secondary block leading-4">
                {contextUnavailable
                  ? t("context-unavailable-short")
                  : birth && age !== null
                    ? t("context-birth-age", { date: birthFormatter.format(birth), age })
                    : t("context-birth-missing")}
              </Typography>
            </Box>
          </Box>

          <Box className="flex flex-row flex-wrap items-center gap-2 md:justify-end">
            <Typography
              variant="caption"
              className="text-text-secondary inline-flex items-center gap-1 whitespace-nowrap [&_svg]:h-3.5 [&_svg]:w-3.5"
            >
              <NiCalendarClock aria-hidden />
              {scheduledFor ? formatter.format(new Date(scheduledFor)) : t("context-no-appointment")}
            </Typography>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", EXPERIENCE_TONE[experience])}>
              {t(EXPERIENCE_KEYS[experience])}
            </span>
            {/* One control for every consent of this patient: its colour says
                whether anything is missing, the tooltip lists each one, and a
                click opens the collection dialog right here. */}
            {contextUnavailable ? (
              <span className="bg-grey-100 text-text-secondary rounded-full px-2 py-0.5 text-xs font-semibold">
                {t("context-consents-unavailable")}
              </span>
            ) : (
              <Tooltip title={consentSummary.join(" · ")}>
                <Chip
                  size="small"
                  icon={<NiShieldCheck size="tiny" />}
                  label={
                    missingConsents > 0
                      ? t("context-consents-pending", { count: missingConsents })
                      : t("context-consents-ok")
                  }
                  onClick={onManageConsents}
                  clickable={Boolean(onManageConsents)}
                  aria-label={`${t("context-consents")}: ${consentSummary.join(", ")}`}
                  className={cn(
                    "text-xs font-semibold",
                    missingConsents > 0
                      ? "bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light"
                      : "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light",
                  )}
                />
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Clinical alerts are a safety line, not decoration: shown as chips
            when there are any, stated plainly when there are none, and never
            confused with "could not read them". */}
        <Box className="flex flex-row flex-wrap items-center gap-1 md:pl-12">
          {contextUnavailable ? (
            <Typography variant="body2" className="text-warning-dark font-semibold">
              {t("context-alerts-unavailable")}
            </Typography>
          ) : alerts.length ? (
            // This line tells the professional about an allergy or a
            // pregnancy, so the word has to be readable. Measured on the light
            // theme, against the 4.5:1 floor:
            //
            //   filled (white on amber)                2.51:1
            //   outlined (MUI paints the label amber)  2.51:1
            //   the pastel badge (warning-dark on 10%) 2.95:1
            //   outlined + text-primary                9.79:1
            //
            // Amber is simply too light in this palette to carry text at any
            // of its three stops. So the colour moves entirely to the ring,
            // where it reinforces a word that is already spelled out, and the
            // label takes the body colour.
            alerts.map((alert) => (
              <Chip
                key={alert.label}
                size="small"
                color="warning"
                variant="outlined"
                className="text-text-primary!"
                label={alert.label}
              />
            ))
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("context-no-alerts")}
            </Typography>
          )}
        </Box>

        {/* ---- The pending consent: the one highlighted callout ------------ */}
        {/* A soft pulse, not a blink: a flashing block competes with the
            patient for her attention, and continuous motion must be stoppable
            (WCAG 2.2.2) — "Agora não" stops it, and it never moves for anyone
            who asked the system for reduced motion. */}
        {showStrip && (
          <Box
            role="region"
            aria-labelledby="consent-strip-title"
            className="border-accent-3/40 bg-accent-3/10 flex flex-col gap-2 rounded-2xl border px-3 py-2.5 md:flex-row md:items-center md:gap-3"
          >
            <Box className="flex min-w-0 flex-1 flex-row items-start gap-2.5">
              <span aria-hidden className="relative mt-1.5 flex h-2.5 w-2.5 flex-none">
                <span className="bg-accent-3 absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" />
                <span className="bg-accent-3 relative inline-flex h-2.5 w-2.5 rounded-full" />
              </span>
              <Box className="min-w-0">
                <Typography id="consent-strip-title" variant="body2" className="text-text-primary font-semibold">
                  {t("context-consent-strip-title")}
                </Typography>
                <Typography variant="caption" className="text-text-secondary block leading-5">
                  {stripBody}
                </Typography>
              </Box>
            </Box>
            <Box className="flex flex-row flex-wrap items-center gap-1 md:flex-none">
              <Button variant="contained" color="primary" size="small" onClick={onManageConsents}>
                {t("journey-next-action-consent")}
              </Button>
              <Button variant="text" color="grey" size="small" onClick={dismissStrip}>
                {t("context-consent-strip-dismiss")}
              </Button>
            </Box>
          </Box>
        )}

        {/* ---- WHAT NOW ---------------------------------------------------- */}
        <Box className="border-grey-100 flex flex-col gap-3 border-t pt-3 md:flex-row md:items-center md:gap-4">
          <Box className="flex min-w-0 flex-1 flex-row items-start gap-3">
            <ColumnIcon tone="bg-secondary/10 text-secondary">
              <NiFlag />
            </ColumnIcon>
            <Box className="min-w-0">
              <Typography variant="caption" className="text-text-secondary block leading-4 font-semibold">
                {t("context-next-action")}
              </Typography>
              <Typography variant="body2" className="text-text-primary mt-0.5 font-medium">
                {nextAction.label}
              </Typography>
              {nextAction.action && (
                <Button size="small" className="mt-0.5 -ml-1 px-1!" onClick={nextAction.action.onClick}>
                  {nextAction.action.label}
                </Button>
              )}
            </Box>
          </Box>

          <Box className="flex flex-col items-stretch gap-1 md:flex-none md:items-end">
            {/* Whether her last keystrokes are safe, next to the button that
                closes the record — the moment that question matters. */}
            <Box className="flex flex-row flex-wrap items-center gap-1 md:justify-end">
              <Typography
                variant="caption"
                className={cn(
                  "leading-4",
                  saveState === "error" ? "text-accent-3-dark dark:text-accent-3-light" : "text-text-secondary",
                )}
                role="status"
                aria-live="polite"
              >
                {t(SAVE_KEYS[saveState])}
                {recordingStatus ? ` · ${t(`context-recording-${recordingStatus}`)}` : ""}
              </Typography>
              {saveState === "error" && onRetrySave && (
                <Button size="small" onClick={onRetrySave} className="px-1!">
                  {t("retry")}
                </Button>
              )}
            </Box>
            {primaryAction && (
              <>
                <Button
                  variant={primaryAction.variant}
                  color="primary"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  aria-label={primaryAction.ariaLabel}
                  aria-describedby={primaryAction.reason ? "clinical-context-primary-reason" : undefined}
                  className="w-full whitespace-nowrap md:w-auto"
                >
                  {primaryAction.label}
                  {/* The loose ends as a count, not a sentence: the button
                      used to wrap onto two lines to fit "· 1 pendência". */}
                  {primaryAction.count ? (
                    <span
                      aria-hidden
                      className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full border border-current px-1.5 text-xs leading-4 font-bold tabular-nums"
                    >
                      {primaryAction.count}
                    </span>
                  ) : null}
                </Button>
                {/* Stays VISIBLE when it cannot act, with the reason in words. */}
                {primaryAction.reason && (
                  <Typography
                    id="clinical-context-primary-reason"
                    variant="caption"
                    className="text-text-secondary max-w-72 leading-4 md:text-right"
                  >
                    {primaryAction.reason}
                  </Typography>
                )}
              </>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
