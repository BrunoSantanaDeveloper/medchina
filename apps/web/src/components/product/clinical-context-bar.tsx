"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Card, CardContent, Chip, Typography } from "@mui/material";

import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUser from "@/icons/nexture/ni-user";
import type { ConsultationSaveState } from "@/lib/consultation-save-coordinator";
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

const SAVE_KEYS: Record<ConsultationSaveState, string> = {
  idle: "context-save-idle",
  pending: "context-save-pending",
  saving: "context-save-saving",
  saved: "context-save-saved",
  error: "context-save-error",
};

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
            <Typography variant="caption" className="text-text-secondary flex items-center gap-1 font-semibold">
              <NiUser size="tiny" aria-hidden /> {t("context-identity")}
            </Typography>
            <Typography component={Link} href={`/pacientes/${patientId}`} variant="subtitle1" className="truncate">
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
              <Typography variant="caption" className="text-text-secondary flex items-center gap-1 font-semibold">
                <NiCalendarClock size="tiny" aria-hidden /> {t("context-appointment")}
              </Typography>
              <Typography variant="body2">
                {scheduledFor ? formatter.format(new Date(scheduledFor)) : t("context-no-appointment")}
              </Typography>
              <Chip
                size="small"
                className="mt-1"
                color={experience === "failed" ? "warning" : "primary"}
                label={t(EXPERIENCE_KEYS[experience])}
              />
            </Box>

            <Box className="md:border-grey-100 min-w-48 md:border-l md:pl-4">
              <Typography variant="caption" className="text-text-secondary flex items-center gap-1 font-semibold">
                <NiShieldCheck size="tiny" aria-hidden /> {t("context-consents")}
              </Typography>
              <Box className="mt-1 flex flex-wrap gap-1">
                <Chip
                  size="small"
                  color={consents.audio ? "success" : "default"}
                  label={t(consents.audio ? "context-audio-granted" : "context-audio-missing")}
                />
                <Chip
                  size="small"
                  color={consents.ai ? "success" : "default"}
                  label={t(consents.ai ? "context-ai-granted" : "context-ai-missing")}
                />
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
            <Typography variant="caption" className="text-text-secondary font-semibold">
              {t("context-next-action")}
            </Typography>
            <Typography variant="body2" className="font-medium">
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
