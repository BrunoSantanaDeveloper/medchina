"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Card, CardContent, Chip, Typography } from "@mui/material";

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
  consents: { audio: boolean; ai: boolean };
  saveState: ConsultationSaveState;
  recordingStatus?: RecordingStatus | null;
  nextAction: string;
  onRetrySave?: () => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant: "outlined" | "contained";
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

/** One tone per lifecycle stage instead of the same teal for nearly every
 * state — scheduled/working/needs-review/done/closed now read apart at a
 * glance, echoing the tones already used for review chips and Home. */
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

/** Small round tinted icon, the same "chip" language used for section
 * headers elsewhere — scaled down so a persistent sticky bar stays slim. */
function ColumnIcon({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn("flex h-6 w-6 flex-none items-center justify-center rounded-lg [&_svg]:h-3.5 [&_svg]:w-3.5", tone)}
    >
      {children}
    </span>
  );
}

/** Persistent clinical identity and state, kept above the editable record. */
export default function ClinicalContextBar({
  patientId,
  patientName,
  patientBirthDate,
  alerts,
  scheduledFor,
  experience,
  consents,
  saveState,
  recordingStatus,
  nextAction,
  onRetrySave,
  primaryAction,
}: ClinicalContextBarProps) {
  const t = useTranslations("product");
  const [showDetails, setShowDetails] = useState(false);
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Card component="section" aria-label={t("context-title")} className="bg-background-paper/95 backdrop-blur">
      <CardContent className="flex flex-col gap-3 py-3!">
        <Box className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
          <Box className="min-w-0 flex-1">
            <Typography variant="caption" className="text-text-secondary flex items-center gap-1.5 font-semibold">
              <ColumnIcon tone="bg-primary/10 text-primary">
                <NiUser aria-hidden />
              </ColumnIcon>
              {t("context-identity")}
            </Typography>
            <Typography
              component={Link}
              href={`/pacientes/${patientId}`}
              variant="subtitle1"
              className="mt-1 truncate font-semibold"
            >
              {patientName}
            </Typography>
            <Typography variant="caption" className="text-text-secondary block">
              {patientBirthDate
                ? t("context-birth-date", { date: new Date(`${patientBirthDate}T12:00:00`).toLocaleDateString() })
                : t("context-birth-missing")}
            </Typography>
            <Box className="mt-1 flex flex-wrap gap-1">
              {alerts.length ? (
                alerts.map((alert) => <Chip key={alert.label} size="small" color="warning" label={alert.label} />)
              ) : (
                <Typography variant="caption" className="text-text-secondary">
                  {t("context-no-alerts")}
                </Typography>
              )}
            </Box>
          </Box>

          <Button
            size="small"
            color="grey"
            variant="text"
            className="self-start md:hidden"
            aria-expanded={showDetails}
            aria-controls="clinical-context-details"
            onClick={() => setShowDetails((current) => !current)}
          >
            {t(showDetails ? "context-hide-details" : "context-show-details")}
          </Button>

          <Box id="clinical-context-details" className={`${showDetails ? "grid" : "hidden"} gap-3 md:contents`}>
            <Box className="md:border-grey-100 min-w-48 md:border-l md:pl-4">
              <Typography variant="caption" className="text-text-secondary flex items-center gap-1.5 font-semibold">
                <ColumnIcon tone="bg-accent-2/10 text-accent-2">
                  <NiCalendarClock aria-hidden />
                </ColumnIcon>
                {t("context-appointment")}
              </Typography>
              <Typography variant="body2" className="mt-1">
                {scheduledFor ? formatter.format(new Date(scheduledFor)) : t("context-no-appointment")}
              </Typography>
              <span
                className={cn(
                  "mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold",
                  EXPERIENCE_TONE[experience],
                )}
              >
                {t(EXPERIENCE_KEYS[experience])}
              </span>
            </Box>

            <Box className="md:border-grey-100 min-w-48 md:border-l md:pl-4">
              <Typography variant="caption" className="text-text-secondary flex items-center gap-1.5 font-semibold">
                <ColumnIcon tone="bg-accent-4/10 text-accent-4">
                  <NiShieldCheck aria-hidden />
                </ColumnIcon>
                {t("context-consents")}
              </Typography>
              <Box className="mt-1 flex flex-wrap gap-1">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    consents.audio
                      ? "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
                      : "bg-grey-100 text-text-secondary",
                  )}
                >
                  {t(consents.audio ? "context-audio-granted" : "context-audio-missing")}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    consents.ai
                      ? "bg-accent-1/15 text-accent-1-dark dark:text-accent-1-light"
                      : "bg-grey-100 text-text-secondary",
                  )}
                >
                  {t(consents.ai ? "context-ai-granted" : "context-ai-missing")}
                </span>
              </Box>
              {(!consents.audio || !consents.ai) && (
                <Button
                  component={Link}
                  href={`/pacientes/${patientId}/consentimentos`}
                  size="small"
                  className="mt-1 px-0!"
                >
                  {t("context-manage-consents")}
                </Button>
              )}
            </Box>
          </Box>

          <Box className="md:border-grey-100 min-w-44 flex-1 md:border-l md:pl-4">
            <Typography variant="caption" className="text-text-secondary flex items-center gap-1.5 font-semibold">
              <ColumnIcon tone="bg-secondary/10 text-secondary">
                <NiFlag aria-hidden />
              </ColumnIcon>
              {t("context-next-action")}
            </Typography>
            <Typography variant="body2" className="mt-1 font-medium">
              {nextAction}
            </Typography>
            <Typography
              variant="caption"
              className={saveState === "error" ? "text-accent-3-dark dark:text-accent-3-light" : "text-text-secondary"}
              role="status"
              aria-live="polite"
            >
              {t(SAVE_KEYS[saveState])}
              {recordingStatus ? ` · ${t(`context-recording-${recordingStatus}`)}` : ""}
            </Typography>
            {saveState === "error" && onRetrySave && (
              <Button size="small" onClick={onRetrySave} className="ml-1 px-1!">
                {t("retry")}
              </Button>
            )}
          </Box>

          {primaryAction && (
            <Button
              variant={primaryAction.variant}
              color="primary"
              onClick={primaryAction.onClick}
              disabled={primaryAction.disabled}
              className="w-full flex-none md:w-auto md:self-center"
            >
              {primaryAction.label}
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
