"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

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
  Typography,
} from "@mui/material";

import { useAudioAllowance } from "@/hooks/use-audio-allowance";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { loadPatientBriefing, type PatientBriefing } from "@/lib/patient-briefing";
import { trackProductEvent } from "@/lib/product-events";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@flyee/clinical";

const OPEN_STATUS_KEY: Record<string, string> = {
  draft: "briefing-open-draft",
  in_progress: "briefing-open-in-progress",
  awaiting_review: "briefing-open-awaiting-review",
};

/**
 * The pre-consultation briefing: who is about to walk in, in one glance —
 * alerts, what the last consultation left, what is still pending. Assembled
 * deterministically from the record (no AI, no consent gate, every plan);
 * the AI conversation about the case stays one click away for Pro.
 */
export default function ConsultationBriefingDialog({
  open,
  onClose,
  patientId,
  patientName,
  appointmentNote,
}: {
  open: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  appointmentNote?: string | null;
}) {
  const t = useTranslations("product");
  const format = useFormatter();
  const { orgId } = useCurrentOrg();
  const { allowance } = useAudioAllowance(orgId);
  const canStudyCase = Boolean(allowance?.clinicalReasoning);

  const [state, setState] = useState<RemoteState<PatientBriefing, string>>(() => remoteLoading());

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setState(remoteError(t("library-not-configured")));
      return;
    }
    setState(remoteLoading());
    const result = await loadPatientBriefing(createClient(), patientId);
    setState(result.ok ? remoteSuccess(result.data) : remoteError(result.error));
    // Does preparing before the visit become part of the routine?
    if (result.ok) trackProductEvent("briefing.opened");
  }, [patientId, t]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const briefing = state.status === "success" ? state.data : null;
  const firstVisit = briefing && !briefing.lastFinalized && briefing.openConsultations.length === 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t("briefing-title", { name: patientName })}</DialogTitle>
      <DialogContent className="flex flex-col gap-4">
        {appointmentNote && (
          <Typography variant="body2" className="text-text-secondary">
            {t("briefing-appointment-note", { note: appointmentNote })}
          </Typography>
        )}

        {state.status === "error" ? (
          <Alert severity="error" action={<Button onClick={load}>{t("retry")}</Button>}>
            {state.error}
          </Alert>
        ) : state.status === "idle" || state.status === "loading" ? (
          <Box className="flex flex-col gap-2">
            <Skeleton variant="rounded" height={32} className="rounded-xl" />
            <Skeleton variant="rounded" height={96} className="rounded-2xl" />
            <Skeleton variant="rounded" height={64} className="rounded-2xl" />
          </Box>
        ) : briefing ? (
          <>
            {briefing.alerts.length > 0 && (
              <Box className="flex flex-row flex-wrap gap-2">
                {briefing.alerts.map(
                  (alert) =>
                    alert.label && (
                      <span
                        key={alert.label}
                        className="bg-accent-3/15 text-accent-3-dark dark:text-accent-3-light rounded-full px-3 py-1.5 text-sm font-semibold"
                      >
                        {alert.label}
                      </span>
                    ),
                )}
              </Box>
            )}

            {firstVisit ? (
              <Typography variant="body1" className="text-text-secondary leading-6">
                {t("briefing-first-visit")}
              </Typography>
            ) : (
              <>
                {briefing.lastFinalized && (
                  <Box className="flex flex-col gap-1.5">
                    <Typography variant="overline" component="h3" className="text-text-secondary">
                      {t("briefing-last-consultation", {
                        date: format.dateTime(new Date(briefing.lastFinalized.when), { dateStyle: "long" }),
                      })}
                    </Typography>
                    {briefing.lastFinalized.chiefComplaint && (
                      <Typography variant="body2">
                        <span className="text-text-secondary">{t("briefing-chief-complaint")}</span>{" "}
                        {briefing.lastFinalized.chiefComplaint}
                      </Typography>
                    )}
                    {briefing.lastFinalized.summary && (
                      <Typography variant="body2" className="text-text-primary leading-6">
                        {briefing.lastFinalized.summary}
                      </Typography>
                    )}
                    {briefing.lastFinalized.hypotheses.map((hypothesis) => (
                      <Typography key={hypothesis.pattern} variant="body2" className="text-text-primary">
                        {t("briefing-hypothesis", { pattern: hypothesis.pattern })}{" "}
                        <span className="text-text-secondary">
                          — {t(`hypotheses-match-${hypothesis.correspondence}`)}
                        </span>
                      </Typography>
                    ))}
                    {briefing.lastFinalized.planModalities.length > 0 && (
                      <Box className="flex flex-row flex-wrap items-center gap-1.5">
                        <Typography variant="body2" className="text-text-secondary">
                          {t("briefing-validated-plan")}
                        </Typography>
                        {briefing.lastFinalized.planModalities.map((slug) => (
                          <Chip key={slug} size="small" variant="outlined" label={t(`plan-modality-${slug}`)} />
                        ))}
                      </Box>
                    )}
                  </Box>
                )}

                {(briefing.openConsultations.length > 0 || briefing.gaps.length > 0) && (
                  <Box className="flex flex-col gap-1.5">
                    <Typography variant="overline" component="h3" className="text-text-secondary">
                      {t("briefing-pending")}
                    </Typography>
                    {briefing.openConsultations.map((consultation) => (
                      <Box key={consultation.id} className="flex flex-row flex-wrap items-center gap-2">
                        <Typography variant="body2" className="text-text-primary">
                          {t(OPEN_STATUS_KEY[consultation.status] ?? "briefing-open-draft")}
                          {consultation.chiefComplaint ? ` — ${consultation.chiefComplaint}` : ""}
                        </Typography>
                        <Button
                          size="tiny"
                          variant="text"
                          color="primary"
                          href={`/consultas/${consultation.id}`}
                          LinkComponent={Link}
                        >
                          {t("briefing-open-consultation")}
                        </Button>
                      </Box>
                    ))}
                    {briefing.gaps.length > 0 && (
                      <Box className="flex flex-col gap-1">
                        <Typography variant="body2" className="text-text-secondary">
                          {t("briefing-gaps-title")}
                        </Typography>
                        <Box component="ul" className="m-0 flex list-disc flex-col gap-0.5 pl-5">
                          {briefing.gaps.map((gap) => (
                            <Typography key={gap} component="li" variant="body2" className="text-text-primary">
                              {gap}
                            </Typography>
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                )}
              </>
            )}
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="grey" onClick={onClose}>
          {t("briefing-close")}
        </Button>
        {canStudyCase && (
          <Button color="grey" variant="outlined" href={`/biblioteca?paciente=${patientId}`} LinkComponent={Link}>
            {t("patient-study-case")}
          </Button>
        )}
        <Button color="primary" variant="contained" href={`/pacientes/${patientId}`} LinkComponent={Link}>
          {t("briefing-open-record")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
